// Unit tests for the PURE settlement conversationId builders.
//
// These helpers construct the STABLE iyzico conversationId per reservation +
// money operation (capture / release / refund) so retries are idempotent on
// the iyzico side. They are Deno-free, so Jest imports them directly — same
// pattern as reconcile.test.ts / canonical-parity.test.ts.
import {
  refundConversationId,
  captureConversationId,
  releaseConversationId,
} from "../../supabase/functions/settlement/refundConversationId";

describe("settlement conversationId builders", () => {
  const RID = "res_abc123";

  it("refundConversationId follows settle:<id>:refund", () => {
    expect(refundConversationId(RID)).toBe("settle:res_abc123:refund");
  });

  it("captureConversationId follows settle:<id>:capture", () => {
    expect(captureConversationId(RID)).toBe("settle:res_abc123:capture");
  });

  it("releaseConversationId follows settle:<id>:release", () => {
    expect(releaseConversationId(RID)).toBe("settle:res_abc123:release");
  });

  it("is stable across calls (idempotency key must not change between retries)", () => {
    expect(refundConversationId(RID)).toBe(refundConversationId(RID));
    expect(captureConversationId(RID)).toBe(captureConversationId(RID));
    expect(releaseConversationId(RID)).toBe(releaseConversationId(RID));
  });

  it("namespaces each operation distinctly for the same reservation", () => {
    const ids = new Set([
      refundConversationId(RID),
      captureConversationId(RID),
      releaseConversationId(RID),
    ]);
    expect(ids.size).toBe(3);
  });

  it("partitions by reservation id", () => {
    expect(refundConversationId("a")).not.toBe(refundConversationId("b"));
  });
});
