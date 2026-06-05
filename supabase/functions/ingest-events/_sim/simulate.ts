// LIVE end-to-end simulator for the ingest-events function (Deno, write-only).
//
// This is the WET, full-stack gate to run ONCE the Supabase stack is up (DB +
// migrations applied, station + reservation seeded, `supabase functions serve
// ingest-events` running). It signs the same scenario events the Jest loop test
// (lib/server/ingest-loop.test.ts) drives — with a real DEV-001 hex secret — and
// POSTs them to the live function, printing pass/fail per scenario based on the
// returned { accepted, deduped, rejected, reconciled, acked_seq } counts.
//
// The Jest test is the DETERMINISTIC proof of the orchestration logic. THIS
// script is the integration gate that the Supabase wiring (RLS, upsert
// onConflict, the cursor update, JWT auth, CORS) is correct end-to-end. It does
// NOT assert reservation-row state (that requires a DB read); it asserts the
// response envelope per scenario. Inspect the DB manually / via the README's SQL
// to confirm reservation mutations.
//
// Env:
//   INGEST_URL          full URL of the served function
//                       (e.g. http://127.0.0.1:54321/functions/v1/ingest-events)
//   STATION_SECRET_HEX  the 64-hex secret for the seeded station (DEV-001)
//   AUTH_JWT            a Supabase user JWT (any authenticated user may courier)
//   STATION_ID          optional, defaults to DEV-001
//
// Run:  deno run --allow-net --allow-env simulate.ts
//
// NOTE: each run should use a FRESH station_id / seq space (or reset the DB),
// since station_events dedupe by (station_id, seq) — a re-run reuses seqs and
// every scenario after #1 will read as a dedupe hit. The README shows the reset.

const INGEST_URL = Deno.env.get("INGEST_URL");
const SECRET_HEX = Deno.env.get("STATION_SECRET_HEX");
const AUTH_JWT = Deno.env.get("AUTH_JWT");
const STATION_ID = Deno.env.get("STATION_ID") ?? "DEV-001";

if (!INGEST_URL || !SECRET_HEX || !AUTH_JWT) {
  console.error(
    "Missing env. Required: INGEST_URL, STATION_SECRET_HEX, AUTH_JWT (STATION_ID optional, default DEV-001).",
  );
  Deno.exit(2);
}

// ---- signing (mirrors firmware + _shared/blesign.ts + lib/server/eventVerify) ----
// HMAC-SHA256 over the canonical pipe-delimited payload, key = hex-decoded secret.
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Same canonical string as lib/ble/protocol.ts::eventSigningPayload.
function signingPayload(e: Record<string, unknown>): string {
  const gate = "gate" in e ? String(e.gate) : "";
  const session = "session_id" in e ? String(e.session_id) : "";
  const extra =
    e.event === "battery_low" || e.event === "battery_critical" ? String(e.mv) : "";
  return `${e.event}|${gate}|${session}|${e.seq}|${e.ts}|${extra}`;
}
async function sign(e: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(SECRET_HEX!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = signingPayload(e);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return { ...e, sig: bytesToHex(mac) };
}

async function post(events: Array<Record<string, unknown>>) {
  const res = await fetch(INGEST_URL!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${AUTH_JWT}`,
    },
    body: JSON.stringify({ station_id: STATION_ID, events }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

type Expect = Partial<{
  accepted: number;
  deduped: number;
  rejected: number;
  reconciled: number;
  acked_seq: number;
}>;

let passes = 0;
let fails = 0;
function check(name: string, got: any, want: Expect) {
  const mismatches: string[] = [];
  for (const [k, v] of Object.entries(want)) {
    if (got?.[k] !== v) mismatches.push(`${k}: expected ${v}, got ${got?.[k]}`);
  }
  if (mismatches.length === 0) {
    passes++;
    console.log(`PASS  ${name}  → ${JSON.stringify(got)}`);
  } else {
    fails++;
    console.log(`FAIL  ${name}  → ${mismatches.join("; ")}  (full: ${JSON.stringify(got)})`);
  }
}

// Use a unique session/seq space per run so re-runs don't collide on dedupe.
const RUN = Date.now().toString(36);
const S = (suffix: string) => `${RUN}-${suffix}`;

async function main() {
  console.log(`ingest-events live simulator → ${INGEST_URL} (station ${STATION_ID}, run ${RUN})\n`);

  // NOTE: these scenarios assume the README's seeded reservations whose
  // ble_session_id match the S(...) values below. Adjust the seed SQL to use the
  // printed RUN id, OR seed generic sessions and map them here.

  // 1. Happy path: gate_opened(1) + gate_closed(2)
  {
    const events = [
      await sign({ event: "gate_opened", gate: 1, session_id: S("happy"), seq: 1, ts: 100 }),
      await sign({ event: "gate_closed", gate: 1, session_id: S("happy"), seq: 2, ts: 200 }),
    ];
    const { json } = await post(events);
    check("1 happy path", json, { accepted: 2, deduped: 0, rejected: 0, reconciled: 2, acked_seq: 2 });
  }

  // 2. Replay / dedupe: re-POST the same batch
  {
    const events = [
      await sign({ event: "gate_opened", gate: 1, session_id: S("happy"), seq: 1, ts: 100 }),
      await sign({ event: "gate_closed", gate: 1, session_id: S("happy"), seq: 2, ts: 200 }),
    ];
    const { json } = await post(events);
    check("2 replay/dedupe", json, { accepted: 0, deduped: 2, rejected: 0, reconciled: 0, acked_seq: 2 });
  }

  // 4. Tampered sig (numbered to match Jest scenarios; #3 out-of-order below).
  {
    const good = await sign({ event: "gate_closed", gate: 1, session_id: S("tamper"), seq: 10, ts: 1000 });
    const sig = good.sig as string;
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    const { json } = await post([{ ...good, sig: flipped }]);
    check("4 tampered sig", json, { accepted: 0, rejected: 1, reconciled: 0 });
  }

  // 5. Foreign / unknown session: signed but no reservation → stored + reconciled.
  {
    const ev = await sign({ event: "gate_closed", gate: 1, session_id: S("ghost"), seq: 20, ts: 2000 });
    const { json } = await post([ev]);
    check("5 foreign session (stored+reconciled, no_reservation)", json, {
      accepted: 1,
      rejected: 0,
      reconciled: 1,
    });
  }

  // 7. Late return after penalty (requires a reservation with penalty_eligible_at
  //    set whose ble_session_id = S("late") — see README seed).
  {
    const ev = await sign({ event: "gate_closed", gate: 1, session_id: S("late"), seq: 30, ts: 3000 });
    const { json } = await post([ev]);
    check("7 late return after penalty", json, { accepted: 1, reconciled: 1 });
  }

  console.log(`\n${passes} passed, ${fails} failed.`);
  console.log(
    "Inspect reservation-row mutations (opened_at/returned_at/release_eligible_at/" +
      "reversal_eligible_at) + station_events.reconciled_at + stations.acked_seq via the README SQL.",
  );
  Deno.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("simulator crashed:", e);
  Deno.exit(3);
});
