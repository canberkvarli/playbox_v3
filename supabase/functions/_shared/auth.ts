/**
 * Pulls the Supabase user id (`sub`) out of the Authorization bearer token.
 * The JWT is already verified by the Edge Functions runtime (verify_jwt on by
 * default), so here we just decode the payload to route by user. We do NOT
 * trust this for anything beyond routing; all DB writes go through RLS
 * policies that enforce `user_id = auth.uid()`.
 */
export function getUserIdFromRequest(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const json = JSON.parse(atob(payload));
    const sub = typeof json?.sub === 'string' ? json.sub : null;
    return sub;
  } catch {
    return null;
  }
}

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

/**
 * Returns the `role` claim from the bearer JWT, or null. Used by the
 * sweep function to distinguish service-role (cron) calls from user calls.
 * Trust here is acceptable because the Edge Functions runtime has already
 * verified the JWT's signature.
 */
export function getRoleFromRequest(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const json = JSON.parse(atob(payload));
    return typeof json?.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}
