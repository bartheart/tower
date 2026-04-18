import { syncTransactions } from '../syncTransactions';
import { database } from '../../db';
import PlaidItem from '../../db/models/PlaidItem';
import Transaction from '../../db/models/Transaction';
import { supabase } from '../../supabase/client';

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-jwt' } },
      }),
    },
    functions: {
      invoke: jest.fn(),
    },
  },
}));

jest.mock('../../db', () => {
  const { Database } = require('@nozbe/watermelondb');
  const SQLiteAdapter = require('@nozbe/watermelondb/adapters/sqlite').default;
  const { schema } = require('../../db/schema');
  const { migrations } = require('../../db/migrations');
  const TransactionModel = require('../../db/models/Transaction').default;
  const AccountModel = require('../../db/models/Account').default;
  const PlaidItemModel = require('../../db/models/PlaidItem').default;

  const adapter = new SQLiteAdapter({ schema, migrations, dbName: ':memory:' });
  const db = new Database({ adapter, modelClasses: [TransactionModel, AccountModel, PlaidItemModel] });
  return { database: db };
});

const mockInvoke = supabase.functions.invoke as jest.Mock;

const PLAID_SYNC_RESPONSE = {
  added: [
    {
      transaction_id: 'txn_1',
      account_id: 'acc_1',
      amount: 84.20,
      merchant_name: 'Whole Foods',
      name: 'Whole Foods Market',
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' },
      date: '2026-04-10',
      pending: false,
    },
  ],
  modified: [],
  removed: [],
  next_cursor: 'cursor_v2',
  has_more: false,
  accounts: [],
};

describe('syncTransactions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches transactions from Plaid via edge function and writes to WatermelonDB', async () => {
    mockInvoke.mockResolvedValueOnce({ data: PLAID_SYNC_RESPONSE, error: null });

    const userId = 'user-test-123';

    await database.write(async () => {
      await database.get<PlaidItem>('plaid_items').create(item => {
        item.itemId = 'item_1';
        item.userId = userId;
        item.accessToken = '';
        item.institutionId = 'ins_1';
        item.institutionName = 'Chase';
        item.cursor = '';
      });
    });

    const item = (await database.get<PlaidItem>('plaid_items').query().fetch())[0];
    await syncTransactions(item, userId);

    // Verify edge function invoked (not fetch directly)
    expect(mockInvoke).toHaveBeenCalledWith(
      'sync-transactions',
      expect.objectContaining({ body: expect.objectContaining({ item_id: 'item_1' }) }),
    );

    const txns = await database.get<Transaction>('transactions').query().fetch();
    expect(txns).toHaveLength(1);
    expect(txns[0].merchantName).toBe('Whole Foods');
    expect(txns[0].categoryL1).toBe('Food and Drink');
    expect(txns[0].categoryL2).toBe('Groceries');
    expect(txns[0].userId).toBe(userId);

    const updatedItem = (await database.get<PlaidItem>('plaid_items').query().fetch())[0];
    expect(updatedItem.cursor).toBe('cursor_v2');
  });
});
