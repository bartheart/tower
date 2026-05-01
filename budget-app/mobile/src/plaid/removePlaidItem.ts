import { FunctionsHttpError } from '@supabase/supabase-js';
import { Q } from '@nozbe/watermelondb';
import { supabase } from '../supabase/client';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import Account from '../db/models/Account';

/**
 * Revokes Plaid access for an item and removes all local WatermelonDB records
 * for that item and its accounts. Transaction history is kept.
 */
export async function removePlaidItem(itemId: string): Promise<void> {
  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr || !refreshed.session) {
    throw new Error('Session expired — please sign out and sign in again');
  }

  const { data, error } = await supabase.functions.invoke('remove-plaid-item', {
    body: { item_id: itemId },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.text();
      throw new Error(`remove-plaid-item ${error.context.status}: ${body}`);
    }
    throw new Error(`remove-plaid-item failed: ${error.message}`);
  }

  if (!data?.success) {
    throw new Error(`remove-plaid-item returned: ${JSON.stringify(data)}`);
  }

  // Clean up local WatermelonDB records for this item and its accounts
  await database.write(async () => {
    const items = await database.get<PlaidItem>('plaid_items')
      .query(Q.where('item_id', itemId))
      .fetch();

    const accounts = await database.get<Account>('accounts')
      .query(Q.where('plaid_item_id', itemId))
      .fetch();

    for (const item of items) await item.destroyPermanently();
    for (const account of accounts) await account.destroyPermanently();
  });
}
