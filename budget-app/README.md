# Tower — Budget App

A personal finance mobile app that links your bank accounts via Plaid, tracks spending, and helps you stay within budget goals.

**Stack:** React Native (Expo bare) · Supabase (auth, edge functions, Postgres) · WatermelonDB · Plaid Link SDK

---

## Architecture

```
Mobile App (React Native)
  ├── WatermelonDB          local-first persistence (transactions, accounts, plaid_items)
  ├── Supabase Auth         session management (email, Apple, Google)
  └── Supabase Edge Fns     server-side secrets & Plaid API calls

Supabase Edge Functions
  ├── create-link-token     mints Plaid Link tokens (normal + update mode)
  ├── exchange-public-token exchanges Plaid public token → access token, fetches accounts
  ├── plaid-webhook         handles TRANSACTIONS and ITEM_ERROR events from Plaid
  ├── plaid-oauth-redirect  HTTPS relay for OAuth bank redirects → tower:// deep link
  ├── remove-plaid-item     revokes Plaid access + deletes plaid_tokens row
  └── sync-transactions     calls Plaid /transactions/sync, writes to DB

Plaid
  └── Link SDK              bank auth UI, transaction data, institution connections
```

---

## Business Flows

### 1. Authentication

Three sign-in methods, all producing a Supabase session:

| Method | Implementation |
|--------|---------------|
| Email + password | Supabase Auth — password strength enforced client-side, email confirmation required |
| Sign in with Apple | `expo-apple-authentication` → `supabase.auth.signInWithIdToken` |
| Sign in with Google | `react-native-app-auth` → nonce exchange → `supabase.auth.signInWithIdToken` |

Session is refreshed before every edge function call. Errors surface specific messages (wrong credentials, unconfirmed email, rate limit) rather than raw Supabase responses.

See [`docs/AUTH.md`](docs/AUTH.md) for full details.

---

### 2. Linking a Bank Account

**Normal banks (username/password):**

```
User taps "Add Account"
  → create-link-token edge fn mints a link_token (with webhook URL)
  → Plaid Link SDK opens
  → User selects bank, enters credentials
  → onSuccess fires with publicToken
  → exchange-public-token edge fn:
      - exchanges publicToken → access_token (stored server-side in plaid_tokens)
      - calls /accounts/get immediately (available right after exchange)
      - returns item_id + accounts[]
  → App writes PlaidItem + Account records to WatermelonDB
  → syncTransactions runs in background
```

**OAuth institutions (Amex, Chase, etc.):**

These banks redirect users to their own website to authenticate. The flow adds two extra hops:

```
create({ token, redirectUri: 'https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect' })
  → Plaid Link opens, detects OAuth institution
  → Redirects user to bank's website
  → Bank redirects to plaid-oauth-redirect edge fn (HTTPS — required by Plaid)
  → Edge fn immediately 302s to tower://plaid-oauth?...
  → App's Linking listener catches tower://plaid-oauth
  → Calls open({ receivedRedirectUri: url }) to resume Link
  → onSuccess fires — same flow as normal banks from here
```

The `plaid-oauth-redirect` edge function is deployed with `--no-verify-jwt` (Plaid hits it without auth headers). Register `https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect` in the Plaid dashboard under OAuth redirect URIs.

---

### 3. Transaction Sync

Two paths keep local data fresh:

**Webhook-driven (primary):**
```
Plaid fires TRANSACTIONS.SYNC_UPDATES_AVAILABLE
  → plaid-webhook edge fn sends Expo push notification to all registered devices
  → App's setupNotificationHandler receives it
  → syncTransactions(item, userId) runs — calls Plaid /transactions/sync with cursor
  → New/modified/removed transactions written to WatermelonDB
```

**Item error handling:**
```
Plaid fires ITEM.ITEM_LOGIN_REQUIRED / ITEM_ERROR / CONSENT_EXPIRED
  → plaid-webhook sets plaid_tokens.status = 'error'
  → Push notification sent only to the item owner's device (scoped by user_id)
  → backgroundSync sets plaid_items.has_error = true locally
  → SettingsScreen shows red dot + "Reconnect" button
```

---

### 4. Reconnecting a Broken Connection (Update Mode)

```
User taps "Reconnect" in Settings
  → fetchUpdateLinkToken(itemId) calls create-link-token with { item_id }
  → Edge fn fetches access_token from plaid_tokens, resets status to 'good'
  → create-link-token returns update-mode link_token
  → Plaid Link opens in update mode (re-auth only, no new item created)
  → onSuccess: clears has_error on local PlaidItem record
```

---

### 5. Unlinking an Account

```
User long-presses an account row in Settings
  → ActionSheetIOS shows "Unlink [account name]" + confirmation Alert
  → removePlaidItem(itemId):
      - calls remove-plaid-item edge fn → Plaid /item/remove + deletes plaid_tokens row
      - destroys PlaidItem + Account records in WatermelonDB
```

Transaction history is preserved on unlink.

---

### 6. Budget Planning

Users allocate income into named buckets by percentage:

```
Confirmed monthly income (from income detector)
  → Buckets get targetPct % each
  → Goals can be set per bucket (fixed monthly target)
  → Slider adjusts targetPct; unallocated remainder shown explicitly
  → On bucket delete: percentage redistributed proportionally to remaining buckets
     (priority-weighted — higher-ranked buckets absorb more)
  → Drag-to-reorder (DraggableFlatList) persists priority_rank to Supabase
```

Key rules:
- Unallocated income is always shown and included in slider max
- Goal allocations come from unallocated first, then from other buckets proportionally
- `computeRedistribution()` in `redistributeOnDelete.ts` handles all weight math

---

### 7. Wellness Score

A 0–100 score computed from current-period transactions vs. budget targets, displayed on HomeScreen. Factors: spend ratio per bucket, income coverage, transaction recency. Score refreshes on every HomeScreen focus via `useFocusEffect`.

---

## Edge Functions

| Function | Auth required | Purpose |
|----------|--------------|---------|
| `create-link-token` | Yes (Bearer) | Mint Plaid Link token; supports update mode via `item_id` body param |
| `exchange-public-token` | Yes (Bearer) | Exchange Plaid public token, store access token, return accounts |
| `plaid-webhook` | No (Plaid signature) | Handle TRANSACTIONS and ITEM events from Plaid |
| `plaid-oauth-redirect` | No | Relay HTTPS redirect from OAuth bank → `tower://plaid-oauth` deep link |
| `remove-plaid-item` | Yes (Bearer) | Revoke Plaid access, delete token row |
| `sync-transactions` | Yes (Bearer) | Manual or webhook-triggered transaction sync |

Deploy all: `supabase functions deploy <name>`

---

## Local Development

```bash
# Mobile
cd mobile
npm install
npx expo run:ios

# Edge functions (local)
cd ..
supabase start
supabase functions serve

# Tests
cd mobile
npx jest --no-coverage
```

Required env vars in `mobile/.env`:
```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
```

---

## Backlog

| Item | Issue | Spec |
|------|-------|------|
| Wellness detail sheet (sparkline + factor breakdown) | #36 | `docs/superpowers/specs/2026-04-21-wellness-detail-sheet-design.md` |
| Budget treemap visualization | #35 | `docs/superpowers/specs/2026-04-19-budget-treemap-design.md` |
| Remove confirmed fixed charge button | — | `docs/superpowers/specs/2026-04-19-budget-bucket-fixes-design.md` §4 |
| Budget alerts (push when nearing limit) | — | — |
| Android Google Sign-In | — | `docs/AUTH.md` |
| GitHub / Facebook OAuth | — | `docs/AUTH.md` |
