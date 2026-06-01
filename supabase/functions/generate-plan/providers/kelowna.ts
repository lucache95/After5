import type { DateGenerationProvider, GenerationContext } from './types.ts';
import { runPipeline } from './pipeline.ts';

// KelownaProvider — the entire current pipeline, curated-only ('live'). This
// is the default provider and must behave byte-identically to pre-M1.
export const KelownaProvider: DateGenerationProvider = {
  name: 'kelowna',
  generate(ctx: GenerationContext) {
    return runPipeline(ctx, { approvalStatuses: ['live'] });
  },
};
