# Phase 3: App Resilience + Client Wiring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task.

**Goal:** Make the phone actually drive the Phase 1 loop and survive the real-world BLE edge cases: send `gate_id` so reservation linkage fires, relay signed events to `ingest-events`, and harden the unlock/return flow against write failures, radio-off, mid-return disconnects, cold launch, and stale proximity.

**Architecture:** Keep the existing two-layer BLE split (`lib/ble/stationClient.ts` low-level GATT, `lib/hardware/ble.ts` driver) and the `driver.unlockGate/returnGate` seam. Phase 3 adds **pure, Jest-testable decision modules** (backoff schedule, radio-state gate, proximity freshness, cold-launch recovery decision, relay/ack helpers) and threads them into the thin BLE/driver wiring. The relay uses the renter's own connected phone as the primary courier (happy path); gossip-sync (any phone drains a station's buffer) is the backstop.

**Tech stack:** React Native / Expo, `react-native-ble-plx`, Zustand (`stores/sessionStore.ts`, `stores/nearbyStore.ts`), `supabase.functions.invoke`, Jest (`jest-expo`). The Phase 0 protocol contract (`lib/ble/protocol.ts`) and the Phase 1 `ingest-events` function are the server contract.

**Testability rule (same as Phases 1–2):** put decision logic in pure TS modules with NO `react-native-ble-plx` / native imports so Jest imports them directly; keep the BLE I/O wiring thin and verify it live. No new RN/BLE mock harness required for the pure logic.

---

## Grounding facts (verified — file:line)

- **sign-unlock invoke:** `lib/ble/signUnlock.ts:75-82` builds the body (`cmd, station_id, gate, session_id, duration_min, dev_bypass`). **No `gate_id`.** Called from `lib/hardware/ble.ts:296-302` via `fetchSignedUnlock(...)`.
- **gate_id slug** is built at `app/session-prep/[stationId]/[sport].tsx:254` as `` `${station.id}-${sport}-${Math.max(1, gateIndex+1)}` `` (e.g. `DEV-001-football-1`) and passed to `driver.unlockGate({ gateId, ... })` (`:256-262`) but **dropped before sign-unlock**.
- **Server already accepts `gate_id`** and logs `linkage skipped: no gate_id in request` when absent (`supabase/functions/sign-unlock/index.ts`). So sending it is the only client change needed to light up linkage.
- **Events handled locally only:** `lib/hardware/ble.ts:37-83 dispatchStationEvent()` mutates `sessionStore` and never POSTs. Subscription at `:174-192`. **No `ingest-events` call exists.**
- **No retry/backoff:** `stationClient.ts` `writeCharacteristicWithResponseForService` throws immediately (unlock `:266-286`).
- **Radio-off:** `requestPermission()` resolves PoweredOff as "granted" (`stationClient.ts:381-382`); no runtime gate before unlock. `classifyError()` maps to `bluetooth_off` only AFTER a failed scan (`ble.ts:207-208`).
- **Proximity:** passive scan → `nearbyStore.record({stationId, rssi, lastSeenAt})`, entries expire 15s (`nearbyStore.ts:18`). Unlock is **NOT gated** on fresh presence (`ble.ts unlockGate :280-318`).
- **Session persist:** Zustand persist→AsyncStorage (`sessionStore.ts:188-190`); persists `bleSessionId`, `gate`, firmware flags. **No explicit cold-launch re-subscribe** to EVENTS.
- **bleSessionId** = `correlationId` = `` `unlock:${stationId}:${sport}:${Date.now()}` `` (`session-prep:255`).

---

## ⚠️ Firmware dependency (drives the A/B split)

`ingest-events` **fails closed** on bad signatures. Today firmware emits **unsigned** events (Phase 0 Tasks 5–6, blocked on hardware). So any event relayed now would be rejected server-side. Therefore:

- **Group A (Tasks 1–6): works and is testable NOW**, no firmware needed — `gate_id` wiring + all BLE resilience + proximity.
- **Group B (Tasks 7–8): built against the contract now, unit-tested with mocked signed events, goes live once firmware Task 5 emits signed/sequenced events.** Clearly gated so it no-ops safely until then.

---

# GROUP A — works & testable now

## Task 1: Send `gate_id` to sign-unlock (lights up Phase 1 linkage)

**Files:** `lib/ble/signUnlock.ts`, `lib/hardware/ble.ts`, `app/session-prep/[stationId]/[sport].tsx` (thread the slug through), test `lib/ble/signUnlock.test.ts`.

