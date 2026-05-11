# Plaid Update Mode, Offboarding & OAuth Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three Plaid production-readiness features: (1) re-authentication flow for broken connections (Update Mode), (2) individual account unlinking (User Offboarding), (3) OAuth redirect relay for institutions like American Express that require HTTPS redirect URIs.

**Architecture:** The webhook edge function detects `ITEM_LOGIN_REQUIRED` / `ITEM_ERROR` / `CONSENT_EXPIRED` events, stores a `status` flag in `plaid_tokens`, and sends a push notification to the client. The client persists error state locally in WatermelonDB (`has_error` on `plaid_items`). The Settings screen reads local state and shows a red "Reconnect" button; tapping it launches Plaid Link in update mode via a modified `create-link-token` edge function. For offboarding, a long-press on an account triggers an action sheet that calls a new `remove-plaid-item` edge function and cleans up local WatermelonDB records. For OAuth institutions, a `plaid-oauth-redirect` edge function acts as an HTTPS relay — Plaid redirects to it, and it immediately 302s to the `tower://plaid-oauth` deep link so the native Linking listener can resume Link.

**Tech Stack:** Deno edge functions (Supabase), WatermelonDB v3 migration, React Native, Plaid Link SDK, expo-notifications, ActionSheetIOS

---

## Implementation Status

| Task | Status |
|------|--------|
| Task 1: DB migration (`plaid_tokens.status`) | ✅ Done |
| Task 2: WatermelonDB v3 (`has_error` on `plaid_items`) | ✅ Done |
| Task 3: `plaid-webhook` — item error handling | ✅ Done |
| Task 4: `create-link-token` — update mode + webhook URL | ✅ Done |
| Task 5: `remove-plaid-item` edge function | ✅ Done |
| Task 6: `fetchUpdateLinkToken` + `removePlaidItem` client helpers | ✅ Done |
| Task 7: `backgroundSync` — ITEM_ERROR notification handling | ✅ Done |
| Task 8: SettingsScreen — error state, reconnect, unlink | ✅ Done |
| Task 9: OAuth redirect relay (`plaid-oauth-redirect`) | ✅ Done |

---

## File Structure

**Create:**
- `supabase/migrations/20260421000000_plaid_tokens_status.sql` — add `status` column to `plaid_tokens`
- `supabase/functions/remove-plaid-item/index.ts` — call Plaid `/item/remove`, delete `plaid_tokens` row
- `mobile/src/plaid/removePlaidItem.ts` — client-side remove: call edge function + clean up WatermelonDB

**Modify:**
- `supabase/functions/plaid-webhook/index.ts` — handle `ITEM_LOGIN_REQUIRED`, `ITEM_ERROR`, `CONSENT_EXPIRED`
- `supabase/functions/create-link-token/index.ts` — accept optional `item_id` for update-mode link token
- `mobile/src/db/schema.ts` — add `has_error` boolean to `plaid_items`, bump version to 3
- `mobile/src/db/migrations.ts` — add v2→v3 migration step
- `mobile/src/db/models/PlaidItem.ts` — add `hasError` field decorator
- `mobile/src/plaid/linkToken.ts` — add `fetchUpdateLinkToken(itemId: string)`
- `mobile/src/plaid/backgroundSync.ts` — handle `ITEM_ERROR` notification type, show banner, set `has_error` locally
- `mobile/src/screens/SettingsScreen.tsx` — error indicator, Reconnect button, per-account rows, long-press unlink

---

### Task 1: DB migration — add `status` to `plaid_tokens`

**Files:**
- Create: `supabase/migrations/20260421000000_plaid_tokens_status.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260421000000_plaid_tokens_status.sql
alter table public.plaid_tokens
  add column if not exists status text not null default 'good';

-- allowed values: 'good' | 'error'
-- set by plaid-webhook edge function when ITEM_LOGIN_REQUIRED / ITEM_ERROR / CONSENT_EXPIRED fires
-- reset to 'good' by create-link-token when update mode link is issued
```

- [ ] **Step 2: Apply locally and verify**

```bash
cd budget-app
supabase db push --local 2>/dev/null || echo "Run: supabase migration up (local)"
```

Expected: migration runs without error. If running against a remote project: `supabase db push`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000000_plaid_tokens_status.sql
git commit -m "feat: add status column to plaid_tokens for item error tracking"
```

---

### Task 2: WatermelonDB v3 schema — add `has_error` to `plaid_items`

**Files:**
- Modify: `mobile/src/db/schema.ts`
- Modify: `mobile/src/db/migrations.ts`
- Modify: `mobile/src/db/models/PlaidItem.ts`
- Test: `mobile/src/db/__tests__/models.test.ts`

- [ ] **Step 1: Write the failing test**

Open `mobile/src/db/__tests__/models.test.ts`. Add this test at the end of the file (before the closing `}`):

```typescript
it('PlaidItem schema version is 3', () => {
  expect(schema.version).toBe(3);
});

