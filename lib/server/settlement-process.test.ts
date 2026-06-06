// THE no-double-charge proof for Phase 2 settlement orchestration.
//
// processSettlement is the pure (Deno-free) orchestration around the Task 3
// decision engine (decideDepositSettlement). It scans candidate reservations,
// drives the right iyzico op (release / capture / refund) via a PORT, and
// persists deposit_state ONLY AFTER iyzico confirms success — so a failed money
// move never flips state, and the next tick retries. This test suite proves
// that invariant by asserting the EXACT number of iyzico calls per scenario.
//
// Deno-free, so Jest imports the orchestration directly (same pattern as
// settlement-decide.test.ts / settlement-ids.test.ts). The store + iyzico are
// in-memory recording fakes; no DB, no network, no Deno.
import {
  processSettlement,
  type SettlementCandidate,
  type SettlementIyzico,
  type SettlementStore,
} from "../../supabase/functions/settlement/process";
import type { DepositState } from "../../supabase/functions/settlement/decide";

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

// Recording fake iyzico: records every call, returns a per-op configured result
// (ok / not-ok / throw). Lets each test assert the EXACT call count + args.
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
      calls.push({ op: "release", priceTry: args.priceTry, ip: args.ip, conversationId: args.conversationId, paymentId: args.paymentId });
      return result("release");
    },
    refund(args) {
      calls.push({ op: "refund", priceTry: args.priceTry, ip: args.ip, conversationId: args.conversationId, paymentTxnId: args.paymentTxnId });
      return result("refund");
    },
  };
  return { iyzico, calls };
}

