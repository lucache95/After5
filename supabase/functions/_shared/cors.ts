// Shared CORS headers for Edge Functions invoked from browser clients.
// Allow all origins in dev. Tighten to https://after5.app once live.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
