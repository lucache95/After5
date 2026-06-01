// supabase/functions/_shared/_test_anthropic_stub.ts
// TEST-ONLY stand-in for the Anthropic SDK. Wired in via _test_import_map.json
// so `import Anthropic from 'npm:@anthropic-ai/sdk@^0.40.0'` resolves here
// during `deno test` (the real npm package isn't installed in the Deno test
// env). NOT shipped — referenced only by the import map. The LLM writing pass
// itself is never exercised in unit tests (it makes a network call); only the
// pure prompt builders (buildSystemPrompt / buildUserMessage) are tested.

type TextBlock = { type: 'text'; text: string };

export default class Anthropic {
  constructor(_opts?: { apiKey?: string }) {}
  messages = {
    create: (_args: unknown): Promise<{ content: TextBlock[] }> =>
      Promise.resolve({ content: [{ type: 'text', text: '[]' }] }),
  };
}
