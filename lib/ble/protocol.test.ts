import {
  encodeCommand,
  decodeEvent,
  SERVICE_UUID,
  UNLOCK_CHAR_UUID,
  EVENTS_CHAR_UUID,
  INFO_CHAR_UUID,
} from "./protocol";

describe("encodeCommand", () => {
  it("encodes an unlock command for a specific gate", () => {
    const json = encodeCommand({
      cmd: "unlock",
      gate: 2,
      session_id: "sess-abc",
      duration_min: 60,
    });
    expect(JSON.parse(json)).toEqual({
      cmd: "unlock",
      gate: 2,
      session_id: "sess-abc",
      duration_min: 60,
    });
  });

  it("encodes a return_unlock command without duration", () => {
    const json = encodeCommand({
      cmd: "return_unlock",
      gate: 2,
      session_id: "sess-abc",
    });
    expect(JSON.parse(json)).toEqual({
      cmd: "return_unlock",
      gate: 2,
      session_id: "sess-abc",
    });
  });
});

describe("decodeEvent", () => {
  it("parses a gate_closed notification", () => {
    const event = decodeEvent(
      '{"event":"gate_closed","gate":2,"session_id":"sess-abc","ts":1712345678}',
    );
    expect(event).toEqual({
      event: "gate_closed",
      gate: 2,
      session_id: "sess-abc",
      ts: 1712345678,
    });
  });

  it("parses a battery_low notification", () => {
    const event = decodeEvent(
      '{"event":"battery_low","v":11.2,"ts":1712345678}',
    );
    expect(event).toEqual({
      event: "battery_low",
      v: 11.2,
      ts: 1712345678,
    });
  });

  it("parses a boot notification", () => {
    const event = decodeEvent('{"event":"boot","ts":1712345678}');
    expect(event).toEqual({ event: "boot", ts: 1712345678 });
  });

  it("throws on malformed JSON", () => {
    expect(() => decodeEvent("not json")).toThrow();
  });

  it("throws on unknown event kind", () => {
    expect(() => decodeEvent('{"event":"alien_invasion","ts":1}')).toThrow(
      /unknown event/i,
    );
  });

  it("throws on missing required fields for gate_closed", () => {
    expect(() => decodeEvent('{"event":"gate_closed","ts":1}')).toThrow(
      /required/i,
    );
  });
});

describe("BLE UUIDs", () => {
  it("exports stable 128-bit UUIDs for service + characteristics", () => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(SERVICE_UUID).toMatch(uuidPattern);
    expect(UNLOCK_CHAR_UUID).toMatch(uuidPattern);
    expect(EVENTS_CHAR_UUID).toMatch(uuidPattern);
    expect(INFO_CHAR_UUID).toMatch(uuidPattern);
  });
});
