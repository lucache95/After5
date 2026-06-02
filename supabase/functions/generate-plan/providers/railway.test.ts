import { assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { RailwayProvider } from './railway.ts';
import { PipelineError } from './pipeline.ts';

Deno.test('RailwayProvider: throws generation_unavailable when railwayUrl is unset', async () => {
  const ctx = {
    inputs: {} as any,
    city: { slug: 'vancouver', name: 'Vancouver', region: 'BC' } as any,
    supabase: {} as any,
    env: { anthropicKey: 'x', anthropicModel: 'm' }, // no railwayUrl
    log: {},
  } as any;
  const err = await assertRejects(() => RailwayProvider.generate(ctx), PipelineError);
  if ((err as PipelineError).code !== 'generation_unavailable') {
    throw new Error(`expected code generation_unavailable, got ${(err as PipelineError).code}`);
  }
});