**Step 1 (test):** extract a pure `buildSignUnlockBody(args)` in `signUnlock.ts` that returns the request body. Test that when `gateId` is provided it appears as `gate_id` in the body alongside numeric `gate`, and that the numeric `gate` (for the HMAC) is unchanged; when absent, `gate_id` is omitted (not `null`/`"undefined"`).
**Step 2:** run → fail. **Step 3:** implement `buildSignUnlockBody` + add optional `gateId` param to `fetchSignedUnlock`; thread `gateId` from `driver.unlockGate` (it already receives it) → `fetchSignedUnlock` → body. Do the same for `return_unlock` (it reuses the session's gate_id — store it on the session at unlock so return can resend it; see Task 5 persistence). **Step 4:** green. **Step 5:** commit `feat(app): send gate_id to sign-unlock so reservation linkage fires`.

> Persist `gateId` on the active session (`sessionStore`) at `startSession` so the return path can resend it without recomputing.

## Task 2: BLE write retry with backoff

**Files:** create pure `lib/ble/retry.ts` (`backoffSchedule(attempt)`, `isRetryable(error)`), wire into `stationClient.ts` unlock/return writes; test `lib/ble/retry.test.ts`.

**Step 1 (test):** `backoffSchedule` returns increasing delays with jitter bounds (e.g. base 200ms, ×2, cap 2s, ≤3 retries); `isRetryable(err)` true for transient GATT/connection errors, false for terminal (powered-off, unauthorized, signature-rejected). Assert the schedule length + monotonic caps + classification table.
**Step 2-4:** implement; wrap the `writeCharacteristicWithResponseForService` calls in a retry loop using the schedule, re-reading INFO between attempts if a reconnect happened. Terminal errors short-circuit (no retry). **Step 5:** commit `feat(ble): retryable write with bounded backoff+jitter`.

## Task 3: Runtime Bluetooth-off gate

**Files:** pure `lib/ble/btState.ts` (`canAttemptBle(state)` → `{ ok } | { ok:false, reason:'off'|'unauthorized'|'unsupported' }`), wire a pre-flight check into `driver.unlockGate`/`returnGate`; test `lib/ble/btState.test.ts`.

**Step 1 (test):** map `CBManagerState`/ble-plx `State` values → gate decision: `PoweredOn`→ok; `PoweredOff`→`off`; `Unauthorized`→`unauthorized`; `Unsupported`/`Resetting`/`Unknown`→appropriate. Pin the table.
**Step 2-4:** implement; before any unlock/return, read the current adapter state (ble-plx `state()`), call `canAttemptBle`; if not ok, surface the existing localized prompt (`bluetooth'u açıp tekrar dene`) WITHOUT attempting a write/scan. **Step 5:** commit `feat(ble): gate unlock/return on live radio state (turn-on-Bluetooth prompt)`.

## Task 4: Disconnect-mid-return fallback (never strand a renter)

**Files:** `lib/hardware/ble.ts` return flow; pure `lib/hardware/returnRecovery.ts` (decision: given disconnect during return-opening + a subsequent INFO read, is the gate confirmed closed?); test.

**Step 1 (test):** `interpretReturnRecovery({ phase, infoGateState, gotGateClosedEvent })` → `confirmed_closed | retry_return | manual_fallback`. Rules: if INFO shows the gate `LOCKED`/closed for this session → confirmed; if still `RETURN_UNLOCKED`/open → retry; if unreadable after retries → manual_fallback (let user tap "kapattım", existing path).
**Step 2-4:** on disconnect while `returnPhase==='opening'`, reconnect (Task 2 retry), re-`readInfo()`, run `interpretReturnRecovery`; confirmed → `markReturnConfirmed`; retry → resend `return_unlock`; manual_fallback → keep current manual tap. **Step 5:** commit `feat(return): disconnect-mid-return fallback via INFO re-read`.

## Task 5: Cold-launch recovery (re-attach the active session)

**Files:** pure `lib/hardware/coldLaunch.ts` (`shouldReattach(persistedSession, nowMs)`), wire into app startup (where the driver/init lives) to re-subscribe to EVENTS + restore the meter; test.

**Step 1 (test):** `shouldReattach` true iff a persisted active session exists, not already returned/terminal, and within max age; returns the `bleSessionId`/`gateId`/`gate` needed to resume. False for returned/expired/none.
**Step 2-4:** on launch, if `shouldReattach`, re-establish passive watch for that station and re-`subscribeToEvents` so a `gate_closed` arriving post-relaunch still confirms return; ensure the return path still works with the persisted `bleSessionId`+`gateId`. **Step 5:** commit `feat(session): cold-launch re-attach + event re-subscribe`.

## Task 6: Proximity honesty before unlock

**Files:** pure `lib/hardware/proximity.ts` (`isFreshlyPresent(sighting, nowMs, { maxAgeMs, minRssi })`), gate the unlock CTA + a pre-write check; test.

**Step 1 (test):** fresh iff `nowMs - lastSeenAt <= maxAgeMs` (default 10s) AND (optional) `rssi >= minRssi`. Stale/absent → not present. Pin boundary.
**Step 2-4:** surface "unlock" only when `isFreshlyPresent` for that station (use `nearbyStore`); if a user reaches unlock but presence is stale, require a fresh read (live GATT connect IS proof of presence, so on connect success treat as present). Document that security is already guaranteed by needing a live connection — this is UX honesty, not a security control. **Step 5:** commit `feat(unlock): gate CTA on fresh BLE presence (UX honesty)`.

---

# GROUP B — built now, live after firmware emits signed events

## Task 7: Real-time event relay to `ingest-events` (primary courier = renter's phone)

**Files:** pure `lib/hardware/relay.ts` (`buildIngestBatch(stationId, events)`, `pickAckedSeq(response)`), wire into `dispatchStationEvent`; test with mocked signed events + mocked `supabase.functions.invoke`.

**Behavior:** when the connected phone receives EVENTS notifications, buffer them and POST `{ station_id, events }` to `ingest-events`; on response, hand the returned `acked_seq` to the ack relay (Task 8). **Gate it:** only relay events that carry a `sig` + `seq` (Phase 0 signed shape); today's unsigned events are skipped (so this no-ops safely until firmware Task 5). Best-effort: relay failure must NOT affect the local session UX (local dispatch still runs).
**Tests:** `buildIngestBatch` shape; signed events included, unsigned skipped; relay failure swallowed; `pickAckedSeq` parses the response. **Commit** `feat(relay): post signed station events to ingest-events (gated on signed shape)`.

## Task 8: Gossip-sync drain + ack relay (any phone, backstop)

**Files:** `lib/hardware/gossip.ts` (pure `planGossipDrain(infoOrBuffer, lastAcked)` + `buildAckCommand(acked_seq)`), wire into the on-connect path; test.

**Behavior:** on ANY station connect (even passive→active for a different user), read the station's pending signed-event buffer (a firmware buffer-drain characteristic — Phase 0 Task 5d), POST to `ingest-events`, then write an unsigned `ack` command (`{cmd:'ack', seq: acked_seq}`) back so the station drops buffered events ≤ acked_seq. **Firmware-dependent:** the buffer-drain + ack characteristics are Phase 0 Task 5; until they exist, `planGossipDrain` returns "nothing to drain" and this no-ops. Build + unit-test the planning/ack logic now.
**Tests:** `planGossipDrain` returns the right events given a buffer + lastAcked; `buildAckCommand` shape; no-op when buffer empty/absent. **Commit** `feat(gossip): drain station event buffer + ack relay (firmware-gated)`.

---

## Out of scope (later)
- Firmware buffer-drain + `ack` + signed-event emit — Phase 0 Tasks 5–6 (hardware).
- Phase 2 money settlement (iyzico consuming `*_eligible_at`).
- Phase 4 abuse/support tooling.

## Definition of done (Phase 3)
- **Group A green & shippable to TestFlight now:** `gate_id` reaches sign-unlock (linkage fires once events flow); writes retry with backoff; radio-off/​unauthorized gates the flow with the turn-on prompt; mid-return disconnect recovers via INFO re-read; cold launch re-attaches + re-subscribes; unlock CTA reflects fresh presence. All pure decision modules Jest-tested.
- **Group B built + unit-tested, no-ops safely until firmware:** signed events relay to `ingest-events`; gossip drain + ack planned. Live end-to-end deferred to the firmware swap, then proven by the Phase 1 `_sim` + a real station.
- **Live gate:** with Phase 1 deployed + firmware emitting signed events, a real unlock→return round-trips through `ingest-events` and the reservation shows `opened_at`/`returned_at`/`release_eligible_at`.
