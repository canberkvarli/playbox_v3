# Phase 0: Firmware Protocol v2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the BLE event protocol so station→phone events are signed, sequenced, and durable — the contract that makes the store-and-forward courier architecture and money correctness possible.

**Architecture:** The station becomes a signed, monotonic event log. Each event carries `seq` (monotonic, NVS-persisted) + `sig` (HMAC over a canonical string). Phones are untrusted couriers: they relay/upload opaque signed events but **never verify** them (no secret on device). The **server** holds the per-station secret and verifies + dedupes by `(station_id, seq)`. Time is anchored by an unsigned `set_time` the phone writes on connect (`boot_epoch = now − millis()/1000`); durations are computed server-side from event deltas, so `wall_ts` is only advisory.

**Tech Stack:** TypeScript (`lib/ble/protocol.ts`, pure — no crypto, stays RN-bundle-safe), Jest, Node `crypto` (server-only module + edge function), ESP32 Arduino (`firmware/*.ino`, NimBLE + ArduinoJson + NVS/Preferences).

**Scope boundary:** This phase delivers the *protocol contract* (testable TS now) and the *firmware spec* (validated via `app/dev/ble.tsx` harness when hardware/sim is available). Server reconciliation tables (Phase 1) and payments (Phase 2) are out of scope; we only build the server-side **verify + canonical-payload** helpers the contract needs.

**Canonical signing strings (MUST match byte-for-byte on firmware + server):**
- Command (unchanged): `${cmd}|${gate}|${session_id}|${duration_min ?? 0}|${ts}`
- Event (new): `${event}|${gate ?? ""}|${session_id ?? ""}|${seq}|${wall_ts}|${extra}`
  where `extra` is event-specific: `battery_low`/`battery_critical` → the integer millivolts `mv`; all other events → `""`.

---

## Task 1: Add `seq` + `sig` to event types and a canonical event-payload function

**Files:**
- Modify: `lib/ble/protocol.ts`
- Test: `lib/ble/protocol.test.ts`

**Step 1: Write the failing test**

Add to `lib/ble/protocol.test.ts`:

```ts
import { eventSigningPayload } from "./protocol";

describe("eventSigningPayload", () => {
  it("builds canonical string for gate_closed (no extra)", () => {
    const e = { event: "gate_closed", gate: 2, session_id: "s1", seq: 7, ts: 1000, sig: "x" } as const;
    expect(eventSigningPayload(e)).toBe("gate_closed|2|s1|7|1000|");
  });

  it("builds canonical string for boot (no gate, no session)", () => {
    const e = { event: "boot", seq: 1, ts: 50, sig: "x" } as const;
    expect(eventSigningPayload(e)).toBe("boot|||1|50|");
  });

  it("includes millivolts as extra for battery_low", () => {
    const e = { event: "battery_low", mv: 11900, seq: 3, ts: 200, sig: "x" } as const;
    expect(eventSigningPayload(e)).toBe("battery_low|||3|200|11900");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest lib/ble/protocol.test.ts -t eventSigningPayload --ci`
Expected: FAIL — `eventSigningPayload is not a function`.

**Step 3: Write minimal implementation**

In `lib/ble/protocol.ts`, add `seq` + `sig` to every event type, add `mv` to battery events (rename `v`→`mv` as integer millivolts), add `battery_critical`, and add the function:

```ts
// Every event now carries:
//   seq: strictly-increasing per-station counter (NVS-persisted, survives reboot)
//   ts:  wall_ts = boot_epoch + millis()/1000 (advisory; server uses deltas)
//   sig: hex HMAC-SHA256 over eventSigningPayload(event), keyed by the station secret.
// The phone NEVER verifies sig (no secret on device) — it relays to the server.
type EventBase = { seq: number; ts: number; sig: string };

export type GateClosedEvent   = EventBase & { event: "gate_closed"; gate: number; session_id: string };
export type GateOpenedEvent   = EventBase & { event: "gate_opened"; gate: number; session_id: string };
export type BatteryLowEvent   = EventBase & { event: "battery_low"; mv: number };
export type BatteryCriticalEvent = EventBase & { event: "battery_critical"; mv: number };
export type BootEvent         = EventBase & { event: "boot" };
export type UnlockTimeoutEvent  = EventBase & { event: "unlock_timeout"; session_id: string };
export type ReturnTimeoutEvent  = EventBase & { event: "return_timeout"; session_id: string };
export type BallOverdueEvent    = EventBase & { event: "ball_overdue"; session_id: string };

export type StationEvent =
  | GateClosedEvent | GateOpenedEvent | BatteryLowEvent | BatteryCriticalEvent
  | BootEvent | UnlockTimeoutEvent | ReturnTimeoutEvent | BallOverdueEvent;

export function eventSigningPayload(e: StationEvent): string {
  const gate = "gate" in e ? String(e.gate) : "";
  const session = "session_id" in e ? e.session_id : "";
  const extra = (e.event === "battery_low" || e.event === "battery_critical") ? String(e.mv) : "";
  return `${e.event}|${gate}|${session}|${e.seq}|${e.ts}|${extra}`;
}
```

