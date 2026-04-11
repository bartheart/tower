# Personal Budgeting Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first personal finance app with real US bank account linking via Plaid, a dynamic multi-level Sankey spending diagram, budget envelopes, and savings goals — all sensitive data stored on-device only.

**Architecture:** Expo (React Native + TypeScript) is the primary surface. WatermelonDB (SQLite) stores all Plaid data on-device. Supabase holds only non-sensitive metadata (categories, goals, preferences) and runs three Edge Functions that act as server-side proxies for Plaid's API without persisting any financial data. The Sankey chart is computed on-device from local transaction data and rendered via react-native-svg — no WebView.

**Tech Stack:** Expo SDK 52, React Native, TypeScript, WatermelonDB (`@nozbe/watermelondb`), Supabase JS v2, Plaid (`react-native-plaid-link-sdk`), `react-native-svg`, `d3-sankey`, Next.js 15 (web dashboard), Render (web hosting), Expo EAS Build (dev builds required — no Expo Go)

---

## File Structure

```
budget-app/
├── mobile/                          # Expo app
│   ├── app.json
│   ├── package.json
│   ├── babel.config.js
│   ├── jest.config.js
│   └── src/
│       ├── db/
│       │   ├── index.ts             # WatermelonDB instance
│       │   ├── schema.ts            # Full DB schema
│       │   ├── migrations.ts        # Schema migrations
│       │   └── models/
│       │       ├── Transaction.ts
│       │       ├── Account.ts
│       │       └── PlaidItem.ts
│       ├── plaid/
│       │   ├── linkToken.ts         # POST /create-link-token edge fn
│       │   ├── exchangeToken.ts     # POST /exchange-public-token edge fn
│       │   └── syncTransactions.ts  # /transactions/sync + cursor logic
│       ├── supabase/
│       │   └── client.ts            # Supabase JS client + auth helpers
│       ├── sankey/
│       │   ├── buildGraph.ts        # Aggregate txns → Sankey node/link data
│       │   └── SankeyChart.tsx      # react-native-svg Sankey renderer
│       ├── hooks/
│       │   ├── useTransactions.ts   # WatermelonDB query hook
│       │   ├── useBudgets.ts        # Supabase budgets + local spending
│       │   └── useGoals.ts          # Supabase goals hook
│       └── screens/
│           ├── HomeScreen.tsx
│           ├── PlanScreen.tsx
│           └── SettingsScreen.tsx
├── web/                             # Next.js dashboard
│   ├── package.json
│   └── src/
│       ├── app/
│       │   ├── layout.tsx
│       │   └── page.tsx             # Overview: categories + goals only
│       └── lib/
│           └── supabase.ts
└── supabase/
    ├── functions/
    │   ├── create-link-token/
    │   │   └── index.ts
    │   ├── exchange-public-token/
    │   │   └── index.ts
    │   └── plaid-webhook/
    │       └── index.ts
    └── migrations/
        └── 20260411000000_init.sql
```

---

## Task 1: Repo + Expo Project Bootstrap

**Files:**
- Create: `mobile/` (Expo project)
- Create: `mobile/src/db/schema.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create the monorepo root and Expo app**

```bash
mkdir budget-app && cd budget-app
npx create-expo-app mobile --template blank-typescript
cd mobile
```

- [ ] **Step 2: Install all mobile dependencies at once**

```bash
npx expo install expo-dev-client expo-notifications expo-secure-store
npx expo install react-native-svg
npm install @nozbe/watermelondb
npx expo install @nozbe/watermelondb/native
npm install react-native-plaid-link-sdk
npm install d3-sankey
npm install --save-dev @types/d3-sankey @testing-library/react-native @testing-library/jest-native jest-expo
npm install @supabase/supabase-js
```

- [ ] **Step 3: Configure babel for WatermelonDB decorators**

Replace `mobile/babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['@babel/plugin-proposal-decorators', { legacy: true }],
    ],
  };
};
```

- [ ] **Step 4: Configure Jest**

Create `mobile/jest.config.js`:

```js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterFramework: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

- [ ] **Step 5: Set up EAS Build (required for native modules)**

```bash
npm install -g eas-cli
eas login
eas build:configure
```

In `mobile/app.json`, ensure `expo.ios.bundleIdentifier` and `expo.android.package` are set:

```json
{
  "expo": {
    "name": "Budget",
    "slug": "budget-app",
    "ios": { "bundleIdentifier": "com.yourname.budget" },
    "android": { "package": "com.yourname.budget" },
    "plugins": ["expo-notifications"]
  }
}
```

- [ ] **Step 6: Create root .gitignore**

```
node_modules/
.expo/
dist/
*.env
*.env.local
supabase/.env
mobile/.env
web/.env.local
```

- [ ] **Step 7: Initial commit**

```bash
cd ..
git add .
git commit -m "feat: bootstrap Expo project with all dependencies"
```

---

## Task 2: WatermelonDB Schema + Models

**Files:**
- Create: `mobile/src/db/schema.ts`
- Create: `mobile/src/db/migrations.ts`
- Create: `mobile/src/db/models/Transaction.ts`
- Create: `mobile/src/db/models/Account.ts`
- Create: `mobile/src/db/models/PlaidItem.ts`
- Create: `mobile/src/db/__tests__/models.test.ts`
- Create: `mobile/src/db/index.ts`

- [ ] **Step 1: Write the failing model test**

Create `mobile/src/db/__tests__/models.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test — expect FAIL (schema not defined)**

```bash
cd mobile && npx jest src/db/__tests__/models.test.ts --no-coverage
```

Expected: `Cannot find module '../schema'`

- [ ] **Step 3: Write the schema**

Create `mobile/src/db/schema.ts`:

```typescript
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
```

- [ ] **Step 4: Write migrations**

Create `mobile/src/db/migrations.ts`:

```typescript
import { createMigration } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = createMigration({
  migrations: [],
});
```

- [ ] **Step 5: Write the Transaction model**

Create `mobile/src/db/models/Transaction.ts`:

```typescript
import { Model } from '@nozbe/watermelondb';
import { field, readonly, date } from '@nozbe/watermelondb/decorators';

export default class Transaction extends Model {
  static table = 'transactions';

