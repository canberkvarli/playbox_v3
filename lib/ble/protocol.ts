export const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
export const UNLOCK_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef1";
export const EVENTS_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef2";
export const INFO_CHAR_UUID = "12345678-1234-5678-1234-56789abcdef3";

export type UnlockCommand = {
  cmd: "unlock";
  gate: number;
  session_id: string;
  duration_min: number;
};

export type ReturnUnlockCommand = {
  cmd: "return_unlock";
  gate: number;
  session_id: string;
};

export type Command = UnlockCommand | ReturnUnlockCommand;

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

export type StationEvent =
  | GateClosedEvent
  | GateOpenedEvent
  | BatteryLowEvent
  | BootEvent;

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
