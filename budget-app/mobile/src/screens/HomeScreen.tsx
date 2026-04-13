import React, { useMemo, useState } from 'react';
import {
  ScrollView, View, Text, StyleSheet, useWindowDimensions,
  TouchableOpacity, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  useCurrentPeriodTransactions, useAccounts, useTotalBalance,
  useMonthlyIncome, useMonthlySpend, Period,
} from '../hooks/useTransactions';
import { useBudgets, BudgetCategory } from '../hooks/useBudgets';
import { useWellnessScore } from '../hooks/useWellnessScore';
import { useIncome } from '../hooks/useIncome';
import Transaction from '../db/models/Transaction';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function fmtFull(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ history, color }: { history: number[]; color: string }) {
  if (history.length < 2) return null;
  const W = 60, H = 28, PAD = 2;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const points = history.map((v, i) => {
    const x = PAD + (i / (history.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');
  const lastX = PAD + (W - PAD * 2);
  const lastY = PAD + (1 - (history[history.length - 1] - min) / range) * (H - PAD * 2);

  return (
    <Svg width={W} height={H}>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </Svg>
  );
}

// ─── Tile: Wellness Score ─────────────────────────────────────────────────────

function ScoreTile({ score, history, delta, status, statusColor, width }: {
  score: number; history: number[]; delta: number;
  status: string; statusColor: string; width: number;
}) {
  return (
    <View style={[t.scoreTile, { width }]}>
      <View style={t.scoreLeft}>
        <Text style={t.scoreLabel}>WELLNESS SCORE</Text>
        <Text style={t.scoreNumber}>{score}</Text>
        <Text style={[t.scoreStatus, { color: statusColor }]}>{status}</Text>
      </View>
      <View style={t.scoreRight}>
        <Text style={t.sparkLabel}>7-day trend</Text>
        <Sparkline history={history} color={statusColor} />
        <Text style={[t.scoreDelta, { color: delta >= 0 ? '#4ade80' : '#ef4444' }]}>
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)} pts
        </Text>
      </View>
    </View>
  );
}

// ─── Tile: Income ─────────────────────────────────────────────────────────────

function IncomeTile({ confirmedMonthlyIncome, width, onPress }: {
  confirmedMonthlyIncome: number; width: number; onPress: () => void;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[t.incomeTile, { width }]}>
      <Text style={t.incomeLabel}>MONTHLY INCOME</Text>
      <Text style={t.incomeValue}>{fmt(confirmedMonthlyIncome)}</Text>
      {confirmedMonthlyIncome === 0 && (
        <Text style={t.incomeHint}>Tap to add income sources</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Tile: Budget ─────────────────────────────────────────────────────────────

function BudgetTile({ budget, totalRemaining, period, width, isTotal, onPress }: {
  budget?: BudgetCategory;
  totalRemaining?: number;
  period: Period;
  width: number;
  isTotal: boolean;
  onPress: () => void;
}) {
  const isGoal = !isTotal && (budget?.isGoal ?? false);
  const color = isTotal ? '#6366f1' : (budget?.color ?? '#6366f1');
  const bgStart = isTotal ? '#1e1b4b' : isGoal ? '#0d1a2e' : '#0f172a';
  const label = isTotal ? 'ALL BUDGETS' : (budget?.name ?? '');
  const remaining = isTotal
    ? totalRemaining ?? 0
    : (budget ? budget.monthlyLimit - budget.spent : 0);
  const limit = isTotal ? undefined : budget?.monthlyLimit;
  const spent = isTotal ? undefined : budget?.spent;
  const ratio = !isTotal && limit ? Math.min(1, (spent ?? 0) / limit) : undefined;

  const barColor = ratio == null ? color
    : ratio > 0.9 ? '#ef4444' : ratio > 0.7 ? '#f59e0b' : color;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[t.budgetTile, { width, borderColor: `${color}22` }]}
    >
      <View style={[t.budgetGradient, { backgroundColor: bgStart }]}>
        <Text style={[t.budgetLabel, { color }]}>{label}</Text>
        <Text style={t.budgetAmount}>{fmt(Math.max(0, remaining))}</Text>
        <Text style={[t.budgetSub, { color }]}>
          left this {period === 'week' ? 'week' : 'month'}
        </Text>
        {isGoal && budget?.monthlyLimit != null && (
          <Text style={[t.budgetSub, { color: '#a5b4fc', marginTop: 0 }]}>
            Goal · {fmt(budget.monthlyLimit)}/mo contribution
          </Text>
        )}
        {!isGoal && limit != null && (
          <Text style={t.budgetFaint}>
            {fmt(spent ?? 0)} spent · {fmt(limit)} budget
          </Text>
        )}
        <View style={t.barTrack}>
          <View style={[t.barFill, { width: `${(ratio ?? 0) * 100}%`, backgroundColor: barColor }]} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Transaction Detail Modal ─────────────────────────────────────────────────

function TxnDetailModal({ txn, onClose }: { txn: Transaction | null; onClose: () => void }) {
  if (!txn) return null;
  const isIncome = txn.amount < 0;
  return (
    <Modal visible={!!txn} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableOpacity style={d.overlay} activeOpacity={1} onPress={onClose}>
        <View style={d.card}>
          <Text style={d.merchant}>{txn.merchantName}</Text>
          <Text style={[d.amount, isIncome && { color: '#4ade80' }]}>
            {isIncome ? '+' : '-'}{fmtFull(Math.abs(txn.amount))}
          </Text>
          <View style={d.row}><Text style={d.rowLabel}>DATE</Text><Text style={d.rowValue}>{txn.date}</Text></View>
          <View style={d.row}><Text style={d.rowLabel}>CATEGORY</Text><Text style={d.rowValue}>{txn.categoryL2 || txn.categoryL1}</Text></View>
          <View style={d.row}><Text style={d.rowLabel}>TYPE</Text><Text style={d.rowValue}>{txn.categoryL1}</Text></View>
          {txn.pending && (
            <View style={d.pendingBadge}><Text style={d.pendingText}>PENDING</Text></View>
          )}
          <TouchableOpacity style={d.closeBtn} onPress={onClose}>
            <Text style={d.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [period, setPeriod] = useState<Period>('month');
  const transactions = useCurrentPeriodTransactions(period);
  const { accounts, loading: accountsLoading } = useAccounts();
  const { budgets } = useBudgets(transactions);
  const { confirmedMonthlyIncome } = useIncome();

  const totalBalance = useTotalBalance(accounts);
  const monthlyIncome = useMonthlyIncome(transactions);
  const monthlySpend = useMonthlySpend(transactions);

  // Use confirmed income for wellness score; fall back to detected income if not yet confirmed
  const incomeForScore = confirmedMonthlyIncome > 0 ? confirmedMonthlyIncome : monthlyIncome;
  const wellness = useWellnessScore(transactions, budgets, incomeForScore, 7);
  const totalRemaining = budgets.reduce((s, b) => s + b.monthlyLimit, 0) - monthlySpend;

  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(
    () => [...transactions].sort((a, b) => b.date.localeCompare(a.date)),
    [transactions]
  );
  const recent = showAll ? sorted : sorted.slice(0, 8);

  // Budget tiles only (total + per-category). Score tile is always shown above.
  const budgetTileCount = 1 + budgets.length;
  const [tileIndex, setTileIndex] = useState(0);

  // Full-screen width for each tile — pagingEnabled snaps exactly one tile at a time
  const TILE_WIDTH = width;

  const goToReport = (budgetId?: string) =>
    navigation.navigate('Report', { budgetId, period });
  const goToIncome = () =>
    navigation.navigate('Tabs', { screen: 'Plan', params: { planningTab: 'income' } });

  if (accountsLoading) {
    return <View style={[s.container, s.center]}><ActivityIndicator color="#6366f1" /></View>;
  }
  if (accounts.length === 0) {
    return (
      <View style={[s.container, s.center, { paddingTop: top + 16 }]}>
        <Text style={s.emptyTitle}>No accounts linked</Text>
        <Text style={s.emptySub}>Go to Settings → Add Account to connect your bank.</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>

        {/* Balance header */}
        <View style={s.header}>
          <Text style={s.balanceLabel}>NET BALANCE</Text>
          <Text style={s.balanceAmount}>{fmt(totalBalance)}</Text>
          <Text style={s.balanceSub}>
            {[...new Set(accounts.map(a => a.institutionName))].join(' · ')}
          </Text>
        </View>

        {/* Week / Month toggle */}
        <View style={s.toggleRow}>
          {(['week', 'month'] as Period[]).map(p => (
            <TouchableOpacity
              key={p}
              style={[s.toggleBtn, period === p && s.toggleBtnActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[s.toggleText, period === p && s.toggleTextActive]}>
                {p.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Wellness score tile — always visible, slightly smaller, sits above budget carousel */}
        <ScoreTile
          width={width - 32}
          score={wellness.score}
          history={wellness.history}
          delta={wellness.delta}
          status={wellness.status}
          statusColor={wellness.statusColor}
        />

        {/* Budget tile carousel — total + per-category, swipe left */}
        <Text style={s.carouselLabel}>MY BUDGETS · swipe →</Text>
        <FlatList
          data={[
            { type: 'total' as const },
            ...budgets.map(b => ({ type: 'budget' as const, budget: b })),
          ]}
          keyExtractor={(_, i) => String(i)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={e => {
            setTileIndex(Math.round(e.nativeEvent.contentOffset.x / TILE_WIDTH));
          }}
          renderItem={({ item }) => {
            if (item.type === 'total') {
              return (
                <BudgetTile
                  width={TILE_WIDTH}
                  isTotal
                  totalRemaining={totalRemaining}
                  period={period}
                  onPress={() => goToReport(undefined)}
                />
              );
            }
            return (
              <BudgetTile
                width={TILE_WIDTH}
                isTotal={false}
                budget={item.budget}
                period={period}
                onPress={() => goToReport(item.budget.id)}
              />
            );
          }}
          style={{ marginHorizontal: -16 }}
          decelerationRate="fast"
        />

        {/* Page dots — budget tiles only */}
        <View style={s.dotsRow}>
          {Array.from({ length: budgetTileCount }).map((_, i) => (
            <View key={i} style={[s.dot, i === tileIndex && s.dotActive]} />
          ))}
        </View>

        {/* Income (tappable → income page) / Spent pills */}
        <View style={s.pillRow}>
          <TouchableOpacity style={[s.pill, s.pillIncome]} onPress={goToIncome} activeOpacity={0.75}>
            <Text style={s.pillLabel}>MONTHLY INCOME</Text>
            <Text style={[s.pillValue, { color: '#4ade80' }]}>
              {confirmedMonthlyIncome > 0 ? fmt(confirmedMonthlyIncome) : fmt(monthlyIncome)}
            </Text>
            {confirmedMonthlyIncome === 0 && (
              <Text style={s.pillHint}>tap to confirm</Text>
            )}
          </TouchableOpacity>
          <View style={[s.pill, s.pillNeutral]}>
            <Text style={s.pillLabel}>SPENT</Text>
            <Text style={[s.pillValue, { color: '#f1f5f9' }]}>{fmt(monthlySpend)}</Text>
          </View>
        </View>

        {/* Recent transactions */}
        <View style={s.recentContainer}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionLabel}>
              {showAll ? `ALL (${sorted.length})` : 'RECENT'}
            </Text>
            {sorted.length > 8 && (
              <TouchableOpacity onPress={() => setShowAll(v => !v)}>
                <Text style={s.viewAll}>{showAll ? 'Show less' : `View all ${sorted.length}`}</Text>
              </TouchableOpacity>
            )}
          </View>
          {recent.map(txn => (
            <TouchableOpacity key={txn.id} style={s.txnRow} onPress={() => setSelectedTxn(txn)}>
              <View style={s.txnLeft}>
                <Text style={s.txnMerchant}>{txn.merchantName}</Text>
                <Text style={s.txnCategory}>{txn.categoryL2 || txn.categoryL1} · {txn.date}</Text>
              </View>
              <Text style={[s.txnAmount, txn.amount < 0 && { color: '#4ade80' }]}>
                {txn.amount < 0 ? '+' : '-'}{fmt(Math.abs(txn.amount))}
              </Text>
            </TouchableOpacity>
          ))}
          {sorted.length === 0 && (
            <Text style={s.emptyTxn}>No transactions this {period} yet.</Text>
          )}
        </View>
      </ScrollView>

      <TxnDetailModal txn={selectedTxn} onClose={() => setSelectedTxn(null)} />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SCORE_H = 90;
const TILE_H = 140;

const t = StyleSheet.create({
  incomeTile: {
    height: 56, backgroundColor: '#0d2818',
    borderRadius: 8, borderWidth: 1, borderColor: '#16a34a33',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 8,
  },
  incomeLabel: { fontSize: 9, color: '#4ade80', letterSpacing: 1.5 },
  incomeValue: { fontSize: 18, fontWeight: '700', color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  incomeHint: { fontSize: 9, color: '#475569' },
  scoreTile: {
    height: SCORE_H, backgroundColor: '#1e293b',
    borderRadius: 10, borderWidth: 1, borderColor: '#f59e0b22',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, marginBottom: 10,
    overflow: 'hidden',
  },
  scoreLeft: { flex: 1 },
  scoreLabel: { fontSize: 9, color: '#f59e0b', letterSpacing: 1.5, marginBottom: 2 },
  scoreNumber: { fontSize: 26, fontWeight: '800', color: '#e2e8f0', letterSpacing: -1 },
  scoreStatus: { fontSize: 9, marginTop: 1 },
  scoreRight: { alignItems: 'flex-end' },
  sparkLabel: { fontSize: 7, color: '#475569', marginBottom: 3 },
  scoreDelta: { fontSize: 8, marginTop: 3 },
  budgetTile: {
    height: TILE_H, borderTopWidth: 1, borderBottomWidth: 1,
    overflow: 'hidden',
  },
  budgetGradient: {
    flex: 1, paddingHorizontal: 20, paddingVertical: 16, justifyContent: 'center',
  },
  budgetLabel: { fontSize: 9, letterSpacing: 1.5, marginBottom: 4 },
  budgetAmount: { fontSize: 36, fontWeight: '800', color: '#e2e8f0', letterSpacing: -2, lineHeight: 38 },
  budgetSub: { fontSize: 11, marginTop: 2 },
  budgetFaint: { fontSize: 9, color: '#334155', marginTop: 6 },
  barTrack: { backgroundColor: '#0f172a55', borderRadius: 4, height: 2, marginTop: 10 },
  barFill: { height: 2, borderRadius: 4 },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { marginBottom: 16 },
  balanceLabel: { fontSize: 10, color: '#475569', letterSpacing: 1.5, marginBottom: 2 },
  balanceAmount: { fontSize: 32, fontWeight: '300', color: '#f8fafc', letterSpacing: -1 },
  balanceSub: { fontSize: 11, color: '#475569', marginTop: 2 },
  toggleRow: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 6, padding: 2, width: 120, marginBottom: 14 },
  toggleBtn: { flex: 1, paddingVertical: 3, alignItems: 'center', borderRadius: 4 },
  toggleBtnActive: { backgroundColor: '#334155' },
  toggleText: { fontSize: 9, color: '#475569' },
  toggleTextActive: { color: '#f1f5f9', fontWeight: '600' },
  carouselLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8, marginBottom: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#334155' },
  dotActive: { backgroundColor: '#6366f1' },
  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  pill: { flex: 1, borderRadius: 8, padding: 10 },
  pillIncome: { backgroundColor: '#0d2818', borderWidth: 1, borderColor: '#16a34a33' },
  pillNeutral: { backgroundColor: '#1e293b' },
  pillLabel: { fontSize: 9, color: '#64748b', letterSpacing: 1 },
  pillValue: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  pillHint: { fontSize: 9, color: '#16a34a', marginTop: 2 },
  recentContainer: { marginBottom: 24 },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  viewAll: { fontSize: 11, color: '#6366f1' },
  txnRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  txnLeft: { flex: 1, marginRight: 12 },
  txnMerchant: { fontSize: 13, color: '#cbd5e1' },
  txnCategory: { fontSize: 11, color: '#475569', marginTop: 2 },
  txnAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  emptyTxn: { fontSize: 12, color: '#334155', textAlign: 'center', paddingVertical: 20 },
  emptyTitle: { fontSize: 16, color: '#cbd5e1', fontWeight: '300', marginBottom: 8 },
  emptySub: { fontSize: 12, color: '#475569', textAlign: 'center' },
});

const d = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#1e293b', borderRadius: 16, padding: 24 },
  merchant: { fontSize: 16, color: '#f1f5f9', fontWeight: '600', marginBottom: 4 },
  amount: { fontSize: 28, color: '#f1f5f9', fontWeight: '300', marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  rowLabel: { fontSize: 10, color: '#475569', letterSpacing: 1 },
  rowValue: { fontSize: 13, color: '#cbd5e1' },
  pendingBadge: { backgroundColor: '#451a03', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 12 },
  pendingText: { fontSize: 9, color: '#f59e0b', letterSpacing: 1 },
  closeBtn: { backgroundColor: '#334155', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 20 },
  closeBtnText: { color: '#cbd5e1', fontSize: 14 },
});
