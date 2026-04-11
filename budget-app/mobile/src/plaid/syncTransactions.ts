import { Q } from '@nozbe/watermelondb';
import PlaidItem from '../db/models/PlaidItem';
import Transaction from '../db/models/Transaction';
import { database } from '../db';

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

export async function syncTransactions(plaidItem: PlaidItem): Promise<void> {
  let cursor = plaidItem.cursor ?? '';
  let hasMore = true;

  while (hasMore) {
    const response = await fetch('https://sandbox.plaid.com/transactions/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.EXPO_PUBLIC_PLAID_CLIENT_ID,
        secret: process.env.EXPO_PUBLIC_PLAID_SECRET,
        access_token: plaidItem.accessToken,
        cursor,
        count: 100,
      }),
    });

    if (!response.ok) throw new Error('Plaid sync failed');
    const data = await response.json();

    await database.write(async () => {
      // Add new transactions
      for (const txn of data.added as PlaidTransaction[]) {
        await database.get<Transaction>('transactions').create(t => {
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

      // Remove deleted transactions
      for (const removed of data.removed) {
        const existing = await database.get<Transaction>('transactions')
          .query(Q.where('plaid_transaction_id', removed.transaction_id))
          .fetch();
        if (existing.length > 0) await existing[0].destroyPermanently();
      }

      // Update cursor on the PlaidItem
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
  const items = await database.get<PlaidItem>('plaid_items').query().fetch();
  await Promise.all(items.map(item => syncTransactions(item)));
}
