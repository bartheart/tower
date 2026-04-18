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

  const { item_id, cursor } = await req.json();
  if (!item_id) return new Response('item_id required', { status: 400 });

  // Retrieve access_token from vault — verify ownership via user_id
  const { data: tokenRow, error: tokenError } = await supabase
    .from('plaid_tokens')
    .select('access_token')
    .eq('item_id', item_id)
    .eq('user_id', user.id)
    .single();

  if (tokenError || !tokenRow) {
    return new Response('Token not found', { status: 404 });
  }

  const plaidRes = await fetch(`${plaidBaseUrl()}/transactions/sync`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify({
      access_token: tokenRow.access_token,
      cursor: cursor ?? '',
      count: 100,
    }),
  });

  const plaidData = await plaidRes.json();
  if (!plaidRes.ok) return new Response(JSON.stringify(plaidData), { status: 502 });

  return new Response(
    JSON.stringify({
      added: plaidData.added,
      removed: plaidData.removed,
      next_cursor: plaidData.next_cursor,
      has_more: plaidData.has_more,
      accounts: plaidData.accounts ?? [],
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
