import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import Transaction from '../db/models/Transaction';
import Account from '../db/models/Account';
import { useAuth } from '../auth/AuthContext';

export type Period = 'week' | 'month';

export function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

export function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday … 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

export function useCurrentPeriodTransactions(period: Period = 'month') {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    if (!user) {
      setTransactions([]);
      return;
    }

    const { start, end } = period === 'week' ? getWeekRange() : currentMonthRange();
    const subscription = database
      .get<Transaction>('transactions')
      .query(
        Q.where('user_id', user.id),
        Q.where('date', Q.gte(start)),
        Q.where('date', Q.lte(end)),
        Q.where('pending', false),
      )
      .observe()
      .subscribe(setTransactions);

    return () => subscription.unsubscribe();
  }, [period, user?.id]);

  return transactions;
}

export function useAccounts(): { accounts: Account[]; loading: boolean } {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setAccounts([]);
      setLoading(false);
      return;
    }

    const subscription = database
      .get<Account>('accounts')
      .query(Q.where('user_id', user.id))
      .observe()
      .subscribe(results => {
        setAccounts(results);
        setLoading(false);
      });

    return () => subscription.unsubscribe();
  }, [user?.id]);

  return { accounts, loading };
}

export function useTotalBalance(accounts: Account[]) {
  return accounts.reduce((sum, a) => sum + (a.currentBalance ?? 0), 0);
}

export function useMonthlyIncome(transactions: Transaction[]) {
  return transactions
    .filter(t => t.amount < 0 && t.categoryL1 === 'Income')
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

export function useMonthlySpend(transactions: Transaction[]) {
  return transactions
    .filter(t => t.amount > 0 && t.categoryL1 !== 'Income' && !t.categoryL1.includes('Transfer'))
    .reduce((sum, t) => sum + t.amount, 0);
}
