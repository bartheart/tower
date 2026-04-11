# Personal Budgeting Dashboard — Design Spec

**Date:** 2026-04-11  
**Status:** Approved  
**Author:** Brainstorming session

---

## 1. Overview

A personal finance app for one user (the builder) that links real US bank accounts and credit cards via Plaid, visualizes spending as a dynamic multi-level Sankey diagram, tracks budget envelopes, and monitors savings goals. Mobile-first (iOS + Android), with a secondary web dashboard.

**Core philosophy:** The app answers two questions — *where am I now?* (Home) and *where am I headed?* (Plan). Everything else is clutter.

---

## 2. Goals & Non-Goals

### Goals (v1)
- Link real bank accounts and credit cards via Plaid
- Sync transactions automatically (webhook-driven, not real-time polling)
- Display multi-level Sankey flow: Income → Categories → Sub-categories → Merchants
- Track monthly budget envelopes per category
- Track savings goals with projected completion dates
- Track paycheck / income alongside spending
- Mobile app (iOS + Android) as primary surface
- Web dashboard (Next.js) as secondary surface for overview

### Non-Goals (v1 — add later)
- Bill reminders / recurring transaction detection
- Net worth / investment tracking
- AI-powered insights
- Multi-user support
- Real-time transaction updates (sync on webhook, not live)
- Manual transaction entry

---

## 3. Stack

| Layer | Technology | Rationale |
|---|---|---|
| Mobile | React Native + Expo (TypeScript) | Official Plaid SDK, OTA updates, fast iteration |
| On-device DB | WatermelonDB (SQLite) | All sensitive financial data stays on-device |
| Cloud DB / Auth | Supabase (Postgres) | Non-sensitive metadata only; free tier sufficient |
| Bank linking | Plaid Link SDK | US standard, returns categories + merchant names |
| Webhook handler | Supabase Edge Function | Always-warm serverless, no cold start |
| Web dashboard | Next.js on Render | Secondary surface; cold starts acceptable |
| Push notifications | Expo Push Notifications | Triggered by Edge Function on Plaid webhook |

---

## 4. Data Architecture — Hybrid Split

### On-device only (WatermelonDB / SQLite)
Anything that touches Plaid never leaves the device:
- `transactions` — id, amount, merchant_name, category_l1, category_l2, date, account_id, pending
- `accounts` — id, name, type (checking/savings/credit), current_balance, available_balance, institution_name
- `plaid_items` — item_id, access_token, institution_id, last_synced_at
- `plaid_cursor` — per-item sync cursor for `/transactions/sync`

### Supabase (non-sensitive metadata)
- `users` — id, email (auth managed by Supabase)
- `budget_categories` — id, user_id, name, emoji, monthly_limit, color
- `savings_goals` — id, user_id, name, emoji, target_amount, current_amount, target_date
  - `current_amount` is user-entered (manually updated), not derived from Plaid balances — it is a goal milestone tracker, not a financial balance
- `app_preferences` — theme, default_date_range, notification_settings

**Rule:** Supabase never receives transaction amounts, merchant names, balances, or account numbers.

---

## 5. Navigation

Three-tab bottom navigation:

| Tab | Purpose |
|---|---|
| **Home** | Current financial state — balance, paycheck, Sankey flow, recent transactions |
| **Plan** | Forward-looking — budget envelopes, savings goals, end-of-month projection |
| **Settings** | Linked accounts (Plaid), categories, profile |

Modal / stack screens: transaction detail, add/edit budget, add/edit goal, Plaid Link flow, category picker.

---

## 6. Home Screen

**Header:** Net balance across all accounts (large, light weight), institution names below.

**Paycheck row:** Three pills side by side — Income (green), Spent (neutral), Free (indigo). Values pulled from local transaction data for the current month.

**Sankey Flow Chart (`WHERE IT'S GOING`):**
- Built with `react-native-svg` + D3-sankey layout computed on-device
- 3 levels: Income → Categories → Sub-categories → Merchants (collapsible)
- Node data: aggregated from `transactions` grouped by `(category_l1, category_l2, merchant_name)`
- Flow width proportional to dollar amount
- Tap a node: expand/collapse its children
- Tap a flow: navigate to filtered transaction list for that node
- Recomputed after each Plaid sync — not real-time
- Plaid's `personal_finance_category` field provides the category hierarchy automatically

