-- Separates bucket display name from the Plaid category label used for spend matching.
-- A bucket named "Eating Out" can now map to Plaid's "Food and Drink" transactions
-- without requiring an exact name match.
-- Nullable: existing rows fall back to name-based matching (backward compatible).

alter table public.budget_categories
  add column if not exists plaid_category text;

comment on column public.budget_categories.plaid_category is
  'Plaid categoryL1/L2 label this bucket captures (e.g. "Food and Drink"). NULL = match on name.';
