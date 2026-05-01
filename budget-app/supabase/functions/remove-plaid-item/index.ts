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

  const { item_id: itemId } = await req.json();
  if (!itemId) return new Response(JSON.stringify({ error: 'item_id required' }), { status: 400 });

  // Fetch access token from vault — verifying this item belongs to this user
  const { data: tokenRow } = await supabase
    .from('plaid_tokens')
    .select('access_token')
    .eq('item_id', itemId)
    .eq('user_id', user.id)
    .single();

  if (!tokenRow) {
    return new Response(JSON.stringify({ error: 'Item not found' }), { status: 404 });
  }

  // Call Plaid /item/remove — best-effort; we clean up locally even if this fails
  await fetch(`${plaidBaseUrl()}/item/remove`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify({ access_token: tokenRow.access_token }),
  }).catch(() => {
    // Plaid errors here are non-fatal — we still delete our local record
  });

  // Delete the token row — cascades nothing (transactions kept per design)
  const { error: deleteError } = await supabase
    .from('plaid_tokens')
    .delete()
    .eq('item_id', itemId)
    .eq('user_id', user.id);

  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