  @field('plaid_transaction_id') plaidTransactionId!: string;
  @field('account_id') accountId!: string;
  @field('amount') amount!: number;
  @field('merchant_name') merchantName!: string;
  @field('category_l1') categoryL1!: string;
  @field('category_l2') categoryL2!: string;
  @field('date') date!: string;
  @field('pending') pending!: boolean;
}
```

- [ ] **Step 6: Write the Account model**

Create `mobile/src/db/models/Account.ts`:

```typescript
import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class Account extends Model {
  static table = 'accounts';

  @field('plaid_account_id') plaidAccountId!: string;
  @field('plaid_item_id') plaidItemId!: string;
  @field('name') name!: string;
  @field('type') type!: string;
  @field('subtype') subtype!: string;
  @field('current_balance') currentBalance!: number;
  @field('available_balance') availableBalance!: number;
  @field('institution_name') institutionName!: string;
}
```

- [ ] **Step 7: Write the PlaidItem model**

Create `mobile/src/db/models/PlaidItem.ts`:

```typescript
import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export default class PlaidItem extends Model {
  static table = 'plaid_items';

  @field('item_id') itemId!: string;
  @field('access_token') accessToken!: string;
  @field('institution_id') institutionId!: string;
  @field('institution_name') institutionName!: string;
  @field('cursor') cursor!: string;
  @field('last_synced_at') lastSyncedAt!: number | undefined;
}
```

- [ ] **Step 8: Write the DB singleton**

Create `mobile/src/db/index.ts`:

```typescript
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
  jsi: true, // faster on iOS
});

export const database = new Database({
  adapter,
  modelClasses: [Transaction, Account, PlaidItem],
});
```

- [ ] **Step 9: Run tests — expect PASS**

```bash
npx jest src/db/__tests__/models.test.ts --no-coverage
```

Expected: 3 passing

- [ ] **Step 10: Commit**

```bash
git add src/db/
git commit -m "feat: WatermelonDB schema, models, migrations"
```

---

## Task 3: Supabase Project + Migrations + Client

**Files:**
- Create: `supabase/migrations/20260411000000_init.sql`
- Create: `mobile/src/supabase/client.ts`
- Create: `mobile/.env`

- [ ] **Step 1: Create Supabase project**

Go to https://supabase.com/dashboard → New project. Name it `budget-app`. Note your project URL and anon key.

- [ ] **Step 2: Install Supabase CLI and initialize**

```bash
cd budget-app
npm install -g supabase
supabase init
supabase login
supabase link --project-ref <your-project-ref>
```

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260411000000_init.sql`:

```sql
-- Enable RLS on all tables
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz default now()
);

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  emoji text not null default '💰',
  monthly_limit numeric(10,2) not null default 0,
  color text not null default '#6366f1',
  created_at timestamptz default now()
);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  emoji text not null default '🎯',
  target_amount numeric(10,2) not null,
  current_amount numeric(10,2) not null default 0,
  target_date date,
  created_at timestamptz default now()
);

create table if not exists public.app_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  theme text not null default 'dark',
  expo_push_token text,
  updated_at timestamptz default now()
);

-- Row-level security: each user can only see their own rows
alter table public.users enable row level security;
alter table public.budget_categories enable row level security;
alter table public.savings_goals enable row level security;
alter table public.app_preferences enable row level security;

create policy "users: own row" on public.users for all using (auth.uid() = id);
create policy "categories: own rows" on public.budget_categories for all using (auth.uid() = user_id);
create policy "goals: own rows" on public.savings_goals for all using (auth.uid() = user_id);
create policy "prefs: own row" on public.app_preferences for all using (auth.uid() = user_id);

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  insert into public.app_preferences (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

- [ ] **Step 4: Run migration**

```bash
supabase db push
```

Expected: Migration applied successfully.

- [ ] **Step 5: Create environment file**

Create `mobile/.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 6: Write the Supabase client**

Create `mobile/src/supabase/client.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}
```

- [ ] **Step 7: Commit**

```bash
git add supabase/ src/supabase/ .env
git commit -m "feat: Supabase migrations, RLS policies, client"
```

---

## Task 4: Supabase Edge Functions (Plaid server-side proxies)

**Files:**
- Create: `supabase/functions/create-link-token/index.ts`
- Create: `supabase/functions/exchange-public-token/index.ts`
- Create: `supabase/functions/plaid-webhook/index.ts`
- Create: `supabase/functions/_shared/plaid.ts`

These three functions are the only server-side code. They proxy Plaid's API (which requires your secret key) without persisting any financial data.

- [ ] **Step 1: Set Supabase secrets**

```bash
supabase secrets set PLAID_CLIENT_ID=your_client_id
supabase secrets set PLAID_SECRET=your_sandbox_secret
supabase secrets set PLAID_ENV=sandbox
```

- [ ] **Step 2: Write shared Plaid client**

Create `supabase/functions/_shared/plaid.ts`:

```typescript
const PLAID_BASE_URLS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

export function plaidBaseUrl(): string {
  return PLAID_BASE_URLS[Deno.env.get('PLAID_ENV') ?? 'sandbox'];
}

export function plaidHeaders() {
  return {
    'Content-Type': 'application/json',
    'PLAID-CLIENT-ID': Deno.env.get('PLAID_CLIENT_ID')!,
    'PLAID-SECRET': Deno.env.get('PLAID_SECRET')!,
  };
}
```

- [ ] **Step 3: Write create-link-token function**

