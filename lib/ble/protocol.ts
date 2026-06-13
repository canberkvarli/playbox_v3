export const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
export const UNLOCK_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1";
export const EVENTS_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef2";
export const INFO_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef3";
// Buffer-drain characteristic: a read returns the station's pending SIGNED-event
// gossip buffer as a JSON array (events ≤ acked_seq already dropped firmware-side
// on ack). DOES NOT EXIST YET — Phase 0 firmware Task 5. The app's reader tries
// this characteristic and catches → [] so the gossip drain is a safe no-op until
// the firmware exposes it.
export const BUFFER_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef4";

// All commands are HMAC-signed by the server before being relayed over BLE.
// The phone is a dumb pipe — it never holds the station secret.
//   ts:  unix seconds (monotonic across boots — replay protection)
//   sig: hex-encoded HMAC-SHA256 over `${cmd}|${gate}|${session_id}|${duration_min ?? 0}|${ts}`
export type UnlockCommand = {
  cmd: "unlock";
  gate: number;
  session_id: string;
  duration_min: number;
  ts: number;
  sig: string;
};

export type ReturnUnlockCommand = {
  cmd: "return_unlock";
  gate: number;
  session_id: string;
  ts: number;
  sig: string;
};

export type Command = UnlockCommand | ReturnUnlockCommand;

// UNSIGNED. Written on connect to anchor the station's wall clock
// (boot_epoch = now − millis()/1000). The phone cannot sign this — it holds no
// station secret — and that's safe because the resulting `wall_ts` on events is
// advisory only; the server computes durations from event deltas, not wall_ts.
// Deliberately NOT part of the signable `Command` union and never passed to
// `signingPayload`.
//
// A hostile/buggy phone can send a bogus set_time `now`, so the station wall clock (and every event's wall_ts) is NON-AUTHORITATIVE. The server MUST NOT use wall_ts for billing or duration — derive durations from event-delta (seq-ordered) timing only.
export type SetTimeCommand = { cmd: "set_time"; now: number };

// UNSIGNED — like set_time. Written back to the station after the server has
// durably accepted events ≤ `seq`, telling the station it may DROP those events
// from its NVS gossip buffer. The phone cannot sign this (it holds no station
// secret), and that's safe because the ack is ADVISORY: a lost/forged ack just
// means the station re-sends events it already buffered (harmless — the server
// dedupes on `(station_id, seq)`), and it can never authorize an unlock. The
// station must only ever DROP buffered events on ack, never act on one.
// Deliberately NOT part of the signable `Command` union and never passed to
// `signingPayload`.
export type AckCommand = { cmd: "ack"; seq: number };

// UNSIGNED, DEV ONLY. App-driven stand-in for the reed/door-closed edge, so the
// full rent→close→return→close cycle can be driven from the BLE debug screen
// without pressing the dev board's BOOT button. The firmware honors this only
// when built with DEV_SIM_CLOSE (the single-gate dev unit); it just advances the
// local door state (UNLOCKED→IN_USE or RETURN_UNLOCKED→LOCKED) and NEVER opens
// the gate, so — like set_time/ack — it needs no signature.
export type SimCloseCommand = { cmd: "sim_close"; gate: number };

// Everything writable over the unlock characteristic: the signable commands plus
// the unsigned set_time + ack (+ dev-only sim_close). `encodeCommand` accepts
// this wider set; `signingPayload` stays narrowed to `Command`.
export type AnyCommand = Command | SetTimeCommand | AckCommand | SimCloseCommand;

// Canonical string the firmware HMACs over. Must match exactly on both sides.
//
// INVARIANT: `session_id` MUST be restricted to [A-Za-z0-9-] (no `|`). The
// signing string is pipe-delimited, so a `|` inside session_id would let two
// distinct commands collapse to the same canonical string (signature collision).
// This is a documented contract the firmware + server must honor; the server is
// the trust boundary, so we do NOT sanitize in this hot path.
export function signingPayload(cmd: Command): string {
  const duration = cmd.cmd === "unlock" ? cmd.duration_min : 0;
  return `${cmd.cmd}|${cmd.gate}|${cmd.session_id}|${duration}|${cmd.ts}`;
}

// Station→phone events are signed + sequenced so they can be relayed by
// untrusted "courier" phones and verified server-side.
//   seq: monotonic per-station counter (replay/ordering protection)
//   ts:  event wall-clock unix seconds (a.k.a. wall_ts) — NON-AUTHORITATIVE.
//        A hostile/buggy phone can send a bogus set_time `now`, so the station
//        wall clock (and every event's wall_ts) is untrusted. The server MUST
//        NOT use wall_ts for billing or duration — derive durations from
//        event-delta (seq-ordered) timing only.
//   sig: hex-encoded HMAC-SHA256 over `eventSigningPayload(event)`
// See the "Firmware serialization contract" block above `eventSigningPayload`
// for the EXACT byte-level rendering of seq / ts / mv / sig the firmware must
// reproduce.
type EventBase = { seq: number; ts: number; sig: string };

export type GateClosedEvent = EventBase & {
  event: "gate_closed";
  gate: number;
  session_id: string;
};

export type GateOpenedEvent = EventBase & {
  event: "gate_opened";
  gate: number;
  session_id: string;
};

// INVARIANT: `mv` is integer millivolts (never fractional). The signing payload
// renders it via String(mv); String(11900.5) would not match the firmware's
// integer rendering and would break signature verification. See the "Firmware
// serialization contract" block above `eventSigningPayload` for the exact `mv`
// rendering rules (decimal digits only, no fractional / scientific notation).
export type BatteryLowEvent = EventBase & {
  event: "battery_low";
  mv: number;
};

