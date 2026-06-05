# Playbox — Production Hardening Design

**Date:** 2026-06-05
**Status:** Design / agreed direction
**Author:** brainstormed with Claude

---

## 1. Context & goal

Playbox is an on-demand sports-equipment rental product for Turkey (React Native / Expo, Clerk auth, Supabase, `react-native-ble-plx`). Reference model: [equip.sport](https://equip.sport) (500 stations across Europe, partner-funded, "easy to maintain" station OS + analytics). Playbox differs: **users pay to rent the balls**, with an additional **safety deposit / penalty** for theft or wrong-item return.

Hardware: ESP32 station with N independent gates (MG996R servo per gate + reed switch), powered by a **TTEC 12V 7Ah VRLA (sealed lead-acid) battery**. Solenoids inbound; firmware will be swapped plug-and-play.

**The single defining constraint:** the station's **only** link to the outside world is **BLE, via a user's phone.** There is no WiFi/LTE uplink. The station is, for all practical purposes, an **offline device**, and every phone that connects is an **untrusted courier**.

This document defines the invariants the production system must never violate, the architecture that holds under the BLE-only constraint, the firmware protocol changes required, and a phased plan.

---

## 2. Invariants (must never break)

1. **No capture without dispense.** A rental charge is only finalized after the gate physically opens (firmware-confirmed `gate_opened`), never on "we sent the write."
2. **No wrongful deposit/penalty.** A deposit is only captured after a max-duration window passes with **no** signed `gate_closed` for that session. A confirmed return must always release the hold — even if the confirmation arrives late, via a different phone.
3. **No dispense without a paid, live session.** The gate opens only for a server-signed command bound to a live reservation. (Already true — unlock commands are HMAC-signed.)
4. **Every session terminates.** No session stays "active" forever; each resolves to `returned`, `auto_closed`, or `disputed` with a settled charge.
5. **App state ⊆ hardware truth.** When app and station disagree, the station's **signed reed-switch events win**; the server reconciles.

---

## 3. Current-state audit (firmware + protocol)

Verified against `firmware/PlayboxStation.ino`, `firmware/PlayboxStation_3gate.ino`, `lib/ble/protocol.ts`, `lib/ble/stationClient.ts`.

| Area | Today | Gap for production |
|------|-------|--------------------|
| Time | `millis()` only, boot-relative `ts` seconds. No RTC. Phone does **not** send wall-clock. | Events can't be placed on a real timeline after a courier delay. |
| Event delivery | Fire-and-forget BLE notify, only if `bleConnected`. | Lost if no phone is listening at that instant → **wrongful penalty**. |
| Event sequencing | None. | Can't detect dropped events or dedupe. |
| Event signing | **Commands signed (phone→station); events unsigned (station→phone).** | A courier phone could forge/tamper "gate_closed." |
| Persistence | Gate state + `session_id` persisted to NVS; **event history is not.** | Reboot or no-listener loses proof. |
| Gate state read | INFO char exposes per-gate `state` + `session_id`. | No "occupied since" timestamp. |
| Battery | Hardcoded `battery_pct = 100`. `battery_low` event type defined, never emitted. | Battery-only + BLE-only = blind to power state. |
| Session binding | `session_id` carried in unlock and echoed in `gate_closed`. ✅ | Sound; keep it. |

---

## 4. Architecture: signed offline event log + courier phones

### 4.1 Station = durable, signed event log

The station maintains a **monotonic event log** in NVS:

- Each event gets a strictly increasing `seq` (persisted across reboot).
- Each event is **HMAC-signed** with the same per-station secret used for unlock verification.
- Events are held in an **NVS ring buffer** until the server **acks** their `seq` (ack relayed back by any phone).
- The buffer survives reboots and "no phone listening."

### 4.2 Phones = untrusted couriers + gossip sync

- The active user's phone relays events in real time in the happy path.
- **Every** phone that comes into BLE range of any station performs a **gossip sync**: read INFO (current gate states), drain the pending signed-event buffer, upload to the server, relay back the server's ack-cursor (`acked_seq`) so the station can free buffer slots.
- Because events are signed, a stranger's phone is safe as a courier — it cannot forge or alter them, and it sees no PII (just opaque signed blobs + station id).
- This is what closes **abandoned sessions**: user unlocks, walks away, never reconnects → the station knows the door is open, and the next unrelated phone carries that fact to the server.

### 4.3 Time anchoring (no RTC needed)

On connect, the phone writes `now` (unix seconds) to the station. Firmware computes `boot_epoch = now − millis()/1000` (once, or smoothed across connects). Every event stamps `wall_ts = boot_epoch + millis()/1000`. Server treats `wall_ts` as advisory and computes **durations from event deltas** (`close − open`), never from arrival time.

---

## 5. Money & deposit state machine

Two independent money objects per session:

**Rental charge**
- `reserved` → on unlock attempt, authorize rental amount (hold).
- `captured` → on signed `gate_opened`. (Invariant 1)
- `voided` → if no `gate_opened` within unlock window.

**Safety deposit / penalty**
- `held` → placed at unlock alongside rental auth.
- `released` → on signed `gate_closed` for the session (return confirmed). (Invariant 2)
- `captured` (penalty) → only after `max_session_duration` elapses with **no** `gate_closed`, **or** an explicit `wrong_item`/`overdue` resolution. Must be **idempotent** and **reversible** by support if a late return event arrives.

**Overtime:** rental meter accrues from `gate_opened` to `gate_closed` deltas, with a **hard ceiling** so a forgotten/abandoned session cannot bill unbounded. After the ceiling → auto-close + deposit penalty path.

All capture/void operations keyed by `(station_id, gate, session_id, seq)` → **idempotent**; replayed courier deliveries never double-charge.

---

## 6. Firmware protocol v2

Five load-bearing additions (small, mostly in the `.ino` + `protocol.ts`):

1. **Event signing.** Every event JSON gains `sig = HMAC(secret, "<event>|<gate>|<session_id>|<seq>|<wall_ts>|<payload>")`. App verifies before trusting/uploading.
2. **Sequence numbers.** Global monotonic `seq` per station, persisted to NVS; included in every event.
3. **NVS event ring buffer.** Hold last K events (sized to flash budget; e.g. 64–128). Drop oldest only after `acked_seq` advances past it. Replayed on every connect until acked.
4. **Wall-clock anchoring.** New `set_time` command (phone→station, signed or trusted-on-connect) sets `boot_epoch`. Events stamp `wall_ts`.
5. **Real battery telemetry** (see §7). Replace hardcoded `100` with measured SoC; emit `battery_low` / `battery_critical` events.

App-side INFO read should additionally expose, per gate: `state`, `session_id`, `occupied_since_wall_ts` (so the server learns abandoned-since time from a gossip read alone).

New/confirmed event types: `gate_opened`, `gate_closed`, `unlock_timeout`, `return_timeout`, `boot`, `battery_low`, `battery_critical`, `wrong_item?` (if a reed/scale check is added later).

---

## 7. Battery & power management (12V 7Ah VRLA)

Sealed lead-acid has hard rules that must shape firmware + ops:

- **ADC reading:** 12–14.4V exceeds the ESP32 3.3V ADC. Use a voltage divider (~5:1, e.g. measure ≤2.9V at 14.4V charge) + a known-good ADC calibration. Read **at rest** (between servo actuations) because lead-acid voltage **sags under load**; the MG996R inrush can drop the rail and produce a false-low reading.
- **State-of-charge curve (resting voltage):** ≈12.7V = 100%, 12.2V ≈ 60%, 12.06V ≈ 50%, 11.9V ≈ 40%, 11.6V ≈ 20%, ≤10.5V = empty/damaging. Map voltage→SoC with this curve, not linearly.
- **Thresholds & behavior:**
  - `battery_low` (~11.9V / ~40%): emit event, courier out, show ops "recharge soon."
  - `battery_critical` (~11.5V): emit event; **refuse new unlocks** (preserve enough charge to let in-progress users return their gear).
  - Hard floor (~11.0–11.3V): protect the battery; never deep-discharge below ~10.5V.
- **Servo brownout guard:** measure battery before actuating; if below the actuation floor, report `battery_critical` rather than browning out mid-move. Keep the separate buck supply (LM2596) for the servo rail.
- **Fail-safe on power loss:** gates hold their last physical position (servo unpowered). Define operationally: a station that dies mid-session leaves that gate physically as-is until serviced; the session auto-closes server-side on the abandoned-timer, and support reconciles the deposit when the gear is recovered.
- **Recharge cadence is an operational metric.** Recharge is **manual / on-site (jumper-cable style)** — no solar, no battery swap. So battery telemetry couriered out = the "go service station X" signal (equip's "easy to maintain" parallel), and it must give **enough lead time for a human to travel out** before the station hits `battery_critical`. Set `battery_low` conservatively (≈40% / ~11.9V) and track per-station discharge rate so the ops view can predict "service by date X."

---

## 8. Server reconciliation & data model (sketch)

Supabase tables (server-authoritative):

- `stations` — id, secret (KMS/edge-only), gate_count, last_seen_wall_ts, battery_soc, fw_version.
- `sessions` — id, station_id, gate, user_id, sport, reserved_at, opened_at, closed_at, status (`reserved|active|returned|auto_closed|disputed`), rental_state, deposit_state.
- `station_events` — station_id, seq, event, gate, session_id, wall_ts, sig, received_via_user_id, received_at. **Unique (station_id, seq)** → courier dedupe.
- `ack_cursors` — station_id, acked_seq (relayed back to firmware to free buffer).

Reconciliation worker:
- Ingests courier-uploaded events, verifies `sig`, dedupes by `(station_id, seq)`, advances session state machine.
- Runs the **abandoned-session sweep**: any `active` session past `max_session_duration` with no `gate_closed` → `auto_closed` + deposit penalty path (reversible).
- Detects **gaps** in `seq` → flags station for "events pending, need a courier."

---

## 9. App resilience

- **BLE write retry** with exponential backoff + jitter (none today). Distinguish transient (retry) vs terminal (surface clear UX).
- **Bluetooth radio OFF at runtime:** iOS reports permission "granted" while `CBManagerState == PoweredOff`. Explicit "turn on Bluetooth" gate before any unlock/return attempt.
- **Disconnect mid-return:** fallback path — re-scan + re-read INFO to confirm `gate_closed` landed; if confirmed, close the session even though the live notify was missed. Never strand a user unable to return.
- **Cold-launch recovery:** verify Zustand persist re-attaches the meter and can still issue `return_unlock` with the same `session_id` after app kill / phone restart.
- **Gossip sync hook:** on any station connect (even passive map proximity), opportunistically drain + upload the event buffer.

### Proximity gating (the "BLE range" requirement)
A live GATT connection **is** proof of presence — you physically cannot unlock a station you're not near. So security is already covered. The remaining work is **UX honesty**: only surface "unlock" when there is a **fresh** advert from *that* `station_id` (RSSI threshold + recency window, e.g. seen < ~10s ago). Stale presence → re-require a live read before enabling unlock.

---

## 10. Abuse, trust & support

- **Server-side event log is the dispute record.** "I returned it!" is resolved by the signed `gate_closed` (or its absence). Without §4's signed log, disputes are unwinnable.
- **Support tooling:** remote-issue a deposit refund/reversal; mark a session `disputed`; view per-station event timeline + battery history.
- **Wrong-item / theft:** deposit penalty path; later hardware option (load cell / second reed) can emit a `wrong_item` signal, but v1 relies on deposit + manual review.
- **Lost gear / photo-on-return:** the review screen's photo verification (currently stubbed) feeds manual review, not auto-charge.
- **Rate/abuse limits:** one active session per gate (server reservation lock); cap concurrent sessions per user.

---

## 11. Edge-case matrix (★ = launch blocker)

| # | Scenario | Required behavior |
|---|----------|-------------------|
| ★1 | Unlock write sent, no `gate_opened` in window | Void rental hold; release deposit; never capture. |
| ★2 | Gate opens, app crashes before relaying | Capture from couriered signed `gate_opened` (happy or gossip path). |
| ★3 | Return done, `gate_closed` notify missed (disconnect) | Confirm via INFO re-read / next courier; release deposit; **no penalty**. |
| ★4 | User walks away, never reconnects | Station holds open-state; next stranger's phone couriers it; server auto-closes at ceiling. |
| ★5 | Bluetooth radio off at runtime | Explicit enable-BT gate; block unlock/return. |
| ★6 | Battery critical | Refuse new unlocks; allow returns; courier `battery_critical`. |
| 7 | Station reboot mid-session | NVS restores gate state + session_id + event buffer; `boot` event couriered. |
| 8 | Two phones, one gate | Server reservation lock; one active session per gate. |
| 9 | Replayed courier delivery | Idempotent by `(station_id, seq)`; no double-charge. |
| 10 | Overtime / forgotten session | Meter ceiling → auto-close → deposit penalty (reversible). |
| 11 | Late return event after penalty captured | Reconciliation reverses penalty; refund deposit. |
| 12 | Stale proximity UI | Re-require fresh advert + live read before enabling unlock. |

---

## 12. Phased plan

**Phase 0 — Firmware protocol v2 (blocker for everything money-related)**
Signed events · seq numbers · NVS ring buffer · wall-clock anchoring · real battery ADC + thresholds. Update `protocol.ts` + both `.ino` files. Test against `app/dev/ble.tsx` harness. Swap in real solenoid actuation when hardware arrives (plug-and-play).

**Phase 1 — Server reconciliation**
Supabase schema (§8) · edge functions verify event `sig` + dedupe · session state machine · abandoned-session sweep · ack-cursor relay.

**Phase 2 — Money correctness**
Rental capture-on-open, deposit release-on-close, idempotent + reversible penalty path, overtime ceiling. Wire to real payments (currently holds-only, no rollback).

**Phase 3 — App resilience**
BLE retry/backoff · radio-off gate · disconnect-mid-return fallback · cold-launch recovery · gossip-sync hook · proximity UX honesty.

**Phase 4 — Abuse, support & ops**
Dispute record UI · remote deposit reversal · per-station event + battery timeline (the "maintenance OS" parallel) · recharge-cadence metric · one-session-per-gate lock.

**Phase 5 — Tests**
Protocol codec (exists) + signing/seq · reconciliation dedupe/idempotency · simulated courier delay/out-of-order · timeout & abandoned-session sweeps · battery threshold behavior.

---

## 13. Open questions / risks

- **Recharge logistics:** ✅ Resolved — **manual on-site recharge (jumper-cable style)**, no solar/swap. Implication: battery alerting must give human travel lead time (see §7); track discharge rate per station to predict service-by dates.
- **Payment rails:** ✅ Resolved — **iyzico** (Turkey), wired in Phase 2. Deposit amount TBD.
- **NVS wear:** ring-buffer write frequency vs flash endurance — bound writes (batch, only on state change).
- **Time-anchor trust:** is `set_time` signed, or trusted-on-connect? A malicious phone skewing `boot_epoch` only affects advisory `wall_ts` (durations come from deltas), but worth deciding.
- **Multi-gate secret scope:** one secret per station vs per gate.
