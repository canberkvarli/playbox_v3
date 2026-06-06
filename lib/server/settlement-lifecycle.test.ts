// THE Phase-2 acceptance gate — the multi-tick MONEY LIFECYCLE proof.
//
// settlement-process.test.ts (Task 4) proves SINGLE-decision behavior: one
// processSettlement call drives exactly one iyzico op per row. This suite
// (Task 5) proves the FULL LIFECYCLE: a deposit moving through states across
// SUCCESSIVE sweeps as Phase-1 flags arrive over time — released / captured /
// the headline capture→refund reversal (net-zero, never a second capture) /
// return-beat-the-sweep / courier-delayed flags / an iyzico outage that
// recovers. Each "tick" is one processSettlement(deps) call over the CURRENT
// candidate rows; between ticks we MUTATE the rows to simulate Phase-1 writing
// its *_eligible_at flags (and reconcile clearing penalty on a late return).
//
// The proof is the recording fake iyzico's CUMULATIVE call log: at every step
// we assert the EXACT multiset of calls made so far. That is the end-to-end
// no-double-charge guarantee — money moves at most once per leg, ever.
//
// Deno-free, ports-only: same in-memory store + recording fake patterns as
// settlement-process.test.ts. If a scenario FAILS here it is a REAL bug in
// process.ts / decide.ts (a money-safety violation) — do not weaken the test.
import {
  processSettlement,
  type SettlementCandidate,
  type SettlementIyzico,
  type SettlementStore,
} from "../../supabase/functions/settlement/process";
import type { DepositState } from "../../supabase/functions/settlement/decide";

const T0 = "2026-06-06T12:00:00.000Z"; // a Phase-1 flag timestamp
const NOW = "2026-06-06T13:00:00.000Z"; // settlement "now"

type RecordedCall = {
  op: "capture" | "release" | "refund";
  id: string; // reservation id (parsed from the stable conversationId)
  conversationId: string;
  paymentId?: string;
  paymentTxnId?: string;
};

type IyzicoMode = "ok" | "fail" | "throw";

// A recording fake iyzico shared ACROSS ticks: the call log accumulates so we
// can assert CUMULATIVE counts at each step. Per-op behavior is mutable between
// ticks (set `modes.capture = "ok"`) to simulate an outage recovering.
function makeIyzico(initial: Partial<Record<RecordedCall["op"], IyzicoMode>> = {}) {
  const calls: RecordedCall[] = [];
  const modes: Record<RecordedCall["op"], IyzicoMode> = {
    capture: initial.capture ?? "ok",
    release: initial.release ?? "ok",
    refund: initial.refund ?? "ok",
  };
  // conversationId is the stable `settle:<id>:<action>` key — parse the id back
  // out so the cumulative log is keyed by reservation, exactly the dedupe key
  // iyzico itself would see.
  const idOf = (conversationId: string) => conversationId.split(":")[1];
  function result(op: RecordedCall["op"]): Promise<{ ok: boolean }> {
    const mode = modes[op];
    if (mode === "throw") return Promise.reject(new Error(`iyzico ${op} exploded`));
    return Promise.resolve({ ok: mode === "ok" });
  }
  const iyzico: SettlementIyzico = {
    capture(args) {
      calls.push({ op: "capture", id: idOf(args.conversationId), conversationId: args.conversationId, paymentId: args.paymentId });
      return result("capture");
    },
    release(args) {
      calls.push({ op: "release", id: idOf(args.conversationId), conversationId: args.conversationId, paymentId: args.paymentId });
      return result("release");
    },
    refund(args) {
      calls.push({ op: "refund", id: idOf(args.conversationId), conversationId: args.conversationId, paymentTxnId: args.paymentTxnId });
      return result("refund");
    },
  };
  // counts of each op so far (cumulative, across every tick).
  const tally = () => ({
    capture: calls.filter((c) => c.op === "capture").length,
    release: calls.filter((c) => c.op === "release").length,
    refund: calls.filter((c) => c.op === "refund").length,
  });
  // ops for a single reservation, in order — the "ledger" for one deposit.
  const ledger = (id: string) => calls.filter((c) => c.id === id).map((c) => c.op);
  return { iyzico, calls, modes, tally, ledger };
}

