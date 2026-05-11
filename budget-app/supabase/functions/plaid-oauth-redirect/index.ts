import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

serve((req) => {
  const url = new URL(req.url);
  const target = `tower://plaid-oauth${url.search}`;
  return Response.redirect(target, 302);
});
