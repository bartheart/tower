import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';

export async function exchangePublicToken(publicToken: string): Promise<{ itemId: string }> {
  // Refresh session — the Plaid flow can take minutes and the token may have expired
  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr || !refreshed.session) {
    throw new Error('Session expired — please sign out and sign in again');
  }

  const { data, error } = await supabase.functions.invoke('exchange-public-token', {
    body: { public_token: publicToken },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.text();
      throw new Error(`exchange-public-token ${error.context.status}: ${body}`);
    }
    throw new Error(`exchange-public-token failed: ${error.message}`);
  }
  return { itemId: data.item_id };
}
