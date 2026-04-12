import React, { useState, useCallback, useMemo } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBudgets, createBudget, deleteBudget } from '../hooks/useBudgets';
import { useGoals, createGoal, updateGoalProgress, deleteGoal } from '../hooks/useGoals';
import { useCurrentMonthTransactions, useMonthlyIncome, useMonthlySpend } from '../hooks/useTransactions';
import Transaction from '../db/models/Transaction';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function ProgressBar({ ratio }: { ratio: number }) {
  const clamped = Math.min(1, ratio);
  const barColor = ratio > 1 ? '#ef4444' : ratio > 0.7 ? '#f59e0b' : '#22c55e';
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
        <TouchableOpacity key={e} style={[m.emojiBtn, value === e && m.emojiBtnSelected]} onPress={() => onChange(e)}>
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
          style={[m.colorBtn, { backgroundColor: c }, value === c && m.colorBtnSelected]}
          onPress={() => onChange(c)}
        />
      ))}
    </View>
  );
}

// Deduplicated list of categoryL1 + categoryL2 values from actual transactions
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

// ─── Add Budget Modal ────────────────────────────────────────────────────────

function AddBudgetModal({ visible, onClose, onSaved, transactions }: {
  visible: boolean; onClose: () => void; onSaved: () => void; transactions: Transaction[];
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💰');
  const [limit, setLimit] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);
  const categoryOptions = useCategoryOptions(transactions);

  const reset = () => { setName(''); setEmoji('💰'); setLimit(''); setColor('#6366f1'); };

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
              <View style={m.suggestionRow}>
                {categoryOptions.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[m.suggestionChip, name === c && m.suggestionChipSelected]}
                    onPress={() => setName(c)}
                  >
                    <Text style={[m.suggestionText, name === c && { color: '#f1f5f9' }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={m.label}>NAME</Text>
          <TextInput
            style={m.input}
            placeholder="e.g. Food and Drink"
            placeholderTextColor="#475569"
            value={name}
            onChangeText={setName}
          />

          <Text style={m.label}>ICON</Text>
          <EmojiPicker value={emoji} onChange={setEmoji} />

          <Text style={m.label}>MONTHLY LIMIT</Text>
          <TextInput
            style={m.input}
            placeholder="500"
            placeholderTextColor="#475569"
            keyboardType="numeric"
            value={limit}
            onChangeText={setLimit}
          />

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

// ─── Add Goal Modal ──────────────────────────────────────────────────────────

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

    // Validate date if provided
    let date: string | null = null;
    if (targetDate.trim()) {
      const d = new Date(targetDate.trim());
      if (isNaN(d.getTime())) return Alert.alert('Invalid date', 'Use YYYY-MM-DD format.');
      date = targetDate.trim();
    }

    setSaving(true);
    try {
      await createGoal(name.trim(), emoji, t, parseFloat(current) || 0, date);
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
        <View style={m.handle} />
        <Text style={m.title}>New Goal</Text>

        <Text style={m.label}>GOAL NAME</Text>
        <TextInput
          style={m.input}
          placeholder="e.g. Emergency Fund"
          placeholderTextColor="#475569"
          value={name}
          onChangeText={setName}
        />

        <Text style={m.label}>ICON</Text>
        <EmojiPicker value={emoji} onChange={setEmoji} />

        <Text style={m.label}>TARGET AMOUNT</Text>
        <TextInput
          style={m.input}
          placeholder="10000"
          placeholderTextColor="#475569"
          keyboardType="numeric"
          value={target}
          onChangeText={setTarget}
        />

        <Text style={m.label}>SAVED SO FAR</Text>
        <TextInput
          style={m.input}
          placeholder="0"
          placeholderTextColor="#475569"
          keyboardType="numeric"
          value={current}
          onChangeText={setCurrent}
        />

        <Text style={m.label}>TARGET DATE (optional)</Text>
        <TextInput
          style={m.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#475569"
          value={targetDate}
          onChangeText={setTargetDate}
          maxLength={10}
        />

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

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PlanScreen() {
  const { top } = useSafeAreaInsets();
  const transactions = useCurrentMonthTransactions();
  const { budgets, reload: reloadBudgets } = useBudgets(transactions);
  const { goals, reload: reloadGoals } = useGoals();
  const income = useMonthlyIncome(transactions);
  const spent = useMonthlySpend(transactions);
  const [refreshing, setRefreshing] = useState(false);

  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const projectedSpend = daysPassed > 0 ? (spent / daysPassed) * daysInMonth : 0;
  const projectedRemaining = income - projectedSpend;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reloadBudgets(), reloadGoals()]);
    setRefreshing(false);
  }, [reloadBudgets, reloadGoals]);

  const handleDeleteBudget = useCallback((id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => { await deleteBudget(id); reloadBudgets(); },
      },
    ]);
  }, [reloadBudgets]);

  const handleDeleteGoal = useCallback((id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => { await deleteGoal(id); reloadGoals(); },
      },
    ]);
  }, [reloadGoals]);

  const handleUpdateProgress = useCallback((id: string, current: number) => {
    Alert.prompt(
      'Update Progress',
      'Current saved amount:',
      async (value) => {
        const amount = parseFloat(value);
        if (!isNaN(amount) && amount >= 0) {
          await updateGoalProgress(id, amount);
          reloadGoals();
        }
      },
      'plain-text',
      String(current),
      'numeric'
    );
  }, [reloadGoals]);

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={[s.content, { paddingTop: top + 16 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6366f1" />}
    >
      {/* Projection banner */}
      <View style={s.projectionCard}>
        <Text style={s.sectionLabel}>END OF MONTH PROJECTION</Text>
        <Text style={[s.projectionAmount, projectedRemaining < 0 && { color: '#ef4444' }]}>
          {fmt(Math.abs(projectedRemaining))}
          {projectedRemaining < 0 && <Text style={{ fontSize: 14 }}> over</Text>}
        </Text>
        <Text style={s.projectionSub}>
          {projectedRemaining >= 0 ? 'on track' : 'over budget'} · based on {daysPassed} of {daysInMonth} days
        </Text>
      </View>

      {/* Budgets */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionLabel}>BUDGETS</Text>
        <TouchableOpacity onPress={() => setShowBudgetModal(true)}>
          <Text style={s.addText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {budgets.length === 0 ? (
        <TouchableOpacity style={s.emptyCard} onPress={() => setShowBudgetModal(true)}>
          <Text style={s.emptyTitle}>No budgets yet</Text>
          <Text style={s.emptyHint}>Tap to add your first category</Text>
        </TouchableOpacity>
      ) : (
        budgets.map(b => (
          <TouchableOpacity
            key={b.id}
            style={s.budgetCard}
            onLongPress={() => handleDeleteBudget(b.id, b.name)}
          >
            <View style={s.row}>
              <Text style={s.budgetName}>{b.emoji} {b.name}</Text>
              <Text style={[s.budgetAmount, b.spent > b.monthlyLimit && { color: '#ef4444' }]}>
                {fmt(b.spent)} <Text style={s.budgetLimit}>/ {fmt(b.monthlyLimit)}</Text>
              </Text>
            </View>
            <ProgressBar ratio={b.monthlyLimit > 0 ? b.spent / b.monthlyLimit : 0} />
          </TouchableOpacity>
        ))
      )}

      {/* Goals */}
      <View style={[s.sectionHeader, { marginTop: 28 }]}>
        <Text style={s.sectionLabel}>GOALS</Text>
        <TouchableOpacity onPress={() => setShowGoalModal(true)}>
          <Text style={s.addText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {goals.length === 0 ? (
        <TouchableOpacity style={s.emptyCard} onPress={() => setShowGoalModal(true)}>
          <Text style={s.emptyTitle}>No goals yet</Text>
          <Text style={s.emptyHint}>Tap to add your first savings goal</Text>
        </TouchableOpacity>
      ) : (
        goals.map(g => (
          <TouchableOpacity
            key={g.id}
            style={s.goalCard}
            onPress={() => handleUpdateProgress(g.id, g.currentAmount)}
            onLongPress={() => handleDeleteGoal(g.id, g.name)}
          >
            <View style={s.row}>
              <Text style={s.budgetName}>{g.emoji} {g.name}</Text>
              <Text style={s.goalPercent}>{g.progressPercent}%</Text>
            </View>
            <ProgressBar ratio={g.progressPercent / 100} />
            <Text style={s.goalSub}>
              {fmt(g.currentAmount)} of {fmt(g.targetAmount)}
              {g.monthsLeft !== null ? ` · ~${g.monthsLeft}mo left` : ''}
            </Text>
          </TouchableOpacity>
        ))
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
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 48 },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  addText: { fontSize: 12, color: '#6366f1', fontWeight: '600' },
  projectionCard: { backgroundColor: '#1e293b', borderRadius: 10, padding: 16, marginBottom: 28 },
  projectionAmount: { fontSize: 32, fontWeight: '300', color: '#f8fafc', marginVertical: 6 },
  projectionSub: { fontSize: 11, color: '#64748b' },
  budgetCard: { marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  budgetName: { fontSize: 13, color: '#cbd5e1' },
  budgetAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  budgetLimit: { color: '#475569' },
  goalCard: { backgroundColor: '#1e293b', borderRadius: 8, padding: 14, marginBottom: 10 },
  goalPercent: { fontSize: 12, color: '#a5b4fc' },
  goalSub: { fontSize: 10, color: '#475569', marginTop: 6 },
  emptyCard: {
    borderWidth: 1, borderColor: '#1e293b', borderStyle: 'dashed',
    borderRadius: 8, padding: 20, alignItems: 'center', marginBottom: 10,
  },
  emptyTitle: { fontSize: 13, color: '#475569', fontWeight: '500' },
  emptyHint: { fontSize: 11, color: '#334155', marginTop: 4 },
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
  emojiBtnSelected: { backgroundColor: '#312e81' },
  colorBtn: { width: 28, height: 28, borderRadius: 14 },
  colorBtnSelected: { borderWidth: 3, borderColor: '#f1f5f9' },
  suggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  suggestionChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: '#1e293b', borderRadius: 99,
    borderWidth: 1, borderColor: '#334155',
  },
  suggestionChipSelected: { backgroundColor: '#312e81', borderColor: '#6366f1' },
  suggestionText: { fontSize: 11, color: '#64748b' },
  saveBtn: { backgroundColor: '#6366f1', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 28 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  cancelBtn: { padding: 14, alignItems: 'center' },
  cancelBtnText: { color: '#475569', fontSize: 14 },
});
