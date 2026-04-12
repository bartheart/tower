import React, { useState, useCallback, useMemo } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  RefreshControl, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBudgets, createBudget, updateBudget, deleteBudget } from '../hooks/useBudgets';
import { useGoals, createGoal, updateGoalProgress, deleteGoal } from '../hooks/useGoals';
import { useCurrentPeriodTransactions, useMonthlyIncome } from '../hooks/useTransactions';
import SankeyChart from '../sankey/SankeyChart';
import { buildSankeyData } from '../sankey/buildGraph';
import Transaction from '../db/models/Transaction';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function ProgressBar({ ratio, color = '#22c55e' }: { ratio: number; color?: string }) {
  const clamped = Math.min(1, ratio);
  const barColor = ratio > 1 ? '#ef4444' : ratio > 0.9 ? '#ef4444' : ratio > 0.7 ? '#f59e0b' : color;
  return (
    <View style={{ backgroundColor: '#1e293b', borderRadius: 99, height: 4, marginTop: 6 }}>
      <View style={{ backgroundColor: barColor, width: `${clamped * 100}%`, height: '100%', borderRadius: 99 }} />
    </View>
  );
}

const EMOJI_OPTIONS = ['💰','🏠','🚗','🍔','✈️','🎮','👕','💊','📱','🎓','🐶','☕','🛒','🍕','🏋️'];
const COLOR_OPTIONS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#a855f7','#f97316','#ec4899'];