it('plaid_items table has has_error column', () => {
  const plaidItemsTable = schema.tables.find(t => t.name === 'plaid_items');
  expect(plaidItemsTable).toBeDefined();
  const col = plaidItemsTable!.columns.find(c => c.name === 'has_error');
  expect(col).toBeDefined();
  expect(col!.type).toBe('boolean');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd budget-app/mobile
npx jest src/db/__tests__/models.test.ts --no-coverage
```

Expected: FAIL — `schema.version` is 2, `has_error` column not found.

- [ ] **Step 3: Update schema.ts**

In `mobile/src/db/schema.ts`, make these changes:

1. Bump `version: 2` → `version: 3`
2. Add `{ name: 'has_error', type: 'boolean' }` to `plaid_items` columns:

```typescript
import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 3,
  tables: [
    tableSchema({
      name: 'transactions',
      columns: [
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'plaid_transaction_id', type: 'string', isIndexed: true },
        { name: 'account_id', type: 'string', isIndexed: true },
        { name: 'amount', type: 'number' },
        { name: 'merchant_name', type: 'string', isOptional: true },
        { name: 'category_l1', type: 'string' },
        { name: 'category_l2', type: 'string', isOptional: true },
        { name: 'date', type: 'string', isIndexed: true },
        { name: 'pending', type: 'boolean' },
      ],
    }),
    tableSchema({
      name: 'accounts',
      columns: [
        { name: 'user_id', type: 'string', isIndexed: true },
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
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'item_id', type: 'string', isIndexed: true },
        { name: 'access_token', type: 'string' },
        { name: 'institution_id', type: 'string' },
        { name: 'institution_name', type: 'string' },
        { name: 'cursor', type: 'string' },
        { name: 'last_synced_at', type: 'number', isOptional: true },
        { name: 'has_error', type: 'boolean' },
      ],
    }),
  ],
});
```

- [ ] **Step 4: Update migrations.ts**

Replace the contents of `mobile/src/db/migrations.ts` with:

```typescript
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
```

- [ ] **Step 5: Update PlaidItem model**

Replace `mobile/src/db/models/PlaidItem.ts` with:

```typescript
import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class PlaidItem extends Model {
  static table = 'plaid_items';

  @field('user_id') userId!: string;
  @field('item_id') itemId!: string;
  @field('access_token') accessToken!: string;
  @field('institution_id') institutionId!: string;
  @field('institution_name') institutionName!: string;
  @field('cursor') cursor!: string;
  @field('last_synced_at') lastSyncedAt!: number | undefined;
  @field('has_error') hasError!: boolean;
}
```

- [ ] **Step 6: Run tests**

```bash
cd budget-app/mobile
npx jest src/db/__tests__/models.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add mobile/src/db/schema.ts mobile/src/db/migrations.ts mobile/src/db/models/PlaidItem.ts mobile/src/db/__tests__/models.test.ts
git commit -m "feat: WatermelonDB v3 — add has_error to plaid_items"
```

---

### Task 3: Update `plaid-webhook` — handle item error events

**Files:**
- Modify: `supabase/functions/plaid-webhook/index.ts`

- [ ] **Step 1: Replace `plaid-webhook/index.ts`**

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ITEM_ERROR_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'ITEM_ERROR',
  'CONSENT_EXPIRED',
]);

serve(async (req) => {
  const body = await req.json();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const itemId: string = body.item_id;

  // Handle item error events — mark item as broken and push alert
  if (
    body.webhook_type === 'ITEM' &&
    ITEM_ERROR_CODES.has(body.webhook_code)
  ) {
    // Update status in plaid_tokens so server state reflects the error
    await supabase
      .from('plaid_tokens')
      .update({ status: 'error' })
      .eq('item_id', itemId);

    // Notify all registered devices; each device checks locally if it owns item_id
    const { data: prefs } = await supabase
      .from('app_preferences')
      .select('expo_push_token')
      .not('expo_push_token', 'is', null);

    if (prefs && prefs.length > 0) {
      await Promise.all(
        prefs.map((pref: { expo_push_token: string }) =>
          fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: pref.expo_push_token,
              title: 'Action required',
              body: 'One of your bank connections needs to be refreshed.',
              data: { type: 'ITEM_ERROR', itemId },
              priority: 'high',
            }),
          })
        )
      );
    }

    return new Response('ok', { status: 200 });
  }

  // Handle transaction sync webhooks
  if (body.webhook_type !== 'TRANSACTIONS' || body.webhook_code !== 'SYNC_UPDATES_AVAILABLE') {
    return new Response('ok', { status: 200 });
  }

  // Find the user whose device has this item_id registered.
  // NOTE: item_id is not stored in a client-readable table — we broadcast to all
  // registered devices and each device ignores the notification if it doesn't own
  // that item_id.
  const { data: prefs } = await supabase
    .from('app_preferences')
    .select('expo_push_token')
    .not('expo_push_token', 'is', null);

  if (!prefs || prefs.length === 0) return new Response('ok', { status: 200 });

  await Promise.all(
    prefs.map((pref: { expo_push_token: string }) =>
      fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: pref.expo_push_token,
          title: 'New transactions',
          body: 'Your accounts have been updated.',
          data: { itemId },
          priority: 'normal',
        }),
      })
    )
  );

  return new Response('ok', { status: 200 });
});
```