// In-memory store: a Map of candidates, recorded markSettled writes + events.
function makeStore(initial: SettlementCandidate[]) {
  const map = new Map<string, SettlementCandidate>();
  for (const c of initial) map.set(c.id, { ...c });
  const events: RecordedEvent[] = [];
  const settled: Array<{ id: string; nextState: DepositState; nowISO: string; expectedFrom: DepositState }> = [];
  const store: SettlementStore = {
    getCandidates(_limit: number) {
      return Promise.resolve([...map.values()]);
    },
    markSettled(id, nextState, nowISO, expectedFrom) {
      settled.push({ id, nextState, nowISO, expectedFrom });
      const cur = map.get(id);
      // CONDITIONAL: only apply the flip if the row is still at expectedFrom —
      // mirrors the real store's lost-update guard. A stale expectedFrom is a
      // harmless no-op (another writer already advanced the row).
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
  return { store, events, settled, map };
}

function candidate(over: Partial<SettlementCandidate> & { id: string }): SettlementCandidate {
  return {
    deposit_state: "held",
    hold_id: "pay_1",
    hold_txn_id: "txn_1",
    release_eligible_at: null,
    penalty_eligible_at: null,
    reversal_eligible_at: null,
    ...over,
  };
}

const deps = (store: SettlementStore, iyzico: SettlementIyzico, over: Partial<Parameters<typeof processSettlement>[0]> = {}) => ({
  store,
  iyzico,
  now: () => NOW,
  ip: "0.0.0.0",
  priceTry: "20.00",
  ...over,
});

describe("processSettlement — happy paths drive exactly one iyzico op", () => {
  it("release happy: release+held -> ONE release call, state released, audit deposit_release", async () => {
    const { store, events, settled, map } = makeStore([
      candidate({ id: "r1", deposit_state: "held", release_eligible_at: ISO }),
    ]);
    const { iyzico, calls } = makeIyzico();
    const counts = await processSettlement(deps(store, iyzico));

    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("release");
    expect(calls[0].paymentId).toBe("pay_1");
    expect(calls[0].conversationId).toBe("settle:r1:release");
    expect(map.get("r1")!.deposit_state).toBe("released");
    expect(settled).toEqual([{ id: "r1", nextState: "released", nowISO: NOW, expectedFrom: "held" }]);
    expect(events.map((e) => e.kind)).toEqual(["deposit_release"]);
    expect(counts).toMatchObject({ released: 1, captured: 0, refunded: 0, failed: 0, skipped: 0 });
  });

  it("capture happy: penalty+held -> ONE capture (with hold_id), state captured", async () => {
    const { store, events, settled, map } = makeStore([
      candidate({ id: "r2", deposit_state: "held", penalty_eligible_at: ISO }),
    ]);
    const { iyzico, calls } = makeIyzico();
    const counts = await processSettlement(deps(store, iyzico));

    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("capture");
    expect(calls[0].paymentId).toBe("pay_1");
    expect(calls[0].conversationId).toBe("settle:r2:capture");
    expect(map.get("r2")!.deposit_state).toBe("captured");
    expect(settled).toEqual([{ id: "r2", nextState: "captured", nowISO: NOW, expectedFrom: "held" }]);
    expect(events.map((e) => e.kind)).toEqual(["deposit_capture"]);
    expect(counts).toMatchObject({ captured: 1, failed: 0 });
  });

  it("refund happy: reversal+captured -> ONE refund (with hold_txn_id), state refunded", async () => {
    const { store, events, settled, map } = makeStore([
      candidate({ id: "r3", deposit_state: "captured", reversal_eligible_at: ISO }),
    ]);
    const { iyzico, calls } = makeIyzico();
    const counts = await processSettlement(deps(store, iyzico));

    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("refund");
    expect(calls[0].paymentTxnId).toBe("txn_1");
    expect(calls[0].conversationId).toBe("settle:r3:refund");
    expect(map.get("r3")!.deposit_state).toBe("refunded");
    expect(settled).toEqual([{ id: "r3", nextState: "refunded", nowISO: NOW, expectedFrom: "captured" }]);
    expect(events.map((e) => e.kind)).toEqual(["deposit_refund"]);
    expect(counts).toMatchObject({ refunded: 1, failed: 0 });
  });
});

describe("processSettlement — no-double-charge invariant", () => {
  it("idempotent re-run: after a happy settle the terminal row -> decision none -> ZERO new iyzico calls, no new audit", async () => {
    const { store, events, map } = makeStore([
      candidate({ id: "r1", deposit_state: "held", release_eligible_at: ISO }),
    ]);
    const first = makeIyzico();
    await processSettlement(deps(store, first.iyzico));
    expect(first.calls).toHaveLength(1);
    expect(map.get("r1")!.deposit_state).toBe("released");
    const eventsAfterFirst = events.length;

    // Second sweep over the now-terminal row: release flag still set, but
    // deposit_state is 'released' -> decideDepositSettlement returns 'none'.
    const second = makeIyzico();
    const counts = await processSettlement(deps(store, second.iyzico));
    expect(second.calls).toHaveLength(0); // <-- the core no-double-charge proof
    expect(events.length).toBe(eventsAfterFirst); // no new audit
    expect(counts).toMatchObject({ released: 0, skipped: 1 });
  });

  it("iyzico failure (ok:false) leaves deposit_state UNCHANGED, audits deposit_settle_failed, failed++; retried next tick captures exactly once", async () => {
    const { store, events, settled, map } = makeStore([
      candidate({ id: "r2", deposit_state: "held", penalty_eligible_at: ISO }),
    ]);
    // First tick: capture fails -> state must NOT flip.
    const failTick = makeIyzico({ capture: "fail" });
    const c1 = await processSettlement(deps(store, failTick.iyzico));
    expect(failTick.calls).toHaveLength(1); // it DID attempt
    expect(map.get("r2")!.deposit_state).toBe("held"); // but state UNCHANGED
    expect(settled).toHaveLength(0); // no markSettled on failure
    expect(events.map((e) => e.kind)).toEqual(["deposit_settle_failed"]);
    expect(c1).toMatchObject({ captured: 0, failed: 1 });

    // Second tick: capture succeeds -> captures exactly ONCE, now flips.
    const okTick = makeIyzico({ capture: "ok" });
    const c2 = await processSettlement(deps(store, okTick.iyzico));
    expect(okTick.calls).toHaveLength(1); // exactly one real capture, ever
    expect(map.get("r2")!.deposit_state).toBe("captured");
    expect(c2).toMatchObject({ captured: 1, failed: 0 });
  });

  it("conditional markSettled passes expectedFrom = the ORIGINAL deposit_state the decision rode on", async () => {
    const { store, settled, map } = makeStore([
      candidate({ id: "r5", deposit_state: "held", penalty_eligible_at: ISO }),
    ]);
    const { iyzico } = makeIyzico();
    await processSettlement(deps(store, iyzico));
    // expectedFrom is the pre-flip state ('held'), nextState is terminal.
    expect(settled).toEqual([{ id: "r5", nextState: "captured", nowISO: NOW, expectedFrom: "held" }]);
    expect(map.get("r5")!.deposit_state).toBe("captured");
  });

  it("lost-update guard: a markSettled with a STALE expectedFrom is a no-op (concurrent writer already advanced the row)", async () => {
    const { store, map } = makeStore([
      candidate({ id: "r6", deposit_state: "held", release_eligible_at: ISO }),
    ]);
    // First worker settles the row: held -> released.
    await processSettlement(deps(store, makeIyzico().iyzico));
    expect(map.get("r6")!.deposit_state).toBe("released");

    // Simulate a second, slower worker that computed its decision from the OLD
    // 'held' state and only now calls markSettled. Its expectedFrom='held' no
    // longer matches the row (now 'released') -> conditional update is a no-op.
    await store.markSettled("r6", "captured", NOW, "held");
    expect(map.get("r6")!.deposit_state).toBe("released"); // NOT clobbered to captured
  });

  it("iyzico throws -> same as ok:false: caught, state unchanged, failed++, continue", async () => {
    const { store, events, settled, map } = makeStore([
      candidate({ id: "r2", deposit_state: "held", penalty_eligible_at: ISO }),
    ]);
    const { iyzico, calls } = makeIyzico({ capture: "throw" });
    const counts = await processSettlement(deps(store, iyzico));
    expect(calls).toHaveLength(1);
    expect(map.get("r2")!.deposit_state).toBe("held");
    expect(settled).toHaveLength(0);
    expect(events.map((e) => e.kind)).toEqual(["deposit_settle_failed"]);
    expect(counts).toMatchObject({ failed: 1, captured: 0 });
  });
});

describe("processSettlement — graceful degrade + safety", () => {
  it("missing payment ref: refund needed but hold_txn_id null -> NO iyzico call, failed++ reason missing_payment_ref", async () => {
    const { store, events, settled } = makeStore([
      candidate({ id: "r3", deposit_state: "captured", reversal_eligible_at: ISO, hold_txn_id: null }),
    ]);
    const { iyzico, calls } = makeIyzico();
    const counts = await processSettlement(deps(store, iyzico));

    expect(calls).toHaveLength(0); // never call iyzico without a payment ref
    expect(settled).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("deposit_settle_failed");
    expect(events[0].payload).toMatchObject({ action: "refund", reason: "missing_payment_ref" });
    expect(counts).toMatchObject({ failed: 1, refunded: 0 });
  });

  it("precedence/safety: BOTH penalty AND reversal set on a captured row -> exactly one REFUND, never a capture", async () => {
    const { store, map } = makeStore([
      candidate({ id: "r4", deposit_state: "captured", penalty_eligible_at: ISO, reversal_eligible_at: ISO }),
    ]);
    const { iyzico, calls } = makeIyzico();
    await processSettlement(deps(store, iyzico));

    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("refund"); // reversal wins; NEVER capture
    expect(calls.some((c) => c.op === "capture")).toBe(false);
    expect(map.get("r4")!.deposit_state).toBe("refunded");
  });

  it("per-row isolation: 3 candidates, middle throws -> other two settle (ONE call each), failed=1", async () => {
    const { store, map } = makeStore([
      candidate({ id: "a", deposit_state: "held", release_eligible_at: ISO }),
      candidate({ id: "b", deposit_state: "held", penalty_eligible_at: ISO }),
      candidate({ id: "c", deposit_state: "captured", reversal_eligible_at: ISO }),
    ]);
    // Make only the capture (the middle row "b") throw.
    const { iyzico, calls } = makeIyzico({ capture: "throw" });
    const counts = await processSettlement(deps(store, iyzico));

    // One call per row: release(a) ok, capture(b) throws, refund(c) ok.
    expect(calls).toHaveLength(3);
    expect(calls.filter((c) => c.op === "release")).toHaveLength(1);
    expect(calls.filter((c) => c.op === "capture")).toHaveLength(1);
    expect(calls.filter((c) => c.op === "refund")).toHaveLength(1);

    expect(map.get("a")!.deposit_state).toBe("released"); // unaffected by b's failure
    expect(map.get("b")!.deposit_state).toBe("held"); // failed, unchanged
    expect(map.get("c")!.deposit_state).toBe("refunded"); // unaffected by b's failure
    expect(counts).toMatchObject({ released: 1, refunded: 1, captured: 0, failed: 1 });
  });
});
