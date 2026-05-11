# Settings Screen Design Spec

## Overview

`SettingsScreen` is the bank account management screen in the Tower app. It lists all linked financial institutions, grouped by institution name, with per-account rows showing name, subtype, and current balance. It handles the full Plaid lifecycle: adding new accounts, reconnecting broken connections (update mode), unlinking individual accounts, and signing out. This screen was built as part of the Plaid Update Mode, Offboarding & OAuth Redirect implementation plan (2026-04-21).

## Architecture

**File:** `mobile/src/screens/SettingsScreen.tsx`

**Components:**
- `SettingsScreen` — default export, the full screen
- `usePlaidItems` — a file-local hook (not exported) that queries WatermelonDB for all `plaid_items` rows belonging to the current user

**External hooks and helpers:**
- `useAuth()` from `AuthContext` — provides `signOut()`
- `useAccounts()` from `useTransactions` — returns `{ accounts, loading: accountsLoading }` where each account has `institutionName`, `plaidItemId`, `plaidAccountId`, `name`, `subtype`, `currentBalance`
- `fetchLinkToken` — calls the `create-link-token` edge function (normal mode)
- `fetchUpdateLinkToken(itemId)` — calls `create-link-token` with `{ item_id }` body (update mode)
- `exchangePublicToken(publicToken)` — calls `exchange-public-token` edge function; returns `{ itemId, accounts }`
- `removePlaidItem(plaidItemId)` — calls `remove-plaid-item` edge function + deletes WatermelonDB records
- `syncTransactions(item, userId)` — kicks off a background Plaid transaction sync

**Local state:**

| State | Type | Purpose |
|-------|------|---------|
| `linking` | `boolean` | Disables "Add Account" button while Plaid Link is open |
| `reconnectingItemId` | `string \| null` | Tracks which institution is currently in reconnect flow |
| `unlinkingItemId` | `string \| null` | Tracks which item is being unlinked (shows spinner on its rows) |
| `refreshCount` | `number` | Incrementing counter that triggers `usePlaidItems` re-fetch |

### `usePlaidItems(refreshKey: number)`

Queries `database.get('plaid_items').query(Q.where('user_id', user.id)).fetch()` inside a `useEffect` that fires whenever `refreshKey` changes. Sets `cancelled = true` on cleanup to prevent stale state updates. Returns `PlaidItem[]`.

**Note:** This hook accepts a `refreshKey` parameter in the production implementation to force a re-fetch after unlink/reconnect. The plan document contains an earlier version of the hook without the `refreshKey` parameter.

## Account Display

**Institution grouping:** `institutions` is derived as `[...new Set(accounts.map(a => a.institutionName))]` — unique institution names in the order they appear in the `accounts` array.

**Loading state:** When `accountsLoading` is true, renders an `ActivityIndicator` (color `#475569`) with vertical margin.

**Empty state:** When `institutions.length === 0`, renders an empty card with `"No accounts linked yet"` and `"Tap Add Account to connect your bank"`.

**Institution card layout:**

Each institution renders as a `View` with background `#1e293b`, `borderRadius: 8`.

The institution header row contains:
- Left: institution name + account count (e.g., `"2 accounts"`)
- Right: either a red "Reconnect" button (if `hasError`) or a green `●  linked` status indicator

**Error indicator:** When `institutionHasError(name).hasError === true`, a 7×7px red dot (`#ef4444`, `borderRadius: 3.5`) is rendered to the left of the institution name.

**Per-account rows:** Each `Account` in `instAccounts` renders as a `TouchableOpacity` with:
- Left: `account.name` (13px, `#94a3b8`) + `account.subtype` (10px, `#475569`, `textTransform: capitalize`)
- Right: `"$" + account.currentBalance.toFixed(2)` in `#64748b`
- While unlinking: right side shows `ActivityIndicator` (`size="small"`, color `#475569`) and the row is `disabled`
- Border separator: `borderTopWidth: 1`, `borderTopColor: '#0f172a'`