Create `supabase/functions/create-link-token/index.ts`:

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

  const response = await fetch(`${plaidBaseUrl()}/link/token/create`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify({
      user: { client_user_id: user.id },
      client_name: 'Budget App',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    }),
  });

  const data = await response.json();
  if (!response.ok) return new Response(JSON.stringify(data), { status: 502 });

  // Return only the link_token — nothing sensitive stored
  return new Response(JSON.stringify({ link_token: data.link_token }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 4: Write exchange-public-token function**

Create `supabase/functions/exchange-public-token/index.ts`:

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

  const { public_token } = await req.json();

  const response = await fetch(`${plaidBaseUrl()}/item/public_token/exchange`, {
    method: 'POST',
    headers: plaidHeaders(),
    body: JSON.stringify({ public_token }),
  });

  const data = await response.json();
  if (!response.ok) return new Response(JSON.stringify(data), { status: 502 });

  // Return access_token + item_id to device — NOT stored server-side
  return new Response(
    JSON.stringify({ access_token: data.access_token, item_id: data.item_id }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
```

- [ ] **Step 5: Write plaid-webhook function**

Create `supabase/functions/plaid-webhook/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const body = await req.json();

  // Only handle transaction sync webhooks
  if (body.webhook_type !== 'TRANSACTIONS' || body.webhook_code !== 'SYNC_UPDATES_AVAILABLE') {
    return new Response('ok', { status: 200 });
  }

  const itemId: string = body.item_id;

  // Find the user whose device has this item_id registered
  // We look up the push token from app_preferences via a custom join
  // NOTE: item_id is not stored in Supabase — we broadcast to all users
  // and the device ignores the notification if it doesn't own that item_id
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: prefs } = await supabase
    .from('app_preferences')
    .select('expo_push_token')
    .not('expo_push_token', 'is', null);

  if (!prefs || prefs.length === 0) return new Response('ok', { status: 200 });

  // Send push to all registered devices — each device checks locally if it owns item_id
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

- [ ] **Step 6: Deploy all three functions**

```bash
supabase functions deploy create-link-token --no-verify-jwt
supabase functions deploy exchange-public-token --no-verify-jwt
supabase functions deploy plaid-webhook --no-verify-jwt
```

Note the deployed URL for `plaid-webhook` — register it in your Plaid dashboard under Webhooks.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/
git commit -m "feat: Supabase edge functions for Plaid proxying and webhook"
```

---

## Task 5: Plaid Link SDK + Bank Linking Flow

**Files:**
- Create: `mobile/src/plaid/linkToken.ts`
- Create: `mobile/src/plaid/exchangeToken.ts`
- Create: `mobile/src/plaid/__tests__/linkFlow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mobile/src/plaid/__tests__/linkFlow.test.ts`:

```typescript
import { fetchLinkToken } from '../linkToken';
import { exchangePublicToken } from '../exchangeToken';

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-jwt' } },
      }),
    },
  },
}));

global.fetch = jest.fn();

describe('Plaid link flow', () => {
  it('fetchLinkToken calls edge function and returns link_token', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ link_token: 'link-sandbox-abc' }),
    });

    const token = await fetchLinkToken();
    expect(token).toBe('link-sandbox-abc');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('create-link-token'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('exchangePublicToken returns access_token and item_id', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-sandbox-xxx',
        item_id: 'item_abc123',
      }),
    });

    const result = await exchangePublicToken('public-sandbox-token');
    expect(result.accessToken).toBe('access-sandbox-xxx');
    expect(result.itemId).toBe('item_abc123');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/plaid/__tests__/linkFlow.test.ts --no-coverage
```

Expected: `Cannot find module '../linkToken'`

- [ ] **Step 3: Write linkToken.ts**

Create `mobile/src/plaid/linkToken.ts`:

```typescript
import { supabase } from '../supabase/client';

const EDGE_FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`;

export async function fetchLinkToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const response = await fetch(`${EDGE_FN_URL}/create-link-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!response.ok) throw new Error('Failed to create link token');
  const data = await response.json();
  return data.link_token;
}
```

- [ ] **Step 4: Write exchangeToken.ts**

Create `mobile/src/plaid/exchangeToken.ts`:

```typescript
import { supabase } from '../supabase/client';

const EDGE_FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1`;

export async function exchangePublicToken(
  publicToken: string
): Promise<{ accessToken: string; itemId: string }> {
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
  return { accessToken: data.access_token, itemId: data.item_id };
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
npx jest src/plaid/__tests__/linkFlow.test.ts --no-coverage
```

Expected: 2 passing

- [ ] **Step 6: Commit**

```bash
git add src/plaid/
git commit -m "feat: Plaid link token fetch and public token exchange"
```

---

## Task 6: Transaction Sync Engine

**Files:**
- Create: `mobile/src/plaid/syncTransactions.ts`
- Create: `mobile/src/plaid/__tests__/syncTransactions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mobile/src/plaid/__tests__/syncTransactions.test.ts`:

```typescript
import { syncTransactions } from '../syncTransactions';
import { database } from '../../db';
import PlaidItem from '../../db/models/PlaidItem';
import Transaction from '../../db/models/Transaction';
import Account from '../../db/models/Account';

// Mock the db with in-memory test instance
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

global.fetch = jest.fn();

const PLAID_SYNC_RESPONSE = {
  added: [
    {
      transaction_id: 'txn_1',
      account_id: 'acc_1',
      amount: 84.20,
      merchant_name: 'Whole Foods',
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' },
      date: '2026-04-10',
      pending: false,
    },
  ],
  modified: [],
  removed: [],
  next_cursor: 'cursor_v2',
  has_more: false,
};

describe('syncTransactions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches transactions from Plaid and writes to WatermelonDB', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => PLAID_SYNC_RESPONSE,
    });

    // Seed a PlaidItem
    await database.write(async () => {
      await database.get<PlaidItem>('plaid_items').create(item => {
        item.itemId = 'item_1';
        item.accessToken = 'access-sandbox-test';
        item.institutionId = 'ins_1';
        item.institutionName = 'Chase';
        item.cursor = '';
      });
    });

    const item = (await database.get<PlaidItem>('plaid_items').query().fetch())[0];
    await syncTransactions(item);

    const txns = await database.get<Transaction>('transactions').query().fetch();
    expect(txns).toHaveLength(1);
    expect(txns[0].merchantName).toBe('Whole Foods');
    expect(txns[0].categoryL1).toBe('Food and Drink');
    expect(txns[0].categoryL2).toBe('Groceries');

    // Cursor should be updated
    const updatedItem = (await database.get<PlaidItem>('plaid_items').query().fetch())[0];
    expect(updatedItem.cursor).toBe('cursor_v2');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/plaid/__tests__/syncTransactions.test.ts --no-coverage
```

Expected: `Cannot find module '../syncTransactions'`

- [ ] **Step 3: Write syncTransactions.ts**

Create `mobile/src/plaid/syncTransactions.ts`:

```typescript
import PlaidItem from '../db/models/PlaidItem';
import Transaction from '../db/models/Transaction';
import Account from '../db/models/Account';
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
```

Add missing import at top of `syncTransactions.ts`:

```typescript
import { Q } from '@nozbe/watermelondb';
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/plaid/__tests__/syncTransactions.test.ts --no-coverage
```

Expected: 1 passing

- [ ] **Step 5: Commit**

```bash
git add src/plaid/syncTransactions.ts
git commit -m "feat: transaction sync engine with cursor pagination"
```

