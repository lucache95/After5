import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { parseProviderMap, resolveProviderName } from './select.ts';

Deno.test('parseProviderMap: tolerates junk, returns {}', () => {
  assertEquals(parseProviderMap(null), {});
  assertEquals(parseProviderMap('garbage'), {});
  assertEquals(parseProviderMap(['a', 'b']), {});
  assertEquals(parseProviderMap({ kelowna: 'kelowna', _default: 'onthefly' }), { kelowna: 'kelowna', _default: 'onthefly' });
  // Non-string values are dropped.
  assertEquals(parseProviderMap({ kelowna: 'kelowna', bad: 3 }), { kelowna: 'kelowna' });
});

Deno.test('resolveProviderName: explicit city wins, else _default, else kelowna', () => {
  const m = { kelowna: 'kelowna', _default: 'onthefly', vancouver: 'railway' };
  assertEquals(resolveProviderName('kelowna', m), 'kelowna');
  assertEquals(resolveProviderName('vancouver', m), 'railway');
  assertEquals(resolveProviderName('vernon', m), 'onthefly');     // _default
  assertEquals(resolveProviderName('vernon', {}), 'kelowna');     // hard fallback
});