**`institutionHasError(institutionName)`:** Iterates accounts for the institution, finds matching `plaidItems` by `item.itemId === acc.plaidItemId`, returns `{ hasError: true, itemId }` on the first match where `item.hasError === true`. Returns `{ hasError: false, itemId: null }` if none.

## Add Account Flow

1. User taps `"+ Add Account"` button (disabled + shows `"Linking..."` while `linking === true`)
2. `handleAddAccount` sets `linking = true`, calls `fetchLinkToken()` to get a Plaid `link_token`
3. `create({ token, redirectUri: 'https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect' })` initializes the Plaid Link SDK
4. `open({ onSuccess: handlePlaidSuccess, onExit: handlePlaidExit })` launches the native Plaid UI

**`handlePlaidSuccess(success: LinkSuccess)`:**

1. Calls `supabase.auth.getUser()` to get the current user
2. Calls `exchangePublicToken(success.publicToken)` → `{ itemId, accounts: freshAccounts }`
3. Performs a `database.write()` transaction:
   - Creates a `plaid_items` record with `userId`, `itemId`, `accessToken: ''`, `institutionId`, `institutionName`, `cursor: ''`, `hasError: false`
   - Creates one `accounts` record per `freshAccounts` entry with all Plaid account fields. These are written immediately from the `/accounts/get` response because `/transactions/sync` returns empty account data for newly created Plaid items until Plaid finishes processing
