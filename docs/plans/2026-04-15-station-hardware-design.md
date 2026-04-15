# Station Hardware Design — BLE Rental Cabinet

**Date:** 2026-04-15
**Status:** Design approved, ready for Phase 0 implementation
**Author:** @canberkvarli (with Claude)

## 1. Problem & goals

Playbox today is map-browse only with mock stations. We want a real physical product: an outdoor **locked cabinet at a basketball court** containing 3 sports balls (e.g. basketball, football, volleyball), each behind its own small gate. Users rent a ball through the app, play, return the ball, pay.

Constraints from the user:

- **No internet at the station.** The cabinet sits at an outdoor court; no WiFi, no SIM, no LoRa gateway. The phone is the only connected device.
- **Turkish-locked UX.** All user-facing copy is Turkish (`Müsait`, `Dolu`, `OYNA!`, `Anladım`, `Topu İade Et`).
- **"Just push the gate" return.** Session ends when the reed switch sees the gate close after a return-unlock. No complex mechanical drop-slot in v1.
- **Existing stack only.** Expo 54 + Clerk + Supabase + Zustand. No new frameworks.

Success = a user can scan a QR code at a real basketball court in Istanbul, rent a ball, play for 30–120 min, return the ball, and be charged correctly — all without the station ever touching the internet.

## 2. Architecture

```
┌─────────────────────┐         ┌─────────────────────┐        ┌──────────────┐
│  Playbox app        │◀──BLE──▶│  ESP32 at station   │──wires─▶│  Solenoid×3 │
│  (user's phone)     │         │  (inside cabinet)   │        │  (per gate) │
│                     │         │                     │◀─wires─│  Reed×3     │
└──────────┬──────────┘         └─────────────────────┘        └──────────────┘
           │ 4G/WiFi                      ▲
           ▼                              │ (BLE when phone near)
┌─────────────────────┐                   │ sneakernet: events relayed
│  Supabase           │◀──────────────────┘ by next phone to pass by
│  (stations,         │
│   station_gates,    │
│   sessions,         │
│   station_events)   │
└─────────────────────┘
```

**The phone is the bridge.** ESP32 stores events in flash; phones that connect over BLE drain the event queue and relay it to Supabase. The user's own phone handles the happy path (BLE range while playing); any Playbox phone handles the fallback.

## 3. User flow — one complete rental

1. User walks up to the cabinet and **scans the QR code** sticker. Deep link `playbox://station/IST-BB-042` opens the app.
2. **Station detail screen** (Screen 1) shows the 3 gates with Turkish status labels:
   - `Kapı 1 — Basketbol — Müsait`
   - `Kapı 2 — Futbol — Müsait`
   - `Kapı 3 — Voleybol — Dolu (bitiş 18:42)`
3. User taps an available gate → **duration picker** (Screen 2): `30 dk`, `1 saat`, `2 saat`.
4. **"Nasıl Çalışır?" tutorial slides** (Screen 3), existing onboarding flow. Final slide has CTA `Anladım, OYNA!`.
5. On tap, app optimistically inserts a `sessions` row (`status='active'`), connects over BLE, writes the `unlock` command. ESP32 pulses the solenoid for that gate. User grabs the ball and closes the gate.
6. **Active session screen** (Screen 5) shows a live countdown timer and a big **`Topu İade Et`** button.
7. When the user returns: tap `Topu İade Et` → app re-connects BLE → sends `return_unlock` → solenoid pulses → user drops ball, closes gate → reed switch fires → ESP32 emits `gate_closed` event on the notify characteristic.
8. Phone catches the event → posts to Supabase `relay-events` edge function → session marked `completed`, charge finalized, receipt shown.

**Timeout handling** (server-side, no hardware involvement):

| Time past `started_at + duration_min` | Action |
|---|---|
| +5 min | Push: "Kiralamanız bitti, kapıyı kapat." |
| +30 min | Push: "Kapı hala açık, 30 dk sonra ek ücret." |
| +60 min | Auto-charge overage, keep ticking. |
| +24 h | Mark session `lost`, charge replacement fee, flag station for inspection. |

A late `gate_closed` event (sneakernet delay) always wins: truth-source is the reed switch; the server refunds any overcharge when the real event arrives.

## 4. Supabase schema

