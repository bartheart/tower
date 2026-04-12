ALTER TABLE budget_categories
  ADD COLUMN IF NOT EXISTS target_pct FLOAT;

COMMENT ON COLUMN budget_categories.target_pct IS
  'Optional: percentage of monthly income this category targets (0–100). NULL means excluded from wellness score.';
