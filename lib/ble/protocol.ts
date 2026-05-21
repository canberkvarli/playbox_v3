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

// Canonical string the firmware HMACs over. Must match exactly on both sides.
export function signingPayload(cmd: Command): string {
  const duration = cmd.cmd === "unlock" ? cmd.duration_min : 0;
  return `${cmd.cmd}|${cmd.gate}|${cmd.session_id}|${duration}|${cmd.ts}`;
}

export type GateClosedEvent = {
  event: "gate_closed";
  gate: number;
  session_id: string;
  ts: number;
};

export type GateOpenedEvent = {
  event: "gate_opened";
  gate: number;
  ts: number;
};

export type BatteryLowEvent = {
  event: "battery_low";
  v: number;
  ts: number;
};

export type BootEvent = {
  event: "boot";
  ts: number;
};

export type UnlockTimeoutEvent = {
  event: "unlock_timeout";
  session_id: string;
  ts: number;
};

export type ReturnTimeoutEvent = {
  event: "return_timeout";
  session_id: string;
  ts: number;
};

export type BallOverdueEvent = {
  event: "ball_overdue";
  session_id: string;
  ts: number;
};

export type StationEvent =
  | GateClosedEvent
  | GateOpenedEvent
  | BatteryLowEvent
  | BootEvent
  | UnlockTimeoutEvent
  | ReturnTimeoutEvent
  | BallOverdueEvent;

export function encodeCommand(cmd: Command): string {
  return JSON.stringify(cmd);
}

export function decodeEvent(raw: string): StationEvent {
  const parsed = JSON.parse(raw);
  const kind = parsed?.event;

  switch (kind) {
    case "gate_closed":
      requireFields(parsed, ["gate", "session_id", "ts"], "gate_closed");
      return parsed as GateClosedEvent;
    case "gate_opened":
      requireFields(parsed, ["gate", "ts"], "gate_opened");
      return parsed as GateOpenedEvent;
    case "battery_low":
      requireFields(parsed, ["v", "ts"], "battery_low");
      return parsed as BatteryLowEvent;
    case "boot":
      requireFields(parsed, ["ts"], "boot");
      return parsed as BootEvent;
    case "unlock_timeout":
      requireFields(parsed, ["session_id", "ts"], "unlock_timeout");
      return parsed as UnlockTimeoutEvent;
    case "return_timeout":
      requireFields(parsed, ["session_id", "ts"], "return_timeout");
      return parsed as ReturnTimeoutEvent;
    case "ball_overdue":
      requireFields(parsed, ["session_id", "ts"], "ball_overdue");
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
