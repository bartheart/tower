# Settings Screen Redesign — Design Spec

## Overview

Redesign `SettingsScreen` from a single scrollable page into a proper hub-and-spoke navigation structure. All Plaid account management moves to a dedicated `LinkedAccountsScreen`. Four new sub-screens are added: `ProfileScreen`, `NotificationsScreen`, `PreferencesScreen`, and `AboutScreen`. All sub-screens use push navigation (stack) with a manual back button, consistent with the existing `ReportScreen` pattern.

This spec supersedes the account-management sections of `docs/superpowers/specs/2026-04-21-settings-screen.md`, which remains the authoritative reference for the Plaid lifecycle logic inside `LinkedAccountsScreen`.

---

## Navigation Architecture

**File changed:** `mobile/App.tsx`

The existing root `Stack.Navigator` gains 5 new screens alongside `Report`. The Settings tab stays as the hub entry point.

```
RootNavigator (Stack)
├── Tabs (Bottom Tab)
│   ├── Home
│   ├── Plan
│   └── Settings          ← hub (rewritten)
├── Report
├── LinkedAccounts        ← current SettingsScreen content
├── Profile
├── Notifications
├── Preferences
└── About
```

All new screens use `headerShown: false`. Navigation is typed via a new `RootStackParamList` in `mobile/src/navigation/types.ts`.

**New file:** `mobile/src/navigation/types.ts`

```typescript
export type RootStackParamList = {
  Tabs: undefined;
  Report: undefined;
  LinkedAccounts: undefined;
  Profile: undefined;
  Notifications: undefined;
  Preferences: undefined;
  About: undefined;
};
```

**New file:** `mobile/src/constants.ts`

