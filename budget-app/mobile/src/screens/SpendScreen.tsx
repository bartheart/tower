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

const CAT_TINTS = [
  'rgba(52,211,153,0.5)',   // emerald
  'rgba(150,207,232,0.5)',  // sky
  'rgba(240,168,168,0.5)',  // rose
  'rgba(52,211,153,0.4)',   // emerald lighter
  'rgba(232,200,122,0.5)',  // amber
];

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
  const barColor = ratio > 1 ? C.rose : ratio > 0.7 ? C.amber : budget.color;

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
          <Text style={[s.reportAmount, ratio > 1 && { color: C.rose }]}>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.emerald} />}
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
              <Text style={[s.summaryValue, overallRatio > 1 && { color: C.rose }]}>{fmt(totalSpent)}</Text>
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
                backgroundColor: overallRatio > 1 ? C.rose : overallRatio > 0.8 ? C.amber : C.emerald,
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
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  scroll: { flex: 1 },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backBtn: { padding: 4 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.w, letterSpacing: -0.4 },
  periodBadge: { fontSize: 10, color: C.w4 },

  // Summary card
  summaryCard: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, padding: 14, marginBottom: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  summaryLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 3 },
  summaryValue: { fontSize: 20, fontWeight: '700', color: C.w, letterSpacing: -0.8, ...T.tabular },
  summaryBarTrack: { height: 3, backgroundColor: C.b2, borderRadius: 2, overflow: 'hidden', marginBottom: 8 },
  summaryBarFill: { height: 3, borderRadius: 2 },
  summaryIncome: { fontSize: 10, color: C.w4 },

  // Section label
  sectionLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 8 },

  // Sankey container
  sankeyContainer: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 10, padding: 8, marginBottom: 16, overflow: 'hidden' },
  emptyHint: { fontSize: 11, color: C.w4, textAlign: 'center', paddingVertical: 20 },
  zoomHint: { fontSize: 9, color: C.w4, textAlign: 'center', marginTop: 4 },

  // Budget report rows
  reportRow: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 10, marginBottom: 8, overflow: 'hidden' },
  reportRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  reportRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  reportRowRight: { flexDirection: 'row', alignItems: 'center' },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  reportName: { fontSize: 13, color: C.w, fontWeight: '500' },
  goalBadge: { fontSize: 9, color: C.emerald, letterSpacing: 0.5, marginTop: 2 },
  reportAmount: { fontSize: 13, fontWeight: '600', color: C.w, ...T.tabular },
  chevronInline: { fontSize: 13, color: C.w4 },
  barTrackWrap: { height: 3, backgroundColor: C.b2, marginHorizontal: 12, borderRadius: 2, overflow: 'visible', position: 'relative', marginBottom: 4 },
  barTrack: { height: 3, backgroundColor: C.b2, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 3, borderRadius: 2 },
  floorMarker: { position: 'absolute', top: -2, width: 1, height: 7, backgroundColor: C.w4 },
  reportSub: { fontSize: 9, color: C.w4, paddingHorizontal: 12, paddingBottom: 8 },

  // Transaction list inside expanded row
  txnList: { borderTopWidth: 1, borderTopColor: C.b1 },
  txnEmpty: { fontSize: 11, color: C.w4, padding: 12, textAlign: 'center' },
  txnListRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.b1 },
  txnListLeft: { flex: 1 },
  txnListMerchant: { fontSize: 11, color: C.w2 },
  txnListDate: { fontSize: 9, color: C.w4, marginTop: 1 },
  txnListAmount: { fontSize: 11, fontWeight: '600', color: C.w, ...T.tabular },

  // FAB
  fabWrap: { position: 'absolute', left: 20, right: 20 },
  fab: { backgroundColor: C.w, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  fabText: { fontSize: 13, fontWeight: '700', color: C.bg, letterSpacing: 0.1 },

  // Plan tokens (kept for any future use)
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
