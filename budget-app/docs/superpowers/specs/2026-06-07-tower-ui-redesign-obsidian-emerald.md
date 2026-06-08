# Tower UI Redesign — Obsidian Emerald

**Date:** 2026-06-07  
**Scope:** Pure visual/layout redesign. Zero changes to business logic, hooks, data flow, navigation routing, or existing tests.

---

## Design System

### Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#09090c` | Screen background |
| `--s1` | `#111116` | Surface (cards, modals) |
| `--s2` | `#18181f` | Elevated surface |
| `--b1` | `#1f1f28` | Primary border / rule |
| `--b2` | `#2a2a36` | Secondary border |
| `--w` | `#ece8f8` | Primary text (lavender-white) |
| `--w2` | `rgba(236,232,248,0.52)` | Secondary text |
| `--w3` | `rgba(236,232,248,0.28)` | Tertiary text |
| `--w4` | `rgba(236,232,248,0.14)` | Labels / captions |
| `--emerald` | `#34d399` | Brand accent · wellness · positive signals |
| `--emerald-bg` | `rgba(52,211,153,0.10)` | Tinted background |
| `--emerald-bd` | `rgba(52,211,153,0.18)` | Tinted border |
| `--rose` | `#f0a8a8` | Negative / over-budget / error |
| `--rose-bg` | `rgba(240,168,168,0.08)` | Rose tinted background |
| `--rose-bd` | `rgba(240,168,168,0.18)` | Rose tinted border |
| `--sky` | `#96cfe8` | Category tint (Rent) |
| `--amber` | `#e8c87a` | Goal at-risk signal |

Add these to `src/theme.ts` (new file). All screens import from this file — no more hardcoded hex values per-StyleSheet.

### Typography Scale

| Usage | Size | Weight | Color |
|-------|------|--------|-------|
| Balance hero | 50px | 800 | `--w` |
| Screen title | 21px | 700 | `--w` |
| Section label (MICRO) | 8.5px | 500 | `--w4` · 0.13em tracking · uppercase |
| Body / row | 11–12px | 400–500 | `--w2` |
| Amounts (tabular) | 10–18px | 600–700 | `--w2` · `font-variant-numeric: tabular-nums` |
| Captions | 9–10px | 400 | `--w3`–`--w4` |

---

## Screen-by-Screen Changes

### HomeScreen

**Remove:**
- "on track" status pill from balance hero
- Current `#0f172a` / `#1e293b` / `#6366f1` color scheme
- Carousel budget tiles (replaced by flat bucket list)
- Card-wrapped sections

**Add:**
- `TOWER` wordmark (11px, 700, 0.18em tracking, `--w4`) above balance
- Balance: `$4,218` at 50px/800 weight, `.44` cents at 22px/300 weight in `--w3`
- Meta line: `June 2026 · 7 days left` in `--w3`, no status pill
- Wellness block: score number (32px, `--emerald`) + 7-day sparkline bar chart (7 bars, `--emerald` at varying opacity) — replaces current carousel sparkline approach
- Bucket list: rank number · name · `$spent / $total` in tabular-nums. No progress bars. Over-budget row gets `--rose-bg` background tint.
- Transaction list: date column (Jun / 06) · merchant · category · amount. Bank-statement density.
- Section separators: 1px `--b1` rules, no card wrappers

**Unchanged:** all data hooks (`useTransactions`, `useWellnessScore`, `useBudgets`, `useIncome`), transaction tap → detail modal, wellness tap → `WellnessDetailSheet`

---

### PlanScreen

**Remove:**
- Three-tab internal nav (`buckets | goals | income`)
- Fixed charges as a standalone scrollable section on the Plan surface
- `#6366f1` accent throughout

**Add:**
- Tappable income strip at top of screen: shows total + source names. Tap → bottom-sheet modal (`IncomeModal`) with confirmed sources, suggested sources, + add button. Same as existing `IncomeTab` component, now rendered in a modal.
- Two-segment control: `Buckets | Goals` (replaces three-tab nav)
- **Buckets segment:** drag-handle · pastel dot · name · percentage (18px bold) · dollar amount. Unallocated row at 30% opacity. `+ Add bucket` row at bottom.
- **Goals segment:** goal name · target amount · saved / % · target date · 2px progress bar · on-track/at-risk status. `+ Add goal` row at bottom.

**Unchanged:** all bucket CRUD (`createBudget`, `updateBudget`, `deleteBudget`, `deleteBudgetWithRedistribution`, `rebalanceBucketPct`, `updateBucketRanks`), all goal logic (`useGoals`, `previewGoalAllocation`, `commitGoalAllocation`), all income CRUD (`confirmIncomeSource`, `dismissIncomeSource`, `addManualIncomeSource`, `deleteIncomeSource`), `BucketDetailModal` (fixed charges live here unchanged), `AddBudgetModal`, `AddGoalModal`, `AddIncomeModal`

---

### ReportScreen → SpendScreen

**Rename:** file `ReportScreen.tsx` → `SpendScreen.tsx`, route name `Report` → `Spend`

