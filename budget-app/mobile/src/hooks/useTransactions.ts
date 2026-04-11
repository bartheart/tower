import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import Transaction from '../db/models/Transaction';
import Account from '../db/models/Account';

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

export function useCurrentMonthTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    const { start, end } = currentMonthRange();
    const subscription = database
      .get<Transaction>('transactions')
      .query(
        Q.where('date', Q.gte(start)),
        Q.where('date', Q.lte(end)),
        Q.where('pending', false)
      )
      .observe()
      .subscribe(setTransactions);

    return () => subscription.unsubscribe();
  }, []);

  return transactions;
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    const subscription = database
      .get<Account>('accounts')
      .query()
      .observe()
      .subscribe(setAccounts);
    return () => subscription.unsubscribe();
  }, []);

  return accounts;
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
