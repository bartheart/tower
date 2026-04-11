import React, { useMemo } from 'react';
import {
  ScrollView, View, Text, StyleSheet, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SankeyChart from '../sankey/SankeyChart';
import { buildSankeyData } from '../sankey/buildGraph';
import {
  useCurrentMonthTransactions,
  useAccounts,
  useTotalBalance,
  useMonthlyIncome,
  useMonthlySpend,
} from '../hooks/useTransactions';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  const transactions = useCurrentMonthTransactions();
  const accounts = useAccounts();

  const totalBalance = useTotalBalance(accounts);
  const monthlyIncome = useMonthlyIncome(transactions);
  const monthlySpend = useMonthlySpend(transactions);
  const free = monthlyIncome - monthlySpend;

  const sankeyData = useMemo(
    () => buildSankeyData(transactions, monthlyIncome),
    [transactions, monthlyIncome]
  );

  const recent = [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  if (accounts.length === 0) {
    return (
      <View style={[s.container, s.emptyContainer, { paddingTop: top + 16 }]}>
        <Text style={s.emptyTitle}>No accounts linked</Text>
        <Text style={s.emptySub}>Go to Settings to connect your bank.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      {/* Balance header */}
      <View style={s.header}>
        <Text style={s.balanceLabel}>NET BALANCE</Text>
        <Text style={s.balanceAmount}>{fmt(totalBalance)}</Text>
        <Text style={s.balanceSub}>
          {accounts.map(a => a.institutionName).filter((v, i, arr) => arr.indexOf(v) === i).join(' · ')}
        </Text>
      </View>

      {/* Income / Spent / Free pills */}
      <View style={s.pillRow}>
        <View style={[s.pill, s.pillIncome]}>
          <Text style={s.pillLabel}>INCOME</Text>
          <Text style={[s.pillValue, { color: '#4ade80' }]}>{fmt(monthlyIncome)}</Text>
        </View>
        <View style={[s.pill, s.pillNeutral]}>
          <Text style={s.pillLabel}>SPENT</Text>
          <Text style={[s.pillValue, { color: '#f1f5f9' }]}>{fmt(monthlySpend)}</Text>
        </View>
        <View style={[s.pill, s.pillFree]}>
          <Text style={s.pillLabel}>FREE</Text>
          <Text style={[s.pillValue, { color: '#a5b4fc' }]}>{fmt(free)}</Text>
        </View>
      </View>

      {/* Sankey chart */}
      {sankeyData.nodes.length > 1 && (
        <View style={s.sankeyContainer}>
          <Text style={s.sectionLabel}>WHERE IT'S GOING</Text>
          <SankeyChart
            data={sankeyData}
            width={width - 32}
            height={280}
          />
        </View>
      )}

      {/* Recent transactions */}
      <View style={s.recentContainer}>
        <Text style={s.sectionLabel}>RECENT</Text>
        {recent.map(txn => (
          <View key={txn.id} style={s.txnRow}>
            <View>
              <Text style={s.txnMerchant}>{txn.merchantName}</Text>
              <Text style={s.txnCategory}>{txn.categoryL2 || txn.categoryL1} · {txn.date}</Text>
            </View>
            <Text style={[s.txnAmount, txn.amount < 0 && { color: '#4ade80' }]}>
              {txn.amount < 0 ? '+' : '-'}{fmt(Math.abs(txn.amount))}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16 },
  header: { marginBottom: 20 },
  balanceLabel: { fontSize: 10, color: '#475569', letterSpacing: 1.5, marginBottom: 4 },
  balanceAmount: { fontSize: 36, fontWeight: '300', color: '#f8fafc', letterSpacing: -1 },
  balanceSub: { fontSize: 12, color: '#475569', marginTop: 2 },
  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  pill: { flex: 1, borderRadius: 8, padding: 10 },
  pillIncome: { backgroundColor: '#0d2818', borderWidth: 1, borderColor: '#16a34a33' },
  pillNeutral: { backgroundColor: '#1e293b' },
  pillFree: { backgroundColor: '#1e1b4b', borderWidth: 1, borderColor: '#6366f133' },
  pillLabel: { fontSize: 9, color: '#64748b', letterSpacing: 1 },
  pillValue: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  sankeyContainer: { marginBottom: 24 },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 10 },
  recentContainer: { marginBottom: 24 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 16, color: '#cbd5e1', fontWeight: '300', marginBottom: 8 },
  emptySub: { fontSize: 12, color: '#475569', textAlign: 'center' },
  txnRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  txnMerchant: { fontSize: 13, color: '#cbd5e1' },
  txnCategory: { fontSize: 11, color: '#475569', marginTop: 2 },
  txnAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
});
