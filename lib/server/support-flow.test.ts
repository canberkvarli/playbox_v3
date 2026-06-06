// THE support-flow money-safety gate — Phase 4, Task 5.
//
// The operator/support write actions (op_mark_disputed, op_resolve_dispute,
// op_unquarantine) NEVER call iyzico. They only SET FLAGS on the reservation;
// the already-proven Phase 2 settlement worker (settlement/process.ts +
// decide.ts + guards.ts) is the SINGLE money path and performs the real money
// move on its next tick. This suite proves the support actions are money-safe by
// SIMULATING each op_* function's flag mutation on an in-memory candidate, then
// driving the pure `processSettlement` and asserting the EXACT iyzico call
// count per tick (the recording fake's call count is the proof).
//
// Deno-free: same recording-fake-iyzico + in-memory store harness as
// settlement-process.test.ts. No DB, no network, no Deno. The op_* SQL is only
// mirrored as flag mutations here (each helper below documents which SQL
// function's effect it simulates).
import {
  processSettlement,
  type SettlementCandidate,
  type SettlementIyzico,
  type SettlementStore,
} from "../../supabase/functions/settlement/process";
import type { DepositState } from "../../supabase/functions/settlement/decide";
import { buildDisputeTimeline } from "../../supabase/functions/_shared/disputeTimeline";

const ISO = "2026-06-06T12:00:00.000Z";
const NOW = "2026-06-06T13:00:00.000Z";

type RecordedCall = {
  op: "capture" | "release" | "refund";
  conversationId: string;
  paymentId?: string;
  paymentTxnId?: string;
  priceTry: string;
  ip: string;
};

type RecordedEvent = { id: string; kind: string; payload: unknown };

// Recording fake iyzico (identical contract to settlement-process.test.ts):
// records every call, returns a per-op configured result (ok / fail / throw),
// so each tick's EXACT call count + ops are assertable.
function makeIyzico(
  cfg: Partial<Record<"capture" | "release" | "refund", "ok" | "fail" | "throw">> = {},
) {
  const calls: RecordedCall[] = [];
  function result(op: "capture" | "release" | "refund"): Promise<{ ok: boolean }> {
    const mode = cfg[op] ?? "ok";
    if (mode === "throw") return Promise.reject(new Error(`iyzico ${op} exploded`));
    return Promise.resolve({ ok: mode === "ok" });
  }
  const iyzico: SettlementIyzico = {
    capture(args) {
      calls.push({ op: "capture", priceTry: args.priceTry, ip: args.ip, conversationId: args.conversationId, paymentId: args.paymentId });
      return result("capture");
    },
    release(args) {
      calls.push({ op: "release", priceTry: "0.00", ip: args.ip, conversationId: args.conversationId, paymentId: args.paymentId });
      return result("release");
    },
    refund(args) {
      calls.push({ op: "refund", priceTry: args.priceTry, ip: args.ip, conversationId: args.conversationId, paymentTxnId: args.paymentTxnId });
      return result("refund");
    },
  };
  return { iyzico, calls };
}

// In-memory store (same shape as settlement-process.test.ts). The `map` is the
// live row set; the op_* helpers below mutate it directly to simulate the SQL.
function makeStore(initial: SettlementCandidate[]) {
  const map = new Map<string, SettlementCandidate>();
  for (const c of initial) map.set(c.id, { ...c });
  const events: RecordedEvent[] = [];
  const settled: Array<{ id: string; nextState: DepositState; nowISO: string; expectedFrom: DepositState }> = [];
  const failedAttempts: Array<{ id: string; errorText: string }> = [];
  const quarantined: Array<{ id: string; nowISO: string }> = [];
  const store: SettlementStore = {
    getCandidates(_limit: number) {
      return Promise.resolve([...map.values()]);
    },
    recordFailedAttempt(id, errorText) {
      failedAttempts.push({ id, errorText });
      const cur = map.get(id);
      if (cur) map.set(id, { ...cur, settle_attempts: cur.settle_attempts + 1 });
      return Promise.resolve();
    },
    quarantine(id, nowISO) {
      quarantined.push({ id, nowISO });
      const cur = map.get(id);
      if (cur) map.set(id, { ...cur, quarantined_at: nowISO });
      return Promise.resolve();
    },
    markSettled(id, nextState, nowISO, expectedFrom) {
      settled.push({ id, nextState, nowISO, expectedFrom });
      const cur = map.get(id);
      if (cur && cur.deposit_state === expectedFrom) {
        map.set(id, { ...cur, deposit_state: nextState });
      }
      return Promise.resolve();
    },
    appendReservationEvent(id, kind, payload) {
      events.push({ id, kind, payload });
      return Promise.resolve();
    },
  };
  return { store, events, settled, failedAttempts, quarantined, map };
}

