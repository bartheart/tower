import { Q } from '@nozbe/watermelondb';
import PlaidItem from '../db/models/PlaidItem';
import Transaction from '../db/models/Transaction';
import Account from '../db/models/Account';
import { database } from '../db';
import { supabase } from '../supabase/client';

const PLAID_CATEGORY_MAP: Record<string, string> = {
  'FOOD_AND_DRINK': 'Food and Drink',
  'FOOD_AND_DRINK_GROCERIES': 'Groceries',
  'FOOD_AND_DRINK_RESTAURANTS': 'Restaurants',
  'FOOD_AND_DRINK_FAST_FOOD': 'Fast Food',
  'FOOD_AND_DRINK_BARS': 'Bars',
  'TRANSPORTATION': 'Transportation',
  'TRANSPORTATION_GAS_STATION': 'Gas',
  'TRANSPORTATION_TAXI': 'Uber / Taxi',
  'TRANSPORTATION_PARKING': 'Parking',
  'RENT_AND_UTILITIES': 'Housing',
  'RENT_AND_UTILITIES_RENT': 'Rent',
  'RENT_AND_UTILITIES_UTILITIES': 'Utilities',
  'ENTERTAINMENT': 'Entertainment',
  'GENERAL_MERCHANDISE': 'Shopping',
  'PERSONAL_CARE': 'Personal Care',
  'INCOME': 'Income',
  'TRANSFER_IN': 'Transfer In',
  'TRANSFER_OUT': 'Transfer Out',
};

function mapCategory(raw: string): string {
  return PLAID_CATEGORY_MAP[raw] ?? raw.replace(/_/g, ' ').toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  merchant_name?: string;
  name: string;
  personal_finance_category?: { primary: string; detailed: string };
  date: string;
  pending: boolean;
}

interface PlaidAccount {
  account_id: string;
  name: string;
  type: string;
  subtype: string;
  balances: { current: number | null; available: number | null };
}

async function upsertAccounts(
  accounts: PlaidAccount[],
  plaidItem: PlaidItem,
  userId: string,
) {
  if (!accounts?.length) return;

  // Only query this user's accounts — prevents touching another user's rows
  const existing = await database.get<Account>('accounts')
    .query(Q.where('user_id', userId))
    .fetch();
  const existingMap = new Map(existing.map(a => [a.plaidAccountId, a]));

  await database.write(async () => {
    for (const acc of accounts) {
      const record = existingMap.get(acc.account_id);
      if (record) {
        await record.update(a => {
          a.currentBalance = acc.balances.current ?? 0;
          a.availableBalance = acc.balances.available ?? 0;
        });
      } else {
        await database.get<Account>('accounts').create(a => {
          a.userId = userId;
          a.plaidAccountId = acc.account_id;
          a.plaidItemId = plaidItem.itemId;
          a.name = acc.name;
          a.type = acc.type;
          a.subtype = acc.subtype ?? '';
          a.currentBalance = acc.balances.current ?? 0;
          a.availableBalance = acc.balances.available ?? 0;
          a.institutionName = plaidItem.institutionName;
        });
      }
    }
  });
}

export async function syncTransactions(
  plaidItem: PlaidItem,
  userId: string,
): Promise<void> {
  let cursor = plaidItem.cursor ?? '';
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase.functions.invoke('sync-transactions', {
      body: { item_id: plaidItem.itemId, cursor },
    });

    if (error) throw new Error(`sync-transactions failed: ${error.message}`);

    await upsertAccounts(data.accounts, plaidItem, userId);

    await database.write(async () => {
      for (const txn of data.added as PlaidTransaction[]) {
        // Scope duplicate check to this user — another user's identical
        // plaid_transaction_id must not block this user's record.
        const existing = await database.get<Transaction>('transactions')
          .query(
            Q.where('user_id', userId),
            Q.where('plaid_transaction_id', txn.transaction_id),
          )
          .fetch();
        if (existing.length > 0) continue;

        await database.get<Transaction>('transactions').create(t => {
          t.userId = userId;
          t.plaidTransactionId = txn.transaction_id;
          t.accountId = txn.account_id;
          t.amount = txn.amount;
          t.merchantName = txn.merchant_name ?? txn.name;
          t.categoryL1 = mapCategory(txn.personal_finance_category?.primary ?? 'OTHER');
          t.categoryL2 = mapCategory(txn.personal_finance_category?.detailed ?? '');
          t.date = txn.date;
          t.pending = txn.pending;
        });
      }

      for (const removed of data.removed) {
        const existing = await database.get<Transaction>('transactions')
          .query(
            Q.where('user_id', userId),
            Q.where('plaid_transaction_id', removed.transaction_id),
          )
          .fetch();
        if (existing.length > 0) await existing[0].destroyPermanently();
      }

      await plaidItem.update(item => { item.cursor = data.next_cursor; });
    });

    cursor = data.next_cursor;
    hasMore = data.has_more;
  }

  await database.write(async () => {
    await plaidItem.update(item => { item.lastSyncedAt = Date.now(); });
  });
}

export async function syncAllItems(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Only sync this user's plaid_items
  const items = await database.get<PlaidItem>('plaid_items')
    .query(Q.where('user_id', user.id))
    .fetch();

  await Promise.all(items.map(item => syncTransactions(item, user.id)));
}

/**
 * One-time startup migration: blank any access_tokens still sitting
 * in SQLite from before the Vault migration. Safe to call on every launch —
 * it only writes if it finds non-empty values.
 */
export async function migrateAccessTokens(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const items = await database.get<PlaidItem>('plaid_items')
    .query(Q.where('user_id', user.id))
    .fetch();
  const stale = items.filter(i => i.accessToken && i.accessToken.length > 0);
  if (stale.length === 0) return;

  await database.write(async () => {
    for (const item of stale) {
      await item.update(i => { i.accessToken = ''; });
    }
  });
}