---

## Task 7: Sankey Data Aggregation

**Files:**
- Create: `mobile/src/sankey/buildGraph.ts`
- Create: `mobile/src/sankey/__tests__/buildGraph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mobile/src/sankey/__tests__/buildGraph.test.ts`:

```typescript
import { buildSankeyData } from '../buildGraph';

const MOCK_TRANSACTIONS = [
  { merchantName: 'Whole Foods', categoryL1: 'Food and Drink', categoryL2: 'Groceries', amount: 120 },
  { merchantName: 'Trader Joes', categoryL1: 'Food and Drink', categoryL2: 'Groceries', amount: 80 },
  { merchantName: 'Chipotle', categoryL1: 'Food and Drink', categoryL2: 'Restaurants', amount: 45 },
  { merchantName: 'Shell', categoryL1: 'Transportation', categoryL2: 'Gas', amount: 60 },
  { merchantName: 'Direct Deposit', categoryL1: 'Income', categoryL2: 'Paycheck', amount: -5200 },
];

describe('buildSankeyData', () => {
  it('builds nodes and links from transaction list', () => {
    const { nodes, links } = buildSankeyData(MOCK_TRANSACTIONS as any, 5200);

    // Should have: Income, Food and Drink, Transportation, Groceries, Restaurants, Gas, Whole Foods, Trader Joes, Chipotle, Shell
    const nodeNames = nodes.map(n => n.name);
    expect(nodeNames).toContain('Income');
    expect(nodeNames).toContain('Food and Drink');
    expect(nodeNames).toContain('Groceries');
    expect(nodeNames).toContain('Whole Foods');
  });

  it('link values are correct aggregations', () => {
    const { links } = buildSankeyData(MOCK_TRANSACTIONS as any, 5200);

    const groceriesLink = links.find(l =>
      (l.source as any).name === 'Food and Drink' &&
      (l.target as any).name === 'Groceries'
    );
    expect(groceriesLink?.value).toBe(200); // 120 + 80
  });

  it('income node value equals provided income amount', () => {
    const { nodes } = buildSankeyData(MOCK_TRANSACTIONS as any, 5200);
    const incomeNode = nodes.find(n => n.name === 'Income');
    expect(incomeNode?.value).toBe(5200);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/sankey/__tests__/buildGraph.test.ts --no-coverage
```

Expected: `Cannot find module '../buildGraph'`

- [ ] **Step 3: Write buildGraph.ts**

Create `mobile/src/sankey/buildGraph.ts`:

```typescript
import Transaction from '../db/models/Transaction';

export interface SankeyNode {
  name: string;
  value?: number;
}

export interface SankeyLink {
  source: number | SankeyNode;
  target: number | SankeyNode;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export function buildSankeyData(
  transactions: Pick<Transaction, 'merchantName' | 'categoryL1' | 'categoryL2' | 'amount'>[],
  incomeAmount: number
): SankeyData {
  const nodeIndex = new Map<string, number>();
  const nodes: SankeyNode[] = [];
  const linkMap = new Map<string, number>(); // "source->target" => total amount

  function getOrAddNode(name: string): number {
    if (!nodeIndex.has(name)) {
      nodeIndex.set(name, nodes.length);
      nodes.push({ name });
    }
    return nodeIndex.get(name)!;
  }

  function addLink(source: string, target: string, amount: number) {
    const key = `${source}||${target}`;
    linkMap.set(key, (linkMap.get(key) ?? 0) + amount);
  }

  // Income node
  getOrAddNode('Income');
  nodes[0].value = incomeAmount;

  // Filter out income/transfer transactions (negative amounts = money in)
  const spending = transactions.filter(
    t => t.amount > 0 && t.categoryL1 !== 'Income' && !t.categoryL1.includes('Transfer')
  );

  for (const txn of spending) {
    const cat1 = txn.categoryL1 || 'Other';
    const cat2 = txn.categoryL2 || cat1;
    const merchant = txn.merchantName || 'Unknown';

    // Income → Category L1
    addLink('Income', cat1, txn.amount);
    // Category L1 → Category L2 (skip if same)
    if (cat2 !== cat1) addLink(cat1, cat2, txn.amount);
    // Category L2 → Merchant
    addLink(cat2 !== cat1 ? cat2 : cat1, merchant, txn.amount);

    getOrAddNode(cat1);
    if (cat2 !== cat1) getOrAddNode(cat2);
    getOrAddNode(merchant);
  }

  const links: SankeyLink[] = [];
  for (const [key, value] of linkMap.entries()) {
    const [sourceName, targetName] = key.split('||');
    links.push({
      source: nodeIndex.get(sourceName)!,
      target: nodeIndex.get(targetName)!,
      value,
    });
  }

  return { nodes, links };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/sankey/__tests__/buildGraph.test.ts --no-coverage
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```bash
git add src/sankey/buildGraph.ts src/sankey/__tests__/
git commit -m "feat: Sankey graph builder from transaction data"
```

---

## Task 8: Sankey SVG Component

**Files:**
- Create: `mobile/src/sankey/SankeyChart.tsx`

- [ ] **Step 1: Install d3-sankey types check**

```bash
npx jest --listTests 2>/dev/null | head -1  # just verify jest still works
```

- [ ] **Step 2: Write SankeyChart.tsx**

Create `mobile/src/sankey/SankeyChart.tsx`:

```typescript
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';
import { sankey, sankeyLinkHorizontal, SankeyNode, SankeyLink } from 'd3-sankey';
import { SankeyData, SankeyNode as AppNode, SankeyLink as AppLink } from './buildGraph';

interface Props {
  data: SankeyData;
  width: number;
  height: number;
  onNodePress?: (nodeName: string) => void;
}

const NODE_WIDTH = 12;
const NODE_PADDING = 14;

const COLORS = [
  '#4ade80', '#6366f1', '#f59e0b', '#ef4444',
  '#a78bfa', '#fb923c', '#fcd34d', '#818cf8',
  '#34d399', '#f87171',
];