function candidate(over: Partial<SettlementCandidate> & { id: string }): SettlementCandidate {
  return {
    deposit_state: "held",
    hold_id: "pay_1",
    hold_txn_id: "txn_1",
    release_eligible_at: null,
    penalty_eligible_at: null,
    reversal_eligible_at: null,
    disputed_at: null,
    quarantined_at: null,
    settle_attempts: 0,
    ...over,
  };
}

const deps = (
  store: SettlementStore,
  iyzico: SettlementIyzico,
  over: Partial<Parameters<typeof processSettlement>[0]> = {},
) => ({
  store,
  iyzico,
  now: () => NOW,
  ip: "0.0.0.0",
  priceTry: "20.00",
  maxAttempts: 5,
  ...over,
});

// ── op_* SIMULATORS ──────────────────────────────────────────────────────────
// Each mutates the in-memory row exactly as the corresponding SQL function does
// (flags only — SQL never touches iyzico). The settlement worker is then driven
// to prove the money move (or no-op) that results.
type Map_ = ReturnType<typeof makeStore>["map"];

// op_mark_disputed: set disputed_at (pauses settlement). Flag-only.
function opMarkDisputed(map: Map_, id: string, at = ISO) {
  const c = map.get(id)!;
  map.set(id, { ...c, disputed_at: at });
}
// op_resolve_dispute(...,'refund'): set reversal_eligible_at (coalesce) + clear
// disputed_at. The worker then refunds-if-captured / releases-if-held.
function opResolveRefund(map: Map_, id: string, at = NOW) {
  const c = map.get(id)!;
  map.set(id, { ...c, reversal_eligible_at: c.reversal_eligible_at ?? at, disputed_at: null });
}
// op_resolve_dispute(...,'uphold'): clear disputed_at only (no reversal flag).
function opResolveUphold(map: Map_, id: string) {
  const c = map.get(id)!;
  map.set(id, { ...c, disputed_at: null });
}
// op_unquarantine: clear quarantined_at + reset settle_attempts to 0 (+ the
// Task 4 polish: clear settle_last_error, not modeled in this candidate shape).
function opUnquarantine(map: Map_, id: string) {
  const c = map.get(id)!;
  map.set(id, { ...c, quarantined_at: null, settle_attempts: 0 });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("support-flow gate — dispute pauses settlement, uphold resumes it", () => {
  it("scenario 1: penalty-eligible AND disputed -> tick SKIPS (0 iyzico calls), then op_resolve_dispute uphold -> capture fires exactly ONCE", async () => {
    const { store, events, settled, map } = makeStore([
      // Would capture (penalty + held) WITHOUT the dispute. The dispute must
      // short-circuit it before decide / iyzico are reached.
      candidate({ id: "s1", deposit_state: "held", penalty_eligible_at: ISO, disputed_at: ISO }),
    ]);

    // Tick 1: disputed -> blocked -> ZERO iyzico calls, money frozen at held.
    const t1 = makeIyzico();
    const c1 = await processSettlement(deps(store, t1.iyzico));
    expect(t1.calls).toHaveLength(0); // <-- dispute pause proof
    expect(settled).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(map.get("s1")!.deposit_state).toBe("held");
    expect(c1).toMatchObject({ skipped: 1, captured: 0, failed: 0 });

    // op_resolve_dispute uphold: clear disputed_at -> settlement resumes; the
    // original penalty precedence stands.
    opResolveUphold(map, "s1");

    // Tick 2: penalty + held -> exactly ONE capture, now flips to captured.
    const t2 = makeIyzico();
    const c2 = await processSettlement(deps(store, t2.iyzico));
    expect(t2.calls).toHaveLength(1); // <-- uphold resumes auto-money
    expect(t2.calls[0].op).toBe("capture");
    expect(map.get("s1")!.deposit_state).toBe("captured");
    expect(c2).toMatchObject({ captured: 1, skipped: 0, failed: 0 });
  });
});

describe("support-flow gate — resolve->refund (the headline 'I returned it, give it back')", () => {
  it("scenario 2: captured deposit, op_resolve_dispute refund -> exactly ONE refund -> refunded; re-tick ZERO new calls (terminal)", async () => {
    const { store, settled, map } = makeStore([
      // Penalty already taken (captured) and the row is disputed.
      candidate({ id: "s2", deposit_state: "captured", penalty_eligible_at: ISO, disputed_at: ISO }),
    ]);

    // Sanity: while disputed, settlement is paused (0 calls).
    const pre = makeIyzico();
    await processSettlement(deps(store, pre.iyzico));
    expect(pre.calls).toHaveLength(0);

    // op_resolve_dispute refund: set reversal_eligible_at + clear disputed_at.
    opResolveRefund(map, "s2");

    // Tick: captured + reversal -> exactly ONE refund -> refunded.
    const t1 = makeIyzico();
    const c1 = await processSettlement(deps(store, t1.iyzico));
    expect(t1.calls).toHaveLength(1); // <-- the proven refund path
    expect(t1.calls[0].op).toBe("refund");
    expect(t1.calls[0].paymentTxnId).toBe("txn_1");
    expect(t1.calls[0].conversationId).toBe("settle:s2:refund");
    expect(map.get("s2")!.deposit_state).toBe("refunded");
    expect(settled).toEqual([{ id: "s2", nextState: "refunded", nowISO: NOW, expectedFrom: "captured" }]);
    expect(c1).toMatchObject({ refunded: 1, failed: 0 });

    // Re-tick the now-terminal row: reversal still set but state refunded ->
    // decision 'none' -> ZERO new iyzico calls.
    const t2 = makeIyzico();
    const c2 = await processSettlement(deps(store, t2.iyzico));
    expect(t2.calls).toHaveLength(0); // <-- terminal, no double-refund
    expect(map.get("s2")!.deposit_state).toBe("refunded");
    expect(c2).toMatchObject({ refunded: 0, skipped: 1 });
  });
});

describe("support-flow gate — resolve->uphold keeps the money", () => {
  it("scenario 3: disputed captured deposit, op_resolve_dispute uphold (no reversal) -> tick does NOTHING (0 iyzico calls), stays captured", async () => {
    const { store, settled, map } = makeStore([
      candidate({ id: "s3", deposit_state: "captured", penalty_eligible_at: ISO, disputed_at: ISO }),
    ]);

    // op_resolve_dispute uphold: clear disputed_at, NO reversal flag set.
    opResolveUphold(map, "s3");

    // Tick: captured + penalty-only -> decide returns 'none' (no double
    // capture, no reversal) -> ZERO iyzico calls, money correctly kept.
    const t1 = makeIyzico();
    const c1 = await processSettlement(deps(store, t1.iyzico));
    expect(t1.calls).toHaveLength(0); // <-- uphold keeps the money
    expect(settled).toHaveLength(0);
    expect(map.get("s3")!.deposit_state).toBe("captured");
    expect(c1).toMatchObject({ captured: 0, refunded: 0, skipped: 1, failed: 0 });
  });
});

describe("support-flow gate — operator can NOT double-refund a terminal deposit", () => {
  it("scenario 4: already-released deposit, operator wrongly sets reversal_eligible_at -> tick decides 'none' -> ZERO iyzico calls", async () => {
    const { store, settled, map } = makeStore([
      candidate({ id: "s4", deposit_state: "released" }),
    ]);

    // An operator wrongly flags reversal on an already-terminal (released) row.
    map.set("s4", { ...map.get("s4")!, reversal_eligible_at: NOW });

    // Tick: reversal + released -> decide returns 'none' (idempotent no-op) ->
    // ZERO iyzico calls. The operator CANNOT double-refund / re-touch money.
    const t1 = makeIyzico();
    const c1 = await processSettlement(deps(store, t1.iyzico));
    expect(t1.calls).toHaveLength(0); // <-- no double-refund on terminal
    expect(settled).toHaveLength(0);
    expect(map.get("s4")!.deposit_state).toBe("released"); // unchanged
    expect(c1).toMatchObject({ refunded: 0, released: 0, skipped: 1, failed: 0 });
  });
});

describe("support-flow gate — quarantine -> op_unquarantine -> retry recovers", () => {
  it("scenario 5: held+release-eligible fails maxAttempts times -> quarantined (ticks then 0 calls); op_unquarantine + iyzico ok -> exactly ONE release -> released", async () => {
    const { store, events, quarantined, map } = makeStore([
      // settle_attempts=4, maxAttempts=5: one failure pushes it to 5 -> quarantine.
      candidate({ id: "s5", deposit_state: "held", release_eligible_at: ISO, settle_attempts: 4 }),
    ]);

    // Tick 1: iyzico release fails -> attempt 5 -> quarantined. ONE attempt made.
    const failTick = makeIyzico({ release: "fail" });
    const c1 = await processSettlement(deps(store, failTick.iyzico, { maxAttempts: 5 }));
    expect(failTick.calls).toHaveLength(1); // it DID attempt the money move
    expect(map.get("s5")!.deposit_state).toBe("held"); // HARD CONTRACT: no flip on failure
    expect(map.get("s5")!.settle_attempts).toBe(5);
    expect(quarantined).toEqual([{ id: "s5", nowISO: NOW }]); // parked exactly once
    expect(map.get("s5")!.quarantined_at).toBe(NOW);
    expect(events.map((e) => e.kind)).toEqual(["deposit_settle_failed", "deposit_quarantined"]);
    expect(c1).toMatchObject({ failed: 1, quarantined: 1, released: 0 });

    // Tick 2 (and any number of ticks): quarantined -> skipped, ZERO calls. Even
    // if iyzico would now succeed, the parked row does not get spammed.
    const stuck = makeIyzico();
    const c2 = await processSettlement(deps(store, stuck.iyzico, { maxAttempts: 5 }));
    expect(stuck.calls).toHaveLength(0); // <-- parked, no retry spam
    expect(c2).toMatchObject({ skipped: 1, released: 0, quarantined: 0 });

    // op_unquarantine: clear quarantined_at + reset settle_attempts to 0.
    opUnquarantine(map, "s5");

    // Tick 3: now unblocked, iyzico ok -> exactly ONE release -> released.
    const okTick = makeIyzico();
    const c3 = await processSettlement(deps(store, okTick.iyzico, { maxAttempts: 5 }));
    expect(okTick.calls).toHaveLength(1); // <-- recovery: exactly one real release
    expect(okTick.calls[0].op).toBe("release");
    expect(map.get("s5")!.deposit_state).toBe("released");
    expect(c3).toMatchObject({ released: 1, skipped: 0, failed: 0, quarantined: 0 });
  });
});

describe("support-flow gate — dispute timeline is the ordered 'what happened' record", () => {
  it("scenario 6: buildDisputeTimeline merges reservation + station + deposit milestones in true chronological order", () => {
    // A realistic late-return-then-refund story. Times chosen so the merged
    // order interleaves all three sources (not just grouped by source).
    const reservation = {
      ble_session_id: "sess_abc",
      opened_at: "2026-06-06T10:00:05.000Z", // gate opened
      returned_at: "2026-06-06T10:40:00.000Z", // came back (late)
      release_eligible_at: null,
      penalty_eligible_at: "2026-06-06T10:30:00.000Z", // abandoned-sweep penalized
      reversal_eligible_at: "2026-06-06T10:40:05.000Z", // late return -> reverse
      settled_at: "2026-06-06T11:00:00.000Z",
      disputed_at: null,
      deposit_state: "refunded",
    };
    const reservationEvents = [
      { kind: "unlock_signed", at: "2026-06-06T10:00:00.000Z", payload: { gate: 1 } },
      { kind: "abandoned", at: "2026-06-06T10:30:00.000Z", payload: { reason: "timeout" } },
    ];
    const stationEvents = [
      { event: "gate_opened", session_id: "sess_abc", received_at: "2026-06-06T10:00:10.000Z", wall_ts: 1, seq: 1, gate: 1 },
      { event: "gate_closed", session_id: "sess_abc", received_at: "2026-06-06T10:40:02.000Z", wall_ts: 2, seq: 2, gate: 1 },
      // A different session's event must NOT appear in this reservation's story.
      { event: "gate_opened", session_id: "OTHER", received_at: "2026-06-06T10:05:00.000Z", wall_ts: 9, seq: 9, gate: 1 },
    ];

    const timeline = buildDisputeTimeline(reservation, reservationEvents, stationEvents);

    // The ordered story support reads. Each tuple is [at, source, kind].
    const story = timeline.map((e) => [e.at, e.source, e.kind]);
    expect(story).toEqual([
      ["2026-06-06T10:00:00.000Z", "reservation", "unlock_signed"],
      ["2026-06-06T10:00:05.000Z", "deposit", "gate_opened_at"],
      ["2026-06-06T10:00:10.000Z", "station", "gate_opened"],
      ["2026-06-06T10:30:00.000Z", "reservation", "abandoned"],
      ["2026-06-06T10:30:00.000Z", "deposit", "penalty_eligible"], // tie: reservation before deposit (stable)
      ["2026-06-06T10:40:00.000Z", "deposit", "returned_at"],
      ["2026-06-06T10:40:02.000Z", "station", "gate_closed"],
      ["2026-06-06T10:40:05.000Z", "deposit", "reversal_eligible"],
      ["2026-06-06T11:00:00.000Z", "deposit", "settled(refunded)"],
    ]);

    // The OTHER session's event is excluded; only this session's 2 station rows.
    expect(timeline.filter((e) => e.source === "station")).toHaveLength(2);
    // Carried device detail (wall_ts/seq/gate) survives on station entries.
    const closed = timeline.find((e) => e.source === "station" && e.kind === "gate_closed");
    expect(closed!.detail).toMatchObject({ wall_ts: 2, seq: 2, gate: 1 });
  });
});