- [ ] **Step 2: Deploy and smoke-test**

```bash
cd budget-app
supabase functions deploy plaid-webhook
```

To smoke-test, send a test webhook payload via the Supabase dashboard or `curl`:

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/plaid-webhook \
  -H "Content-Type: application/json" \
  -d '{"webhook_type":"ITEM","webhook_code":"ITEM_LOGIN_REQUIRED","item_id":"item_test_123"}'
```

Expected: 200 ok, `plaid_tokens` row for `item_test_123` updated to `status = 'error'` (if it exists), push sent to all registered devices.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/plaid-webhook/index.ts
git commit -m "feat: plaid-webhook handles ITEM_LOGIN_REQUIRED and item error events"
```

---

### Task 4: Update `create-link-token` — support update mode

**Files:**
- Modify: `supabase/functions/create-link-token/index.ts`

- [ ] **Step 1: Replace `create-link-token/index.ts`**

When `item_id` is provided in the request body, the function fetches the stored access token and includes it in the Plaid request. This activates Plaid Link's update mode, which re-authenticates the existing item rather than creating a new one.

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { plaidBaseUrl, plaidHeaders } from '../_shared/plaid.ts';

serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  // Optional item_id signals update mode (re-auth an existing Item)
  const body = req.headers.get('content-type')?.includes('application/json')
    ? await req.json().catch(() => ({}))
    : {};
  const itemId: string | undefined = body?.item_id;

  const plaidBody: Record<string, unknown> = {
    user: { client_user_id: user.id },
    client_name: 'Tower',
    country_codes: ['US'],
    language: 'en',
  };

  if (itemId) {
    // Update mode: fetch access token from vault, pass to Plaid
    const { data: tokenRow } = await supabase
      .from('plaid_tokens')
      .select('access_token')
      .eq('item_id', itemId)
      .eq('user_id', user.id)
      .single();

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: 'Item not found' }), { status: 404 });
    }

    plaidBody.access_token = tokenRow.access_token;

    // Reset error status now that user is re-authenticating
    await supabase
      .from('plaid_tokens')
      .update({ status: 'good' })
      .eq('item_id', itemId);
  } else {
    // Normal mode: link a new item
    plaidBody.products = ['transactions'];
  }

  const response = await fetch(`${plaidBaseUrl()}/link/token/create`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify(plaidBody),
  });

  const data = await response.json();
  if (!response.ok) return new Response(JSON.stringify(data), { status: 502 });

  return new Response(JSON.stringify({ link_token: data.link_token }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Deploy**

```bash
cd budget-app
supabase functions deploy create-link-token
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/create-link-token/index.ts
git commit -m "feat: create-link-token supports update mode via optional item_id"
```

---

### Task 5: New `remove-plaid-item` edge function

**Files:**
- Create: `supabase/functions/remove-plaid-item/index.ts`

- [ ] **Step 1: Create the edge function**

```typescript
// supabase/functions/remove-plaid-item/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { plaidBaseUrl, plaidHeaders } from '../_shared/plaid.ts';

serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  const { item_id: itemId } = await req.json();
  if (!itemId) return new Response(JSON.stringify({ error: 'item_id required' }), { status: 400 });

  // Fetch access token from vault — verifying this item belongs to this user
  const { data: tokenRow } = await supabase
    .from('plaid_tokens')
    .select('access_token')
    .eq('item_id', itemId)
    .eq('user_id', user.id)
    .single();

  if (!tokenRow) {
    return new Response(JSON.stringify({ error: 'Item not found' }), { status: 404 });
  }

  // Call Plaid /item/remove — best-effort; we clean up locally even if this fails
  await fetch(`${plaidBaseUrl()}/item/remove`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify({ access_token: tokenRow.access_token }),
  }).catch(() => {
    // Plaid errors here are non-fatal — we still delete our local record
  });

  // Delete the token row — cascades nothing (transactions kept per design)
  const { error: deleteError } = await supabase
    .from('plaid_tokens')
    .delete()
    .eq('item_id', itemId)
    .eq('user_id', user.id);

  if (deleteError) {
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Deploy**

```bash
cd budget-app
supabase functions deploy remove-plaid-item
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/remove-plaid-item/index.ts
git commit -m "feat: remove-plaid-item edge function — revokes Plaid access and deletes token"
```

---

### Task 6: Client helpers — `fetchUpdateLinkToken` and `removePlaidItem`

**Files:**
- Modify: `mobile/src/plaid/linkToken.ts`
- Create: `mobile/src/plaid/removePlaidItem.ts`
- Test: `mobile/src/plaid/__tests__/linkFlow.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `mobile/src/plaid/__tests__/linkFlow.test.ts` (after the existing `describe` block):

```typescript
import { fetchUpdateLinkToken } from '../linkToken';

describe('fetchUpdateLinkToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue({ data: MOCK_SESSION, error: null });
  });

  it('calls create-link-token with item_id body', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { link_token: 'link-sandbox-update' }, error: null });

    const token = await fetchUpdateLinkToken('item_abc123');
    expect(token).toBe('link-sandbox-update');
    expect(mockInvoke).toHaveBeenCalledWith(
      'create-link-token',
      expect.objectContaining({ body: { item_id: 'item_abc123' } }),
    );
  });

  it('throws if no link_token returned', async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    await expect(fetchUpdateLinkToken('item_abc123')).rejects.toThrow('No link_token');
  });
});
```

Also add a test for `removePlaidItem`. First add the mock import at the top alongside the existing mock — update the jest.mock to also add the `removePlaidItem` module (it uses supabase, which is already mocked).

Create a new describe block in the same test file:

```typescript
import { removePlaidItem } from '../removePlaidItem';

describe('removePlaidItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue({ data: MOCK_SESSION, error: null });
  });

  it('calls remove-plaid-item edge function with item_id', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { success: true }, error: null });

    await removePlaidItem('item_abc123');
    expect(mockInvoke).toHaveBeenCalledWith(
      'remove-plaid-item',
      expect.objectContaining({ body: { item_id: 'item_abc123' } }),
    );
  });

  it('throws on edge function error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('Not found') });
    await expect(removePlaidItem('item_abc123')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd budget-app/mobile
npx jest src/plaid/__tests__/linkFlow.test.ts --no-coverage
```

Expected: FAIL — `fetchUpdateLinkToken` and `removePlaidItem` not exported.

- [ ] **Step 3: Add `fetchUpdateLinkToken` to `linkToken.ts`**

Append to `mobile/src/plaid/linkToken.ts`:

```typescript
export async function fetchUpdateLinkToken(itemId: string): Promise<string> {
  const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr || !refreshed.session) {
    throw new Error('Session expired — please sign out and sign in again');
  }

  const { data, error } = await supabase.functions.invoke('create-link-token', {
    body: { item_id: itemId },
  });
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
```

- [ ] **Step 4: Create `removePlaidItem.ts`**

```typescript
// mobile/src/plaid/removePlaidItem.ts
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
  // Refresh session before calling edge function
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
```

- [ ] **Step 5: Run tests**

```bash
cd budget-app/mobile
npx jest src/plaid/__tests__/linkFlow.test.ts --no-coverage
```

Expected: PASS (all tests including new ones)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/plaid/linkToken.ts mobile/src/plaid/removePlaidItem.ts mobile/src/plaid/__tests__/linkFlow.test.ts
git commit -m "feat: fetchUpdateLinkToken and removePlaidItem client helpers"
```

---

### Task 7: Handle `ITEM_ERROR` notifications in `backgroundSync`

**Files:**
- Modify: `mobile/src/plaid/backgroundSync.ts`

The notification handler currently syncs transactions when any `itemId` notification arrives. We need to branch on `type`:
- `ITEM_ERROR` → mark `has_error = true` on the matching `plaid_items` record, show banner
- anything else (or no type) → existing sync behavior

- [ ] **Step 1: Write failing test**

Create `mobile/src/plaid/__tests__/backgroundSync.test.ts`:

```typescript
import * as Notifications from 'expo-notifications';
import { database } from '../../db';
import { supabase } from '../../supabase/client';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(() => ({
      upsert: jest.fn().mockResolvedValue({}),
    })),
  },
}));

