import {
  encodeCommand,
  decodeEvent,
  eventSigningPayload,
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
      ts: 1712345678,
      sig: "deadbeef".repeat(8),
    });
    expect(JSON.parse(json)).toEqual({
      cmd: "unlock",
      gate: 2,
      session_id: "sess-abc",
      duration_min: 60,
      ts: 1712345678,
      sig: "deadbeef".repeat(8),
    });
  });

  it("encodes a return_unlock command", () => {
    const json = encodeCommand({
      cmd: "return_unlock",
      gate: 2,
      session_id: "sess-abc",
      ts: 1712345678,
      sig: "cafebabe".repeat(8),
    });
    expect(JSON.parse(json)).toEqual({
      cmd: "return_unlock",
      gate: 2,
      session_id: "sess-abc",
      ts: 1712345678,
      sig: "cafebabe".repeat(8),
    });
  });
});

describe("decodeEvent", () => {
  it("parses a gate_closed notification", () => {
    const event = decodeEvent(
      '{"event":"gate_closed","gate":2,"session_id":"sess-abc","seq":11,"ts":1712345678,"sig":"ab12"}',
    );
    expect(event).toEqual({
      event: "gate_closed",
      gate: 2,
      session_id: "sess-abc",
      seq: 11,
      ts: 1712345678,
      sig: "ab12",
    });
  });

  it("parses a battery_low notification", () => {
    const event = decodeEvent(
      '{"event":"battery_low","mv":11200,"seq":12,"ts":1712345678,"sig":"ab12"}',
    );
    expect(event).toEqual({
      event: "battery_low",
      mv: 11200,
      seq: 12,
      ts: 1712345678,
      sig: "ab12",
    });
  });

  it("parses a boot notification", () => {
    const event = decodeEvent(
      '{"event":"boot","seq":1,"ts":1712345678,"sig":"ab12"}',
    );
    expect(event).toEqual({
      event: "boot",
      seq: 1,
      ts: 1712345678,
      sig: "ab12",
    });
  });

  it("parses a fully-signed battery_critical", () => {
    const raw = JSON.stringify({ event: "battery_critical", mv: 11500, seq: 8, ts: 120, sig: "ff00" });
    const e = decodeEvent(raw);
    expect(e).toMatchObject({ event: "battery_critical", mv: 11500, seq: 8, sig: "ff00" });
  });

  it("requires seq and sig on every event", () => {
    const raw = JSON.stringify({ event: "boot", ts: 5 }); // no seq/sig
    expect(() => decodeEvent(raw)).toThrow(
      /missing required field: (seq|sig)/,
    );
  });

  it("parses a fully-signed gate_opened with session_id", () => {
    const raw = JSON.stringify({
      event: "gate_opened",
      gate: 1,
      session_id: "s9",
      seq: 4,
      ts: 99,
      sig: "ab12",
    });
    const e = decodeEvent(raw);
    expect(e).toMatchObject({
      event: "gate_opened",
      session_id: "s9",
      seq: 4,
      sig: "ab12",
    });
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

  it("includes millivolts as extra for battery_critical", () => {
    const e = { event: "battery_critical", mv: 11500, seq: 2, ts: 300, sig: "x" } as const;
    expect(eventSigningPayload(e)).toBe("battery_critical|||2|300|11500");
  });

  it("builds canonical string for an event with session_id but no gate", () => {
    const e = { event: "unlock_timeout", session_id: "s1", seq: 5, ts: 400, sig: "x" } as const;
    expect(eventSigningPayload(e)).toBe("unlock_timeout||s1|5|400|");
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
