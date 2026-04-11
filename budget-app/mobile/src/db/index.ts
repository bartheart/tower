import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import { migrations } from './migrations';
import Transaction from './models/Transaction';
import Account from './models/Account';
import PlaidItem from './models/PlaidItem';

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  dbName: 'budget',
  jsi: true,
});

export const database = new Database({
  adapter,
  modelClasses: [Transaction, Account, PlaidItem],
});
