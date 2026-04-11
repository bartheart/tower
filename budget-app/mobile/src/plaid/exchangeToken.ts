import { supabase } from '../supabase/client';

const EDGE_FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`;

export async function exchangePublicToken(publicToken: string): Promise<{ itemId: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch(`${EDGE_FN_URL}/exchange-public-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ public_token: publicToken }),
  });

  if (!response.ok) throw new Error('Failed to exchange token');
  const data = await response.json();
  return { itemId: data.item_id };
}
