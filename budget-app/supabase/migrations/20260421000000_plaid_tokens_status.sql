-- supabase/migrations/20260421000000_plaid_tokens_status.sql
alter table public.plaid_tokens
  add column if not exists status text not null default 'good';

-- allowed values: 'good' | 'error'
-- set by plaid-webhook edge function when ITEM_LOGIN_REQUIRED / ITEM_ERROR / CONSENT_EXPIRED fires
-- reset to 'good' by create-link-token when update mode link is issued