export type BatteryCriticalEvent = EventBase & {
  event: "battery_critical";
  mv: number;
};

export type BootEvent = EventBase & {
  event: "boot";
};

export type UnlockTimeoutEvent = EventBase & {
  event: "unlock_timeout";
  session_id: string;
};

export type ReturnTimeoutEvent = EventBase & {
  event: "return_timeout";
  session_id: string;
};

export type BallOverdueEvent = EventBase & {
  event: "ball_overdue";
  session_id: string;
};

export type StationEvent =
  | GateClosedEvent
  | GateOpenedEvent
  | BatteryLowEvent
  | BatteryCriticalEvent
  | BootEvent
  | UnlockTimeoutEvent
  | ReturnTimeoutEvent
  | BallOverdueEvent;

// Canonical string the firmware + server both HMAC over. Must match exactly.
//   `${event}|${gate}|${session_id}|${seq}|${wall_ts}|${extra}`
// where extra is integer millivolts for battery events, "" otherwise.
//
// Empty slots are PRESENCE-based, not nullish: a field renders as the
// stringified value when its KEY IS PRESENT on the event, and as the empty
// string "" when the key is ABSENT. (Events are constructed by firmware with
// exactly the fields their type declares, so absent == empty slot; e.g. a
// `boot` event — no gate, no session_id, not a battery event — renders as
// `boot|||<seq>|<ts>|`.) Note this differs from `?? ""`: a key present but
// null would render as the string "null", not "".
//
// ── Firmware serialization contract ──────────────────────────────────────
// The C++ firmware MUST serialize each field exactly as below so the canonical
// string (and the JSON it emits) match this TS side byte-for-byte; any
// mismatch breaks HMAC verification:
//   • seq         — uint32_t, decimal digits only, no leading zeros, no sign.
//                   Monotonic + NVS-persisted; firmware MUST NEVER reset seq
//                   across reboots. (Wraparound at 2^32 isn't expected within
//                   device lifetime, but if it ever wrapped, the server dedupe
//                   key `${stationId}:${seq}` would collide.)
//   • ts          — uint32_t UNIX SECONDS, decimal digits only, NEVER
//                   fractional. Computed as `boot_epoch + millis()/1000`
//                   (integer division).
//   • mv          — integer millivolts (e.g. 11900), decimal digits only,
//                   NEVER fractional, NEVER scientific notation. Fits int
//                   (well under int32).
//   • sig         — lowercase hex of HMAC-SHA256. No `0x` prefix, no
//                   separators. (Server verify is case-insensitive on input,
//                   but firmware SHOULD emit lowercase.)
//   • separator   — a single ASCII pipe `|` between fields.
//   • empties     — when an event type has no gate / no session_id, that slot
//                   is the empty string (see `boot` example above).
//
// INVARIANT: `session_id` MUST be restricted to [A-Za-z0-9-] (no `|`). This
// canonical string is pipe-delimited, so a `|` inside session_id would let two
// distinct events collapse to the same signing string (signature collision).
// Documented contract for firmware + server; not sanitized here (server is the
// trust boundary).
export function eventSigningPayload(e: StationEvent): string {
  const gate = "gate" in e ? String(e.gate) : "";
  const session = "session_id" in e ? String(e.session_id) : "";
  const extra =
    e.event === "battery_low" || e.event === "battery_critical"
      ? (e.mv == null ? "" : String(e.mv))
      : "";
  return `${e.event}|${gate}|${session}|${e.seq}|${e.ts}|${extra}`;
}

export function encodeCommand(cmd: AnyCommand): string {
  return JSON.stringify(cmd);
}

// Every station event carries these signed/sequenced base fields. Single-sourced
// so adding an event can't silently drop one (drift risk).
const BASE_FIELDS = ["seq", "ts", "sig"] as const;

export function decodeEvent(raw: string): StationEvent {
  const parsed = JSON.parse(raw);
  const kind = parsed?.event;

  switch (kind) {
    case "gate_closed":
      requireFields(parsed, [...BASE_FIELDS, "gate", "session_id"], "gate_closed");
      return parsed as GateClosedEvent;
    case "gate_opened":
      requireFields(parsed, [...BASE_FIELDS, "gate", "session_id"], "gate_opened");
      return parsed as GateOpenedEvent;
    case "battery_low":
      requireFields(parsed, [...BASE_FIELDS, "mv"], "battery_low");
      return parsed as BatteryLowEvent;
    case "battery_critical":
      requireFields(parsed, [...BASE_FIELDS, "mv"], "battery_critical");
      return parsed as BatteryCriticalEvent;
    case "boot":
      requireFields(parsed, [...BASE_FIELDS], "boot");
      return parsed as BootEvent;
    case "unlock_timeout":
      requireFields(parsed, [...BASE_FIELDS, "session_id"], "unlock_timeout");
      return parsed as UnlockTimeoutEvent;
    case "return_timeout":
      requireFields(parsed, [...BASE_FIELDS, "session_id"], "return_timeout");
      return parsed as ReturnTimeoutEvent;
    case "ball_overdue":
      requireFields(parsed, [...BASE_FIELDS, "session_id"], "ball_overdue");
      return parsed as BallOverdueEvent;
    default:
      throw new Error(`unknown event kind: ${kind}`);
  }
}

function requireFields(obj: unknown, fields: string[], kind: string): void {
  for (const f of fields) {
    if ((obj as Record<string, unknown>)[f] === undefined) {
      throw new Error(`event ${kind} missing required field: ${f}`);
    }
  }
}
