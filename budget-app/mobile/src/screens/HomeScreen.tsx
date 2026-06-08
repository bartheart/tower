import React, { useMemo, useState, useCallback } from 'react';
import {
  ScrollView, View, Text, StyleSheet,
  TouchableOpacity, Modal, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  useCurrentPeriodTransactions, useAccounts, useTotalBalance,
  useMonthlyIncome, useMonthlySpend, Period,
} from '../hooks/useTransactions';
import { useBudgets, BudgetCategory } from '../hooks/useBudgets';
import { useWellnessScore } from '../hooks/useWellnessScore';
import { useIncome } from '../hooks/useIncome';
import Transaction from '../db/models/Transaction';
import { WellnessDetailSheet } from '../components/WellnessDetailSheet';
import { C, T } from '../theme';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function fmtFull(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function txnMonth(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-US', { month: 'short' });
}
function txnDay(dateStr: string) {
  return new Date(dateStr).getDate().toString().padStart(2, '0');
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
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [period, setPeriod] = useState<Period>('month');
  const transactions = useCurrentPeriodTransactions(period);
  const { accounts, loading: accountsLoading } = useAccounts();
  const { budgets, reload: reloadBudgets } = useBudgets(transactions);
  useFocusEffect(useCallback(() => { reloadBudgets(); }, [reloadBudgets]));
  const { confirmedMonthlyIncome } = useIncome();

  const totalBalance = useTotalBalance(accounts);
  const monthlyIncome = useMonthlyIncome(transactions);
  const monthlySpend = useMonthlySpend(transactions);

  // Use confirmed income for wellness score; fall back to detected income if not yet confirmed
  const incomeForScore = confirmedMonthlyIncome > 0 ? confirmedMonthlyIncome : monthlyIncome;
  const wellness = useWellnessScore(transactions, budgets, incomeForScore, 7);

  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [wellnessSheetVisible, setWellnessSheetVisible] = useState(false);

  const sorted = useMemo(
    () => [...transactions].sort((a, b) => b.date.localeCompare(a.date)),
    [transactions]
  );
  const displayedTxns = showAllTxns ? sorted : sorted.slice(0, 8);

  const goToReport = (budgetId?: string) =>
    navigation.navigate('Spend', { budgetId, period });
  const goToIncome = () =>
    navigation.navigate('Tabs', { screen: 'Plan', params: { planningTab: 'income' } });

  // Month label and days left
  const now = new Date();
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = lastDay - now.getDate();

  const wellnessHistory = wellness.history ?? [];

  if (accountsLoading) {
    return <View style={[s.container, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={C.emerald} /></View>;
  }
  if (accounts.length === 0) {
    return (
      <View style={[s.container, { alignItems: 'center', justifyContent: 'center', paddingTop: top + 16, padding: 32 }]}>
        <Text style={{ fontSize: 16, color: C.w2, fontWeight: '300', marginBottom: 8 }}>No accounts linked</Text>
        <Text style={{ fontSize: 12, color: C.w4, textAlign: 'center' }}>Go to Settings → Add Account to connect your bank.</Text>
      </View>
    );
  }

  const balanceDollars = Math.floor(Math.abs(totalBalance));
  const balanceCents = Math.abs(totalBalance - Math.floor(totalBalance)).toFixed(2).slice(1);
  const isNegative = totalBalance < 0;

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 100 }}>
      {/* ── Hero ── */}
      <View style={[s.hero, { paddingTop: top + 6 }]}>
        <Text style={s.wordmark}>Tower</Text>
        <Text style={s.balance}>
          {isNegative ? '−' : ''}<Text style={s.balCurrency}>$</Text>
          {balanceDollars.toLocaleString()}
          <Text style={s.balCents}>.{balanceCents.slice(1)}</Text>
        </Text>
        <Text style={s.balMeta}>
          {monthLabel} · {daysLeft} days left
        </Text>
      </View>

      <View style={s.rule} />

      {/* ── Wellness ── */}
      <TouchableOpacity
        style={s.wellBlock}
        onPress={() => setWellnessSheetVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={[s.micro, { marginBottom: 10 }]}>Wellness</Text>
        <View style={s.wellInner}>
          <View>
            <Text style={s.wellScore}>
              {wellness.score}<Text style={s.wellDenom}> /100</Text>
            </Text>
            <Text style={s.wellSub}>
              {wellness.delta >= 0 ? `Good · up ${wellness.delta} pts` : `Needs work · down ${Math.abs(wellness.delta)} pts`}
            </Text>
          </View>
          <View style={s.sparkWrap}>
            {wellnessHistory.slice(-7).map((val, i, arr) => {
              const max = Math.max(...arr, 1);
              const h = Math.max(4, Math.round((val / max) * 20));
              const isLast = i === arr.length - 1;
              return (
                <View
                  key={i}
                  style={[s.sparkBar, { height: h, opacity: isLast ? 0.85 : 0.45 },
                    i === arr.length - 1 && s.sparkBarNow]}
                />
              );
            })}
          </View>
        </View>
      </TouchableOpacity>

      <View style={s.rule} />

      {/* ── Buckets ── */}
      <View style={s.secStrip}>
        <Text style={s.micro}>Buckets</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Tabs', { screen: 'Plan' })}>
          <Text style={s.secAction}>Plan →</Text>
        </TouchableOpacity>
      </View>

      {budgets.slice(0, 5).map((b, i) => {
        const isOver = b.monthlyLimit > 0 && b.spent > b.monthlyLimit;
        return (
          <TouchableOpacity
            key={b.id}
            style={[s.bktRow, isOver && s.bktRowWarn]}
            onPress={() => goToReport(b.id)}
            activeOpacity={0.7}
          >
            <Text style={s.bktRank}>0{i + 1}</Text>
            <Text style={[s.bktName, isOver && s.bktNameWarn]}>{b.name}</Text>
            <Text style={[s.bktSpent, isOver && s.bktNameWarn]}>
              {fmt(b.spent)}
            </Text>
            <Text style={s.bktOf}> / {fmt(b.monthlyLimit)}</Text>
          </TouchableOpacity>
        );
      })}

      <View style={[s.rule, { marginTop: 4 }]} />

      {/* ── Recent transactions ── */}
      <View style={s.secStrip}>
        <Text style={s.micro}>Recent</Text>
        <TouchableOpacity onPress={() => setShowAllTxns(true)}>
          <Text style={s.secAction}>All →</Text>
        </TouchableOpacity>
      </View>

      {displayedTxns.map(txn => (
        <TouchableOpacity
          key={txn.id}
          style={s.txnRow}
          onPress={() => { setSelectedTxn(txn); }}
          activeOpacity={0.7}
        >
          <View style={s.txnDateWrap}>
            <Text style={s.txnDateMon}>{txnMonth(txn.date)}</Text>
            <Text style={s.txnDateDay}>{txnDay(txn.date)}</Text>
          </View>
          <View style={s.txnInfo}>
            <Text style={s.txnMerchant} numberOfLines={1}>{txn.merchantName || txn.categoryL1}</Text>
            <Text style={s.txnCat}>{txn.categoryL1}</Text>
          </View>
          <Text style={[s.txnAmt, txn.amount < 0 && s.txnAmtPos]}>
            {txn.amount < 0 ? '+' : '−'}{fmt(Math.abs(txn.amount))}
          </Text>
        </TouchableOpacity>
      ))}

      {/* Keep all existing modals unchanged below */}
      <WellnessDetailSheet
        visible={wellnessSheetVisible}
        onClose={() => setWellnessSheetVisible(false)}
        wellness={wellness}
        transactions={transactions}
      />
      {/* TransactionDetailModal — keep exactly as-is */}
      <TxnDetailModal txn={selectedTxn} onClose={() => setSelectedTxn(null)} />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  hero: { paddingHorizontal: 20, paddingBottom: 20 },
  wordmark: { fontSize: 11, fontWeight: '700', letterSpacing: 1.98, textTransform: 'uppercase', color: C.w4, marginBottom: 18 },
  balance: { fontSize: 50, fontWeight: '800', letterSpacing: -3, color: C.w, lineHeight: 48, fontVariant: ['tabular-nums'] },
  balCurrency: { fontSize: 22, fontWeight: '400', color: C.w3, letterSpacing: -1 },
  balCents: { fontSize: 22, fontWeight: '300', color: C.w3, letterSpacing: -1 },
  balMeta: { marginTop: 8, fontSize: 11, color: C.w3 },

  rule: { height: 1, backgroundColor: C.b1 },

  wellBlock: { paddingHorizontal: 20, paddingVertical: 14 },
  wellInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wellScore: { fontSize: 32, fontWeight: '700', color: C.emerald, letterSpacing: -1.5, lineHeight: 32, fontVariant: ['tabular-nums'] },
  wellDenom: { fontSize: 14, fontWeight: '300', color: C.w4 },
  wellSub: { fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: C.w4, marginTop: 3 },
  sparkWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  sparkBar: { width: 5, borderRadius: 2, backgroundColor: C.emerald },
  sparkBarNow: { opacity: 0.85 },

  secStrip: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  micro: { ...T.sectionLabel, color: C.w4 },
  secAction: { fontSize: 10, color: C.w4 },

  bktRow: { paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'baseline', borderBottomWidth: 1, borderBottomColor: 'rgba(31,31,40,0.7)' },
  bktRowWarn: { backgroundColor: C.roseBg },
  bktRank: { fontSize: 9, color: C.w4, fontVariant: ['tabular-nums'], width: 16, marginRight: 8 },
  bktName: { fontSize: 12, color: C.w2, flex: 1 },
  bktNameWarn: { color: C.rose },
  bktSpent: { fontSize: 12, fontWeight: '600', color: C.w2, fontVariant: ['tabular-nums'], marginRight: 3 },
  bktOf: { fontSize: 11, color: C.w4, fontVariant: ['tabular-nums'] },

  txnRow: { paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(31,31,40,0.5)' },
  txnDateWrap: { width: 28, alignItems: 'center' },
  txnDateMon: { fontSize: 8, color: C.w4, letterSpacing: 0.3, textTransform: 'uppercase' },
  txnDateDay: { fontSize: 10, color: C.w4, fontVariant: ['tabular-nums'] },
  txnInfo: { flex: 1, minWidth: 0 },
  txnMerchant: { fontSize: 11, color: C.w2, fontWeight: '500' },
  txnCat: { fontSize: 9, color: C.w4, marginTop: 1 },
  txnAmt: { fontSize: 12, fontWeight: '600', color: C.w2, fontVariant: ['tabular-nums'] },
  txnAmtPos: { color: C.emerald },
});

const d = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: C.s1, borderRadius: 16, padding: 24 },
  merchant: { fontSize: 16, color: C.w, fontWeight: '600', marginBottom: 4 },
  amount: { fontSize: 28, color: C.w, fontWeight: '300', marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.b2 },
  rowLabel: { fontSize: 10, color: C.w4, letterSpacing: 1 },
  rowValue: { fontSize: 13, color: C.w2 },
  pendingBadge: { backgroundColor: '#451a03', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 12 },
  pendingText: { fontSize: 9, color: C.amber, letterSpacing: 1 },
  closeBtn: { backgroundColor: C.b2, borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 20 },
  closeBtnText: { color: C.w2, fontSize: 14 },
});
