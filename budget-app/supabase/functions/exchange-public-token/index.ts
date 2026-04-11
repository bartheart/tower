import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { plaidBaseUrl, plaidHeaders } from '../_shared/plaid.ts';

serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  const { public_token } = await req.json();

  const response = await fetch(`${plaidBaseUrl()}/item/public_token/exchange`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify({ public_token }),
  });

  const data = await response.json();
  if (!response.ok) return new Response(JSON.stringify(data), { status: 502 });

  // Return access_token + item_id to device — NOT stored server-side
  return new Response(
    JSON.stringify({ access_token: data.access_token, item_id: data.item_id }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
