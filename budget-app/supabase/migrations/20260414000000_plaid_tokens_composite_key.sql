-- Fix plaid_tokens unique constraint: item_id alone is not the right key.
-- The correct invariant is one token per (user, item) pair.
-- Plaid item_ids are globally unique in production but this was still
-- wrong in shape — a composite key makes the intent explicit and safe.

alter table public.plaid_tokens
  drop constraint if exists plaid_tokens_item_id_key;

alter table public.plaid_tokens
  add constraint plaid_tokens_user_id_item_id_key unique (user_id, item_id);
