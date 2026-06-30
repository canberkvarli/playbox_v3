// PURE, Deno-free. Jest-importable directly.
//
// SECURITY: a capture must NEVER exceed the server-recorded hold amount, and
// must never go negative or NaN — otherwise a client could postauth an
// arbitrary amount against a hold. This clamps a (possibly missing / malformed)
// client-supplied amount to [0, holdAmount]. `requested` is typed `unknown`
// because it comes straight off the request body.

export function clampCaptureAmount(requested: unknown, holdAmount: number): number {
  const r = Number(requested ?? holdAmount);
  const safe = Number.isFinite(r) ? r : holdAmount;
  return Math.min(Math.max(0, safe), holdAmount);
}
