import React, { useMemo, useState, useCallback } from 'react';
import {
  ScrollView, View, Text, StyleSheet, useWindowDimensions,
  TouchableOpacity, Modal, FlatList, ActivityIndicator,
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
import Transaction from '../db/models/Transaction';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtFull(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

// ─── Transaction Detail Modal ────────────────────────────────────────────────

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
          <View style={d.row}>
            <Text style={d.label}>DATE</Text>
            <Text style={d.value}>{txn.date}</Text>
          </View>
          <View style={d.row}>
            <Text style={d.label}>CATEGORY</Text>
            <Text style={d.value}>{txn.categoryL2 || txn.categoryL1}</Text>
          </View>
          <View style={d.row}>
            <Text style={d.label}>TYPE</Text>
            <Text style={d.value}>{txn.categoryL1}</Text>
          </View>
          {txn.pending && (
            <View style={d.pendingBadge}>
              <Text style={d.pendingText}>PENDING</Text>
            </View>
          )}
          <TouchableOpacity style={d.closeBtn} onPress={onClose}>
            <Text style={d.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Filtered Transactions Modal (Sankey drill-down) ─────────────────────────

function FilteredTxnModal({
  nodeName, transactions, onClose,
}: {
  nodeName: string | null;
  transactions: Transaction[];
  onClose: () => void;
}) {
  const filtered = useMemo(() => {
    if (!nodeName) return [];
    return transactions
      .filter(t =>
        t.categoryL1 === nodeName ||
        t.categoryL2 === nodeName ||
        t.merchantName === nodeName
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [nodeName, transactions]);

  const total = filtered.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  return (
    <Modal visible={!!nodeName} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={f.container}>
        <View style={f.header}>
          <Text style={f.title}>{nodeName}</Text>
          <Text style={f.total}>{fmt(total)}</Text>
          <Text style={f.count}>{filtered.length} transactions</Text>
        </View>
        <FlatList
          data={filtered}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item: txn }) => (
            <View style={f.row}>
              <View>
                <Text style={f.merchant}>{txn.merchantName}</Text>
                <Text style={f.category}>{txn.categoryL2 || txn.categoryL1} · {txn.date}</Text>
              </View>
              <Text style={[f.amount, txn.amount < 0 && { color: '#4ade80' }]}>
                {txn.amount < 0 ? '+' : '-'}{fmt(Math.abs(txn.amount))}
              </Text>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#1e293b' }} />}
        />
        <TouchableOpacity style={f.closeBtn} onPress={onClose}>
          <Text style={f.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  const transactions = useCurrentMonthTransactions();
  const { accounts, loading: accountsLoading } = useAccounts();

  const totalBalance = useTotalBalance(accounts);
  const monthlyIncome = useMonthlyIncome(transactions);
  const monthlySpend = useMonthlySpend(transactions);
  const free = monthlyIncome - monthlySpend;

  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [sankeyNode, setSankeyNode] = useState<string | null>(null);
  const [showAllTxns, setShowAllTxns] = useState(false);

  const sankeyData = useMemo(
    () => buildSankeyData(transactions, monthlyIncome),
    [transactions, monthlyIncome]
  );

  const sorted = useMemo(
    () => [...transactions].sort((a, b) => b.date.localeCompare(a.date)),
    [transactions]
  );

  const recent = showAllTxns ? sorted : sorted.slice(0, 8);

  const handleNodePress = useCallback((name: string) => {
    setSankeyNode(name === 'Income' ? null : name);
  }, []);

  if (accountsLoading) {
    return (
      <View style={[s.container, s.emptyContainer]}>
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  if (accounts.length === 0) {
    return (
      <View style={[s.container, s.emptyContainer, { paddingTop: top + 16 }]}>
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
            <Text style={[s.pillValue, { color: free >= 0 ? '#a5b4fc' : '#ef4444' }]}>{fmt(free)}</Text>
          </View>
        </View>

        {/* Sankey chart — tap a node to drill down */}
        {sankeyData.nodes.length > 1 && (
          <View style={s.sankeyContainer}>
            <Text style={s.sectionLabel}>WHERE IT'S GOING · tap to explore</Text>
            <SankeyChart
              data={sankeyData}
              width={width - 32}
              height={300}
              onNodePress={handleNodePress}
            />
          </View>
        )}

        {/* Recent transactions */}
        <View style={s.recentContainer}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionLabel}>
              {showAllTxns ? `ALL TRANSACTIONS (${sorted.length})` : 'RECENT'}
            </Text>
            {sorted.length > 8 && (
              <TouchableOpacity onPress={() => setShowAllTxns(v => !v)}>
                <Text style={s.viewAllText}>{showAllTxns ? 'Show less' : `View all ${sorted.length}`}</Text>
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

          {transactions.length === 0 && (
            <Text style={s.emptyTxn}>No transactions this month yet.</Text>
          )}
        </View>
      </ScrollView>

      <TxnDetailModal txn={selectedTxn} onClose={() => setSelectedTxn(null)} />
      <FilteredTxnModal
        nodeName={sankeyNode}
        transactions={transactions}
        onClose={() => setSankeyNode(null)}
      />
    </>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 40 },
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
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  viewAllText: { fontSize: 11, color: '#6366f1' },
  recentContainer: { marginBottom: 24 },
  txnRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  txnLeft: { flex: 1, marginRight: 12 },
  txnMerchant: { fontSize: 13, color: '#cbd5e1' },
  txnCategory: { fontSize: 11, color: '#475569', marginTop: 2 },
  txnAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  emptyTxn: { fontSize: 12, color: '#334155', textAlign: 'center', paddingVertical: 20 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 16, color: '#cbd5e1', fontWeight: '300', marginBottom: 8 },
  emptySub: { fontSize: 12, color: '#475569', textAlign: 'center' },
});

// Transaction detail modal styles
const d = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#1e293b', borderRadius: 16, padding: 24 },
  merchant: { fontSize: 16, color: '#f1f5f9', fontWeight: '600', marginBottom: 4 },
  amount: { fontSize: 28, color: '#f1f5f9', fontWeight: '300', marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  label: { fontSize: 10, color: '#475569', letterSpacing: 1 },
  value: { fontSize: 13, color: '#cbd5e1' },
  pendingBadge: { backgroundColor: '#451a03', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 12 },
  pendingText: { fontSize: 9, color: '#f59e0b', letterSpacing: 1 },
  closeBtn: { backgroundColor: '#334155', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 20 },
  closeBtnText: { color: '#cbd5e1', fontSize: 14 },
});

// Filtered transactions modal styles
const f = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  title: { fontSize: 20, color: '#f1f5f9', fontWeight: '600' },
  total: { fontSize: 28, color: '#f8fafc', fontWeight: '300', marginTop: 4 },
  count: { fontSize: 11, color: '#475569', marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  merchant: { fontSize: 13, color: '#cbd5e1' },
  category: { fontSize: 11, color: '#475569', marginTop: 2 },
  amount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  closeBtn: { margin: 16, backgroundColor: '#1e293b', borderRadius: 8, padding: 14, alignItems: 'center' },
  closeBtnText: { color: '#94a3b8', fontSize: 14 },
});