Centralises hardcoded values (fixes issue #65):

```typescript
export const SUPABASE_OAUTH_REDIRECT_URL =
  'https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect';
export const PRIVACY_POLICY_URL = 'https://...'; // set before launch
export const TERMS_URL = 'https://...';           // set before launch
export const SUPPORT_EMAIL = 'support@...';       // set before launch
```

---

## Settings Hub (`SettingsScreen.tsx` — rewritten)

**~80 lines.** Replaces the current 349-line implementation. All Plaid logic is removed.

### Layout

**Profile card** — rendered at the top, tappable, navigates to `Profile`:
- Avatar circle: 48×48px, `borderRadius: 24`, background `#6366f1`. Shows the first character of `displayName` in white, 20px bold.
- `displayName`: read from `user.user_metadata.display_name`; falls back to the portion of `user.email` before `@`.
- Email: 12px, `#64748b`, truncated with `ellipsizeMode="tail"`.

**Grouped rows** with section labels (9px, `#475569`, `letterSpacing: 1.5`):

| Section label | Rows |
|---|---|
| `ACCOUNTS` | Linked Accounts |
| `APP` | Notifications, Preferences |
| `SUPPORT` | About |

Each row: 28×28px icon tile (rounded 6px) + 14px label + `›` chevron (`#475569`). Rows inside a section are separated by `borderTopWidth: 1, borderTopColor: '#0f172a'`. Section groups have `backgroundColor: '#1e293b', borderRadius: 8`.

Icon tile colours:
- Linked Accounts: `#1d4ed8`
- Notifications: `#0f766e`
- Preferences: `#7c3aed`
- About: `#334155`

**Sign Out** — standalone text button below all sections. No section label. Text: 14px `#ef4444`. On press: `signOut().catch(() => Alert.alert('Error', 'Could not sign out. Try again.'))`.

### State

No local state beyond what `useAuth()` and `supabase.auth.getUser()` provide. The hub is a pure navigation screen.

---

## LinkedAccountsScreen

**File:** `mobile/src/screens/LinkedAccountsScreen.tsx`

The current `SettingsScreen` implementation, lifted out verbatim, with two changes:
1. Sign Out button removed (it lives on the hub).
2. Back button row added at the top: `‹ Settings` (14px, `#6366f1`, `TouchableOpacity` calling `navigation.goBack()`).

All Plaid lifecycle logic, `usePlaidItems`, `institutionHasError`, `handleAddAccount`, `handleReconnect`, `handleReconnectSuccess`, `handlePlaidExit`, `handleLongPressAccount`, and the OAuth `Linking` listener remain unchanged. Refer to `2026-04-21-settings-screen.md` for full documentation of this logic.

The hardcoded `redirectUri` string is replaced with the `SUPABASE_OAUTH_REDIRECT_URL` constant from `src/constants.ts` (closes issue #65).

---

## ProfileScreen

**File:** `mobile/src/screens/ProfileScreen.tsx`

### Layout

Back button row: `‹ Settings` → `navigation.goBack()`.

**Display name field:**
- Label: `"Display name"` (11px, `#475569`)
- `TextInput`: current value pre-populated from `user.user_metadata.display_name`. On blur, calls `supabase.auth.updateUser({ data: { display_name: value.trim() } })`. Shows `ActivityIndicator` while saving. On error: `Alert.alert('Error', ...)`.

**Email row:**
- Label: `"Email"`
- Value: `user.email`, read-only `Text` (not a `TextInput`). Email change is out of scope.

**Change Password row:**
- Hidden when `user.identities` contains no entry with `provider === 'email'` (i.e. the account was created via Apple or Google with no email/password identity).
- Tapping calls `supabase.auth.resetPasswordForEmail(user.email!)` then shows `Alert.alert('Email sent', 'Check your inbox for a password reset link.')`.
- While in-flight: row shows `ActivityIndicator` and is disabled.
- On error: `Alert.alert('Error', ...)`.

### State

| State | Type | Purpose |
|---|---|---|
| `displayName` | `string` | Current value of the display name input |
| `saving` | `boolean` | True while `updateUser` call is in flight |
| `sendingReset` | `boolean` | True while password reset email is sending |

---

## NotificationsScreen

**File:** `mobile/src/screens/NotificationsScreen.tsx`

### Layout

Back button row: `‹ Settings` → `navigation.goBack()`.

Two `Switch` rows inside a single `#1e293b` card:

| Row label | Sublabel | `user_metadata` key | Default |
|---|---|---|---|
| Bank connection errors | Notify when a linked account needs reconnecting | `notif_bank_errors` | `true` |
| Budget limit alerts | Notify when spending approaches a budget limit | `notif_budget_alerts` | `true` |

### Behaviour

On mount: reads current values from `(await supabase.auth.getUser()).data.user?.user_metadata`. Falls back to `true` if the key is absent (first time).

On toggle: immediately updates local state (optimistic), then calls `supabase.auth.updateUser({ data: { [key]: newValue } })`. On error: reverts local state and shows `Alert.alert('Error', ...)`.

### State

| State | Type |
|---|---|
| `bankErrors` | `boolean` |
| `budgetAlerts` | `boolean` |
| `loading` | `boolean` |

---

## PreferencesScreen

**File:** `mobile/src/screens/PreferencesScreen.tsx`

### Layout

Back button row: `‹ Settings` → `navigation.goBack()`.

**Budget cycle start day:**
- Section label: `"BUDGET CYCLE"`
- A horizontal `FlatList` of day numbers 1–28. Each item is a 36×36px circle. Selected day: `#6366f1` background, white text. Unselected: `#1e293b` background, `#94a3b8` text.
- On select: updates local state, calls `supabase.auth.updateUser({ data: { budget_cycle_start_day: day } })`.

**Currency:**
- Section label: `"CURRENCY"`
- A single tappable row showing current selection (e.g. `"USD — $"`).
- On tap: `ActionSheetIOS.showActionSheetWithOptions` with options `["USD — $", "EUR — €", "GBP — £", "CAD — C$", "Cancel"]`.
- On select: updates local state, calls `supabase.auth.updateUser({ data: { currency: code } })`.

### Storage

Both values stored in Supabase `user_metadata` so they sync across devices:
- `budget_cycle_start_day`: integer 1–28, default `1`
- `currency`: string `"USD" | "EUR" | "GBP" | "CAD"`, default `"USD"`

### Integration note

`useBudgets` does not currently read `budget_cycle_start_day`. Reading this value from `user_metadata` and using it to define the current period window is a follow-on task, out of scope for this spec.

### State

| State | Type |
|---|---|
| `cycleStartDay` | `number` |
| `currency` | `string` |
| `loading` | `boolean` |

---

## AboutScreen

**File:** `mobile/src/screens/AboutScreen.tsx`

### Layout

Back button row: `‹ Settings` → `navigation.goBack()`.

Single `#1e293b` card with four rows:

| Row | Right side | Action |
|---|---|---|
| App version | `Constants.expoConfig?.version ?? '—'` | None (read-only) |
| Privacy Policy | `›` | `Linking.openURL(PRIVACY_POLICY_URL)` |
| Terms of Service | `›` | `Linking.openURL(TERMS_URL)` |
| Send Feedback | `›` | `Linking.openURL('mailto:' + SUPPORT_EMAIL)` |

`Constants` imported from `expo-constants` (already a dependency).

---

## Error Handling

All network calls (`supabase.auth.updateUser`, `resetPasswordForEmail`) follow the same pattern used in the rest of the app:
- Show `ActivityIndicator` while in-flight, disable the interactive element
- On success: update local state
- On error: `Alert.alert('Error', err.message)`, revert optimistic state where applicable

---

## Test Coverage

No unit tests for the screen components (same blocker as the existing `SettingsScreen` — native module dependencies). The following helpers are testable in isolation and should be unit tested:

| Helper | Test |
|---|---|
| Display name fallback logic (`email.split('@')[0]`) | Pure function, extract and test |
| Notification preference read/write | Mock `supabase.auth`, test default fallback behaviour |
| Currency options list | Snapshot test of options array |

---

## Files

| File | Status | Notes |
|---|---|---|
| `mobile/App.tsx` | Modified | Add 5 new `Stack.Screen` entries |
| `mobile/src/navigation/types.ts` | New | `RootStackParamList` type |
| `mobile/src/constants.ts` | New | Shared URLs and constants; closes #65 |
| `mobile/src/screens/SettingsScreen.tsx` | Rewritten | Hub only, ~80 lines |
| `mobile/src/screens/LinkedAccountsScreen.tsx` | New | Current SettingsScreen content |
| `mobile/src/screens/ProfileScreen.tsx` | New | |
| `mobile/src/screens/NotificationsScreen.tsx` | New | |
| `mobile/src/screens/PreferencesScreen.tsx` | New | |
| `mobile/src/screens/AboutScreen.tsx` | New | |

---

## Out of Scope

- `useBudgets` integration with `budget_cycle_start_day` (follow-on task)
- Email address change
- Avatar image upload
- Android currency picker (ActionSheetIOS is iOS-only; Android fallback is a follow-on task)
- Dark/light theme toggle
