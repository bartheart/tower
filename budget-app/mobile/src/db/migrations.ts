import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    {
      // v1 → v2: add user_id to all three Plaid tables so rows are scoped
      // per user and cross-user data leakage is impossible at the query level.
      // Existing rows get user_id = '' — they become invisible to all users
      // and will be replaced on the next sync with correctly-tagged rows.
      toVersion: 2,
      steps: [
        addColumns({
          table: 'transactions',
          columns: [{ name: 'user_id', type: 'string', isIndexed: true }],
        }),
        addColumns({
          table: 'accounts',
          columns: [{ name: 'user_id', type: 'string', isIndexed: true }],
        }),
        addColumns({
          table: 'plaid_items',
          columns: [{ name: 'user_id', type: 'string', isIndexed: true }],
        }),
      ],
    },
    {
      // v2 → v3: add has_error to plaid_items for local item error state.
      // Existing items default to false (no error).
      toVersion: 3,
      steps: [
        addColumns({
          table: 'plaid_items',
          columns: [{ name: 'has_error', type: 'boolean' }],
        }),
      ],
    },
  ],
});
