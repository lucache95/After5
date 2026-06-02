import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { blurParams, blurredPathFor } from './index.ts';
Deno.test('blurredPathFor maps clear -> _blurred', () => {
  assertEquals(blurredPathFor('uid/photoid.jpg'), 'uid/photoid_blurred.jpg');
  assertEquals(blurredPathFor('abc/9e.jpg'), 'abc/9e_blurred.jpg');
});
Deno.test('blurParams downscales longest side to 64 preserving aspect, positive radius', () => {
  const p = blurParams(1000, 500);
  assertEquals(p.width, 64);
  assertEquals(p.height, 32);
  assertEquals(p.blurRadius >= 2, true);
});
Deno.test('blurParams does not upscale small images', () => {
  const p = blurParams(40, 20);
  assertEquals(p.width, 40);
  assertEquals(p.height, 20);
});
