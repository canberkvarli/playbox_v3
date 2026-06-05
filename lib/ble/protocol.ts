export const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
export const UNLOCK_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1";
export const EVENTS_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef2";
export const INFO_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef3";

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

// Everything writable over the unlock characteristic: the signable commands plus
// the unsigned set_time. `encodeCommand` accepts this wider set; `signingPayload`
// stays narrowed to `Command`.
export type AnyCommand = Command | SetTimeCommand;

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
// integer rendering and would break signature verification.
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
//   `${event}|${gate ?? ""}|${session_id ?? ""}|${seq}|${wall_ts}|${extra}`
// where extra is integer millivolts for battery events, "" otherwise.
//
// INVARIANT: `session_id` MUST be restricted to [A-Za-z0-9-] (no `|`). This
// canonical string is pipe-delimited, so a `|` inside session_id would let two
// distinct events collapse to the same signing string (signature collision).
// Documented contract for firmware + server; not sanitized here (server is the
// trust boundary).
export function eventSigningPayload(e: StationEvent): string {
  const gate = "gate" in e ? String(e.gate) : "";
  const session = "session_id" in e ? e.session_id : "";
  const extra =
    e.event === "battery_low" || e.event === "battery_critical"
      ? String(e.mv)
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
