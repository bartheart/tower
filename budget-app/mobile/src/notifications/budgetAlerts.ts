import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import Transaction from '../db/models/Transaction';
import { supabase } from '../supabase/client';

const ALERT_THRESHOLD = 0.8;

/** Returns the YYYY-MM string for the current month, used as part of the dedup key. */
function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** SecureStore key for tracking whether a category alert was sent this month. */
function alertKey(yearMonth: string, categoryId: string): string {
  return `budgetAlert:${yearMonth}:${categoryId}`;
}

/**
 * Checks all budget categories for the given user. For each category whose
 * month-to-date spending is >= 80% of its monthly limit, fires a local
 * notification once per calendar month (deduped via SecureStore).
 */
export async function checkBudgetAlerts(userId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // 1. Fetch budget categories for this user
  const { data: categories } = await supabase
    .from('budget_categories')
    .select('id, name, monthly_limit')
    .eq('user_id', userId);

  if (!categories || categories.length === 0) return;

  // 2. Fetch current month's transactions from WatermelonDB.
  // The `date` field is stored as a 'YYYY-MM-DD' string (Plaid format),
  // so we filter with string comparison rather than a timestamp.
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  const monthStr = String(month + 1).padStart(2, '0');
  const nextMonthStr = month === 11 ? '01' : String(month + 2).padStart(2, '0');
  const nextYear = month === 11 ? year + 1 : year;
  const monthStart = `${year}-${monthStr}-01`;
  const monthEnd = `${nextYear}-${nextMonthStr}-01`;

  const transactions = await database
    .get<Transaction>('transactions')
    .query(
      Q.where('user_id', userId),
      Q.where('date', Q.gte(monthStart)),
      Q.where('date', Q.lt(monthEnd)),
    )
    .fetch();

  // 3. Build spend map (matching the logic in useBudgets)
  const spendMap = new Map<string, number>();
  for (const txn of transactions) {
    if (txn.amount <= 0 || txn.pending) continue;
    spendMap.set(txn.categoryL1, (spendMap.get(txn.categoryL1) ?? 0) + txn.amount);
    if (txn.categoryL2 && txn.categoryL2 !== txn.categoryL1) {
      spendMap.set(txn.categoryL2, (spendMap.get(txn.categoryL2) ?? 0) + txn.amount);
    }
  }

  // 4. Check each category and fire alerts
  const yearMonth = currentYearMonth();

  for (const cat of categories) {
    const spent = spendMap.get(cat.name) ?? 0;
    const limit = cat.monthly_limit;
    if (limit <= 0 || spent / limit < ALERT_THRESHOLD) continue;

    const key = alertKey(yearMonth, cat.id);
    const alreadySent = await SecureStore.getItemAsync(key);
    if (alreadySent) continue;

    const pct = Math.round((spent / limit) * 100);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Budget Alert',
        body: `You've used ${pct}% of your ${cat.name} budget`,
        data: { type: 'budget_alert', categoryId: cat.id },
      },
      trigger: null,
    });

    await SecureStore.setItemAsync(key, 'sent');
  }
}