export default function SankeyChart({ data, width, height, onNodePress }: Props) {
  const { nodes, links } = useMemo(() => {
    const layout = sankey<AppNode, AppLink>()
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .extent([[8, 8], [width - 80, height - 8]]);

    return layout({
      nodes: data.nodes.map(d => ({ ...d })),
      links: data.links.map(d => ({ ...d })),
    });
  }, [data, width, height]);

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((node, i) => {
      map.set((node as any).name, COLORS[i % COLORS.length]);
    });
    return map;
  }, [nodes]);

  const linkPath = sankeyLinkHorizontal();

  return (
    <Svg width={width} height={height}>
      {/* Links */}
      {links.map((link, i) => {
        const sourceName = (link.source as any).name;
        const color = colorMap.get(sourceName) ?? '#6366f1';
        return (
          <Path
            key={`link-${i}`}
            d={linkPath(link as any) ?? ''}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(1, link.width ?? 1)}
            strokeOpacity={0.35}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((node: any, i) => {
        const color = colorMap.get(node.name) ?? '#6366f1';
        const isIncome = node.name === 'Income';
        return (
          <React.Fragment key={`node-${i}`}>
            <Rect
              x={node.x0}
              y={node.y0}
              width={node.x1 - node.x0}
              height={Math.max(2, node.y1 - node.y0)}
              rx={2}
              fill={color}
              opacity={isIncome ? 1 : 0.85}
              onPress={() => onNodePress?.(node.name)}
            />
            <SvgText
              x={node.x1 + 4}
              y={(node.y0 + node.y1) / 2}
              fill={color}
              fontSize={9}
              fontFamily="system"
              dominantBaseline="middle"
            >
              {node.name}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/sankey/SankeyChart.tsx
git commit -m "feat: Sankey SVG chart component with react-native-svg"
```

---

## Task 9: Home Screen

**Files:**
- Create: `mobile/src/hooks/useTransactions.ts`
- Create: `mobile/src/screens/HomeScreen.tsx`

- [ ] **Step 1: Write useTransactions hook**

Create `mobile/src/hooks/useTransactions.ts`:

```typescript
import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import Transaction from '../db/models/Transaction';
import Account from '../db/models/Account';

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

export function useCurrentMonthTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    const { start, end } = currentMonthRange();
    const subscription = database
      .get<Transaction>('transactions')
      .query(
        Q.where('date', Q.gte(start)),
        Q.where('date', Q.lte(end)),
        Q.where('pending', false)
      )
      .observe()
      .subscribe(setTransactions);

    return () => subscription.unsubscribe();
  }, []);

  return transactions;
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    const subscription = database
      .get<Account>('accounts')
      .query()
      .observe()
      .subscribe(setAccounts);
    return () => subscription.unsubscribe();
  }, []);

  return accounts;
}

export function useTotalBalance(accounts: Account[]) {
  return accounts.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0);
}

export function useMonthlyIncome(transactions: Transaction[]) {
  return transactions
    .filter(t => t.amount < 0 && t.categoryL1 === 'Income')
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

export function useMonthlySpend(transactions: Transaction[]) {
  return transactions
    .filter(t => t.amount > 0 && t.categoryL1 !== 'Income' && !t.categoryL1.includes('Transfer'))
    .reduce((sum, t) => sum + t.amount, 0);
}
```

- [ ] **Step 2: Write HomeScreen.tsx**

Create `mobile/src/screens/HomeScreen.tsx`:

```typescript
import React, { useMemo } from 'react';
import {
  ScrollView, View, Text, StyleSheet, useWindowDimensions,
} from 'react-native';
import SankeyChart from '../sankey/SankeyChart';
import { buildSankeyData } from '../sankey/buildGraph';
import {
  useCurrentMonthTransactions,
  useAccounts,
  useTotalBalance,
  useMonthlyIncome,
  useMonthlySpend,
} from '../hooks/useTransactions';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const transactions = useCurrentMonthTransactions();
  const accounts = useAccounts();

  const totalBalance = useTotalBalance(accounts);
  const monthlyIncome = useMonthlyIncome(transactions);
  const monthlySpend = useMonthlySpend(transactions);
  const free = monthlyIncome - monthlySpend;

  const sankeyData = useMemo(
    () => buildSankeyData(transactions, monthlyIncome),
    [transactions, monthlyIncome]
  );

  const recent = [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Balance header */}
      <View style={s.header}>
        <Text style={s.balanceLabel}>NET BALANCE</Text>
        <Text style={s.balanceAmount}>{fmt(totalBalance)}</Text>
        <Text style={s.balanceSub}>
          {accounts.map(a => a.institutionName).filter((v, i, arr) => arr.indexOf(v) === i).join(' · ')}
        </Text>
      </View>

      {/* Income / Spent / Free pills */}
      <View style={s.pillRow}>
        <View style={[s.pill, s.pillIncome]}>
          <Text style={s.pillLabel}>INCOME</Text>
          <Text style={[s.pillValue, { color: '#4ade80' }]}>{fmt(monthlyIncome)}</Text>
        </View>
        <View style={[s.pill, s.pillNeutral]}>
          <Text style={s.pillLabel}>SPENT</Text>
          <Text style={[s.pillValue, { color: '#f1f5f9' }]}>{fmt(monthlySpend)}</Text>
        </View>
        <View style={[s.pill, s.pillFree]}>
          <Text style={s.pillLabel}>FREE</Text>
          <Text style={[s.pillValue, { color: '#a5b4fc' }]}>{fmt(free)}</Text>
        </View>
      </View>

      {/* Sankey chart */}
      {sankeyData.nodes.length > 1 && (
        <View style={s.sankeyContainer}>
          <Text style={s.sectionLabel}>WHERE IT'S GOING</Text>
          <SankeyChart
            data={sankeyData}
            width={width - 32}
            height={280}
          />
        </View>
      )}

      {/* Recent transactions */}
      <View style={s.recentContainer}>
        <Text style={s.sectionLabel}>RECENT</Text>
        {recent.map(txn => (
          <View key={txn.id} style={s.txnRow}>
            <View>
              <Text style={s.txnMerchant}>{txn.merchantName}</Text>
              <Text style={s.txnCategory}>{txn.categoryL2 || txn.categoryL1} · {txn.date}</Text>
            </View>
            <Text style={[s.txnAmount, txn.amount < 0 && { color: '#4ade80' }]}>
              {txn.amount < 0 ? '+' : '-'}{fmt(Math.abs(txn.amount))}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16 },
  header: { marginBottom: 20 },
  balanceLabel: { fontSize: 10, color: '#475569', letterSpacing: 1.5, marginBottom: 4 },
  balanceAmount: { fontSize: 36, fontWeight: '300', color: '#f8fafc', letterSpacing: -1 },
  balanceSub: { fontSize: 12, color: '#475569', marginTop: 2 },
  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  pill: { flex: 1, borderRadius: 8, padding: 10 },
  pillIncome: { backgroundColor: '#0d2818', borderWidth: 1, borderColor: '#16a34a33' },
  pillNeutral: { backgroundColor: '#1e293b' },
  pillFree: { backgroundColor: '#1e1b4b', borderWidth: 1, borderColor: '#6366f133' },
  pillLabel: { fontSize: 9, color: '#64748b', letterSpacing: 1 },
  pillValue: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  sankeyContainer: { marginBottom: 24 },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 10 },
  recentContainer: { marginBottom: 24 },
  txnRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  txnMerchant: { fontSize: 13, color: '#cbd5e1' },
  txnCategory: { fontSize: 11, color: '#475569', marginTop: 2 },
  txnAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTransactions.ts src/screens/HomeScreen.tsx
git commit -m "feat: Home screen with Sankey chart, balance, and recent transactions"
```

---

## Task 10: Plan Screen (Budgets + Goals)

**Files:**
- Create: `mobile/src/hooks/useBudgets.ts`
- Create: `mobile/src/hooks/useGoals.ts`
- Create: `mobile/src/screens/PlanScreen.tsx`

- [ ] **Step 1: Write useBudgets hook**

Create `mobile/src/hooks/useBudgets.ts`:

```typescript
import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import { supabase } from '../supabase/client';
import { database } from '../db';
import Transaction from '../db/models/Transaction';

export interface BudgetCategory {
  id: string;
  name: string;
  emoji: string;
  monthlyLimit: number;
  color: string;
  spent: number;
}

function currentMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
}

export function useBudgets(): BudgetCategory[] {
  const [budgets, setBudgets] = useState<BudgetCategory[]>([]);

  useEffect(() => {
    async function load() {
      const { data: categories } = await supabase
        .from('budget_categories')
        .select('*')
        .order('name');

      if (!categories) return;

      const start = currentMonthStart();
      const txns = await database
        .get<Transaction>('transactions')
        .query(Q.where('date', Q.gte(start)), Q.where('pending', false))
        .fetch();

      const spendMap = new Map<string, number>();
      for (const txn of txns) {
        if (txn.amount <= 0) continue;
        const key = txn.categoryL1;
        spendMap.set(key, (spendMap.get(key) ?? 0) + txn.amount);
      }

      const result: BudgetCategory[] = categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        emoji: cat.emoji,
        monthlyLimit: cat.monthly_limit,
        color: cat.color,
        spent: spendMap.get(cat.name) ?? 0,
      }));

      // Over-budget categories float to top
      result.sort((a, b) => (b.spent / b.monthlyLimit) - (a.spent / a.monthlyLimit));
      setBudgets(result);
    }

    load();
  }, []);

  return budgets;
}
```

- [ ] **Step 2: Write useGoals hook**

Create `mobile/src/hooks/useGoals.ts`:

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client';

export interface Goal {
  id: string;
  name: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  progressPercent: number;
  monthsLeft: number | null;
}

export function useGoals(): Goal[] {
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('savings_goals').select('*').order('created_at');
      if (!data) return;

      setGoals(data.map(g => {
        const progressPercent = Math.min(100, Math.round((g.current_amount / g.target_amount) * 100));
        let monthsLeft: number | null = null;
        if (g.target_date) {
          const months = Math.ceil(
            (new Date(g.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
          );
          monthsLeft = Math.max(0, months);
        }
        return {
          id: g.id,
          name: g.name,
          emoji: g.emoji,
          targetAmount: g.target_amount,
          currentAmount: g.current_amount,
          targetDate: g.target_date,
          progressPercent,
          monthsLeft,
        };
      }));
    }

    load();
  }, []);

  return goals;
}
```

