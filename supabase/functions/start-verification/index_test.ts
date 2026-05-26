import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildInquiryRequest } from './index.ts';

Deno.test('buildInquiryRequest sets template-id and reference-id', () => {
  const body = buildInquiryRequest('user-uuid-123', 'itmpl_abc');
  assertEquals(body.data.attributes['inquiry-template-id'], 'itmpl_abc');
  assertEquals(body.data.attributes['reference-id'], 'user-uuid-123');
});