4. Fetches the newly-written `PlaidItem` from WatermelonDB and calls `syncTransactions(item, user.id)` in the background (errors are `console.warn`'d, not surfaced to the user)
5. Shows `Alert.alert('Connected!', ...)` on success; `Alert.alert('Error', ...)` on failure
6. Sets `linking = false` in `finally`

**`handlePlaidExit`:** Sets `linking = false` and `reconnectingItemId = null`.

## OAuth Redirect Flow

Plaid's production dashboard requires HTTPS redirect URIs. The app uses `tower://plaid-oauth` as its deep link scheme, so an HTTPS relay is needed.

**`plaid-oauth-redirect` edge function:** A Supabase edge function deployed at `https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect`. Deployed with `--no-verify-jwt`. On any `GET` request, it constructs `tower://plaid-oauth{url.search}` and returns a `302` redirect to that URL.

**Linking listener:** Registered in `useEffect` on mount (cleaned up on unmount):

```typescript
Linking.addEventListener('url', ({ url }) => {
  if (url.startsWith('tower://plaid-oauth')) {
    open({
      receivedRedirectUri: url,
      onSuccess: handlePlaidSuccess,
      onExit: handlePlaidExit,
    } as any);
  }
});
```

When an OAuth institution (e.g., American Express) redirects after authentication, Plaid redirects to the HTTPS relay, which 302s to `tower://plaid-oauth?...`. The OS fires the `url` event, the listener catches it, and `open({ receivedRedirectUri })` resumes the Plaid Link session.

The `tower://` URL scheme is registered in `app.json` (`scheme: "tower"` + `CFBundleURLSchemes`).

## Reconnect Flow

Triggered when a Plaid item's `has_error` field is `true` in WatermelonDB. This field is set by `backgroundSync` when an `ITEM_ERROR` push notification arrives (set by the `plaid-webhook` edge function on `ITEM_LOGIN_REQUIRED`, `ITEM_ERROR`, or `CONSENT_EXPIRED` webhook codes).

**Visual state:** The institution card shows a red 7px dot beside the name and replaces the green `● linked` indicator with a red `"Reconnect"` button. While `reconnectingItemId === errorItemId`, the button shows `"Reconnecting…"` and is disabled (background darkens to `#7f1d1d`).

**`handleReconnect(itemId: string)`:**

1. Sets `reconnectingItemId = itemId`
2. Calls `fetchUpdateLinkToken(itemId)` — this hits `create-link-token` with `{ item_id: itemId }` which fetches the stored access token from `plaid_tokens` and also resets `plaid_tokens.status` to `'good'`
3. `create({ token, redirectUri })` + `open({ onSuccess: (s) => handleReconnectSuccess(s, itemId), onExit: handlePlaidExit })`

**`handleReconnectSuccess(success, itemId)`:**

1. Performs `database.write()`: queries `plaid_items` by `item_id = itemId`, calls `item.update(i => { i.hasError = false; })` on each result
2. Shows `Alert.alert('Reconnected!', ...)` on success
3. Sets `reconnectingItemId = null` and increments `refreshCount` in `finally` (triggering `usePlaidItems` re-fetch)

## Unlink Flow

**Trigger:** Long-pressing any `TouchableOpacity` account row calls `handleLongPressAccount(account.name, account.plaidItemId)`.

**Step 1 — Action sheet:** `ActionSheetIOS.showActionSheetWithOptions` with:
- Options: `["Unlink {accountName}", "Cancel"]`
- `destructiveButtonIndex: 0`
- `cancelButtonIndex: 1`

If `buttonIndex !== 0`, returns immediately.

**Step 2 — Confirmation alert:** `Alert.alert('Unlink account?', '...Your transaction history will be preserved.', [...])` with two buttons:
- `"Cancel"` — dismisses
- `"Unlink"` (destructive) — proceeds

**Step 3 — Removal:** On confirmation:
1. Sets `unlinkingItemId = plaidItemId`
2. Calls `removePlaidItem(plaidItemId)` which calls the `remove-plaid-item` edge function (revokes Plaid access, deletes `plaid_tokens` row) then deletes the matching `plaid_items` and `accounts` records from WatermelonDB. Transaction history is explicitly preserved.
3. On error: `Alert.alert('Error', ...)`
4. `finally`: sets `unlinkingItemId = null`, increments `refreshCount`

## Sign Out

A `"Sign Out"` `TouchableOpacity` at the bottom of the scroll view. On press:

```typescript
signOut().catch(() => Alert.alert('Error', 'Could not sign out. Try again.'))
```

`signOut()` comes from `AuthContext` and calls `supabase.auth.signOut()`.

## Known Issues

- **Hardcoded Supabase project URL (issue #65).** The `redirectUri` string `'https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect'` is hardcoded in two places inside `SettingsScreen.tsx` (`handleAddAccount` and `handleReconnect`). This should be read from an env var or a shared constants file.
- **No test file (issue #74).** The plan document explicitly notes: "This task has no unit test (the screen depends on Plaid SDK which requires native modules, and the existing codebase has no SettingsScreen test)." No test file exists.

## Test Coverage

**0%** — there is no test file for `SettingsScreen`. The screen is only verified manually on device/simulator.

Areas that would require test infrastructure investment before unit testing is practical:

| Area | Blocker |
|------|---------|
| `handleAddAccount` / `handlePlaidSuccess` | `react-native-plaid-link-sdk` requires native modules |
| OAuth Linking listener | `Linking` must be mocked; event simulation is non-trivial |
| `institutionHasError` | Could be extracted and unit-tested in isolation |
| `usePlaidItems` | Requires WatermelonDB mock setup |
| Reconnect and unlink flows | Plaid SDK + WatermelonDB mocks required |

## Files

| File | Role |
|------|------|
| `mobile/src/screens/SettingsScreen.tsx` | Full screen implementation |
| `mobile/src/plaid/linkToken.ts` | `fetchLinkToken`, `fetchUpdateLinkToken` |
| `mobile/src/plaid/exchangeToken.ts` | `exchangePublicToken` |
| `mobile/src/plaid/removePlaidItem.ts` | `removePlaidItem` — edge function call + WatermelonDB cleanup |
| `mobile/src/plaid/syncTransactions.ts` | Background transaction sync after link |
| `mobile/src/db/models/PlaidItem.ts` | WatermelonDB model; `hasError` field added in schema v3 |
| `supabase/functions/create-link-token/index.ts` | Normal + update-mode link token generation |
| `supabase/functions/remove-plaid-item/index.ts` | Plaid item revocation + token deletion |
| `supabase/functions/plaid-oauth-redirect/index.ts` | HTTPS → `tower://` deep link relay |
