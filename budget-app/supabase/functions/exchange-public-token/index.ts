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

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (authError || !user) return new Response('Unauthorized', { status: 401 });

  const { public_token } = await req.json();

  const plaidRes = await fetch(`${plaidBaseUrl()}/item/public_token/exchange`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify({ public_token }),
  });

  const plaidData = await plaidRes.json();
  if (!plaidRes.ok) return new Response(JSON.stringify(plaidData), { status: 502 });

  const { access_token, item_id } = plaidData;

  // Ensure public.users row exists — handles accounts created before the trigger was deployed
  await supabase
    .from('users')
    .upsert({ id: user.id, email: user.email ?? '' }, { onConflict: 'id' });

  // Store access_token server-side — never returned to client
  const { error: upsertError } = await supabase
    .from('plaid_tokens')
    .upsert(
      { user_id: user.id, item_id, access_token },
      { onConflict: 'item_id' }
    );

  if (upsertError) {
    console.error('Failed to store plaid token:', upsertError);
    return new Response('Failed to store token', { status: 500 });
  }

  // Return ONLY item_id — access_token stays on server
  return new Response(
    JSON.stringify({ item_id }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
