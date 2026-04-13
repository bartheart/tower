import React, { useMemo, useState, useCallback } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  useWindowDimensions, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useBudgets } from '../hooks/useBudgets';
import { useIncome } from '../hooks/useIncome';
import { useCurrentPeriodTransactions, useMonthlyIncome, Period } from '../hooks/useTransactions';
import SankeyChart from '../sankey/SankeyChart';
import { buildSankeyData } from '../sankey/buildGraph';
import Transaction from '../db/models/Transaction';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// ─── Expandable Budget Row ────────────────────────────────────────────────────

function BudgetReportRow({
  budget,
  transactions,
  autoExpand,
}: {
  budget: ReturnType<typeof useBudgets>['budgets'][0];
  transactions: Transaction[];
  autoExpand: boolean;
}) {
  const [expanded, setExpanded] = useState(autoExpand);
  const ratio = budget.monthlyLimit > 0 ? budget.spent / budget.monthlyLimit : 0;
  const barColor = ratio > 1 ? '#ef4444' : ratio > 0.7 ? '#f59e0b' : budget.color;

  const catTxns = useMemo(() =>
    transactions
      .filter(t => t.amount > 0 && !t.pending &&
        (t.categoryL1 === budget.name || t.categoryL2 === budget.name))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [transactions, budget.name]
  );

  return (
    <View style={s.reportRow}>
      <TouchableOpacity style={s.reportRowTop} onPress={() => setExpanded(v => !v)}>
        <View style={s.reportRowLeft}>
          <View style={[s.colorDot, { backgroundColor: budget.color }]} />
          <View>
            <Text style={s.reportName}>{budget.name}</Text>
            {budget.isGoal && <Text style={s.goalBadge}>Goal</Text>}
          </View>
        </View>
        <View style={s.reportRowRight}>
          <Text style={[s.reportAmount, ratio > 1 && { color: '#ef4444' }]}>
            {fmt(budget.spent)}{ratio > 1 ? '  !' : ''}
          </Text>
          <Text style={s.chevronInline}>{expanded ? '  −' : '  +'}</Text>
        </View>
      </TouchableOpacity>

      {/* Allocation bar with floor marker */}
      <View style={s.barTrackWrap}>
        <View style={s.barTrack}>
          <View style={[s.barFill, { width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: barColor }]} />
        </View>
        {budget.monthlyFloor > 0 && budget.monthlyLimit > 0 && (
          <View
            style={[
              s.floorMarker,
              { left: `${Math.min((budget.monthlyFloor / budget.monthlyLimit) * 100, 100)}%` as any },
            ]}
          />
        )}
      </View>

      <Text style={s.reportSub}>
        {fmt(budget.spent)} spent · {fmt(budget.monthlyLimit)} budget
        {budget.monthlyFloor > 0 ? ` · ${fmt(budget.monthlyFloor)} fixed floor` : ''}
      </Text>

      {expanded && (
        <View style={s.txnList}>
          {catTxns.length === 0 ? (
            <Text style={s.txnEmpty}>No transactions in this category.</Text>
          ) : (
            catTxns.map(t => (
              <View key={t.id} style={s.txnListRow}>
                <View style={s.txnListLeft}>
                  <Text style={s.txnListMerchant}>{t.merchantName}</Text>
                  <Text style={s.txnListDate}>{t.date}</Text>
                </View>
                <Text style={s.txnListAmount}>{fmt(t.amount)}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ReportScreen() {
  const { width } = useWindowDimensions();
  const { top, bottom } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const budgetId: string | undefined = route.params?.budgetId;
  const period: Period = route.params?.period ?? 'month';

  const transactions = useCurrentPeriodTransactions(period);
  const { budgets, reload: reloadBudgets } = useBudgets(transactions);
  const { confirmedMonthlyIncome } = useIncome();
  const detectedIncome = useMonthlyIncome(transactions);
  const income = confirmedMonthlyIncome > 0 ? confirmedMonthlyIncome : detectedIncome;

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await reloadBudgets();
    setRefreshing(false);
  }, [reloadBudgets]);

  const sankeyData = useMemo(() => buildSankeyData(transactions, income), [transactions, income]);

  // If a specific budget was tapped, scroll to it and pre-expand
  const focusedBudget = budgetId ? budgets.find(b => b.id === budgetId) : null;

  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);
  const totalBudget = budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  const overallRatio = totalBudget > 0 ? totalSpent / totalBudget : 0;

  const goAdjustPlan = () => {
    navigation.navigate('Tabs', {
      screen: 'Plan',
      params: {
        planningTab: 'buckets',
        highlightId: budgetId,
      },
    });
  };

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={[s.content, { paddingTop: top + 16 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6366f1" />}
      >
        {/* Header */}
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Text style={s.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>
            {focusedBudget ? focusedBudget.name : 'Report'}
          </Text>
          <Text style={s.periodBadge}>{period === 'week' ? 'This Week' : 'This Month'}</Text>
        </View>

        {/* Summary bar */}
        <View style={s.summaryCard}>
          <View style={s.summaryRow}>
            <View>
              <Text style={s.summaryLabel}>TOTAL SPENT</Text>
              <Text style={[s.summaryValue, overallRatio > 1 && { color: '#ef4444' }]}>{fmt(totalSpent)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.summaryLabel}>BUDGET</Text>
              <Text style={s.summaryValue}>{fmt(totalBudget)}</Text>
            </View>
          </View>
          <View style={s.summaryBarTrack}>
            <View style={[
              s.summaryBarFill,
              {
                width: `${Math.min(overallRatio, 1) * 100}%`,
                backgroundColor: overallRatio > 1 ? '#ef4444' : overallRatio > 0.8 ? '#f59e0b' : '#6366f1',
              },
            ]} />
          </View>
          <Text style={s.summaryIncome}>
            Monthly income: {fmt(income)}
            {confirmedMonthlyIncome === 0 ? ' (detected)' : ' (confirmed)'}
          </Text>
        </View>

        {/* Sankey — pinch to zoom */}
        <Text style={s.sectionLabel}>MONEY FLOW</Text>
        <View style={s.sankeyContainer}>
          {sankeyData.nodes.length > 1 ? (
            <ScrollView
              style={{ height: 280 }}
              minimumZoomScale={1}
              maximumZoomScale={4}
              bouncesZoom
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ alignItems: 'flex-start' }}
            >
              <SankeyChart data={sankeyData} width={width - 32} height={260} />
            </ScrollView>
          ) : (
            <Text style={s.emptyHint}>No data yet — sync your accounts to see the flow.</Text>
          )}
          {sankeyData.nodes.length > 1 && <Text style={s.zoomHint}>Pinch to zoom</Text>}
        </View>

        {/* Breakdown — focused bucket first if specified */}
        <Text style={[s.sectionLabel, { marginTop: 20 }]}>BREAKDOWN</Text>
        {budgets.length === 0 ? (
          <Text style={s.emptyHint}>Add budgets in Plan to see your breakdown.</Text>
        ) : (
          [...budgets]
            .sort((a, b) => {
              // Put focused bucket first
              if (a.id === budgetId) return -1;
              if (b.id === budgetId) return 1;
              // Then sort by spend ratio descending
              const ra = a.monthlyLimit > 0 ? a.spent / a.monthlyLimit : 0;
              const rb = b.monthlyLimit > 0 ? b.spent / b.monthlyLimit : 0;
              return rb - ra;
            })
            .map(b => (
              <BudgetReportRow
                key={b.id}
                budget={b}
                transactions={transactions}
                autoExpand={b.id === budgetId}
              />
            ))
        )}

        <View style={{ height: bottom + 80 }} />
      </ScrollView>

      {/* Adjust Plan FAB */}
      <View style={[s.fabWrap, { bottom: bottom + 16 }]}>
        <TouchableOpacity style={s.fab} onPress={goAdjustPlan} activeOpacity={0.85}>
          <Text style={s.fabText}>Adjust Plan</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 24 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backBtn: { marginRight: 12 },
  backText: { fontSize: 17, color: '#6366f1' },
  headerTitle: { flex: 1, fontSize: 17, color: '#f1f5f9', fontWeight: '600' },
  periodBadge: { fontSize: 10, color: '#475569', backgroundColor: '#1e293b', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },

  summaryCard: { backgroundColor: '#0d1526', borderRadius: 12, padding: 16, marginBottom: 20 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  summaryLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5 },
  summaryValue: { fontSize: 22, color: '#f1f5f9', fontWeight: '700', fontVariant: ['tabular-nums'] },
  summaryBarTrack: { height: 5, backgroundColor: '#1e293b', borderRadius: 3 },
  summaryBarFill: { height: 5, borderRadius: 3 },
  summaryIncome: { fontSize: 10, color: '#475569', marginTop: 8 },

  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 10 },
  emptyHint: { fontSize: 12, color: '#334155', textAlign: 'center', paddingVertical: 24 },

  sankeyContainer: { backgroundColor: '#0d1526', borderRadius: 10, padding: 8, marginBottom: 4, overflow: 'hidden' },
  zoomHint: { fontSize: 9, color: '#334155', textAlign: 'right', marginTop: 4, marginRight: 4 },

  reportRow: { marginBottom: 10, backgroundColor: '#0d1526', borderRadius: 10, padding: 14 },
  reportRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  reportRowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  reportRowRight: { flexDirection: 'row', alignItems: 'center' },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  reportName: { fontSize: 13, color: '#cbd5e1', fontWeight: '500' },
  goalBadge: { fontSize: 9, color: '#a5b4fc', marginTop: 1 },
  reportAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  chevronInline: { fontSize: 13, color: '#475569' },

  barTrackWrap: { position: 'relative', marginBottom: 6 },
  barTrack: { backgroundColor: '#1e293b', borderRadius: 4, height: 5 },
  barFill: { height: 5, borderRadius: 4 },
  floorMarker: { position: 'absolute', top: -2, width: 2, height: 9, backgroundColor: '#94a3b8', borderRadius: 1 },

  reportSub: { fontSize: 10, color: '#475569', marginBottom: 4 },

  txnList: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 8 },
  txnEmpty: { fontSize: 11, color: '#334155', paddingVertical: 8 },
  txnListRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  txnListLeft: { flex: 1 },
  txnListMerchant: { fontSize: 12, color: '#94a3b8' },
  txnListDate: { fontSize: 10, color: '#475569', marginTop: 1 },
  txnListAmount: { fontSize: 12, color: '#cbd5e1', fontVariant: ['tabular-nums'] },

  fabWrap: { position: 'absolute', left: 16, right: 16 },
  fab: {
    backgroundColor: '#6366f1', borderRadius: 12, padding: 16,
    alignItems: 'center',
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
    elevation: 8,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: 0.3 },
});