> NOTE: `gate_opened` gains `session_id` (was missing) — required so capture can bind to the session. Update firmware to emit it (Task 5).

**Step 4: Run test to verify it passes**

Run: `npx jest lib/ble/protocol.test.ts -t eventSigningPayload --ci`
Expected: PASS.

**Step 5: Commit**

```bash
git add lib/ble/protocol.ts lib/ble/protocol.test.ts
git commit -m "feat(protocol): signed+sequenced event types + canonical payload"
```

---

## Task 2: Require `seq` + `sig` in `decodeEvent`, keep existing tests green

**Files:**
- Modify: `lib/ble/protocol.ts` (`decodeEvent`, `requireFields` calls)
- Test: `lib/ble/protocol.test.ts`

**Step 1: Write the failing test**

```ts
it("requires seq and sig on every event", () => {
  const raw = JSON.stringify({ event: "boot", ts: 5 }); // no seq/sig
  expect(() => decodeEvent(raw)).toThrow(/missing required field: (seq|sig)/);
});

it("parses a fully-signed gate_opened with session_id", () => {
  const raw = JSON.stringify({ event: "gate_opened", gate: 1, session_id: "s9", seq: 4, ts: 99, sig: "ab12" });
  const e = decodeEvent(raw);
  expect(e).toMatchObject({ event: "gate_opened", session_id: "s9", seq: 4, sig: "ab12" });
});
```

**Step 2: Run** `npx jest lib/ble/protocol.test.ts --ci` → FAIL (boot now needs seq/sig; gate_opened needs session_id).

**Step 3: Implement** — add `"seq", "sig"` to every `requireFields` call; add `"session_id"` to the `gate_opened` case; add a `battery_critical` case mirroring `battery_low` (require `mv` not `v`); update the existing `battery_low` test fixture in the file to use `mv` + `seq` + `sig`.

**Step 4: Run** `npx jest lib/ble/protocol.test.ts --ci` → PASS (all, including the original 9 updated).

**Step 5: Commit** `feat(protocol): decodeEvent enforces seq+sig; battery_critical; gate_opened session_id`

---

## Task 3: Add the unsigned `set_time` command

**Files:**
- Modify: `lib/ble/protocol.ts` (`Command` union, `encodeCommand`, NOT `signingPayload`)
- Test: `lib/ble/protocol.test.ts`

**Step 1: Failing test**

```ts
it("encodes set_time as an unsigned command", () => {
  const cmd = { cmd: "set_time", now: 1717600000 } as const;
  expect(JSON.parse(encodeCommand(cmd))).toEqual({ cmd: "set_time", now: 1717600000 });
});
it("set_time is excluded from signingPayload (no secret on phone)", () => {
  // @ts-expect-error set_time is not a signable Command
  expect(() => signingPayload({ cmd: "set_time", now: 1 })).toBeDefined();
});
```

**Step 2: Run** → FAIL.

**Step 3: Implement** — add `export type SetTimeCommand = { cmd: "set_time"; now: number };`. Keep `Command = UnlockCommand | ReturnUnlockCommand` (signable). Add `AnyCommand = Command | SetTimeCommand` and make `encodeCommand(cmd: AnyCommand)`. Leave `signingPayload(cmd: Command)` untouched.

**Step 4: Run** `npx jest lib/ble/protocol.test.ts --ci` → PASS.

**Step 5: Commit** `feat(protocol): unsigned set_time command for wall-clock anchoring`

---

## Task 4: Server-only event verification + dedupe helpers

**Files:**
- Create: `lib/server/eventVerify.ts` (server-only; imports `node:crypto` — never imported by RN code)
- Test: `lib/server/eventVerify.test.ts`

**Step 1: Failing test**

```ts
import { createHmac } from "node:crypto";
import { verifyEventSig, isDuplicate } from "./eventVerify";
import { eventSigningPayload } from "../ble/protocol";

const SECRET = "station-secret-DEV-001";
function sign(e: any) {
  const { sig, ...rest } = e;
  return { ...rest, sig: createHmac("sha256", SECRET).update(eventSigningPayload({ ...rest, sig: "" })).digest("hex") };
}

it("accepts a correctly signed event", () => {
  const e = sign({ event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "" });
  expect(verifyEventSig(e, SECRET)).toBe(true);
});
it("rejects a tampered event (gate changed after signing)", () => {
  const e = sign({ event: "gate_closed", gate: 1, session_id: "s1", seq: 2, ts: 100, sig: "" });
  expect(verifyEventSig({ ...e, gate: 2 }, SECRET)).toBe(false);
});
it("dedupes by (station_id, seq)", () => {
  const seen = new Set<string>();
  expect(isDuplicate(seen, "DEV-001", 2)).toBe(false); // first time
  expect(isDuplicate(seen, "DEV-001", 2)).toBe(true);  // replay
  expect(isDuplicate(seen, "DEV-002", 2)).toBe(false); // different station
});
```

