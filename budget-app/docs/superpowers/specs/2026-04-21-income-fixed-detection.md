# Income & Fixed Item Detection — Design Spec

**Goal:** Automatically detect recurring income sources and fixed recurring charges from Plaid transaction history, surface them to the user for confirmation, and keep budget floors in sync.

**Architecture:** Two pure async functions (`detectIncomeSources`, `detectFixedItems`) run on every Plaid sync. Four exported hook functions and two React hooks expose read and write access to the Supabase tables. `backgroundSync.ts` orchestrates the full pipeline.

**Tech Stack:** React Native (Expo), WatermelonDB (local cache), Supabase JS v2, TypeScript.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Income Detection Algorithm](#3-income-detection-algorithm)
4. [Fixed Item Detection Algorithm](#4-fixed-item-detection-algorithm)
5. [useIncome Hook](#5-useincome-hook)
6. [useFixedItems Hook](#6-usefixeditems-hook)
7. [Known Issues](#7-known-issues)
8. [Test Coverage](#8-test-coverage)

---

## 1. Overview

After each Plaid sync the app scans the local WatermelonDB transaction cache to find:

- **Income sources** — recurring credits (deposits) on depository accounts that repeat biweekly or monthly with a consistent merchant name.
- **Fixed items** — recurring debits that appear in two or more consecutive calendar months from the same merchant with an amount variance of 5% or less.

Candidates are written to Supabase as unconfirmed suggestions. The user confirms or dismisses each one in the Plan screen. Confirmed income sources feed `confirmedMonthlyIncome`; confirmed fixed items drive the `monthly_floor` of their budget category.

---

## 2. Architecture

```
backgroundSync.syncStaleItems()
  └── syncTransactions()          — Plaid → WatermelonDB
  └── detectIncomeSources()       — incomeDetector.ts → income_sources table
  └── detectFixedItems()          — fixedItemClassifier.ts → fixed_items table
  └── checkBudgetAlerts()         — budgetAlerts.ts
  └── checkGoalFeasibility()      — goals/checkGoalFeasibility.ts
```

Each detector is called with a fire-and-forget `.catch(() => {})` wrapper so a failure in one does not block the others.

### Files

| File | Responsibility |
|---|---|
| `src/plaid/incomeDetector.ts` | Groups deposits by merchant+account, scores frequency, upserts to `income_sources` |
| `src/plaid/fixedItemClassifier.ts` | Groups debits by merchant+category, checks consecutive months and amount variance, upserts to `fixed_items` |
| `src/plaid/backgroundSync.ts` | Orchestrates sync pipeline; calls both detectors after transaction sync |
| `src/hooks/useIncome.ts` | React hook + standalone async actions for `income_sources` |
| `src/hooks/useFixedItems.ts` | React hook + standalone async actions for `fixed_items` |

### Supabase Tables

**`income_sources`** columns used by this feature:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → auth.users |
| `name` | text | Raw merchant name from last seen transaction |
| `amount_monthly` | numeric | Annualised monthly equivalent |
| `frequency` | text | `'biweekly'` \| `'monthly'` \| `'manual'` |
| `source_account_id` | text | Plaid account ID |
| `is_confirmed` | bool | User-confirmed flag |

Upsert conflict key: `(user_id, name, source_account_id)`.

**`fixed_items`** columns used by this feature:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → auth.users |
| `category_id` | uuid | FK → `budget_categories.id` |
| `merchant_name` | text | Raw merchant name from last seen transaction |
| `detected_amount` | numeric | Average of qualifying monthly amounts |
| `confirmed_amount` | numeric \| null | User-overridden amount; null until user sets it |
| `last_seen_date` | date | Date of most recent qualifying transaction |
| `is_confirmed` | bool | User-confirmed flag |
| `needs_review` | bool | Set true when confirmed amount drifts >5% |

Upsert conflict key: `(user_id, category_id, merchant_name)`.

---

## 3. Income Detection Algorithm

**Source:** `src/plaid/incomeDetector.ts`

### Constants

| Constant | Value | Meaning |
|---|---|---|
| `MIN_OCCURRENCES` | 3 | Minimum number of matching transactions required |
| `BIWEEKLY_MIN_DAYS` | 12 | Minimum gap in days for biweekly classification |
| `BIWEEKLY_MAX_DAYS` | 18 | Maximum gap in days for biweekly classification |
| `MONTHLY_MIN_DAYS` | 25 | Minimum gap in days for monthly classification |
| `MONTHLY_MAX_DAYS` | 35 | Maximum gap in days for monthly classification |
| `BIWEEKLY_TO_MONTHLY` | 26 / 12 ≈ 2.167 | Multiplier to annualise biweekly pay to a monthly figure |

### Step 1 — Filter to depository credits

Reads all `accounts` from WatermelonDB; builds a set of `plaidAccountId` values where `type === 'depository'`. Reads all non-pending transactions from WatermelonDB and keeps only those where `amount < 0` (Plaid convention for credits/deposits) and `accountId` is in the depository set.

### Step 2 — Group by normalized merchant + account

**`normalizeMerchant(name)`** — lowercases, strips all non-alphanumeric characters (keeps spaces), trims. Used to collapse minor punctuation or casing differences.

Group key: `normalizeMerchant(merchantName) + '__' + accountId`.

Groups with fewer than `MIN_OCCURRENCES` transactions are skipped.

### Step 3 — Frequency detection (`detectFrequency`)

Sorts the transactions within each group by date (ascending). Computes the gap in days between each consecutive pair. If **every** gap falls within `[BIWEEKLY_MIN_DAYS, BIWEEKLY_MAX_DAYS]`, the group is classified `'biweekly'`. If **every** gap falls within `[MONTHLY_MIN_DAYS, MONTHLY_MAX_DAYS]`, it is classified `'monthly'`. Any group with mixed gaps returns `null` and is discarded.

### Step 4 — Monthly amount computation

- Computes the absolute average of all transaction amounts in the group.
- Biweekly: `avgAmount × (26 / 12)` rounded to two decimal places.
- Monthly: `avgAmount` rounded to two decimal places.

The `name` field is taken from the most recent transaction's `merchantName` (raw, un-normalized).

### Step 5 — Confirmed-row guard

Fetches existing `income_sources` for the user from Supabase. Builds a set of keys (`normalizeMerchant(name) + '__' + source_account_id`) for all rows where `is_confirmed = true`. Any detected source whose key appears in this set is excluded from the upsert so confirmed rows are never overwritten.

### Step 6 — Upsert

Upserts all remaining candidates with `is_confirmed: false`. The conflict key `(user_id, name, source_account_id)` allows the detected amount and frequency to be updated on each sync.

---

## 4. Fixed Item Detection Algorithm

**Source:** `src/plaid/fixedItemClassifier.ts`

### Constants

| Constant | Value | Meaning |
|---|---|---|
| `MIN_MONTHS` | 2 | Minimum number of consecutive calendar months required |
| `AMOUNT_VARIANCE_PCT` | 0.05 | Maximum allowed proportional deviation from the base month amount |

Note: the spec brief states `MIN_MONTHS = 3` but the implementation uses `2`. The implementation is authoritative.

### Step 1 — Filter to settled debits

Reads all non-pending transactions from WatermelonDB where `amount > 0` (Plaid convention for debits/charges).

### Step 2 — Resolve categories

Fetches `budget_categories` for the user from Supabase and builds a `Map<lowerCaseName, id>`. Transactions whose `categoryL1` does not match a known category are skipped.

### Step 3 — Group by normalized merchant + categoryL1

Group key: `normalizeMerchant(merchantName) + '__' + categoryL1`. Uses the same `normalizeMerchant` implementation as `incomeDetector.ts` (duplicated; see issue #71).

### Step 4 — Bucket into calendar months

For each group, buckets transactions by `YYYY-MM` (first 7 characters of the `YYYY-MM-DD` date string). Multiple transactions in the same month are averaged. Groups with fewer than `MIN_MONTHS` distinct calendar months are skipped.

### Step 5 — Consecutive month check

Iterates sorted `YYYY-MM` keys. For each pair, computes `monthDiff = (y2 - y1) * 12 + (m2 - m1)`. If `monthDiff !== 1` the consecutive counter resets to 1 and only the current month's amount is retained. A group is eligible only if `consecutiveCount >= MIN_MONTHS` after the full pass.

### Step 6 — Amount variance check

Takes the first qualifying month's average as `baseAmount`. Checks that every subsequent month's average satisfies:

```
|amount - baseAmount| / baseAmount <= AMOUNT_VARIANCE_PCT
```

Groups that fail this check are discarded.

### Step 7 — Upsert with drift detection

`detectedAmount` is the average of qualifying monthly amounts, rounded to two decimal places.

**For unconfirmed rows** (or new candidates): upserts `{ is_confirmed: false, needs_review: false }` with the detected amount.

**For confirmed rows**: compares `detectedAmount` against `confirmed_amount ?? detected_amount` (the stored reference). If the drift exceeds `AMOUNT_VARIANCE_PCT`, sets `needs_review: true` on the existing row. If within variance, updates only `detected_amount` and `last_seen_date`. In neither case is `is_confirmed` changed to `false`.

Conflict key: `(user_id, category_id, merchant_name)`.

---

## 5. useIncome Hook

**Source:** `src/hooks/useIncome.ts`

### Hook return value

```typescript
{
  sources: IncomeSource[];            // all rows for the user, ordered by created_at
  confirmedMonthlyIncome: number;     // sum of amountMonthly for confirmed sources only
  reload: () => void;                 // re-fetches from Supabase
}
```

`IncomeSource` shape:

| Field | Type |
|---|---|
| `id` | string |
| `name` | string |
| `amountMonthly` | number |
| `frequency` | `'biweekly'` \| `'monthly'` \| `'manual'` |
| `sourceAccountId` | `string \| null` |
| `isConfirmed` | boolean |

### Confirmed vs pending sources

Callers obtain confirmed and pending sources by filtering `sources`:

```typescript
const confirmed = sources.filter(s => s.isConfirmed);
const pending   = sources.filter(s => !s.isConfirmed);
```

`confirmedMonthlyIncome` is a `useMemo` over `sources` and is recomputed automatically when `sources` state changes.

### Standalone async actions

| Function | Supabase operation | Notes |
|---|---|---|
| `confirmIncomeSource(id)` | `UPDATE is_confirmed = true` | Caller must call `reload()` after |
| `dismissIncomeSource(id)` | `DELETE` row | Permanently removes the suggestion |
| `addManualIncomeSource(name, amountMonthly)` | `INSERT` with `frequency: 'manual', is_confirmed: true` | Requires authenticated user |
| `updateIncomeSource(id, { name?, amountMonthly? })` | `UPDATE` with provided fields | Partial update; ignores undefined fields |
| `deleteIncomeSource(id)` | `DELETE` row | Used for confirmed rows the user wants to remove |

---

## 6. useFixedItems Hook

**Source:** `src/hooks/useFixedItems.ts`

### Hook return value

```typescript
{
  items: FixedItem[];           // all rows for the user, ordered by merchant_name
  pendingReview: FixedItem[];   // items where !isConfirmed OR needsReview
  reload: () => void;
}
```

`FixedItem` shape:

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `categoryId` | string | |
| `merchantName` | string | |
| `detectedAmount` | number | Raw detected value |
| `confirmedAmount` | `number \| null` | User-set override; null if not set |
| `effectiveAmount` | number | `confirmedAmount ?? detectedAmount` |
| `lastSeenDate` | `string \| null` | ISO date string |
| `isConfirmed` | boolean | |
| `needsReview` | boolean | True when confirmed amount has drifted >5% |

`pendingReview` includes both unconfirmed suggestions (`!isConfirmed`) and confirmed items flagged for re-review (`needsReview`). It is computed synchronously from `items` state on every render, not stored separately.

### recomputeFloor

`recomputeFloor(categoryId)` is a standalone async function (not part of the hook) that:

1. Fetches all rows from `fixed_items` where `category_id = categoryId` and `is_confirmed = true`.
2. Sums `confirmed_amount ?? detected_amount` for each row.
3. Writes the result to `budget_categories.monthly_floor` for that category.

This is called by UI after any confirm, dismiss, or amount-update action so the floor stays current.

### Standalone async actions

| Function | Supabase operation | Notes |
|---|---|---|
| `confirmFixedItem(id, confirmedAmount?)` | `UPDATE is_confirmed = true, needs_review = false` | Optionally stores a user-supplied amount |
| `dismissFixedItem(id)` | `DELETE` row | |
| `updateFixedItemAmount(id, confirmedAmount)` | `UPDATE confirmed_amount, needs_review = false` | Clears the review flag |
| `recomputeFloor(categoryId)` | `SELECT` confirmed items → `UPDATE budget_categories.monthly_floor` | See above |

---

## 7. Known Issues

### #61 — Missing user_id scope on WatermelonDB transaction query in `checkBudgetAlerts`

`detectIncomeSources` and `detectFixedItems` both fetch *all* transactions from WatermelonDB without filtering by user. If a device has transactions for multiple users cached locally (e.g. after an account switch without a cache clear), the detectors will mix transactions across users. The `user_id` guard only applies at the Supabase upsert step, not at the local query step.

### #71 — normalizeMerchant duplicated across detectors

`normalizeMerchant` is defined identically in both `incomeDetector.ts` and `fixedItemClassifier.ts`. A divergence between the two copies would cause the income and fixed-item systems to disagree on merchant identity for the same transaction stream. The function should be extracted to a shared utility.

### #56 — recomputeFloor includes unconfirmed items when is_confirmed filter is missing

The `recomputeFloor` query correctly adds `.eq('is_confirmed', true)`. However, callers that manually sum `effectiveAmount` from the full `items` array (rather than calling `recomputeFloor`) will include unconfirmed items in their totals because `pendingReview` contains both confirmed-needs-review and unconfirmed rows.

---

## 8. Test Coverage

### What is tested

There are no unit test files for `incomeDetector.ts`, `fixedItemClassifier.ts`, `useIncome.ts`, or `useFixedItems.ts` in the repository at this time.

### What is missing

| Gap | Priority |
|---|---|
| `detectFrequency` — biweekly classification, monthly classification, mixed gaps return null, fewer than MIN_OCCURRENCES returns null | High |
| `normalizeMerchant` — punctuation stripping, case folding, whitespace trim | Medium |
| `detectIncomeSources` — confirmed-row guard (does not overwrite confirmed rows), biweekly monthly conversion factor, upsert payload shape | High |
| `detectFixedItems` — consecutive month reset on gap, amount variance boundary (exactly 5%, just over 5%), drift detection sets `needs_review`, non-consecutive months discarded | High |
| `useIncome` — `confirmedMonthlyIncome` sums only confirmed rows, `reload` re-fetches from Supabase | Medium |
| `useFixedItems` — `pendingReview` includes `needsReview` rows, `effectiveAmount` falls back to `detectedAmount` when `confirmedAmount` is null | Medium |
| `recomputeFloor` — floor is zero when no confirmed items exist, `confirmed_amount` is preferred over `detected_amount` | Medium |
