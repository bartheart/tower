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

  const response = await fetch(`${plaidBaseUrl()}/link/token/create`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify({
      user: { client_user_id: user.id },
      client_name: 'Tower',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    }),
  });

  const data = await response.json();
  if (!response.ok) return new Response(JSON.stringify(data), { status: 502 });

  // Return only the link_token — nothing sensitive stored
  return new Response(JSON.stringify({ link_token: data.link_token }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