jest.mock('../../db', () => ({
  database: {
    get: jest.fn(),
    write: jest.fn(async (fn: () => Promise<void>) => fn()),
  },
}));

const mockGetUser = supabase.auth.getUser as jest.Mock;
const mockDbGet = database.get as jest.Mock;
const mockAddListener = Notifications.addNotificationReceivedListener as jest.Mock;

describe('setupNotificationHandler — ITEM_ERROR type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('sets has_error=true on matching PlaidItem for ITEM_ERROR notification', async () => {
    const mockItem = {
      itemId: 'item_abc',
      update: jest.fn(async (fn: (item: any) => void) => fn(mockItem)),
      hasError: false,
    };

    mockDbGet.mockReturnValue({
      query: jest.fn().mockReturnValue({
        fetch: jest.fn().mockResolvedValue([mockItem]),
      }),
    });

    // Capture the listener callback registered by setupNotificationHandler
    let capturedListener: ((n: any) => Promise<void>) | undefined;
    mockAddListener.mockImplementation((cb: (n: any) => Promise<void>) => {
      capturedListener = cb;
      return { remove: jest.fn() };
    });

    const { setupNotificationHandler } = require('../backgroundSync');
    setupNotificationHandler();

    expect(capturedListener).toBeDefined();

    await capturedListener!({
      request: {
        content: {
          data: { type: 'ITEM_ERROR', itemId: 'item_abc' },
        },
      },
    });

    expect(mockItem.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd budget-app/mobile
npx jest src/plaid/__tests__/backgroundSync.test.ts --no-coverage
```

Expected: FAIL — `has_error` update logic not implemented.

- [ ] **Step 3: Update `backgroundSync.ts`**

Replace the `setupNotificationHandler` function with:

```typescript
export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const type = notification.request.content.data?.type;
      const show = type === 'budget_alert' || type === 'goal_at_risk' || type === 'ITEM_ERROR';
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });

  return Notifications.addNotificationReceivedListener(async notification => {
    const { type, itemId } = notification.request.content.data ?? {};

    if (!itemId) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (type === 'ITEM_ERROR') {
      // Mark the broken item locally so SettingsScreen can show the Reconnect UI
      const items = await database.get<PlaidItem>('plaid_items')
        .query(Q.where('user_id', user.id))
        .fetch();
      const item = items.find(i => i.itemId === itemId);
      if (item) {
        await database.write(async () => {
          await item.update(i => { (i as PlaidItem).hasError = true; });
        });
      }
      return;
    }

    // Default: sync transactions
    const items = await database.get<PlaidItem>('plaid_items')
      .query(Q.where('user_id', user.id))
      .fetch();
    const item = items.find(i => i.itemId === itemId);
    if (item) await syncTransactions(item, user.id);
  });
}
```

- [ ] **Step 4: Run tests**

```bash
cd budget-app/mobile
npx jest src/plaid/__tests__/backgroundSync.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
cd budget-app/mobile
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/plaid/backgroundSync.ts mobile/src/plaid/__tests__/backgroundSync.test.ts
git commit -m "feat: backgroundSync handles ITEM_ERROR notifications — sets has_error on PlaidItem"
```

---

### Task 8: SettingsScreen — error state, reconnect flow, per-account rows, long-press unlink

**Files:**
- Modify: `mobile/src/screens/SettingsScreen.tsx`

This task has no unit test (the screen depends on Plaid SDK which requires native modules, and the existing codebase has no SettingsScreen test). Verify visually on device/simulator.

The full rewrite of `SettingsScreen.tsx`:

- Institution cards expand to show per-account rows beneath them
- If any `plaid_items` record for that institution has `has_error = true`, show a red dot and "Reconnect" button
- Tapping "Reconnect" fetches an update-mode link token and opens Plaid Link
- After successful reconnect, set `has_error = false` on the item
- Long-pressing an account row shows an iOS action sheet with "Unlink [account name]" and "Cancel"
- Confirming unlink calls `removePlaidItem`, which cleans up WatermelonDB records

- [ ] **Step 1: Write the updated SettingsScreen**

Replace the full contents of `mobile/src/screens/SettingsScreen.tsx`:

```typescript
import React, { useState, useCallback, useEffect } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Alert, Linking, ActivityIndicator, ActionSheetIOS,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create, open, LinkSuccess, LinkExit } from 'react-native-plaid-link-sdk';
import { Q } from '@nozbe/watermelondb';
import { useAuth } from '../auth/AuthContext';
import { useAccounts } from '../hooks/useTransactions';
import { fetchLinkToken, fetchUpdateLinkToken } from '../plaid/linkToken';
import { exchangePublicToken } from '../plaid/exchangeToken';
import { removePlaidItem } from '../plaid/removePlaidItem';
import { syncTransactions } from '../plaid/syncTransactions';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import { supabase } from '../supabase/client';

