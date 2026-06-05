// Golden-vector parity tests. The shared fixture
// supabase/functions/_shared/__fixtures__/event-signing-vectors.json pins the
// canonical signing string + HMAC sig for a representative set of events. It is
// the cross-runtime contract that:
//   • this Jest suite (Node) asserts against now,
//   • the Deno verify (supabase/functions/_shared/eventverify.test.ts) asserts
//     against in the Supabase functions runtime,
//   • the firmware C++ HMAC implementation MUST reproduce byte-for-byte.
// If any of these drift, signature verification breaks silently in production.
import vectors from "../../supabase/functions/_shared/__fixtures__/event-signing-vectors.json";
import { verifyEventSig } from "./eventVerify";
import { eventSigningPayload, type StationEvent } from "../ble/protocol";

type Vector = {
  secretHex: string;
  event: Record<string, unknown>;
  canonical: string;
  sig: string;
};

describe("event-signing golden vectors", () => {
  for (const v of vectors as Vector[]) {
    const kind = String((v.event as { event: string }).event);

    it(`recomputes canonical for ${kind}`, () => {
      expect(eventSigningPayload(v.event as unknown as StationEvent)).toBe(v.canonical);
    });

    it(`verifies pinned sig for ${kind}`, () => {
      const signed = { ...v.event, sig: v.sig } as unknown as StationEvent;
      expect(verifyEventSig(signed, v.secretHex)).toBe(true);
    });

    it(`rejects a flipped-char sig for ${kind}`, () => {
      const first = v.sig[0];
      const flipped = (first === "0" ? "1" : "0") + v.sig.slice(1);
      const signed = { ...v.event, sig: flipped } as unknown as StationEvent;
      expect(verifyEventSig(signed, v.secretHex)).toBe(false);
    });
  }
});
