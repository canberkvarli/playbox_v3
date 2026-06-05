// Requires Deno (Supabase functions runtime); not run in the Node dev env —
// guarded by the shared golden fixtures which the Jest suite also checks.
//
// Run (when Deno is available):
//   deno test --allow-read supabase/functions/_shared/eventverify.test.ts
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { verifyEventSig } from "./eventverify.ts";
import { eventSigningPayload } from "./canonical.ts";

type Vector = {
  secretHex: string;
  event: Record<string, unknown>;
  canonical: string;
  sig: string;
};

const fixtureUrl = new URL(
  "./__fixtures__/event-signing-vectors.json",
  import.meta.url,
);
const vectors: Vector[] = JSON.parse(await Deno.readTextFile(fixtureUrl));

for (const v of vectors) {
  const kind = String((v.event as { event: string }).event);

  Deno.test(`canonical matches fixture for ${kind}`, () => {
    assert(eventSigningPayload(v.event) === v.canonical);
  });

  Deno.test(`verifyEventSig accepts pinned sig for ${kind}`, async () => {
    const ok = await verifyEventSig({ ...v.event, sig: v.sig }, v.secretHex);
    assert(ok === true);
  });

  Deno.test(`verifyEventSig rejects tampered sig for ${kind}`, async () => {
    const first = v.sig[0];
    const flipped = (first === "0" ? "1" : "0") + v.sig.slice(1);
    const ok = await verifyEventSig({ ...v.event, sig: flipped }, v.secretHex);
    assert(ok === false);
  });
}