// In-memory store whose candidate rows are MUTABLE between ticks. `mutate`
// simulates Phase-1 / reconcile writing flags onto the row (a late return
// clears penalty + sets reversal, etc.). markSettled is the same conditional
// (lost-update-guarded) flip as the real store.
function makeStore(initial: SettlementCandidate[]) {
  const map = new Map<string, SettlementCandidate>();
  for (const c of initial) map.set(c.id, { ...c });
  const events: Array<{ id: string; kind: string; payload: unknown }> = [];
  const store: SettlementStore = {
    getCandidates(_limit: number) {
      return Promise.resolve([...map.values()].map((c) => ({ ...c })));
    },
    markSettled(id, nextState, _nowISO, expectedFrom) {
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
  const mutate = (id: string, patch: Partial<SettlementCandidate>) => {
    const cur = map.get(id);
    if (!cur) throw new Error(`no candidate ${id}`);
    map.set(id, { ...cur, ...patch });
  };
  const stateOf = (id: string) => map.get(id)!.deposit_state;
  return { store, events, map, mutate, stateOf };
}

function candidate(over: Partial<SettlementCandidate> & { id: string }): SettlementCandidate {
  return {
    deposit_state: "held",
    hold_id: "pay_" + over.id,
    hold_txn_id: "txn_" + over.id,
    release_eligible_at: null,
    penalty_eligible_at: null,
    reversal_eligible_at: null,
    ...over,
  };
}

const deps = (store: SettlementStore, iyzico: SettlementIyzico) => ({
  store,
  iyzico,
  now: () => NOW,
  ip: "0.0.0.0",
  priceTry: "20.00",
});

// One sweep tick = one processSettlement call over the CURRENT candidate rows.
const tick = (store: SettlementStore, iyzico: SettlementIyzico) =>
  processSettlement(deps(store, iyzico));

describe("settlement lifecycle — deposit moves through states across successive sweeps", () => {
  it("1. confirmed on-time return: held+release_eligible -> ONE release, terminal, re-tick is a no-op", async () => {
    const h = makeStore([candidate({ id: "r1", deposit_state: "held", release_eligible_at: T0 })]);
    const z = makeIyzico();

    // Tick 1: the gate_closed (on-time) flag is present -> release the hold.
    await tick(h.store, z.iyzico);
    expect(h.stateOf("r1")).toBe("released");
    expect(z.tally()).toEqual({ capture: 0, release: 1, refund: 0 });

    // Tick 2: terminal row -> decision 'none' -> ZERO new calls.
    await tick(h.store, z.iyzico);
    expect(z.tally()).toEqual({ capture: 0, release: 1, refund: 0 }); // cumulative unchanged
    expect(z.ledger("r1")).toEqual(["release"]);
  });

  it("2. abandoned then settled: held+penalty_eligible -> ONE capture, terminal, re-tick is a no-op", async () => {
    const h = makeStore([candidate({ id: "r2", deposit_state: "held", penalty_eligible_at: T0 })]);
    const z = makeIyzico();

    // Tick 1: the abandoned sweep set penalty_eligible_at -> capture the deposit.
    await tick(h.store, z.iyzico);
    expect(h.stateOf("r2")).toBe("captured");
    expect(z.tally()).toEqual({ capture: 1, release: 0, refund: 0 });

    // Tick 2: terminal -> no double capture.
    await tick(h.store, z.iyzico);
    expect(z.tally()).toEqual({ capture: 1, release: 0, refund: 0 });
    expect(z.ledger("r2")).toEqual(["capture"]);
  });

  it("3. HEADLINE reversal: late return AFTER penalty captured -> capture then refund, NEVER a 2nd capture (net = 0)", async () => {
    const h = makeStore([candidate({ id: "r3", deposit_state: "held", penalty_eligible_at: T0 })]);
    const z = makeIyzico();

    // Tick 1: abandoned -> capture the penalty.
    await tick(h.store, z.iyzico);
    expect(h.stateOf("r3")).toBe("captured");
    expect(z.tally()).toEqual({ capture: 1, release: 0, refund: 0 });

    // Between ticks: the ball comes back LATE. Phase-1 gate_closed CLEARS
    // penalty_eligible_at and SETS reversal_eligible_at — in the same update —
    // while deposit_state stays 'captured'.
    h.mutate("r3", { penalty_eligible_at: null, reversal_eligible_at: T0 });

    // Tick 2: reversal wins on a captured row -> refund the captured penalty.
    await tick(h.store, z.iyzico);
    expect(h.stateOf("r3")).toBe("refunded");

    // CUMULATIVE proof: exactly one capture + one refund, and NEVER a second
    // capture. Money in (capture) then money back out (refund) -> net zero.
    expect(z.tally()).toEqual({ capture: 1, release: 0, refund: 1 });
    expect(z.ledger("r3")).toEqual(["capture", "refund"]);
    expect(z.calls.filter((c) => c.id === "r3" && c.op === "capture")).toHaveLength(1);

    // Tick 3: terminal 'refunded' -> no further movement.
    await tick(h.store, z.iyzico);
    expect(z.tally()).toEqual({ capture: 1, release: 0, refund: 1 });
  });

  it("4. return BEAT the sweep: reversal set while still held (penalty never fired) -> ONE release, ZERO refund", async () => {
    // The late-return flag lands before the abandoned sweep ever captured. The
    // row is still 'held' with reversal_eligible_at set and NO penalty captured.
    const h = makeStore([candidate({ id: "r4", deposit_state: "held", reversal_eligible_at: T0 })]);
    const z = makeIyzico();

    await tick(h.store, z.iyzico);

    // reversal on a HELD row -> release (cancel the hold), NOT refund — there
    // is no captured money to give back.
    expect(h.stateOf("r4")).toBe("released");
    expect(z.tally()).toEqual({ capture: 0, release: 1, refund: 0 });
    expect(z.ledger("r4")).toEqual(["release"]);

    // Re-tick: terminal, no movement.
    await tick(h.store, z.iyzico);
    expect(z.tally()).toEqual({ capture: 0, release: 1, refund: 0 });
  });

  it("5. flag arrives across ticks (courier-delayed): no flags -> 0 calls; later release flag -> ONE release", async () => {
    const h = makeStore([candidate({ id: "r5", deposit_state: "held" })]); // NO flags yet
    const z = makeIyzico();

    // Tick 1: nothing eligible -> the sweep skips the row entirely.
    await tick(h.store, z.iyzico);
    expect(h.stateOf("r5")).toBe("held");
    expect(z.tally()).toEqual({ capture: 0, release: 0, refund: 0 });

    // The courier is delayed; the return finally lands -> Phase-1 sets release.
    h.mutate("r5", { release_eligible_at: T0 });

    // Tick 2: the sweep now picks up the freshly-landed flag -> ONE release.
    await tick(h.store, z.iyzico);
    expect(h.stateOf("r5")).toBe("released");
    expect(z.tally()).toEqual({ capture: 0, release: 1, refund: 0 });
    expect(z.ledger("r5")).toEqual(["release"]);
  });

  it("6. iyzico down then recovers: capture ok:false tick 1 (stays held), ok:true tick 2 -> exactly ONE successful capture", async () => {
    const h = makeStore([candidate({ id: "r6", deposit_state: "held", penalty_eligible_at: T0 })]);
    const z = makeIyzico({ capture: "fail" }); // outage

    // Tick 1: capture attempted but iyzico is down (ok:false) -> state UNCHANGED.
    await tick(h.store, z.iyzico);
    expect(h.stateOf("r6")).toBe("held"); // no flip on a failed money move
    expect(z.tally()).toEqual({ capture: 1, release: 0, refund: 0 }); // it tried once

    // iyzico recovers.
    z.modes.capture = "ok";

    // Tick 2: retried -> succeeds -> captured. Still exactly ONE *successful*
    // capture; the failed attempt never charged, so there is no double-charge.
    await tick(h.store, z.iyzico);
    expect(h.stateOf("r6")).toBe("captured");
    expect(z.tally()).toEqual({ capture: 2, release: 0, refund: 0 }); // 2 attempts...
    expect(z.ledger("r6")).toEqual(["capture", "capture"]); // ...but the first was a no-op fail

    // Tick 3: terminal -> no further attempts.
    await tick(h.store, z.iyzico);
    expect(z.tally()).toEqual({ capture: 2, release: 0, refund: 0 });
  });

  it("7. money-safety invariant (sweep-wide): one of EACH scenario in a single batch -> exact cumulative multiset, no net penalty after reversal", async () => {
    // A realistic sweep: every lifecycle shape at once, driven over multiple
    // ticks with flags arriving between them. We assert the TOTAL iyzico call
    // multiset matches exactly — no surprise extra calls anywhere.
    const h = makeStore([
      candidate({ id: "ontime", deposit_state: "held", release_eligible_at: T0 }), // -> release
      candidate({ id: "abandon", deposit_state: "held", penalty_eligible_at: T0 }), // -> capture (terminal)
      candidate({ id: "reversal", deposit_state: "held", penalty_eligible_at: T0 }), // -> capture, then refund
      candidate({ id: "beatsweep", deposit_state: "held", reversal_eligible_at: T0 }), // -> release (no refund)
      candidate({ id: "delayed", deposit_state: "held" }), // no flags yet -> picked up later
    ]);
    const z = makeIyzico();

    // ── Tick 1 ──
    await tick(h.store, z.iyzico);
    expect(h.stateOf("ontime")).toBe("released");
    expect(h.stateOf("abandon")).toBe("captured");
    expect(h.stateOf("reversal")).toBe("captured");
    expect(h.stateOf("beatsweep")).toBe("released");
    expect(h.stateOf("delayed")).toBe("held"); // skipped — no flag yet
    expect(z.tally()).toEqual({ capture: 2, release: 2, refund: 0 });

    // Between ticks: the reversal row's ball returns late (clear penalty + set
    // reversal); the delayed row's return finally lands (set release).
    h.mutate("reversal", { penalty_eligible_at: null, reversal_eligible_at: T0 });
    h.mutate("delayed", { release_eligible_at: T0 });

    // ── Tick 2 ──
    await tick(h.store, z.iyzico);
    expect(h.stateOf("reversal")).toBe("refunded");
    expect(h.stateOf("delayed")).toBe("released");
    expect(z.tally()).toEqual({ capture: 2, release: 3, refund: 1 });

    // ── Tick 3 (idempotency): every row terminal -> ZERO new calls. ──
    await tick(h.store, z.iyzico);
    expect(z.tally()).toEqual({ capture: 2, release: 3, refund: 1 }); // cumulative frozen

    // Per-reservation ledgers — the money-safety invariant spelled out:
    expect(z.ledger("ontime")).toEqual(["release"]);
    expect(z.ledger("abandon")).toEqual(["capture"]);
    expect(z.ledger("reversal")).toEqual(["capture", "refund"]); // captured then GAVE BACK -> net 0
    expect(z.ledger("beatsweep")).toEqual(["release"]); // never captured -> nothing to refund
    expect(z.ledger("delayed")).toEqual(["release"]);

    // The headline invariant: NO row that saw a reversal was left net-penalized.
    // Every captured-then-reversed deposit has a matching refund, and no row was
    // ever captured twice.
    for (const id of ["ontime", "abandon", "reversal", "beatsweep", "delayed"]) {
      const led = z.ledger(id);
      expect(led.filter((op) => op === "capture").length).toBeLessThanOrEqual(1);
      if (led.includes("capture") && id === "reversal") {
        expect(led).toContain("refund"); // captured penalty was reversed -> money returned
      }
    }
  });
});
