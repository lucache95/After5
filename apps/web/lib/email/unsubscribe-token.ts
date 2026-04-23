// HMAC-signed unsubscribe tokens. No DB lookup needed to verify — we
// just check the signature. Token shape:
//   base64url(email):base64url(sig)
// where sig = HMAC-SHA256(SUBSCRIBER_TOKEN_SECRET, email).

import { createHmac } from 'crypto';

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function secret(): string {
  const s = process.env.SUBSCRIBER_TOKEN_SECRET;
  if (!s) throw new Error('SUBSCRIBER_TOKEN_SECRET missing');
  return s;
}

export function makeUnsubToken(email: string): string {
  const e = email.toLowerCase().trim();
  const sig = createHmac('sha256', secret()).update(e).digest();
  return `${b64url(e)}.${b64url(sig)}`;
}

export function verifyUnsubToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const email = fromB64url(parts[0]).toString('utf8');
  const expected = createHmac('sha256', secret()).update(email).digest();
  const provided = fromB64url(parts[1]);
  if (provided.length !== expected.length) return null;
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ provided[i];
  return diff === 0 ? email : null;
}