**Step 2: Run** `npx jest lib/server/eventVerify.test.ts --ci` → FAIL.

**Step 3: Implement** `lib/server/eventVerify.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { eventSigningPayload, type StationEvent } from "../ble/protocol";

export function verifyEventSig(e: StationEvent, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(eventSigningPayload(e)).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(e.sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isDuplicate(seen: Set<string>, stationId: string, seq: number): boolean {
  const key = `${stationId}:${seq}`;
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}
```

> `eventSigningPayload` ignores `sig`, so signing with `sig:""` and verifying the populated event match.

**Step 4: Run** → PASS.

**Step 5: Commit** `feat(server): HMAC event verification + (station,seq) dedupe`

---

## Task 5: Firmware — emit signed, sequenced, persisted events (spec + impl)

> Firmware can't run in Jest. Implement against the spec below; validate with `app/dev/ble.tsx` (connect, trigger unlock/return, watch the event log shows `seq`+`sig`, replay after a forced disconnect). Apply identically to `firmware/PlayboxStation.ino` and `firmware/PlayboxStation_3gate.ino`.

**5a — Sequence counter (NVS):** add `uint32_t eventSeq;` loaded from `Preferences` on boot, `++` and persisted on every emit. Survives reboot.

**5b — Wall-clock anchor:** handle `{"cmd":"set_time","now":<unix>}` on the command characteristic → `bootEpoch = now - millis()/1000;`. Stamp every event `ts = bootEpoch + millis()/1000` (fall back to `millis()/1000` if `set_time` not yet received this boot).

**5c — Sign events:** build the canonical string `${event}|${gate}|${session_id}|${seq}|${ts}|${extra}` (empty fields = empty string, per Task 1), HMAC-SHA256 with the station secret (mbedTLS), hex-encode into `sig`. Include `seq` + `sig` in the JSON.

**5d — NVS ring buffer:** persist the last K=64 emitted events (JSON or packed struct) in `Preferences`/NVS. On connect, **replay** all events with `seq > acked_seq` over the events characteristic. Accept an `{"cmd":"ack","seq":<n>}` write → store `acked_seq`, drop buffered events `<= n`. Bound NVS writes (only on state change) to protect flash endurance.

**5e — `gate_opened` carries `session_id`:** emit it on actual servo-open so the server can bind capture.

**Validation steps (manual, via dev harness):**
1. Connect → app writes `set_time`; trigger unlock → `gate_opened` shows `seq=N`, plausible `ts`, non-empty `sig`.
2. Kill the app mid-session, reopen → on reconnect the buffered `gate_closed` replays (proves durability).
3. Send `ack` for that `seq` → reconnect again → it no longer replays.
4. Cross-check: paste the event into a tiny node script using `lib/server/eventVerify.ts` + the station secret → `verifyEventSig` returns `true` (proves canonical strings match byte-for-byte).

**Commit** (firmware): `feat(firmware): signed+sequenced events, NVS replay buffer, set_time, gate_opened session_id`

---

## Task 6: Battery ADC + thresholds (firmware) — replace hardcoded 100%

**Files:** `firmware/PlayboxStation_3gate.ino` (and single-gate), INFO char builder + new events.

- Voltage divider (~5:1) on an ADC pin; calibrate so 14.4V reads ≤2.9V. Read **at rest** (not during servo actuation) and median-filter N samples.
- Map resting volts → SoC with the SLA curve (§7 of the design doc; ~12.7V=100% … 10.5V=empty), publish real `battery_pct` + raw `mv` in INFO.
- Emit `battery_low` at ≈11.9V (≈40%, conservative for manual recharge lead time) and `battery_critical` at ≈11.5V. At `battery_critical`: **refuse new `unlock`** but still honor `return_unlock`. Never deep-discharge below ~10.5V.
- Guard servo actuation: if `mv` below the actuation floor, emit `battery_critical` instead of browning out.

**Validation:** bench PSU sweep 12.8→11.0V; confirm `battery_low`/`battery_critical` fire at thresholds, INFO `battery_pct` tracks the curve, and unlocks are refused while returns still work.

**Commit:** `feat(firmware): real SLA battery telemetry + low/critical thresholds`

---

## Out of scope (later phases, tracked in the design doc)
- App-side: BLE retry/backoff, radio-off gate, disconnect-mid-return fallback, **gossip-sync drain + `ack` relay**, proximity UX. (Phase 3)
- Server: `station_events` table, reconciliation worker, abandoned-session sweep, ack-cursor persistence. (Phase 1)
- Payments via iyzico: capture-on-open, deposit release/penalty. (Phase 2)

## Definition of done (Phase 0)
- `npx jest lib/ble/protocol.test.ts lib/server/eventVerify.test.ts --ci` green.
- Firmware emits signed+sequenced events that `verifyEventSig` accepts with the station secret.
- Buffered events replay on reconnect and stop after `ack`.
- Battery telemetry real; thresholds enforced.
