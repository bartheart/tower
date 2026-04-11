import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from '../schema';
import { migrations } from '../migrations';
import Transaction from '../models/Transaction';
import Account from '../models/Account';
import PlaidItem from '../models/PlaidItem';

function makeTestDatabase() {
  const adapter = new SQLiteAdapter({ schema, migrations, dbName: ':memory:' });
  return new Database({
    adapter,
    modelClasses: [Transaction, Account, PlaidItem],
  });
}

describe('WatermelonDB models', () => {
  let db: Database;

  beforeEach(() => { db = makeTestDatabase(); });

  it('creates and retrieves a transaction', async () => {
    await db.write(async () => {
      await db.get<Transaction>('transactions').create(t => {
        t.plaidTransactionId = 'txn_123';
        t.accountId = 'acc_1';
        t.amount = 84.20;
        t.merchantName = 'Whole Foods';
        t.categoryL1 = 'Food and Drink';
        t.categoryL2 = 'Groceries';
        t.date = '2026-04-10';
        t.pending = false;
      });
    });

    const txns = await db.get<Transaction>('transactions').query().fetch();
    expect(txns).toHaveLength(1);
    expect(txns[0].merchantName).toBe('Whole Foods');
    expect(txns[0].amount).toBe(84.20);
  });

  it('creates a plaid item with access token', async () => {
    await db.write(async () => {
      await db.get<PlaidItem>('plaid_items').create(item => {
        item.itemId = 'item_abc';
        item.accessToken = 'access-sandbox-xxx';
        item.institutionId = 'ins_109511';
        item.institutionName = 'Chase';
        item.cursor = '';
      });
    });

    const items = await db.get<PlaidItem>('plaid_items').query().fetch();
    expect(items[0].accessToken).toBe('access-sandbox-xxx');
  });

  it('creates an account', async () => {
    await db.write(async () => {
      await db.get<Account>('accounts').create(a => {
        a.plaidAccountId = 'acc_456';
        a.plaidItemId = 'item_abc';
        a.name = 'Checking';
        a.type = 'depository';
        a.subtype = 'checking';
        a.currentBalance = 5200.00;
        a.availableBalance = 5100.00;
        a.institutionName = 'Chase';
      });
    });

    const accounts = await db.get<Account>('accounts').query().fetch();
    expect(accounts[0].currentBalance).toBe(5200.00);
  });
});
