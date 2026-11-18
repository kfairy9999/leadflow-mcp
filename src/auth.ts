/** Constant-time string compare for bearer tokens. Length is not secret. */
export function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

export function bearerMatches(authorization: string | null | undefined, expected: string): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const presented = authorization.slice('Bearer '.length).trim();
  if (presented.length === 0) return false;
  return safeEqual(presented, expected);
}

export const MIN_AUTH_TOKEN_LENGTH = 16;

export function assertAuthToken(token: string): void {
  if (token.length < MIN_AUTH_TOKEN_LENGTH) {
    throw new Error(`LEADFLOW_AUTH_TOKEN must be at least ${MIN_AUTH_TOKEN_LENGTH} characters.`);
  }
}
