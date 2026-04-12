import React, { useState, useCallback } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBudgets, createBudget, deleteBudget } from '../hooks/useBudgets';
import { useGoals, createGoal, updateGoalProgress, deleteGoal } from '../hooks/useGoals';
import { useCurrentMonthTransactions, useMonthlyIncome, useMonthlySpend } from '../hooks/useTransactions';

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

const EMOJI_OPTIONS = ['💰','🏠','🚗','🍔','✈️','🎮','👕','💊','📱','🎓','🐶','☕'];
const COLOR_OPTIONS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#a855f7','#f97316','#ec4899'];

function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return (
    <View style={p.emojiRow}>
      {EMOJI_OPTIONS.map(e => (
        <TouchableOpacity
          key={e}
          style={[p.emojiBtn, value === e && p.emojiBtnSelected]}
          onPress={() => onChange(e)}
        >
          <Text style={p.emojiText}>{e}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <View style={p.emojiRow}>
      {COLOR_OPTIONS.map(c => (
        <TouchableOpacity
          key={c}
          style={[p.colorBtn, { backgroundColor: c }, value === c && p.colorBtnSelected]}
          onPress={() => onChange(c)}
        />
      ))}
    </View>
  );
}

// ─── Add Budget Modal ───────────────────────────────────────────────────────

function AddBudgetModal({ visible, onClose, onSaved }: {
  visible: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💰');
  const [limit, setLimit] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setEmoji('💰'); setLimit(''); setColor('#6366f1'); };

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Name required');
    const amount = parseFloat(limit);
    if (isNaN(amount) || amount <= 0) return Alert.alert('Enter a valid limit');
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={p.modalWrap}>
        <View style={p.modalHandle} />
        <Text style={p.modalTitle}>New Budget</Text>

        <Text style={p.fieldLabel}>CATEGORY NAME</Text>
        <TextInput
          style={p.input}
          placeholder="e.g. Groceries"
          placeholderTextColor="#475569"
          value={name}
          onChangeText={setName}
        />

        <Text style={p.fieldLabel}>ICON</Text>
        <EmojiPicker value={emoji} onChange={setEmoji} />

        <Text style={p.fieldLabel}>MONTHLY LIMIT</Text>
        <TextInput
          style={p.input}
          placeholder="500"
          placeholderTextColor="#475569"
          keyboardType="numeric"
          value={limit}
          onChangeText={setLimit}
        />

        <Text style={p.fieldLabel}>COLOR</Text>
        <ColorPicker value={color} onChange={setColor} />

        <TouchableOpacity style={p.saveBtn} onPress={handleSave} disabled={saving}>
          <Text style={p.saveBtnText}>{saving ? 'Saving…' : 'Add Budget'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={p.cancelBtn} onPress={onClose}>
          <Text style={p.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Add Goal Modal ─────────────────────────────────────────────────────────

function AddGoalModal({ visible, onClose, onSaved }: {
  visible: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🎯');
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('0');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setEmoji('🎯'); setTarget(''); setCurrent('0'); };

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Name required');
    const t = parseFloat(target);
    if (isNaN(t) || t <= 0) return Alert.alert('Enter a valid target');
    setSaving(true);
    try {
      await createGoal(name.trim(), emoji, t, parseFloat(current) || 0, null);
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={p.modalWrap}>
        <View style={p.modalHandle} />
        <Text style={p.modalTitle}>New Goal</Text>

        <Text style={p.fieldLabel}>GOAL NAME</Text>
        <TextInput
          style={p.input}
          placeholder="e.g. Emergency Fund"
          placeholderTextColor="#475569"
          value={name}
          onChangeText={setName}
        />

        <Text style={p.fieldLabel}>ICON</Text>
        <EmojiPicker value={emoji} onChange={setEmoji} />

        <Text style={p.fieldLabel}>TARGET AMOUNT</Text>
        <TextInput
          style={p.input}
          placeholder="10000"
          placeholderTextColor="#475569"
          keyboardType="numeric"
          value={target}
          onChangeText={setTarget}
        />

        <Text style={p.fieldLabel}>SAVED SO FAR</Text>
        <TextInput
          style={p.input}
          placeholder="0"
          placeholderTextColor="#475569"
          keyboardType="numeric"
          value={current}
          onChangeText={setCurrent}
        />

        <TouchableOpacity style={p.saveBtn} onPress={handleSave} disabled={saving}>
          <Text style={p.saveBtnText}>{saving ? 'Saving…' : 'Add Goal'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={p.cancelBtn} onPress={onClose}>
          <Text style={p.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PlanScreen() {
  const { top } = useSafeAreaInsets();
  const transactions = useCurrentMonthTransactions();
  const budgets = useBudgets(transactions);
  const { goals, reload: reloadGoals } = useGoals();
  const income = useMonthlyIncome(transactions);
  const spent = useMonthlySpend(transactions);

  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [budgetVersion, setBudgetVersion] = useState(0);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysPassed = now.getDate();
  const projectedSpend = daysPassed > 0 ? (spent / daysPassed) * daysInMonth : 0;
  const projectedRemaining = income - projectedSpend;

  const handleDeleteBudget = useCallback((id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteBudget(id);
          setBudgetVersion(v => v + 1);
        },
      },
    ]);
  }, []);

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
      'Enter current saved amount:',
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
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>

      {/* Projection banner */}
      <View style={s.projectionCard}>
        <Text style={s.sectionLabel}>END OF MONTH PROJECTION</Text>
        <Text style={[s.projectionAmount, projectedRemaining < 0 && { color: '#ef4444' }]}>
          {fmt(projectedRemaining)}
        </Text>
        <Text style={s.projectionSub}>
          {projectedRemaining >= 0 ? 'on track' : 'over budget'} · based on {daysPassed} days
        </Text>
      </View>

      {/* Budget envelopes */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionLabel}>BUDGETS</Text>
        <TouchableOpacity onPress={() => setShowBudgetModal(true)}>
          <Text style={s.addText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {budgets.length === 0 ? (
        <TouchableOpacity style={s.emptyCard} onPress={() => setShowBudgetModal(true)}>
          <Text style={s.emptyCardText}>Tap to add your first budget category</Text>
        </TouchableOpacity>
      ) : (
        budgets.map(b => (
          <TouchableOpacity
            key={`${b.id}-${budgetVersion}`}
            style={s.budgetCard}
            onLongPress={() => handleDeleteBudget(b.id, b.name)}
          >
            <View style={s.budgetRow}>
              <Text style={s.budgetName}>{b.emoji} {b.name}</Text>
              <Text style={[s.budgetAmount, b.spent > b.monthlyLimit && { color: '#ef4444' }]}>
                {fmt(b.spent)} <Text style={s.budgetLimit}>/ {fmt(b.monthlyLimit)}</Text>
              </Text>
            </View>
            <ProgressBar ratio={b.monthlyLimit > 0 ? b.spent / b.monthlyLimit : 0} />
          </TouchableOpacity>
        ))
      )}

      {/* Savings goals */}
      <View style={[s.sectionHeader, { marginTop: 24 }]}>
        <Text style={s.sectionLabel}>GOALS</Text>
        <TouchableOpacity onPress={() => setShowGoalModal(true)}>
          <Text style={s.addText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {goals.length === 0 ? (
        <TouchableOpacity style={s.emptyCard} onPress={() => setShowGoalModal(true)}>
          <Text style={s.emptyCardText}>Tap to add your first savings goal</Text>
        </TouchableOpacity>
      ) : (
        goals.map(g => (
          <TouchableOpacity
            key={g.id}
            style={s.goalCard}
            onPress={() => handleUpdateProgress(g.id, g.currentAmount)}
            onLongPress={() => handleDeleteGoal(g.id, g.name)}
          >
            <View style={s.budgetRow}>
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
        onSaved={() => setBudgetVersion(v => v + 1)}
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
  content: { padding: 16, paddingBottom: 40 },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  addText: { fontSize: 12, color: '#6366f1', fontWeight: '600' },
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
  goalSub: { fontSize: 10, color: '#475569', marginTop: 6 },
  emptyCard: {
    borderWidth: 1, borderColor: '#1e293b', borderStyle: 'dashed',
    borderRadius: 8, padding: 20, alignItems: 'center', marginBottom: 10,
  },
  emptyCardText: { fontSize: 12, color: '#475569' },
});

const p = StyleSheet.create({
  modalWrap: { flex: 1, backgroundColor: '#0f172a', padding: 24 },
  modalHandle: { width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 18, color: '#f1f5f9', fontWeight: '600', marginBottom: 24 },
  fieldLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 8, marginTop: 16 },
  input: {
    backgroundColor: '#1e293b', borderRadius: 8, padding: 12,
    color: '#f1f5f9', fontSize: 14,
  },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiBtn: { padding: 6, borderRadius: 6, backgroundColor: '#1e293b' },
  emojiBtnSelected: { backgroundColor: '#312e81' },
  emojiText: { fontSize: 20 },
  colorBtn: { width: 28, height: 28, borderRadius: 14 },
  colorBtnSelected: { borderWidth: 2, borderColor: '#f1f5f9' },
  saveBtn: { backgroundColor: '#6366f1', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 32 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#475569', fontSize: 14 },
});