// A lightweight hook that returns all PlaidItem records for the current user.
function usePlaidItems(): PlaidItem[] {
  const [items, setItems] = useState<PlaidItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const result = await database.get<PlaidItem>('plaid_items')
        .query(Q.where('user_id', user.id))
        .fetch();
      if (!cancelled) setItems(result);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return items;
}

export default function SettingsScreen() {
  const { top } = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [linking, setLinking] = useState(false);
  const [reconnectingItemId, setReconnectingItemId] = useState<string | null>(null);
  const [unlinkingAccountId, setUnlinkingAccountId] = useState<string | null>(null);
  const { accounts, loading: accountsLoading } = useAccounts();
  const plaidItems = usePlaidItems();

  // Group accounts by institution
  const institutions = [...new Set(accounts.map(a => a.institutionName))];

  // Check if any plaid_items for a given institution have has_error set
  function institutionHasError(institutionName: string): { hasError: boolean; itemId: string | null } {
    const instAccounts = accounts.filter(a => a.institutionName === institutionName);
    for (const acc of instAccounts) {
      const item = plaidItems.find(i => i.itemId === acc.plaidItemId);
      if (item?.hasError) return { hasError: true, itemId: item.itemId };
    }
    return { hasError: false, itemId: null };
  }

  const handlePlaidSuccess = useCallback(async (success: LinkSuccess) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { itemId } = await exchangePublicToken(success.publicToken);
      await database.write(async () => {
        await database.get<PlaidItem>('plaid_items').create(item => {
          item.userId = user.id;
          item.itemId = itemId;
          item.accessToken = '';
          item.institutionId = success.metadata.institution?.id ?? '';
          item.institutionName = success.metadata.institution?.name ?? 'Bank';
          item.cursor = '';
          item.hasError = false;
        });
      });
      const item = (await database.get<PlaidItem>('plaid_items')
        .query(Q.where('user_id', user.id)).fetch()).find(i => i.itemId === itemId)!;
      await syncTransactions(item, user.id);
      Alert.alert('Connected!', `${success.metadata.institution?.name} linked successfully.`);
    } catch (err) {
      Alert.alert('Error', `Failed to connect account: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLinking(false);
    }
  }, []);

  const handleReconnectSuccess = useCallback(async (success: LinkSuccess, itemId: string) => {
    // After successful update-mode link, clear the error flag locally
    try {
      await database.write(async () => {
        const items = await database.get<PlaidItem>('plaid_items')
          .query(Q.where('item_id', itemId))
          .fetch();
        for (const item of items) {
          await item.update(i => { (i as PlaidItem).hasError = false; });
        }
      });
      Alert.alert('Reconnected!', `${success.metadata.institution?.name ?? 'Account'} has been refreshed.`);
    } catch (err) {
      Alert.alert('Error', `Could not clear error state: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReconnectingItemId(null);
    }
  }, []);

  const handlePlaidExit = useCallback((exit: LinkExit) => {
    setLinking(false);
    setReconnectingItemId(null);
  }, []);

  // Handle OAuth redirect
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('tower://plaid-oauth')) {
        open({
          receivedRedirectUri: url,
          onSuccess: handlePlaidSuccess,
          onExit: handlePlaidExit,
        });
      }
    });
    return () => sub.remove();
  }, [handlePlaidSuccess, handlePlaidExit]);

  const handleAddAccount = useCallback(async () => {
    setLinking(true);
    try {
      const token = await fetchLinkToken();
      create({ token });
      open({ onSuccess: handlePlaidSuccess, onExit: handlePlaidExit });
    } catch (err) {
      Alert.alert('Error', `Bank linking failed: ${err instanceof Error ? err.message : String(err)}`);
      setLinking(false);
    }
  }, [handlePlaidSuccess, handlePlaidExit]);

  const handleReconnect = useCallback(async (itemId: string) => {
    setReconnectingItemId(itemId);
    try {
      const token = await fetchUpdateLinkToken(itemId);
      create({ token });
      open({
        onSuccess: (success) => handleReconnectSuccess(success, itemId),
        onExit: handlePlaidExit,
      });
    } catch (err) {
      Alert.alert('Error', `Reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
      setReconnectingItemId(null);
    }
  }, [handleReconnectSuccess, handlePlaidExit]);

  const handleLongPressAccount = useCallback((accountName: string, plaidItemId: string) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [`Unlink ${accountName}`, 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      async (buttonIndex) => {
        if (buttonIndex !== 0) return;

        Alert.alert(
          'Unlink account?',
          `This will disconnect ${accountName}. Your transaction history will be preserved.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Unlink',
              style: 'destructive',
              onPress: async () => {
                setUnlinkingAccountId(plaidItemId);
                try {
                  await removePlaidItem(plaidItemId);
                } catch (err) {
                  Alert.alert('Error', `Could not unlink: ${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setUnlinkingAccountId(null);
                }
              },
            },
          ]
        );
      }
    );
  }, []);

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <Text style={s.sectionLabel}>LINKED ACCOUNTS</Text>

      {accountsLoading ? (
        <ActivityIndicator color="#475569" style={{ marginVertical: 20 }} />
      ) : institutions.length === 0 ? (
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>No accounts linked yet</Text>
          <Text style={s.emptyHint}>Tap Add Account to connect your bank</Text>
        </View>
      ) : (
        institutions.map(name => {
          const { hasError, itemId: errorItemId } = institutionHasError(name);
          const instAccounts = accounts.filter(a => a.institutionName === name);
          const isReconnecting = reconnectingItemId === errorItemId;

          return (
            <View key={name} style={s.institutionCard}>
              {/* Institution header row */}
              <View style={s.institutionHeader}>
                <View style={s.institutionInfo}>
                  <View style={s.nameRow}>
                    {hasError && <View style={s.errorDot} />}
                    <Text style={s.institutionName}>{name}</Text>
                  </View>
                  <Text style={s.accountCount}>
                    {instAccounts.length} account{instAccounts.length !== 1 ? 's' : ''}
                  </Text>
                </View>

                {hasError && errorItemId ? (
                  <TouchableOpacity
                    style={[s.reconnectButton, isReconnecting && s.reconnectButtonDisabled]}
                    onPress={() => handleReconnect(errorItemId)}
                    disabled={isReconnecting}
                  >
                    <Text style={s.reconnectText}>
                      {isReconnecting ? 'Reconnecting…' : 'Reconnect'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={s.syncStatus}>
                    <Text style={s.syncDot}>●</Text>
                    <Text style={s.syncLabel}>linked</Text>
                  </View>
                )}
              </View>

              {/* Per-account rows */}
              {instAccounts.map(account => {
                const isUnlinking = unlinkingAccountId === account.plaidItemId;
                return (
                  <TouchableOpacity
                    key={account.plaidAccountId}
                    style={s.accountRow}
                    onLongPress={() => handleLongPressAccount(account.name, account.plaidItemId)}
                    disabled={isUnlinking}
                  >
                    <View>
                      <Text style={s.accountName}>{account.name}</Text>
                      <Text style={s.accountSubtype}>{account.subtype}</Text>
                    </View>
                    {isUnlinking ? (
                      <ActivityIndicator size="small" color="#475569" />
                    ) : (
                      <Text style={s.accountBalance}>
                        ${account.currentBalance.toFixed(2)}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })
      )}

      <TouchableOpacity style={s.addButton} onPress={handleAddAccount} disabled={linking}>
        <Text style={s.addButtonText}>{linking ? 'Linking...' : '+ Add Account'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.signOutButton}
        onPress={() => signOut().catch(() => Alert.alert('Error', 'Could not sign out. Try again.'))}
      >
        <Text style={s.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16 },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 10 },
  institutionCard: {
    backgroundColor: '#1e293b', borderRadius: 8, marginBottom: 8, overflow: 'hidden',
  },
  institutionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14,
  },
  institutionInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorDot: {
    width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#ef4444',
  },
  institutionName: { fontSize: 14, color: '#f1f5f9' },
  accountCount: { fontSize: 11, color: '#64748b', marginTop: 2 },
  reconnectButton: {
    backgroundColor: '#ef4444', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6,
  },
  reconnectButtonDisabled: { backgroundColor: '#7f1d1d' },
  reconnectText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  syncStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncDot: { fontSize: 8, color: '#22c55e' },
  syncLabel: { fontSize: 11, color: '#475569' },
  accountRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#0f172a',
  },
  accountName: { fontSize: 13, color: '#94a3b8' },
  accountSubtype: { fontSize: 10, color: '#475569', marginTop: 1, textTransform: 'capitalize' },
  accountBalance: { fontSize: 13, color: '#64748b' },
  addButton: {
    backgroundColor: '#6366f1', borderRadius: 8, padding: 14,
    alignItems: 'center', marginTop: 8,
  },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  emptyCard: { padding: 20, alignItems: 'center', marginBottom: 8 },
  emptyText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  emptyHint: { fontSize: 11, color: '#334155', marginTop: 4 },
  signOutButton: { marginTop: 32, padding: 14, alignItems: 'center' },
  signOutText: { color: '#475569', fontSize: 14 },
});
```

- [ ] **Step 2: Check the `useAccounts` hook for `plaidItemId` and `plaidAccountId` field names**

Open `mobile/src/hooks/useTransactions.ts` and verify the `Account` model has `plaidItemId` and `plaidAccountId` fields. If the field names differ, update the references in `SettingsScreen.tsx` accordingly.

- [ ] **Step 3: TypeScript check**

```bash
cd budget-app/mobile
npx tsc --noEmit 2>&1 | grep -v node_modules | head -30
```

Expected: No errors in `SettingsScreen.tsx`, `linkToken.ts`, or `removePlaidItem.ts`.

- [ ] **Step 4: Run full test suite**

```bash
cd budget-app/mobile
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Test on device/simulator**

Build and run on iOS simulator:
```bash
cd budget-app/mobile
npx expo run:ios
```

Verify the golden path:
1. Settings screen shows institution cards with per-account rows and balances
2. Long-pressing an account shows the action sheet with "Unlink [name]" and Cancel
3. Tapping Cancel dismisses the sheet
4. To test error state: manually update a `plaid_items` record in WatermelonDB via a test helper, or trigger a webhook from Supabase dashboard — verify red dot and Reconnect button appear
5. Tapping Reconnect opens Plaid Link (update mode)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/SettingsScreen.tsx
git commit -m "feat: SettingsScreen — error indicator, Reconnect flow, per-account rows, long-press unlink"
```

---

### Task 9: OAuth redirect relay — `plaid-oauth-redirect` edge function

**Context:** Plaid's production dashboard only accepts `https://` redirect URIs. Native apps using custom URL schemes (`tower://`) need an HTTPS relay. This edge function acts as that relay — Plaid redirects to it after the user authenticates with an OAuth institution (e.g. American Express), and it immediately 302s to `tower://plaid-oauth` so the app's existing `Linking` listener can resume Link.

**Files:**
- Create: `supabase/functions/plaid-oauth-redirect/index.ts`
- Modify: `mobile/src/screens/SettingsScreen.tsx` — pass `redirectUri` to both `create()` calls

**Plaid dashboard:** Register `https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect` as an allowed redirect URI under OAuth Institutions settings.

- [x] **Step 1: Create the edge function**

```typescript
// supabase/functions/plaid-oauth-redirect/index.ts
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

serve((req) => {
  const url = new URL(req.url);
  const target = `tower://plaid-oauth${url.search}`;
  return Response.redirect(target, 302);
});
```

- [x] **Step 2: Deploy (no JWT verification — Plaid hits this without auth headers)**

```bash
supabase functions deploy plaid-oauth-redirect --no-verify-jwt
```

- [x] **Step 3: Pass `redirectUri` in `create()` calls in `SettingsScreen.tsx`**

Both `handleAddAccount` and `handleReconnect` now call:
```typescript
create({ token, redirectUri: 'https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect' });
```

The existing `Linking` listener at `tower://plaid-oauth` (already in the screen) handles the return:
```typescript
useEffect(() => {
  const sub = Linking.addEventListener('url', ({ url }) => {
    if (url.startsWith('tower://plaid-oauth')) {
      open({ receivedRedirectUri: url, onSuccess: handlePlaidSuccess, onExit: handlePlaidExit });
    }
  });
  return () => sub.remove();
}, [handlePlaidSuccess, handlePlaidExit]);
```

The `tower://` scheme is registered in `app.json` (`scheme: "tower"` + `CFBundleURLSchemes`) — no additional iOS/Android config needed for Expo managed workflow.

---

## Deployment Checklist

After all tasks are complete:

- [ ] Push all edge function changes: `supabase functions deploy plaid-webhook create-link-token remove-plaid-item`
- [ ] Apply DB migration to production: `supabase db push`
- [ ] Verify Plaid webhook URL is configured in Plaid Dashboard to point to the production edge function URL
- [ ] Build a new `preview` or `production` build: `eas build --profile preview --platform ios`