- [ ] **Step 3: Write PlanScreen.tsx**

Create `mobile/src/screens/PlanScreen.tsx`:

```typescript
import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useBudgets } from '../hooks/useBudgets';
import { useGoals } from '../hooks/useGoals';
import { useCurrentMonthTransactions, useMonthlyIncome, useMonthlySpend } from '../hooks/useTransactions';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function ProgressBar({ ratio, color }: { ratio: number; color: string }) {
  const clamped = Math.min(1, ratio);
  const barColor = ratio > 1 ? '#ef4444' : ratio > 0.7 ? '#f59e0b' : '#22c55e';
  return (
    <View style={{ backgroundColor: '#1e293b', borderRadius: 99, height: 4, marginTop: 4 }}>
      <View style={{ backgroundColor: barColor, width: `${clamped * 100}%`, height: '100%', borderRadius: 99 }} />
    </View>
  );
}

export default function PlanScreen() {
  const budgets = useBudgets();
  const goals = useGoals();
  const transactions = useCurrentMonthTransactions();
  const income = useMonthlyIncome(transactions);
  const spent = useMonthlySpend(transactions);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const projectedSpend = (spent / daysPassed) * daysInMonth;
  const projectedRemaining = income - projectedSpend;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Projection banner */}
      <View style={s.projectionCard}>
        <Text style={s.sectionLabel}>END OF MONTH PROJECTION</Text>
        <Text style={s.projectionAmount}>{fmt(projectedRemaining)}</Text>
        <Text style={s.projectionSub}>
          {projectedRemaining >= 0 ? 'on track' : 'over budget'} · based on {daysPassed} days of spending
        </Text>
      </View>

      {/* Budget envelopes */}
      <Text style={s.sectionLabel}>BUDGETS</Text>
      {budgets.map(b => (
        <View key={b.id} style={s.budgetCard}>
          <View style={s.budgetRow}>
            <Text style={s.budgetName}>{b.emoji} {b.name}</Text>
            <Text style={[s.budgetAmount, b.spent > b.monthlyLimit && { color: '#ef4444' }]}>
              {fmt(b.spent)} <Text style={s.budgetLimit}>/ {fmt(b.monthlyLimit)}</Text>
            </Text>
          </View>
          <ProgressBar ratio={b.spent / b.monthlyLimit} color={b.color} />
        </View>
      ))}

      {/* Savings goals */}
      <Text style={[s.sectionLabel, { marginTop: 24 }]}>GOALS</Text>
      {goals.map(g => (
        <View key={g.id} style={s.goalCard}>
          <View style={s.budgetRow}>
            <Text style={s.budgetName}>{g.emoji} {g.name}</Text>
            <Text style={s.goalPercent}>{g.progressPercent}%</Text>
          </View>
          <ProgressBar ratio={g.progressPercent / 100} color="#6366f1" />
          <Text style={s.goalSub}>
            {fmt(g.currentAmount)} of {fmt(g.targetAmount)}
            {g.monthsLeft !== null ? ` · ~${g.monthsLeft}mo left` : ''}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16 },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 10 },
  projectionCard: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, marginBottom: 24 },
  projectionAmount: { fontSize: 28, fontWeight: '300', color: '#f8fafc', marginVertical: 4 },
  projectionSub: { fontSize: 11, color: '#64748b' },
  budgetCard: { marginBottom: 14 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  budgetName: { fontSize: 13, color: '#cbd5e1' },
  budgetAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  budgetLimit: { color: '#475569' },
  goalCard: { backgroundColor: '#1e293b', borderRadius: 8, padding: 12, marginBottom: 10 },
  goalPercent: { fontSize: 12, color: '#a5b4fc' },
  goalSub: { fontSize: 10, color: '#475569', marginTop: 5 },
});
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useBudgets.ts src/hooks/useGoals.ts src/screens/PlanScreen.tsx
git commit -m "feat: Plan screen with budget envelopes and savings goals"
```