**Recent Transactions:** Flat list, 5–10 most recent, merchant name + category + amount. Tap → transaction detail modal.

---

## 7. Plan Screen

**End-of-month projection:** Banner at top — projected remaining balance based on current spend rate vs. budget. Simple linear extrapolation from days elapsed.

**Budget Envelopes:** Vertical list of category cards. Each shows:
- Category name + emoji
- Spent vs. limit (e.g. `$320 / $400`)
- Thin progress bar, color-coded: green (<70%), yellow (70–90%), red (>100%)
- Over-budget categories float to top

**Savings Goals:** Cards below budgets. Each shows:
- Goal name + emoji
- Progress bar + percentage
- Projected completion date (calculated from average monthly contribution)

---

## 8. Key Flows

### Bank Linking
1. User taps "Add Account" in Settings
2. Plaid Link SDK opens as modal
3. User authenticates with their bank
4. On success: `access_token` + `item_id` stored in WatermelonDB (`plaid_items`)
5. App immediately calls `/transactions/sync` to fetch initial transaction history
6. Transactions stored in WatermelonDB

### Transaction Sync (ongoing)
1. Plaid fires webhook to Supabase Edge Function URL
2. Edge Function receives `SYNC_UPDATES_AVAILABLE` event, extracts `item_id`
3. Edge Function sends Expo push notification to device (no financial data in payload — just item_id)
4. App receives notification, wakes, reads local `access_token` for that `item_id`
5. App calls Plaid `/transactions/sync` with stored cursor
6. New/modified/removed transactions written to WatermelonDB
7. Cursor updated; Sankey + budget calculations refresh

**Fallback:** If the device is offline when the push notification fires, the app performs a full sync on next foreground resume — checks each `plaid_item`'s `last_synced_at` and re-runs `/transactions/sync` if stale (>15 min).

### Sankey Rendering
1. On Home screen mount, query WatermelonDB: `SELECT category_l1, category_l2, merchant_name, SUM(amount)` for current month
2. Build node/link graph in JS: Income node → category nodes → sub-category nodes → merchant nodes
3. Run D3-sankey layout algorithm to compute node positions and bezier paths
4. Render via `react-native-svg` — no WebView
5. On each Plaid sync completion, re-run steps 1–4

---

## 9. Hosting & Infrastructure

| Service | Provider | Tier |
|---|---|---|
| Supabase (auth + metadata DB) | Supabase | Free |
| Plaid webhook receiver | Supabase Edge Function | Free (500K invocations/month) |
| Next.js web dashboard | Render (existing account) | Free (cold starts acceptable) |
| Mobile builds | Expo EAS | Free tier |
| Plaid | Plaid | Development (free), Production (~$500/mo flat or per-item) |

**Single user note:** All free tiers are sufficient indefinitely for personal use. Plaid Development tier allows up to 100 Items (linked accounts) for free.

---

## 10. Effort Estimate

| Phase | Work | Estimate |
|---|---|---|
| 1 | Supabase setup, auth, DB schema, Expo project bootstrap | 1–2 weeks |
| 2 | Plaid Link integration, WatermelonDB schema, `/transactions/sync` flow, webhook handler | 2–3 weeks |
| 3 | Mobile UI — Home screen, Sankey chart, Plan screen, Settings | 3–4 weeks |
| 4 | Next.js web dashboard on Render | 2–3 weeks |
| **Total** | | **8–12 weeks** |

Frontend design agent handles visual polish (typography, spacing, color system, animations) — not included in above estimate as it runs in parallel with Phase 3.

---

## 11. Technical Risks

| Risk | Mitigation |
|---|---|
| D3-sankey in React Native (no DOM) | Use `d3-sankey` layout algorithm only (pure JS, no DOM); render output via `react-native-svg` |
| Plaid webhook delivery to Supabase Edge Function | Edge Functions are always-warm; register webhook URL in Plaid dashboard during setup |
| WatermelonDB migration complexity as schema evolves | Define schema versioning from day 1; WatermelonDB has built-in migration support |
| Plaid Development → Production upgrade needed if sharing with others | v1 is personal only; no upgrade needed |
| Expo EAS build limits on free tier | Free tier allows 30 builds/month — more than enough for personal development |
