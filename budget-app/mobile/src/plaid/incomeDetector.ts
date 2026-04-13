import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import Transaction from '../db/models/Transaction';
import Account from '../db/models/Account';
import { supabase } from '../supabase/client';

const BIWEEKLY_MIN_DAYS = 12;
const BIWEEKLY_MAX_DAYS = 18;
const MONTHLY_MIN_DAYS  = 25;
const MONTHLY_MAX_DAYS  = 35;
const MIN_OCCURRENCES   = 3;
// Biweekly annualisation: 26 pay periods / 12 months
const BIWEEKLY_TO_MONTHLY = 26 / 12;

type Frequency = 'biweekly' | 'monthly';

interface DetectedSource {
  name: string;
  amountMonthly: number;
  frequency: Frequency;
  sourceAccountId: string;
}

function normalizeMerchant(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function detectFrequency(sortedDates: string[]): Frequency | null {
  if (sortedDates.length < MIN_OCCURRENCES) return null;

  const gaps: number[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    const diff = (new Date(sortedDates[i]).getTime() - new Date(sortedDates[i - 1]).getTime())
      / (1000 * 60 * 60 * 24);
    gaps.push(diff);
  }

  // Check that every gap falls within the same frequency window
  const allBiweekly = gaps.every(g => g >= BIWEEKLY_MIN_DAYS && g <= BIWEEKLY_MAX_DAYS);
  const allMonthly  = gaps.every(g => g >= MONTHLY_MIN_DAYS  && g <= MONTHLY_MAX_DAYS);

  if (allBiweekly) return 'biweekly';
  if (allMonthly)  return 'monthly';
  return null;
}

/**
 * Runs after every Plaid sync. Reads WatermelonDB for credit transactions
 * (amount < 0) on depository accounts, detects recurring patterns, and
 * upserts unconfirmed income_source suggestions to Supabase.
 *
 * Never modifies already-confirmed rows.
 */
export async function detectIncomeSources(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Fetch all depository accounts
  const accounts = await database.get<Account>('accounts').query().fetch();
  const depositoryIds = new Set(
    accounts.filter(a => a.type === 'depository').map(a => a.plaidAccountId)
  );
  if (depositoryIds.size === 0) return;

  // Fetch all credit transactions (deposits: amount < 0 in Plaid convention)
  const allTxns = await database.get<Transaction>('transactions').query(
    Q.where('pending', false)
  ).fetch();

  const deposits = allTxns.filter(t => t.amount < 0 && depositoryIds.has(t.accountId));

  // Group by normalized merchant + account
  type GroupKey = string;
  const groups = new Map<GroupKey, { txns: Transaction[]; accountId: string }>();

  for (const txn of deposits) {
    const key = `${normalizeMerchant(txn.merchantName)}__${txn.accountId}`;
    if (!groups.has(key)) {
      groups.set(key, { txns: [], accountId: txn.accountId });
    }
    groups.get(key)!.txns.push(txn);
  }

  const detected: DetectedSource[] = [];

  for (const [, group] of groups) {
    if (group.txns.length < MIN_OCCURRENCES) continue;

    const sorted = [...group.txns].sort((a, b) => a.date.localeCompare(b.date));
    const dates = sorted.map(t => t.date);
    const frequency = detectFrequency(dates);
    if (!frequency) continue;

    const amounts = sorted.map(t => Math.abs(t.amount));
    const avgAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const amountMonthly = frequency === 'biweekly'
      ? avgAmount * BIWEEKLY_TO_MONTHLY
      : avgAmount;

    detected.push({
      name: sorted[sorted.length - 1].merchantName,
      amountMonthly: Math.round(amountMonthly * 100) / 100,
      frequency,
      sourceAccountId: group.accountId,
    });
  }

  if (detected.length === 0) return;

  // Fetch existing income_sources so we don't overwrite confirmed rows
  const { data: existing } = await supabase
    .from('income_sources')
    .select('id, name, source_account_id, is_confirmed')
    .eq('user_id', user.id);

  const confirmedKeys = new Set(
    (existing ?? [])
      .filter(r => r.is_confirmed)
      .map(r => `${normalizeMerchant(r.name)}__${r.source_account_id}`)
  );

  const toUpsert = detected.filter(d => {
    const key = `${normalizeMerchant(d.name)}__${d.sourceAccountId}`;
    return !confirmedKeys.has(key);
  });

  if (toUpsert.length === 0) return;

  await supabase.from('income_sources').upsert(
    toUpsert.map(d => ({
      user_id: user.id,
      name: d.name,
      amount_monthly: d.amountMonthly,
      frequency: d.frequency,
      source_account_id: d.sourceAccountId,
      is_confirmed: false,
    })),
    { onConflict: 'user_id,name,source_account_id', ignoreDuplicates: false }
  );
}
