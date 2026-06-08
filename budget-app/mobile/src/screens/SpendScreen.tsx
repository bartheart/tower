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
import { C, T } from '../theme';

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
            {focusedBudget ? focusedBudget.name : 'Spend'}
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
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14,
  },
  title: { ...T.screenTitle, color: C.w },
  periodNav: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  periodLabel: { fontSize: 11, color: C.w3 },
  periodArrow: { fontSize: 16, color: C.w4, paddingHorizontal: 2 },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14 },
  heroCell: {},
  heroLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 3 },
  heroValue: { fontSize: 20, fontWeight: '700', color: C.w, letterSpacing: -0.8, ...T.tabular },
  heroValuePos: { fontSize: 20, fontWeight: '700', color: C.emerald, letterSpacing: -0.8, ...T.tabular },
  rule: { height: 1, backgroundColor: C.b1 },
  sankey: {
    margin: 20, marginBottom: 12, padding: 12,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 10,
  },
  sankeyLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 10 },
  secStrip: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  catItem: { paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.b1 },
  catTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  catName: { fontSize: 11, color: C.w2 },
  catNums: { fontSize: 10, color: C.w3, ...T.tabular },
  catNumsWarn: { fontSize: 10, color: C.rose, ...T.tabular },
  catTrack: { height: 1.5, backgroundColor: C.b2, borderRadius: 1, overflow: 'hidden' },
  adjustBtn: {
    margin: 20, padding: 12, borderRadius: 10,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1,
    alignItems: 'center',
  },
  adjustBtnText: { fontSize: 13, fontWeight: '600', color: C.w2 },
});
