import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useBudgets } from '../hooks/useBudgets';
import { useGoals } from '../hooks/useGoals';
import { useCurrentMonthTransactions, useMonthlyIncome, useMonthlySpend } from '../hooks/useTransactions';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function ProgressBar({ ratio, color }: { ratio: number; color: string }) {
  const clamped = Math.min(1, ratio);
  const barColor = ratio > 1 ? '#ef4444' : ratio > 0.7 ? '#f59e0b' : '#22c55e';
  return (
    <View style={{ backgroundColor: '#1e293b', borderRadius: 99, height: 4, marginTop: 4 }}>
      <View style={{ backgroundColor: barColor, width: `${clamped * 100}%`, height: '100%', borderRadius: 99 }} />
    </View>
  );
}

export default function PlanScreen() {
  const budgets = useBudgets();
  const goals = useGoals();
  const transactions = useCurrentMonthTransactions();
  const income = useMonthlyIncome(transactions);
  const spent = useMonthlySpend(transactions);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const projectedSpend = (spent / daysPassed) * daysInMonth;
  const projectedRemaining = income - projectedSpend;

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Projection banner */}
      <View style={s.projectionCard}>
        <Text style={s.sectionLabel}>END OF MONTH PROJECTION</Text>
        <Text style={s.projectionAmount}>{fmt(projectedRemaining)}</Text>
        <Text style={s.projectionSub}>
          {projectedRemaining >= 0 ? 'on track' : 'over budget'} · based on {daysPassed} days of spending
        </Text>
      </View>

      {/* Budget envelopes */}
      <Text style={s.sectionLabel}>BUDGETS</Text>
      {budgets.map(b => (
        <View key={b.id} style={s.budgetCard}>
          <View style={s.budgetRow}>
            <Text style={s.budgetName}>{b.emoji} {b.name}</Text>
            <Text style={[s.budgetAmount, b.spent > b.monthlyLimit && { color: '#ef4444' }]}>
              {fmt(b.spent)} <Text style={s.budgetLimit}>/ {fmt(b.monthlyLimit)}</Text>
            </Text>
          </View>
          <ProgressBar ratio={b.spent / b.monthlyLimit} color={b.color} />
        </View>
      ))}

      {/* Savings goals */}
      <Text style={[s.sectionLabel, { marginTop: 24 }]}>GOALS</Text>
      {goals.map(g => (
        <View key={g.id} style={s.goalCard}>
          <View style={s.budgetRow}>
            <Text style={s.budgetName}>{g.emoji} {g.name}</Text>
            <Text style={s.goalPercent}>{g.progressPercent}%</Text>
          </View>
          <ProgressBar ratio={g.progressPercent / 100} color="#6366f1" />
          <Text style={s.goalSub}>
            {fmt(g.currentAmount)} of {fmt(g.targetAmount)}
            {g.monthsLeft !== null ? ` · ~${g.monthsLeft}mo left` : ''}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16 },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 10 },
  projectionCard: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, marginBottom: 24 },
  projectionAmount: { fontSize: 28, fontWeight: '300', color: '#f8fafc', marginVertical: 4 },
  projectionSub: { fontSize: 11, color: '#64748b' },
  budgetCard: { marginBottom: 14 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  budgetName: { fontSize: 13, color: '#cbd5e1' },
  budgetAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  budgetLimit: { color: '#475569' },
  goalCard: { backgroundColor: '#1e293b', borderRadius: 8, padding: 12, marginBottom: 10 },
  goalPercent: { fontSize: 12, color: '#a5b4fc' },
  goalSub: { fontSize: 10, color: '#475569', marginTop: 5 },
});
