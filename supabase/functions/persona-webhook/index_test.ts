import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { mapInquiryToVerification, verifyPersonaSignature, extractPersonaDob } from './index.ts';

Deno.test('maps inquiry.approved → verified for age+selfie', () => {
  const rows = mapInquiryToVerification('inquiry.approved', 'inq_1', 'user-uuid');
  assertEquals(rows.length, 2);
  assertEquals(rows.every((r) => r.state === 'verified'), true);
  assertEquals(new Set(rows.map((r) => r.kind)), new Set(['age', 'selfie']));
});
Deno.test('maps inquiry.declined → failed', () => {
  const rows = mapInquiryToVerification('inquiry.declined', 'inq_2', 'user-uuid');
  assertEquals(rows.every((r) => r.state === 'failed'), true);
});
Deno.test('maps inquiry.marked-for-review → pending', () => {
  const rows = mapInquiryToVerification('inquiry.marked-for-review', 'inq_3', 'user-uuid');
  assertEquals(rows.every((r) => r.state === 'pending'), true);
});
Deno.test('extractPersonaDob pulls birthdate from inquiry attributes', () => {
  const dob = extractPersonaDob({ 'birthdate': '2000-01-15' });
  assertEquals(dob, '2000-01-15');
  assertEquals(extractPersonaDob({}), null);
});
Deno.test('HMAC signature verification accepts a correct signature', async () => {
  const secret = 'whsec_test';
  const body = '{"hello":"world"}';
  const t = '1700000000';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const header = `t=${t},v1=${hex}`;
  assertEquals(await verifyPersonaSignature(body, header, secret), true);
  assertEquals(await verifyPersonaSignature(body, `t=${t},v1=deadbeef`, secret), false);
});