```sql
-- stations: promoted from seed data to a real table
create table stations (
  id            text primary key,              -- "IST-BB-042"
  name          text not null,
  city          text not null,
  lat           double precision not null,
  lng           double precision not null,
  sports        text[] not null,
  ble_device_id text unique,                   -- ESP32's BLE MAC, for pairing
  firmware_ver  text,
  last_seen_at  timestamptz,
  status        text not null default 'active' -- active | maintenance | offline
);

-- one row per physical gate (typically 3 per station)
create table station_gates (
  id           text primary key,              -- "IST-BB-042-G1"
  station_id   text not null references stations(id),
  gate_number  int  not null,                 -- 1, 2, 3
  sport        text not null,                 -- basketball | football | volleyball
  ball_label   text,                          -- "Futbol Topu"
  status       text not null default 'available', -- available | in_use | maintenance | lost
  unique (station_id, gate_number)
);

-- a single rental
create table sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,                 -- Clerk user ID
  gate_id       text not null references station_gates(id),
  station_id    text not null references stations(id),  -- denormalized for lookup speed
  sport         text not null,
  duration_min  int not null,                  -- 30 | 60 | 120
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  end_source    text,                          -- 'gate_closed' | 'timeout' | 'manual' | 'lost'
  price_cents   int,
  status        text not null default 'active' -- active | completed | overdue | lost
);
create index on sessions (gate_id) where status = 'active';
create index on sessions (user_id);

-- raw audit log from the ESP32, relayed by phones
create table station_events (
  id           bigserial primary key,
  station_id   text not null references stations(id),
  gate_id      text references station_gates(id),
  session_id   uuid references sessions(id),
  kind         text not null,                 -- 'unlock' | 'gate_closed' | 'gate_opened' | 'battery_low' | 'boot'
  occurred_at  timestamptz not null,          -- ESP32's local clock
  relayed_at   timestamptz not null default now(),
  relayed_by   text not null,                 -- Clerk user_id of the phone that carried it
  payload      jsonb
);
create index on station_events (station_id, occurred_at desc);
```

RLS policies: users can read `stations` and `station_gates`; can read their own `sessions`; can insert into `sessions` and `station_events` where `user_id = auth.uid()`. Admin service role for everything else.

**Edge function `relay-events`**: accepts `{station_id, events: [...]}`. Inserts each event into `station_events`. For `gate_closed` events, matches to the relevant `active` session and sets `ended_at`, `end_source='gate_closed'`, `status='completed'`, computes `price_cents`, triggers charge.

**pg_cron `session-timeouts`**: runs every minute, scans `sessions` where `status='active' AND now() > started_at + duration_min * interval '1 minute' + grace`. Sends the appropriate push notification or transitions status per the timeout table above.

## 5. Hardware

**Per station:**

| Part | Qty | Notes |
|---|---|---|
| ESP32 DevKit (WROOM-32, 30 or 38 pin) | 1 | User already owns one. |
| 12V solenoid lock, fail-secure | 3 | One per gate. Fail-secure = stays locked with no power. |
| 1-ch 5V relay module (or IRLZ44N MOSFET) | 3 | Drives the 12V coil from 3.3V GPIO. |
| Reed switch + magnet | 3 | On each gate; magnet on the door, switch on the frame. |
| 1N4007 flyback diode | 3 | Across each solenoid coil — critical to prevent relay damage. |
| 12V 7Ah sealed lead-acid battery | 1 | User has battery already. |
| LM2596 buck converter (12V → 5V) | 1 | Powers the ESP32. |
| 10W solar panel + charge controller | 1 | Outdoor deployment only. |
| IP65 weatherproof enclosure | 1 | Essential for Istanbul weather. |
| Fuses, wires, connectors | — | 5A inline fuse on the battery line. |

**Pin map (illustrative — finalized in firmware):**

```
GPIO 23 → Relay 1 IN  → Solenoid 1 (+12V via relay contact)
GPIO 22 → Relay 2 IN  → Solenoid 2
GPIO 21 → Relay 3 IN  → Solenoid 3
GPIO 19 ← Reed 1 (other side GND, internal pull-up)
GPIO 18 ← Reed 2
GPIO  5 ← Reed 3
GPIO 34 ← Battery voltage divider (ADC, 12V → 3.3V via 10k/3.3k)
```

**Arduino IDE board setting:** `ESP32 Dev Module` is the universal pick for WROOM-32 boards. Exact board + port to be confirmed with a photo at Phase 0.

## 6. BLE contract (app ↔ firmware)

Service UUID: `12340000-0000-0000-0000-000000000000` (placeholder — will finalize).
Advertised name: `Playbox-<station_id>` (e.g. `Playbox-IST-BB-042`).

| Characteristic | UUID suffix | Direction | Payload (JSON, UTF-8) |
|---|---|---|---|
| `UNLOCK` | `...-0001` | phone → ESP32 (write) | `{"cmd":"unlock","gate":2,"session_id":"uuid","duration_min":60}` |
| `UNLOCK` | `...-0001` | phone → ESP32 (write) | `{"cmd":"return_unlock","gate":2,"session_id":"uuid"}` |
| `EVENTS` | `...-0002` | ESP32 → phone (notify) | `{"event":"gate_closed","gate":2,"session_id":"uuid","ts":1712345678}` |
| `EVENTS` | `...-0002` | ESP32 → phone (notify) | `{"event":"battery_low","v":11.2,"ts":1712345678}` |
| `INFO` | `...-0003` | phone → ESP32 (read) | `{"station_id":"IST-BB-042","fw":"0.1.0","gates":3,"battery_pct":72}` |

On connect, the ESP32 flushes its pending event queue through `EVENTS` notifications before accepting new commands.

## 7. ESP32 firmware outline

Single `.ino` file, ~300 lines. Author: Claude (user does not write C++).

