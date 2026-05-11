# Budget Alerts — Design Spec

**Goal:** Fire a local push notification once per calendar month when a user's month-to-date spending in any budget category reaches 80% or more of that category's monthly limit.

**Architecture:** A single async function (`checkBudgetAlerts`) runs at the end of every Plaid sync. It reads categories from Supabase, computes spend from the local WatermelonDB cache, and fires notifications via `expo-notifications`. Deduplication is handled with `expo-secure-store`.

**Tech Stack:** React Native (Expo), WatermelonDB (local cache), Supabase JS v2, `expo-notifications`, `expo-secure-store`, TypeScript.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Alert Logic](#3-alert-logic)
4. [Notification Format](#4-notification-format)
5. [Known Issues](#5-known-issues)
6. [Test Coverage](#6-test-coverage)

---

## 1. Overview

After each Plaid sync, `checkBudgetAlerts` is called with the current user's ID. It computes month-to-date spending per budget category from locally cached transactions, compares each total to that category's `monthly_limit`, and schedules an immediate local notification for any category that has crossed the 80% threshold. A per-category, per-calendar-month key in `SecureStore` prevents the same alert from firing more than once in a given month.

---

## 2. Architecture

```
backgroundSync.syncStaleItems()
  └── syncTransactions()
  └── detectIncomeSources()
  └── detectFixedItems()
  └── checkBudgetAlerts(user.id)    ← this feature
  └── checkGoalFeasibility(user.id)
```

`checkBudgetAlerts` is called with `.catch(() => {})` so a failure does not block other post-sync steps.

### Files

| File | Responsibility |
|---|---|
| `src/notifications/budgetAlerts.ts` | Alert logic — spend aggregation, threshold check, notification dispatch, dedup |
| `src/plaid/backgroundSync.ts` | Calls `checkBudgetAlerts` after every sync cycle |

### External Dependencies

| Dependency | Usage |
|---|---|
| `expo-notifications` | `scheduleNotificationAsync` with `trigger: null` (immediate) |
| `expo-secure-store` | `getItemAsync` / `setItemAsync` for monthly dedup keys |
| WatermelonDB `database` | Local transaction cache |
| Supabase JS | Fetches `budget_categories` for the user |

### Notification Handler

`backgroundSync.setupNotificationHandler()` registers a global handler that shows banners, lists, and plays sound for notifications with `data.type === 'budget_alert'`. The handler is set up once at app start and covers all budget alert notifications.

---

## 3. Alert Logic

**Source:** `src/notifications/budgetAlerts.ts`

### Constants

| Constant | Value | Meaning |
|---|---|---|
| `ALERT_THRESHOLD` | 0.8 | Fraction of `monthly_limit` at which an alert fires (80%) |

### Step 1 — Auth guard

Calls `supabase.auth.getUser()`. Returns immediately if no user is authenticated.

### Step 2 — Fetch budget categories

Fetches `id`, `name`, and `monthly_limit` from `budget_categories` filtered by `user_id`. Returns immediately if no categories are found.

### Step 3 — Determine current month date range

Computes `monthStart` (`YYYY-MM-01`) and `monthEnd` (first day of the following month) as `YYYY-MM-DD` strings using `Date` arithmetic. December rolls over correctly: `month === 11` produces `nextYear = year + 1` and `nextMonthStr = '01'`.

### Step 4 — Fetch current month's transactions

Queries WatermelonDB for transactions matching:

```
user_id = userId
AND date >= monthStart
AND date < monthEnd
```

The `date` field is stored as a `YYYY-MM-DD` string (Plaid format), so WatermelonDB string comparison is used directly rather than a timestamp.

### Step 5 — Build spend map (pending exclusion)

Iterates transactions. Skips any transaction where `amount <= 0` (credits/income) or `pending === true`. For each qualifying transaction:

- Adds `amount` to `spendMap[categoryL1]`.
- If `categoryL2` is set and differs from `categoryL1`, also adds `amount` to `spendMap[categoryL2]`.

This mirrors the spend aggregation logic in `useBudgets`.

### Step 6 — Threshold check and dedup

For each category:

1. Looks up `spent = spendMap.get(cat.name) ?? 0`.
2. If `cat.monthly_limit <= 0` or `spent / cat.monthly_limit < ALERT_THRESHOLD`, skips.
3. Checks `SecureStore.getItemAsync(alertKey(yearMonth, cat.id))`. If the key is present (value `'sent'`), skips — alert already sent this month.
4. Otherwise: fires the notification and writes `'sent'` to SecureStore.

The dedup key format is `budgetAlert:YYYY-MM:categoryId`.

### Spend map lookup — string match dependency

The spend map is keyed by the transaction's `categoryL1` or `categoryL2` string. The threshold check looks up `cat.name` in this map. An alert only fires if `cat.name` matches the string stored in `categoryL1` or `categoryL2` on the transactions exactly (case-sensitive). See issue #67.

---

## 4. Notification Format

All budget alert notifications are scheduled as immediate local notifications (`trigger: null`).

### Content

| Field | Value |
|---|---|
| `title` | `'Budget Alert'` |
| `body` | `"You've used {pct}% of your {cat.name} budget"` where `pct = Math.round((spent / limit) * 100)` |
| `data.type` | `'budget_alert'` |
| `data.categoryId` | The category's UUID |

### Example

```
Title: Budget Alert
Body:  You've used 84% of your Food and Drink budget
```

### Notification Handler Behaviour

The global handler in `backgroundSync.setupNotificationHandler()` shows banners, lists entries, and plays sound for `budget_alert` type notifications. Badge count is not modified (`shouldSetBadge: false`).

---

## 5. Known Issues

### #67 — String match bug and divide-by-zero on zero limit

Two bugs in the threshold check:

**String match bug:** The spend map is keyed by the raw `categoryL1`/`categoryL2` strings from Plaid transactions. The lookup uses `cat.name` from the `budget_categories` table. If the category name in Supabase does not exactly match the string Plaid stores in `categoryL1` (e.g. different casing, whitespace, or an abbreviated form), the lookup returns 0 and the alert never fires for that category even if spending is over the threshold.

**Divide-by-zero guard is one-sided:** The condition `limit <= 0` correctly skips categories with a zero or negative limit, preventing a divide-by-zero. However, a `monthly_limit` of `null` will cause `null <= 0` to evaluate to `false` in JavaScript (null coerces to 0, so `0 <= 0` is `true`), meaning null-limit categories are skipped. This is arguably correct behavior but is not explicitly documented or tested.

---

## 6. Test Coverage

**Source:** `src/notifications/__tests__/budgetAlerts.test.ts`

### What is tested

| Test | Assertion |
|---|---|
| Fires notification at exactly 80% spend | `scheduleNotificationAsync` called once with correct title, body containing category name, and `data.type = 'budget_alert'` |
| Does not fire below 80% (70% case) | `scheduleNotificationAsync` not called |
| Does not re-notify if SecureStore key already set | `scheduleNotificationAsync` not called when `getItemAsync` returns `'sent'` |
| Records notification in SecureStore after firing | `setItemAsync` called with key containing `cat.id` and value `'sent'` |
| Skips pending transactions | $400 pending + $100 settled = $100 total; no alert on a $500 limit |
| Fires separate notifications per category | Two over-threshold categories → two `scheduleNotificationAsync` calls |
| Does nothing when user is not authenticated | `scheduleNotificationAsync` not called when `getUser` returns null user |

### What is missing

| Gap | Priority |
|---|---|
| Category name string mismatch — `cat.name` vs `categoryL1` differ in casing; expect no alert | High (covers issue #67) |
| `monthly_limit = 0` — verify category is skipped, no divide-by-zero | High (covers issue #67) |
| `monthly_limit = null` — verify category is skipped | Medium |
| December roll-over — transactions in December produce `monthEnd = YYYY+1-01-01` correctly | Medium |
| Both `categoryL1` and `categoryL2` accumulate spend — transaction with a subcategory adds to both maps | Medium |
| `categoryL2 === categoryL1` — amount is not double-counted | Medium |
| No categories returned from Supabase — function returns without calling `scheduleNotificationAsync` | Low |
| SecureStore key format — key includes `YYYY-MM` and `categoryId` in the expected format | Low |
