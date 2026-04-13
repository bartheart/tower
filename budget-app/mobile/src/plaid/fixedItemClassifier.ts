import { database } from '../db';
import Transaction from '../db/models/Transaction';
import { supabase } from '../supabase/client';

const MONTHLY_MIN_DAYS    = 25;
const MONTHLY_MAX_DAYS    = 35;
const MIN_MONTHS          = 2;
const AMOUNT_VARIANCE_PCT = 0.05; // 5%

function normalizeMerchant(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function getCalendarMonth(dateStr: string): string {
  // Returns "YYYY-MM"
  return dateStr.slice(0, 7);
}

/**
 * Runs after every Plaid sync. Reads WatermelonDB for debit transactions,
 * detects recurring fixed charges (same merchant, same amount ±5%, 2+ consecutive months),
 * and upserts unconfirmed fixed_item suggestions to Supabase.
 *
 * When a confirmed item's amount drifts >5%, sets needs_review=true.
 * Never changes is_confirmed from true to false.
 */
export async function detectFixedItems(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Fetch budget categories so we can resolve category_id from categoryL1
  const { data: categories } = await supabase
    .from('budget_categories')
    .select('id, name')
    .eq('user_id', user.id);

  if (!categories?.length) return;

  const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

  // Fetch all settled debits from WatermelonDB
  const allTxns = await database.get<Transaction>('transactions').query().fetch();
  const debits = allTxns.filter(t => t.amount > 0 && !t.pending);

  // Group by normalized merchant + categoryL1
  type GroupKey = string;
  const groups = new Map<GroupKey, { txns: Transaction[]; categoryL1: string }>();

  for (const txn of debits) {
    const key = `${normalizeMerchant(txn.merchantName)}__${txn.categoryL1}`;
    if (!groups.has(key)) {
      groups.set(key, { txns: [], categoryL1: txn.categoryL1 });
    }
    groups.get(key)!.txns.push(txn);
  }

  // Fetch existing fixed_items for comparison
  const { data: existingItems } = await supabase
    .from('fixed_items')
    .select('id, merchant_name, category_id, detected_amount, confirmed_amount, is_confirmed')
    .eq('user_id', user.id);

  const existingMap = new Map(
    (existingItems ?? []).map(item => [
      `${normalizeMerchant(item.merchant_name)}__${item.category_id}`,
      item,
    ])
  );

  const upserts: object[] = [];

  for (const [, group] of groups) {
    const categoryId = categoryByName.get(group.categoryL1.toLowerCase());
    if (!categoryId) continue;

    const sorted = [...group.txns].sort((a, b) => a.date.localeCompare(b.date));

    // Group into calendar months
    const byMonth = new Map<string, number[]>();
    for (const txn of sorted) {
      const month = getCalendarMonth(txn.date);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month)!.push(txn.amount);
    }

    const months = [...byMonth.keys()].sort();
    if (months.length < MIN_MONTHS) continue;

    // Check consecutive months
    let consecutiveCount = 1;
    const monthAmounts: number[] = [
      byMonth.get(months[0])!.reduce((s, v) => s + v, 0) / byMonth.get(months[0])!.length,
    ];

    for (let i = 1; i < months.length; i++) {
      const [y1, m1] = months[i - 1].split('-').map(Number);
      const [y2, m2] = months[i].split('-').map(Number);
      const monthDiff = (y2 - y1) * 12 + (m2 - m1);
      if (monthDiff === 1) {
        consecutiveCount++;
        const avg = byMonth.get(months[i])!.reduce((s, v) => s + v, 0) / byMonth.get(months[i])!.length;
        monthAmounts.push(avg);
      } else {
        consecutiveCount = 1;
        monthAmounts.length = 1;
        monthAmounts[0] = byMonth.get(months[i])!.reduce((s, v) => s + v, 0) / byMonth.get(months[i])!.length;
      }
    }

    if (consecutiveCount < MIN_MONTHS) continue;

    // Check amount variance within ±5%
    const baseAmount = monthAmounts[0];
    const allWithinVariance = monthAmounts.every(
      amt => Math.abs(amt - baseAmount) / baseAmount <= AMOUNT_VARIANCE_PCT
    );
    if (!allWithinVariance) continue;

    const detectedAmount = Math.round(
      (monthAmounts.reduce((s, v) => s + v, 0) / monthAmounts.length) * 100
    ) / 100;

    const merchantName = sorted[sorted.length - 1].merchantName;
    const lastSeenDate = sorted[sorted.length - 1].date;
    const existingKey = `${normalizeMerchant(merchantName)}__${categoryId}`;
    const existing = existingMap.get(existingKey);

    if (existing?.is_confirmed) {
      // Already confirmed — check if amount drifted
      const reference = existing.confirmed_amount ?? existing.detected_amount;
      const drift = Math.abs(detectedAmount - reference) / reference;
      if (drift > AMOUNT_VARIANCE_PCT) {
        upserts.push({
          id: existing.id,
          user_id: user.id,
          category_id: categoryId,
          merchant_name: merchantName,
          detected_amount: detectedAmount,
          last_seen_date: lastSeenDate,
          needs_review: true,
        });
      } else {
        // Just update last_seen_date
        upserts.push({
          id: existing.id,
          user_id: user.id,
          category_id: categoryId,
          merchant_name: merchantName,
          detected_amount: detectedAmount,
          last_seen_date: lastSeenDate,
        });
      }
    } else {
      // New candidate or update unconfirmed suggestion
      upserts.push({
        user_id: user.id,
        category_id: categoryId,
        merchant_name: merchantName,
        detected_amount: detectedAmount,
        last_seen_date: lastSeenDate,
        is_confirmed: false,
        needs_review: false,
      });
    }
  }

  if (upserts.length === 0) return;

  await supabase
    .from('fixed_items')
    .upsert(upserts, { onConflict: 'user_id,category_id,merchant_name', ignoreDuplicates: false });
}
