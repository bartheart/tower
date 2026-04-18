import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';

export async function fetchLinkToken(): Promise<string> {
  // Force-refresh so the access_token sent to Edge Functions is always current.
  // The auto-refresh timer may not have fired yet if the app was just resumed.
  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr || !refreshed.session) {
    throw new Error('Session expired — please sign out and sign in again');
  }

  const { data, error } = await supabase.functions.invoke('create-link-token');
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.text();
      throw new Error(`create-link-token ${error.context.status}: ${body}`);
    }
    throw new Error(`create-link-token failed: ${error.message}`);
  }
  if (!data?.link_token) throw new Error(`No link_token in response: ${JSON.stringify(data)}`);
  return data.link_token;
}
