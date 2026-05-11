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

  // Optional item_id signals update mode (re-auth an existing Item)
  const body = req.headers.get('content-type')?.includes('application/json')
    ? await req.json().catch(() => ({}))
    : {};
  const itemId: string | undefined = body?.item_id;

  const plaidBody: Record<string, unknown> = {
    user: { client_user_id: user.id },
    client_name: 'Tower',
    country_codes: ['US'],
    language: 'en',
    webhook: `${Deno.env.get('SUPABASE_URL')}/functions/v1/plaid-webhook`,
  };

  if (itemId) {
    // Update mode: fetch access token from vault, pass to Plaid
    const { data: tokenRow } = await supabase
      .from('plaid_tokens')
      .select('access_token')
      .eq('item_id', itemId)
      .eq('user_id', user.id)
      .single();

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: 'Item not found' }), { status: 404 });
    }

    plaidBody.access_token = tokenRow.access_token;

    // Reset error status now that user is re-authenticating
    await supabase
      .from('plaid_tokens')
      .update({ status: 'good' })
      .eq('item_id', itemId)
      .eq('user_id', user.id);
  } else {
    // Normal mode: link a new item
    plaidBody.products = ['transactions'];
  }

  const response = await fetch(`${plaidBaseUrl()}/link/token/create`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify(plaidBody),
  });

  const data = await response.json();
  if (!response.ok) return new Response(JSON.stringify(data), { status: 502 });

  return new Response(JSON.stringify({ link_token: data.link_token }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
