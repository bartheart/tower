import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'transactions',
      columns: [
        { name: 'plaid_transaction_id', type: 'string', isIndexed: true },
        { name: 'account_id', type: 'string', isIndexed: true },
        { name: 'amount', type: 'number' },
        { name: 'merchant_name', type: 'string' },
        { name: 'category_l1', type: 'string' },
        { name: 'category_l2', type: 'string' },
        { name: 'date', type: 'string', isIndexed: true },
        { name: 'pending', type: 'boolean' },
      ],
    }),
    tableSchema({
      name: 'accounts',
      columns: [
        { name: 'plaid_account_id', type: 'string', isIndexed: true },
        { name: 'plaid_item_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'subtype', type: 'string' },
        { name: 'current_balance', type: 'number' },
        { name: 'available_balance', type: 'number' },
        { name: 'institution_name', type: 'string' },
      ],
    }),
    tableSchema({
      name: 'plaid_items',
      columns: [
        { name: 'item_id', type: 'string', isIndexed: true },
        { name: 'access_token', type: 'string' },
        { name: 'institution_id', type: 'string' },
        { name: 'institution_name', type: 'string' },
        { name: 'cursor', type: 'string' },
        { name: 'last_synced_at', type: 'number', isOptional: true },
      ],
    }),
  ],
});