Responsibilities:
1. **BLE server** using `NimBLE-Arduino` (smaller memory footprint than the stock BLE library).
2. **Per-gate state machine** (3 instances):
   ```
   LOCKED ─unlock cmd─▶ UNLOCKED ─reed closes─▶ IN_USE
   IN_USE ─return_unlock cmd─▶ RETURN_UNLOCKED ─reed closes─▶ LOCKED
                                                                 │
                                                                 └─▶ emit gate_closed event
   ```
3. **Event queue in NVS flash** (`Preferences` library). Every state change appended; drained on next BLE connect. Survives power loss.
4. **Housekeeping loop**: read battery ADC every 60s, emit `battery_low` under 11.5V, blink onboard LED to show liveness.

Libraries: `NimBLE-Arduino`, `Preferences`, `ArduinoJson`.

Starter firmware will be delivered at Phase 0 as `PlayboxStation.ino`.

## 8. App-side changes

**New files:**
- `lib/ble/stationClient.ts` — thin wrapper around `react-native-ble-plx`: `connect(stationId)`, `unlock(gate, sessionId, durationMin)`, `returnUnlock(gate, sessionId)`, `subscribeEvents(callback)`.
- `app/station/[id]/play.tsx` — Screens 2–5 flow (duration → tutorial → unlock → active session).

**Modified files:**
- `lib/supabase.ts` — typed query helpers for `stations`, `station_gates`, `sessions`, and the `relay-events` RPC call.
- `app/station/[id].tsx` — replace mock reads with Supabase queries; render the gate list with Turkish status pills.
- `stores/sessionStore.ts` — add `gateId`, `bleStatus`, `pendingRelayEvents` queue.
- `data/stations.seed.ts` — becomes a one-time migration script that seeds the real Supabase `stations` table, not a runtime import.

**New dependency:** `react-native-ble-plx`. Requires an Expo dev build (which the project already uses on SDK 54 — Expo Go won't work).

## 9. Rollout plan

| Phase | Scope | Duration | Success criteria |
|---|---|---|---|
| 0 — Breadboard handshake | ESP32 + LED + button, minimal firmware, debug screen in app | 2–3 days | Tap "fake unlock" in app → LED lights; press button → app shows "gate closed" toast. |
| 1 — Real lock mechanism | Swap LED→solenoid, button→reed switch. Same firmware + app. | 2–3 days | Physically unlock a test latch from the app. |
| 2 — Supabase + sneakernet | Create tables, `relay-events` edge function, `session-timeouts` cron. Replace mocks. | 3–4 days | Unlock → `sessions` row appears; close gate → row updates to `completed` with correct end time. |
| 3 — Full app UX | Screens 1–5, tutorial, Turkish copy, error states, QR deep links, design polish. | 4–5 days | A friend completes a rental on the breadboard without help. |
| 4 — Real cabinet indoors | Build 3-gate cabinet, battery, buck converter. Soak-test for a week in the apartment. | ~1 week | 50+ rentals with zero failures; battery life measured. |
| 5 — Outdoor pilot | Weatherproof enclosure, solar, mounting. One real basketball court in Istanbul. | ~1 week live | A week of real users, clean event stream, battery holds. |
| 6 — Second station | Repeat Phase 5 somewhere else to validate repeatability. | ongoing | Install process documented and reproducible. |

## 10. Open items & Phase-2 features

Flagged during design but deliberately deferred:

- **Pricing model.** Flat `duration_min × rate` for v1. A `rates` table (per sport, per station, per time-of-day) goes in Phase 2.
- **Pause feature.** Max 10 min cumulative pause per session. Firmware needs a `PAUSED` state per gate so reed-switch closes don't end the session while paused.
- **Extend feature.** Max one 30-min extend per session. Firmware needs an `extend` BLE command that updates the session's `duration_min` and refreshes the stored value.
- **Weight / IR sensor** inside each gate to confirm the ball is actually present before accepting `gate_closed` as a session end. Catches the "empty gate" fraud case. Probably HX711 + load cell, ~₺100/gate.
- **"Don't show again"** on the tutorial slides after the first rental.
- **Admin dashboard** (web) for monitoring station events, battery health, stuck sessions.
- **Firmware OTA updates** over BLE. Painful but eventually necessary — manually flashing 20 deployed stations doesn't scale.
- **Station status page** for users: "bu istasyon bakımda, en yakın müsait istasyon şurada."

## 11. Key file paths

- Supabase client: [lib/supabase.ts](../../lib/supabase.ts)
- Station detail (will be heavily modified): [app/station/[id].tsx](../../app/station/[id].tsx)
- Session state: [stores/sessionStore.ts](../../stores/sessionStore.ts)
- Existing station data (to be migrated to DB): [data/stations.seed.ts](../../data/stations.seed.ts)
- Map screen (reads station list): [app/(tabs)/map.tsx](../../app/(tabs)/map.tsx)
- Existing schema plan (related): [docs/plans/2026-04-15-supabase-schema.md](./2026-04-15-supabase-schema.md)