**Reskin only:**
- Screen title: "Spend"
- Tab bar label: "Spend"
- Period nav (‹ Jun 2026 ›) stays at top right
- Three hero numbers: Earned / Spent / Saved in a horizontal row (20px bold)
- Sankey SVG: re-skin strokes to emerald/sky/rose/amber pastel palette at low opacity. No logic change.
- Category breakdown: 1.5px hairline bars per category with per-category pastel tint. Same data, same ordering.

**Unchanged:** all `ReportScreen` data logic, Sankey layout computation, category aggregation

---

### SettingsScreen (hub)

**Remove:**
- Colored icon tiles (🏦 🔔 etc.)
- Current `#6366f1` back-link color

**Add:**
- Section group labels (`ACCOUNTS`, `PREFERENCES`, `ABOUT`) at 8.5px uppercase `--w4`
- Plain rows: label · right side (chevron + optional secondary label or error text)
- Profile strip at top: monogram avatar (initials, `--emerald` text on `--s2` bg) · name · email · chevron
- `Income Sources` row added under Accounts (second entry point to `IncomeModal`)
- Error badge on Linked Accounts: "1 error" in `--rose` inline text (no badge component)

**Unchanged:** all navigation (goBack, navigate), sign-out logic, profile fetch

---

### ProfileScreen

**Reskin:** back nav (‹ Settings), field group cards for display name (editable) / email (readonly), Change Password button in `--emerald`

**Unchanged:** all save logic, `supabase.auth.updateUser`, password reset flow

---

### NotificationsScreen

**Reskin:** toggle rows with custom pill component (34×20px, `--emerald` when on, `--b2` when off, white knob). Removes `Switch` from React Native — replaces with styled `TouchableOpacity` pill to match theme.

**Unchanged:** all toggle state logic, `supabase` preference updates

---

### PreferencesScreen

**Reskin:** day picker circles use `--emerald` bg when selected. Currency row shows current value inline. ActionSheet trigger unchanged (iOS only).

**Unchanged:** all `budget_cycle_start_day` / `currency` update logic

---

### AboutScreen

**Reskin:** version row + three link rows in consistent `--s1` group card. No icon tiles.

**Unchanged:** `Linking.openURL`, version read from `Constants.expoConfig?.version`

---

### LinkedAccountsScreen

**Rename heading:** "Accounts"

**Reskin:**
- Institution cards: institution name + inline `--rose` error text if `has_error`
- Account rows: name · type · masked number
- Reconnect button: `--rose-bg` / `--rose-bd` tinted row
- `+ Add Account` dashed border row at bottom

**Unchanged:** all Plaid link/exchange/sync/remove logic, `has_error` detection, `usePlaidItems`, `useAccounts`

---

### AuthScreen

**Reskin:**
- `TOWER` wordmark in `--w4` tracked caps at top
- Input fields: `--s1` bg, `--b1` border, 9px uppercase label above value
- Primary CTA: white bg, `--bg` text (solid, high contrast)
- Google / Apple buttons: `--s1` bg, `--b1` border, `--w2` text with inline SVG logo
- Password strength bar: 4 segments, `--emerald` when filled
- "Sign in" / "Create account" toggle link in `--emerald` at 80% opacity
- Email confirmation screen: reskin only

**Unchanged:** all auth logic (`signInWithEmail`, `signUpWithEmail`, `signInWithApple`, `signInWithGoogle`), password strength scoring, form validation

---

### WellnessDetailSheet

**Reskin:**
- Score number: 36px, `--emerald`
- Sparkline polyline + end dot: `--emerald` at 60% / 80% opacity
- Factor dots: per-category pastel tints
- Over-budget factor `%`: `--rose`; on-track factor `%`: `--emerald` at 80%

**Unchanged:** all score computation, `ExpandedSparkline` chart logic, `FactorRow` transaction lookup, modal open/close

---

### FloatingTabBar

**Replace:** emoji/symbol icons (⌂ ◫ ↗ ⚙) → SVG line icons (house, document-list, waveform, gear)

**Tab labels:** Home · Plan · Spend · Settings

**Unchanged:** tab press handlers, active state detection

---

## Navigation

**One route rename:** `Report` → `Spend`

Update in:
- `App.tsx` (stack/tab navigator definition)
- Any `navigation.navigate('Report')` call (grep for occurrences)
- `FloatingTabBar` active tab detection

---

## New File

**`src/theme.ts`** — exports all color tokens and typography constants as a typed object. All screens import from here. This is the only new file.

---

## What Does NOT Change

- All business logic, hooks, utility functions
- All Supabase queries and mutations
- All WatermelonDB schema and models
- All Plaid integration
- All existing tests (211 tests must continue to pass)
- Navigation structure (same 4 tabs, same sub-screens)
- All modal open/close logic
- All gesture handlers (drag-to-sort, percent slider)

---

## Testing

- All 211 existing tests must pass after implementation
- No new tests required: this is a pure visual change
- Verify: tap income strip opens modal, Buckets/Goals segment switches, wellness tap opens detail sheet, all nav routes work