---

## Task 11: Settings Screen + Navigation

**Files:**
- Create: `mobile/src/screens/SettingsScreen.tsx`
- Modify: `mobile/App.tsx`

- [ ] **Step 1: Install navigation**

```bash
npx expo install @react-navigation/native @react-navigation/bottom-tabs
npx expo install react-native-screens react-native-safe-area-context
```

- [ ] **Step 2: Write SettingsScreen.tsx**

Create `mobile/src/screens/SettingsScreen.tsx`:

```typescript
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { PlaidLink, LinkSuccess, LinkExit } from 'react-native-plaid-link-sdk';
import { fetchLinkToken } from '../plaid/linkToken';
import { exchangePublicToken } from '../plaid/exchangeToken';
import { syncTransactions } from '../plaid/syncTransactions';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import Account from '../db/models/Account';
import { useAccounts } from '../hooks/useTransactions';
import { signOut } from '../supabase/client';

export default function SettingsScreen() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const accounts = useAccounts();

  const institutions = [...new Set(accounts.map(a => a.institutionName))];

  const handleAddAccount = useCallback(async () => {
    setLinking(true);
    try {
      const token = await fetchLinkToken();
      setLinkToken(token);
    } catch (e) {
      Alert.alert('Error', 'Could not start bank linking. Try again.');
      setLinking(false);
    }
  }, []);

  const handleLinkSuccess = useCallback(async (success: LinkSuccess) => {
    try {
      const { accessToken, itemId } = await exchangePublicToken(success.publicToken);

      await database.write(async () => {
        await database.get<PlaidItem>('plaid_items').create(item => {
          item.itemId = itemId;
          item.accessToken = accessToken;
          item.institutionId = success.metadata.institution?.id ?? '';
          item.institutionName = success.metadata.institution?.name ?? 'Bank';
          item.cursor = '';
        });
      });

      const item = (await database.get<PlaidItem>('plaid_items')
        .query().fetch()).find(i => i.itemId === itemId)!;

      await syncTransactions(item);
      Alert.alert('Connected!', `${success.metadata.institution?.name} linked successfully.`);
    } catch (e) {
      Alert.alert('Error', 'Failed to connect account.');
    } finally {
      setLinkToken(null);
      setLinking(false);
    }
  }, []);

  const handleLinkExit = useCallback((exit: LinkExit) => {
    setLinkToken(null);
    setLinking(false);
  }, []);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.sectionLabel}>LINKED ACCOUNTS</Text>

      {institutions.map(name => (
        <View key={name} style={s.institutionCard}>
          <Text style={s.institutionName}>{name}</Text>
          <Text style={s.accountCount}>
            {accounts.filter(a => a.institutionName === name).length} accounts
          </Text>
        </View>
      ))}

      {linkToken ? (
        <PlaidLink
          tokenConfig={{ token: linkToken }}
          onSuccess={handleLinkSuccess}
          onExit={handleLinkExit}
        >
          <View style={s.addButton}>
            <Text style={s.addButtonText}>Opening Plaid...</Text>
          </View>
        </PlaidLink>
      ) : (
        <TouchableOpacity style={s.addButton} onPress={handleAddAccount} disabled={linking}>
          <Text style={s.addButtonText}>{linking ? 'Loading...' : '+ Add Account'}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={s.signOutButton} onPress={signOut}>
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
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 8, padding: 14, marginBottom: 8,
  },
  institutionName: { fontSize: 14, color: '#f1f5f9' },
  accountCount: { fontSize: 12, color: '#64748b' },
  addButton: {
    backgroundColor: '#6366f1', borderRadius: 8, padding: 14,
    alignItems: 'center', marginTop: 8,
  },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  signOutButton: { marginTop: 32, padding: 14, alignItems: 'center' },
  signOutText: { color: '#475569', fontSize: 14 },
});
```

- [ ] **Step 3: Wire up navigation in App.tsx**

Replace `mobile/App.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './src/screens/HomeScreen';
import PlanScreen from './src/screens/PlanScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { supabase } from './src/supabase/client';
import type { Session } from '@supabase/supabase-js';

const Tab = createBottomTabNavigator();

function AuthScreen() {
  // Minimal email+password auth — replace with your preferred UI
  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#f8fafc', fontSize: 20, fontWeight: '300' }}>Budget</Text>
      <Text style={{ color: '#64748b', marginTop: 8 }}>Sign in to continue</Text>
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  if (!session) return <AuthScreen />;

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
            tabBarActiveTintColor: '#6366f1',
            tabBarInactiveTintColor: '#475569',
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
          <Tab.Screen name="Plan" component={PlanScreen} options={{ tabBarLabel: 'Plan' }} />
          <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 4: Build and test on device**

```bash
eas build --profile development --platform ios
# or android:
eas build --profile development --platform android
```

Install the dev build on your device. Verify all 3 tabs render without crashing.

- [ ] **Step 5: Commit**

```bash
git add src/screens/SettingsScreen.tsx App.tsx
git commit -m "feat: Settings screen, Plaid Link flow, bottom tab navigation"
```

---

## Task 12: Push Notifications + Background Sync

**Files:**
- Modify: `mobile/App.tsx`
- Create: `mobile/src/plaid/backgroundSync.ts`

- [ ] **Step 1: Write backgroundSync.ts**

Create `mobile/src/plaid/backgroundSync.ts`:

```typescript
import * as Notifications from 'expo-notifications';
import { AppState, AppStateStatus } from 'react-native';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import { syncTransactions } from './syncTransactions';
import { supabase } from '../supabase/client';

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export async function registerPushToken() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync()).data;

  await supabase
    .from('app_preferences')
    .upsert({ expo_push_token: token }, { onConflict: 'user_id' });
}