function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return (
    <View style={m.emojiRow}>
      {EMOJI_OPTIONS.map(e => (
        <TouchableOpacity key={e} style={[m.emojiBtn, value === e && m.emojiBtnSel]} onPress={() => onChange(e)}>
          <Text style={{ fontSize: 20 }}>{e}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <View style={m.emojiRow}>
      {COLOR_OPTIONS.map(c => (
        <TouchableOpacity
          key={c}
          style={[m.colorBtn, { backgroundColor: c }, value === c && m.colorBtnSel]}
          onPress={() => onChange(c)}
        />
      ))}
    </View>
  );
}

function useCategoryOptions(transactions: Transaction[]): string[] {
  return useMemo(() => {
    const set = new Set<string>();
    for (const txn of transactions) {
      if (txn.amount > 0 && txn.categoryL1 !== 'Income' && !txn.categoryL1.includes('Transfer')) {
        set.add(txn.categoryL1);
        if (txn.categoryL2 && txn.categoryL2 !== txn.categoryL1) set.add(txn.categoryL2);
      }
    }
    return Array.from(set).sort();
  }, [transactions]);
}

// ─── Add Budget Modal ─────────────────────────────────────────────────────────

function AddBudgetModal({ visible, onClose, onSaved, transactions }: {
  visible: boolean; onClose: () => void; onSaved: () => void; transactions: Transaction[];
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💰');
  const [limit, setLimit] = useState('');
  const [pct, setPct] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);
  const categoryOptions = useCategoryOptions(transactions);

  const reset = () => { setName(''); setEmoji('💰'); setLimit(''); setPct(''); setColor('#6366f1'); };

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Name required', 'Pick a category or type a name.');
    const amount = parseFloat(limit);
    if (isNaN(amount) || amount <= 0) return Alert.alert('Invalid limit', 'Enter a dollar amount.');
    setSaving(true);
    try {
      await createBudget(name.trim(), emoji, amount, color);
      reset();
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={m.wrap}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={m.handle} />
          <Text style={m.title}>New Budget</Text>

          {categoryOptions.length > 0 && (
            <>
              <Text style={m.label}>YOUR CATEGORIES</Text>
              <Text style={m.hint}>Tap to use — name must match exactly for spend to be tracked</Text>
              <View style={m.chipRow}>
                {categoryOptions.map(c => (
                  <TouchableOpacity
                    key={c} style={[m.chip, name === c && m.chipSel]}
                    onPress={() => setName(c)}
                  >
                    <Text style={[m.chipText, name === c && { color: '#f1f5f9' }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={m.label}>NAME</Text>
          <TextInput style={m.input} placeholder="e.g. Food and Drink" placeholderTextColor="#475569" value={name} onChangeText={setName} />

          <Text style={m.label}>ICON</Text>
          <EmojiPicker value={emoji} onChange={setEmoji} />

          <Text style={m.label}>MONTHLY LIMIT ($)</Text>
          <TextInput style={m.input} placeholder="500" placeholderTextColor="#475569" keyboardType="numeric" value={limit} onChangeText={setLimit} />

          <Text style={m.label}>INCOME TARGET % (optional — drives wellness score)</Text>
          <TextInput style={m.input} placeholder="e.g. 15" placeholderTextColor="#475569" keyboardType="numeric" value={pct} onChangeText={setPct} />

          <Text style={m.label}>COLOR</Text>
          <ColorPicker value={color} onChange={setColor} />

          <TouchableOpacity style={m.saveBtn} onPress={handleSave} disabled={saving}>
            <Text style={m.saveBtnText}>{saving ? 'Saving…' : 'Add Budget'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
            <Text style={m.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Add Goal Modal ───────────────────────────────────────────────────────────

function AddGoalModal({ visible, onClose, onSaved }: {
  visible: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🎯');
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('0');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setEmoji('🎯'); setTarget(''); setCurrent('0'); setTargetDate(''); };

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Name required');
    const t = parseFloat(target);
    if (isNaN(t) || t <= 0) return Alert.alert('Invalid target', 'Enter a dollar amount.');
    let date: string | null = null;
    if (targetDate.trim()) {
      const d = new Date(targetDate.trim());
      if (isNaN(d.getTime())) return Alert.alert('Invalid date', 'Use YYYY-MM-DD format.');
      date = targetDate.trim();
    }
    setSaving(true);
    try {
      await createGoal(name.trim(), emoji, t, parseFloat(current) || 0, date);
      reset(); onSaved(); onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={m.wrap}>
        <View style={m.handle} />
        <Text style={m.title}>New Goal</Text>
        <Text style={m.label}>GOAL NAME</Text>
        <TextInput style={m.input} placeholder="e.g. Emergency Fund" placeholderTextColor="#475569" value={name} onChangeText={setName} />
        <Text style={m.label}>ICON</Text>
        <EmojiPicker value={emoji} onChange={setEmoji} />
        <Text style={m.label}>TARGET AMOUNT</Text>
        <TextInput style={m.input} placeholder="10000" placeholderTextColor="#475569" keyboardType="numeric" value={target} onChangeText={setTarget} />
        <Text style={m.label}>SAVED SO FAR</Text>
        <TextInput style={m.input} placeholder="0" placeholderTextColor="#475569" keyboardType="numeric" value={current} onChangeText={setCurrent} />
        <Text style={m.label}>TARGET DATE (optional, YYYY-MM-DD)</Text>
        <TextInput style={m.input} placeholder="2027-01-01" placeholderTextColor="#475569" value={targetDate} onChangeText={setTargetDate} maxLength={10} />
        <TouchableOpacity style={m.saveBtn} onPress={handleSave} disabled={saving}>
          <Text style={m.saveBtnText}>{saving ? 'Saving…' : 'Add Goal'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
          <Text style={m.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Sankey Full Screen Modal ─────────────────────────────────────────────────

function SankeyModal({ visible, onClose, transactions, monthlyIncome }: {
  visible: boolean; onClose: () => void; transactions: Transaction[]; monthlyIncome: number;
}) {
  const { width } = useWindowDimensions();
  const sankeyData = useMemo(() => buildSankeyData(transactions, monthlyIncome), [transactions, monthlyIncome]);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#0f172a', padding: 16 }}>
        <View style={m.handle} />
        <Text style={[m.title, { marginBottom: 16 }]}>Where It Went</Text>
        {sankeyData.nodes.length > 1 ? (
          <SankeyChart data={sankeyData} width={width - 32} height={320} />
        ) : (
          <Text style={{ color: '#475569', textAlign: 'center', marginTop: 40 }}>
            Not enough data to show the flow chart yet.
          </Text>
        )}
        <TouchableOpacity style={[m.cancelBtn, { marginTop: 24 }]} onPress={onClose}>
          <Text style={m.cancelBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type PlanView = 'report' | 'planning';

export default function PlanScreen() {
  const { top } = useSafeAreaInsets();
  const transactions = useCurrentPeriodTransactions('month');
  const { budgets, reload: reloadBudgets } = useBudgets(transactions);
  const { goals, reload: reloadGoals } = useGoals();
  const monthlyIncome = useMonthlyIncome(transactions);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<PlanView>('report');

  // Report section
  const [showSankey, setShowSankey] = useState(false);

  // Planning section accordions
  const [bucketsOpen, setBucketsOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);

  // Edit state for income buckets
  const [editingPcts, setEditingPcts] = useState<Record<string, string>>({});
  const [savingPcts, setSavingPcts] = useState(false);

  // Modals
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reloadBudgets(), reloadGoals()]);
    setRefreshing(false);
  }, [reloadBudgets, reloadGoals]);

  const handleDeleteBudget = useCallback((id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteBudget(id); reloadBudgets(); } },
    ]);
  }, [reloadBudgets]);

  const handleDeleteGoal = useCallback((id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteGoal(id); reloadGoals(); } },
    ]);
  }, [reloadGoals]);

  const handleUpdateProgress = useCallback((id: string, current: number) => {
    Alert.prompt('Update Progress', 'Current saved amount:',
      async (value) => {
        const amount = parseFloat(value);
        if (!isNaN(amount) && amount >= 0) { await updateGoalProgress(id, amount); reloadGoals(); }
      },
      'plain-text', String(current), 'numeric'
    );
  }, [reloadGoals]);

  const openBucketEdit = useCallback(() => {
    const initial: Record<string, string> = {};
    budgets.forEach(b => { initial[b.id] = b.targetPct != null ? String(b.targetPct) : ''; });
    setEditingPcts(initial);
    setBucketsOpen(v => !v);
  }, [budgets]);

  const handleSavePcts = useCallback(async () => {
    setSavingPcts(true);
    try {
      await Promise.all(
        Object.entries(editingPcts).map(async ([id, pctStr]) => {
          const pct = parseFloat(pctStr);
          await updateBudget(id, { targetPct: isNaN(pct) || pct <= 0 ? 0 : pct });
        })
      );
      await reloadBudgets();
      setBucketsOpen(false);
    } catch (e: any) {
      Alert.alert('Error saving', e.message);
    } finally {
      setSavingPcts(false);
    }
  }, [editingPcts, reloadBudgets]);

  const allocatedTotal = useMemo(() =>
    Object.values(editingPcts).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [editingPcts]
  );

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={[s.content, { paddingTop: top + 16 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6366f1" />}
    >
      {/* Report / Planning toggle */}
      <View style={s.toggle}>
        {(['report', 'planning'] as PlanView[]).map(v => (
          <TouchableOpacity
            key={v}
            style={[s.toggleBtn, view === v && s.toggleBtnActive]}
            onPress={() => setView(v)}
          >
            <Text style={[s.toggleText, view === v && s.toggleTextActive]}>
              {v === 'report' ? 'Report' : 'Planning'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ��─ REPORT VIEW ────────────────────────────────── */}
      {view === 'report' && (
        <>
          <Text style={s.sectionLabel}>WHERE IT WENT · this month</Text>

          {budgets.length === 0 ? (
            <Text style={s.emptyHint}>Add budgets in Planning to see your report.</Text>
          ) : (
            budgets.map(b => {
              const ratio = b.monthlyLimit > 0 ? b.spent / b.monthlyLimit : 0;
              const barColor = ratio > 1 ? '#ef4444' : ratio > 0.7 ? '#f59e0b' : b.color;
              return (
                <View key={b.id} style={s.reportRow}>
                  <View style={s.reportRowTop}>
                    <Text style={s.reportName}>{b.emoji} {b.name}</Text>
                    <Text style={[s.reportAmount, ratio > 1 && { color: '#ef4444' }]}>
                      {fmt(b.spent)}{ratio > 1 ? ' ⚠' : ''}
                    </Text>
                  </View>
                  <View style={s.barTrack}>
                    <View style={[s.barFill, { width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: barColor }]} />
                  </View>
                </View>
              );
            })
          )}

          <TouchableOpacity style={s.sankeyBtn} onPress={() => setShowSankey(true)}>
            <Text style={s.sankeyBtnText}>Open full flow analysis →</Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── PLANNING VIEW ──────────────────────────────── */}
      {view === 'planning' && (
        <>
          {/* Income Buckets accordion */}
          <TouchableOpacity style={s.accordion} onPress={openBucketEdit}>
            <View>
              <Text style={s.accordionTitle}>💰 Income Buckets</Text>
              <Text style={s.accordionSub}>Set % per category · drives wellness score</Text>
            </View>
            <Text style={s.chevron}>{bucketsOpen ? '⌃' : '⌄'}</Text>
          </TouchableOpacity>

          {bucketsOpen && (
            <View style={s.accordionBody}>
              {budgets.length === 0 ? (
                <Text style={s.emptyHint}>No budgets yet. Add one below first.</Text>
              ) : (
                budgets.map(b => (
                  <View key={b.id} style={s.bucketRow}>
                    <TouchableOpacity
                      style={s.bucketDelete}
                      onLongPress={() => handleDeleteBudget(b.id, b.name)}
                    >
                      <Text style={s.bucketName}>{b.emoji} {b.name}</Text>
                      <Text style={s.bucketLimit}>{fmt(b.monthlyLimit)}/mo</Text>
                    </TouchableOpacity>
                    <View style={s.bucketPctWrap}>
                      <TextInput
                        style={s.bucketPctInput}
                        value={editingPcts[b.id] ?? ''}
                        onChangeText={v => setEditingPcts(prev => ({ ...prev, [b.id]: v }))}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor="#334155"
                      />
                      <Text style={s.bucketPctSymbol}>%</Text>
                    </View>
                  </View>
                ))
              )}

              <View style={s.bucketFooter}>
                <Text style={s.allocatedText}>
                  Allocated: {allocatedTotal.toFixed(0)}% of income
                  {monthlyIncome > 0 && ` · ${fmt(monthlyIncome * allocatedTotal / 100)}/mo`}
                </Text>
                <TouchableOpacity style={s.addBucketBtn} onPress={() => setShowBudgetModal(true)}>
                  <Text style={s.addBucketText}>＋ Add bucket</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={s.savePctsBtn} onPress={handleSavePcts} disabled={savingPcts}>
                <Text style={s.savePctsText}>{savingPcts ? 'Saving…' : 'Save Plan'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Savings Goals accordion */}
          <TouchableOpacity style={[s.accordion, { marginTop: 8 }]} onPress={() => setGoalsOpen(v => !v)}>
            <View>
              <Text style={s.accordionTitle}>🎯 Savings Goals</Text>
              <Text style={s.accordionSub}>{goals.length} active goal{goals.length !== 1 ? 's' : ''}</Text>
            </View>
            <Text style={s.chevron}>{goalsOpen ? '⌃' : '⌄'}</Text>
          </TouchableOpacity>

          {goalsOpen && (
            <View style={s.accordionBody}>
              {goals.length === 0 ? (
                <Text style={s.emptyHint}>No goals yet.</Text>
              ) : (
                goals.map(g => (
                  <TouchableOpacity
                    key={g.id}
                    style={s.goalRow}
                    onPress={() => handleUpdateProgress(g.id, g.currentAmount)}
                    onLongPress={() => handleDeleteGoal(g.id, g.name)}
                  >
                    <View style={s.goalRowTop}>
                      <Text style={s.reportName}>{g.emoji} {g.name}</Text>
                      <Text style={s.goalPct}>{g.progressPercent}%</Text>
                    </View>
                    <ProgressBar ratio={g.progressPercent / 100} color="#6366f1" />
                    <Text style={s.goalSub}>
                      {fmt(g.currentAmount)} of {fmt(g.targetAmount)}
                      {g.monthsLeft !== null ? ` · ~${g.monthsLeft}mo left` : ''}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
              <TouchableOpacity style={s.addBucketBtn} onPress={() => setShowGoalModal(true)}>
                <Text style={s.addBucketText}>＋ Add goal</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      <AddBudgetModal
        visible={showBudgetModal}
        onClose={() => setShowBudgetModal(false)}
        onSaved={reloadBudgets}
        transactions={transactions}
      />
      <AddGoalModal
        visible={showGoalModal}
        onClose={() => setShowGoalModal(false)}
        onSaved={reloadGoals}
      />
      <SankeyModal
        visible={showSankey}
        onClose={() => setShowSankey(false)}
        transactions={transactions}
        monthlyIncome={monthlyIncome}
      />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 100 },
  toggle: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 8, padding: 3, marginBottom: 20 },
  toggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  toggleBtnActive: { backgroundColor: '#334155' },
  toggleText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  toggleTextActive: { color: '#f1f5f9', fontWeight: '700' },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 10 },
  emptyHint: { fontSize: 12, color: '#334155', textAlign: 'center', paddingVertical: 16 },
  reportRow: { marginBottom: 12 },
  reportRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  reportName: { fontSize: 13, color: '#cbd5e1' },
  reportAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  barTrack: { backgroundColor: '#1e293b', borderRadius: 4, height: 6 },
  barFill: { height: 6, borderRadius: 4 },
  sankeyBtn: { marginTop: 12, backgroundColor: '#1e293b', borderRadius: 8, padding: 12, alignItems: 'center' },
  sankeyBtnText: { fontSize: 12, color: '#6366f1' },
  accordion: {
    backgroundColor: '#1e293b', borderRadius: 10, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 1,
  },
  accordionTitle: { fontSize: 13, color: '#f1f5f9', fontWeight: '600' },
  accordionSub: { fontSize: 10, color: '#475569', marginTop: 2 },
  chevron: { fontSize: 16, color: '#475569' },
  accordionBody: { backgroundColor: '#141c29', borderRadius: 10, padding: 12, marginBottom: 8 },
  bucketRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  bucketDelete: { flex: 1 },
  bucketName: { fontSize: 12, color: '#cbd5e1' },
  bucketLimit: { fontSize: 10, color: '#475569', marginTop: 1 },
  bucketPctWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bucketPctInput: {
    backgroundColor: '#1e293b', borderRadius: 6, padding: 6,
    color: '#a5b4fc', fontSize: 14, width: 52, textAlign: 'right',
  },
  bucketPctSymbol: { fontSize: 12, color: '#475569' },
  bucketFooter: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  allocatedText: { fontSize: 10, color: '#475569', flex: 1 },
  addBucketBtn: { backgroundColor: '#1e1b4b', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  addBucketText: { fontSize: 11, color: '#6366f1' },
  savePctsBtn: { backgroundColor: '#6366f1', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 12 },
  savePctsText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  goalRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  goalRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  goalPct: { fontSize: 12, color: '#a5b4fc' },
  goalSub: { fontSize: 10, color: '#475569', marginTop: 4 },
});

const m = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0f172a', padding: 24 },
  handle: { width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
  title: { fontSize: 18, color: '#f1f5f9', fontWeight: '600', marginBottom: 20 },
  label: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 8, marginTop: 18 },
  hint: { fontSize: 10, color: '#334155', marginBottom: 8 },
  input: { backgroundColor: '#1e293b', borderRadius: 8, padding: 12, color: '#f1f5f9', fontSize: 14 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiBtn: { padding: 6, borderRadius: 6, backgroundColor: '#1e293b' },
  emojiBtnSel: { backgroundColor: '#312e81' },
  colorBtn: { width: 28, height: 28, borderRadius: 14 },
  colorBtnSel: { borderWidth: 3, borderColor: '#f1f5f9' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#1e293b', borderRadius: 99, borderWidth: 1, borderColor: '#334155' },
  chipSel: { backgroundColor: '#312e81', borderColor: '#6366f1' },
  chipText: { fontSize: 11, color: '#64748b' },
  saveBtn: { backgroundColor: '#6366f1', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 28 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  cancelBtn: { padding: 14, alignItems: 'center' },
  cancelBtnText: { color: '#475569', fontSize: 14 },
});
