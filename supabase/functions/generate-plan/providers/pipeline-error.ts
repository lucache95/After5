// PipelineError lives in its own module so importers that only need the typed
// error (e.g. the OnTheFlyProvider unit tests) do NOT transitively pull
// pipeline.ts → prompt.ts → npm:@anthropic-ai/sdk, which isn't resolvable in the
// plain `deno test` env (no node_modules). Same dodge 08-02 used for
// computeUnverifiedRate. pipeline.ts re-exports this so existing imports of
// `PipelineError` from './pipeline.ts' keep working unchanged.

// Typed pipeline error → handler maps .code/.message back to the EXACT 422/503
// response bodies the frontend already handles.
export class PipelineError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.name = 'PipelineError';
  }
}