export async function syncStaleItems() {
  const items = await database.get<PlaidItem>('plaid_items').query().fetch();
  const now = Date.now();

  for (const item of items) {
    const lastSync = item.lastSyncedAt ?? 0;
    if (now - lastSync > STALE_THRESHOLD_MS) {
      await syncTransactions(item);
    }
  }
}

export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  // Sync when notification received in foreground
  return Notifications.addNotificationReceivedListener(async notification => {
    const itemId = notification.request.content.data?.itemId as string | undefined;
    if (!itemId) return;

    const items = await database.get<PlaidItem>('plaid_items').query().fetch();
    const item = items.find(i => i.itemId === itemId);
    if (item) await syncTransactions(item);
  });
}

export function setupAppStateSync() {
  let lastState = AppState.currentState;

  return AppState.addEventListener('change', async (nextState: AppStateStatus) => {
    if (lastState.match(/inactive|background/) && nextState === 'active') {
      await syncStaleItems();
    }
    lastState = nextState;
  });
}
```

- [ ] **Step 2: Wire into App.tsx — add useEffect after session check**

Add to `App.tsx` (inside the component, after the session effect):

```typescript
import {
  registerPushToken,
  setupNotificationHandler,
  setupAppStateSync,
  syncStaleItems,
} from './src/plaid/backgroundSync';

// Inside App(), after the session/loading effects:
useEffect(() => {
  if (!session) return;
  registerPushToken();
  syncStaleItems(); // sync on app launch

  const notifSub = setupNotificationHandler();
  const appStateSub = setupAppStateSync();

  return () => {
    notifSub.remove();
    appStateSub.remove();
  };
}, [session]);
```

- [ ] **Step 3: Commit**

```bash
git add src/plaid/backgroundSync.ts App.tsx
git commit -m "feat: push notifications and background sync on app foreground"
```

---

## Task 13: Next.js Web Dashboard on Render

**Files:**
- Create: `web/` (Next.js project)
- Create: `web/src/lib/supabase.ts`
- Create: `web/src/app/page.tsx`

- [ ] **Step 1: Create Next.js app**

```bash
cd budget-app
npx create-next-app@latest web --typescript --tailwind --app --no-src-dir
mv web/src web/src 2>/dev/null; mkdir -p web/src/app web/src/lib
npm install --prefix web @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Create web/.env.local**

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 3: Write Supabase client for web**

Create `web/src/lib/supabase.ts`:

```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 4: Write the overview page**

Create `web/src/app/page.tsx`:

```typescript
import { createClient } from '../lib/supabase';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) redirect('/login');

  const [{ data: categories }, { data: goals }] = await Promise.all([
    supabase.from('budget_categories').select('*').order('name'),
    supabase.from('savings_goals').select('*').order('created_at'),
  ]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-3xl font-light text-slate-100 mb-8">Budget Overview</h1>

      <section className="mb-10">
        <p className="text-xs text-slate-500 tracking-widest mb-4">BUDGET CATEGORIES</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories?.map(cat => (
            <div key={cat.id} className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <p className="text-slate-300">{cat.emoji} {cat.name}</p>
              <p className="text-slate-500 text-sm mt-1">
                Limit: ${Number(cat.monthly_limit).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="text-xs text-slate-500 tracking-widest mb-4">SAVINGS GOALS</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {goals?.map(goal => {
            const pct = Math.round((goal.current_amount / goal.target_amount) * 100);
            return (
              <div key={goal.id} className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-slate-300">{goal.emoji} {goal.name}</p>
                  <span className="text-indigo-400 text-sm">{pct}%</span>
                </div>
                <div className="bg-slate-800 rounded-full h-1.5">
                  <div
                    className="bg-indigo-500 h-full rounded-full"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <p className="text-slate-600 text-xs mt-2">
                  ${Number(goal.current_amount).toLocaleString()} of ${Number(goal.target_amount).toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Create render.yaml for Render deployment**

Create `web/render.yaml`:

```yaml
services:
  - type: web
    name: budget-web
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: npm run start
    envVars:
      - key: NEXT_PUBLIC_SUPABASE_URL
        sync: false
      - key: NEXT_PUBLIC_SUPABASE_ANON_KEY
        sync: false
```

- [ ] **Step 6: Deploy to Render**

Push to a GitHub repo, connect it in Render dashboard → New Web Service → select `web/` as root directory. Add env vars from `.env.local`. Deploy.

- [ ] **Step 7: Final commit**

```bash
git add web/
git commit -m "feat: Next.js web dashboard deployed on Render"
```

---

## Self-Review Checklist

Checked against spec `docs/superpowers/specs/2026-04-11-budgeting-dashboard-design.md`:

| Requirement | Task |
|---|---|
| Plaid Link SDK bank linking | Tasks 5, 11 |
| Access token stored on-device only | Task 5 (exchangeToken → WatermelonDB), Task 4 (edge fn returns but doesn't store) |
| Webhook-driven transaction sync | Tasks 4, 12 |
| Multi-level Sankey chart | Tasks 7, 8, 9 |
| Budget envelopes | Task 10 |
| Savings goals | Task 10 |
| Paycheck / income tracking | Tasks 6 (syncTransactions maps Income category), 9 (useMonthlyIncome) |
| 3-tab navigation (Home · Plan · Settings) | Task 11 |
| Supabase non-sensitive metadata only | Tasks 3, 10 (categories/goals only) |
| Push notification + background sync | Task 12 |
| Fallback sync on app foreground | Task 12 (setupAppStateSync + syncStaleItems) |
| Next.js web dashboard on Render | Task 13 |
| No transaction data in web dashboard | Task 13 (page.tsx queries only categories + goals) |
