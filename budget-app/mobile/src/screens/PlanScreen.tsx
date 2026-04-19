import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  RefreshControl, useWindowDimensions, ActivityIndicator, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useBudgets, createBudget, updateBudget, deleteBudget, deleteBudgetWithRedistribution, rebalanceBucketPct } from '../hooks/useBudgets';
import type { BudgetCategory } from '../hooks/useBudgets';
import { useGoals, type Goal } from '../hooks/useGoals';
import { loadGoalEvents, GoalEvent, writeGoalEvent } from '../goals/goalEvents';
import { computeSuggestions, BudgetCut } from '../goals/suggestionEngine';
import { supabase } from '../supabase/client';
import { useCurrentPeriodTransactions } from '../hooks/useTransactions';
import { useIncome, confirmIncomeSource, dismissIncomeSource, addManualIncomeSource, deleteIncomeSource } from '../hooks/useIncome';
import { useFixedItems, confirmFixedItem, dismissFixedItem, recomputeFloor } from '../hooks/useFixedItems';
import type { FixedItem } from '../hooks/useFixedItems';
import { previewGoalAllocation, commitGoalAllocation, removeGoalAllocation } from '../budget/goalAllocator';
import Transaction from '../db/models/Transaction';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

const COLOR_OPTIONS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#a855f7','#f97316','#ec4899'];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <View style={m.row}>
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

// ─── Percent Slider ───────────────────────────────────────────────────────────

const THUMB_R = 12;

function PercentSlider({
  value, min, max, step = 0.5, onChange,
}: {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const widthRef = useRef(0);
  const trackPageXRef = useRef(0);
  const trackRef = useRef<View>(null);
  // propsRef is updated every render so PanResponder callbacks always see fresh props
  const propsRef = useRef({ min, max, step, onChange });
  propsRef.current = { min, max, step, onChange };

  const computeValue = (absoluteX: number) => {
    const { min: mn, max: mx, step: st, onChange: cb } = propsRef.current;
    const w = widthRef.current;
    if (w <= 0) return;
    const x = absoluteX - trackPageXRef.current;
    const raw = mn + (Math.max(0, Math.min(w, x)) / w) * (mx - mn);
    cb(Math.max(mn, Math.min(mx, Math.round(raw / st) * st)));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_, gestureState) => {
        // Re-measure on each grant to handle scroll offsets
        trackRef.current?.measure((_x, _y, _w, _h, pageX) => {
          trackPageXRef.current = pageX;
          computeValue(gestureState.x0);
        });
      },
      onPanResponderMove: (_, gestureState) => {
        computeValue(gestureState.moveX);
      },
    })
  ).current;

  const fraction = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const thumbX = trackWidth > 0 ? fraction * trackWidth : 0;

  return (
    <View
      ref={trackRef}
      style={ss.sliderTrack}
      onLayout={e => {
        const w = e.nativeEvent.layout.width;
        widthRef.current = w;
        setTrackWidth(w);
        // Cache pageX on layout too, so first tap is accurate even before a grant
        trackRef.current?.measure((_x, _y, _w, _h, pageX) => {
          trackPageXRef.current = pageX;
        });
      }}
      {...pan.panHandlers}
    >
      <View style={[ss.sliderFill, { width: thumbX }]} />
      {trackWidth > 0 && (
        <View style={[ss.sliderThumb, { left: thumbX - THUMB_R }]} />
      )}
    </View>
  );
}

// ─── Add Budget Modal ─────────────────────────────────────────────────────────

function AddBudgetModal({ visible, onClose, onSaved, transactions, confirmedMonthlyIncome }: {
  visible: boolean; onClose: () => void; onSaved: () => void;
  transactions: Transaction[]; confirmedMonthlyIncome: number;
}) {
  const [name, setName] = useState('');
  const [plaidCategory, setPlaidCategory] = useState('');
  const [limit, setLimit] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);
  const categoryOptions = useCategoryOptions(transactions);

  const reset = () => { setName(''); setPlaidCategory(''); setLimit(''); setColor('#6366f1'); };

  const pctPreview = confirmedMonthlyIncome > 0 && parseFloat(limit) > 0
    ? ((parseFloat(limit) / confirmedMonthlyIncome) * 100).toFixed(1)
    : null;

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Name required', 'Pick a category or type a name.');
    const amount = parseFloat(limit);
    if (isNaN(amount) || amount <= 0) return Alert.alert('Invalid amount', 'Enter a dollar amount.');
    const targetPct = confirmedMonthlyIncome > 0 ? (amount / confirmedMonthlyIncome) * 100 : undefined;
    setSaving(true);
    try {
      await createBudget(name.trim(), '💰', amount, color, plaidCategory || undefined, targetPct);
      reset(); onSaved(); onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={m.wrap}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={m.handle} />
          <Text style={m.title}>New Bucket</Text>
          {categoryOptions.length > 0 && (
            <>
              <Text style={m.label}>TRANSACTION CATEGORY</Text>
              <Text style={m.hint}>Tap to link — transactions in this Plaid category count toward this bucket's spend</Text>
              <View style={m.chipRow}>
                {categoryOptions.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[m.chip, plaidCategory === c && m.chipSel]}
                    onPress={() => {
                      setPlaidCategory(c);
                      if (!name) setName(c); // pre-fill name only if empty
                    }}
                  >
                    <Text style={[m.chipText, plaidCategory === c && { color: '#f1f5f9' }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <Text style={m.label}>BUCKET NAME</Text>
          <TextInput style={m.input} placeholder="e.g. Eating Out" placeholderTextColor="#475569" value={name} onChangeText={setName} />
          <Text style={m.label}>MONTHLY AMOUNT ($)</Text>
          <View style={{ position: 'relative' }}>
            <TextInput
              style={m.input}
              placeholder="500"
              placeholderTextColor="#475569"
              keyboardType="numeric"
              value={limit}
              onChangeText={setLimit}
            />
            {pctPreview && (
              <Text style={m.pctHint}>= {pctPreview}% of income</Text>
            )}
          </View>
          <Text style={m.label}>COLOR</Text>
          <ColorPicker value={color} onChange={setColor} />
          <TouchableOpacity style={m.saveBtn} onPress={handleSave} disabled={saving}>
            <Text style={m.saveBtnText}>{saving ? 'Saving…' : 'Add Bucket'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
            <Text style={m.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Add Goal Modal (with allocator preview) ─────────────────────────────────

function AddGoalModal({ visible, onClose, onSaved, budgets, confirmedMonthlyIncome }: {
  visible: boolean; onClose: () => void; onSaved: () => void;
  budgets: ReturnType<typeof useBudgets>['budgets'];
  confirmedMonthlyIncome: number;
}) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('0');
  const [targetDate, setTargetDate] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [preview, setPreview] = useState<ReturnType<typeof previewGoalAllocation> | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName(''); setTarget(''); setCurrent('0'); setTargetDate('');
    setColor('#6366f1'); setStep('form'); setPreview(null);
  };

  const handlePreview = () => {
    if (!name.trim()) return Alert.alert('Name required');
    const t = parseFloat(target);
    if (isNaN(t) || t <= 0) return Alert.alert('Invalid target', 'Enter a dollar amount.');
    if (!targetDate.trim()) return Alert.alert('Date required', 'Enter a target date (YYYY-MM-DD).');
    const d = new Date(targetDate.trim());
    if (isNaN(d.getTime()) || d <= new Date()) return Alert.alert('Invalid date', 'Date must be in the future.');

    if (confirmedMonthlyIncome <= 0) {
      return Alert.alert('No confirmed income', 'Add and confirm your income sources first in the Income tab.');
    }

    const p = previewGoalAllocation(
      { name: name.trim(), targetAmount: t, startingAmount: parseFloat(current) || 0, targetDate: targetDate.trim() },
      budgets,
      confirmedMonthlyIncome
    );
    setPreview(p);
    setStep('preview');
  };

  const handleConfirm = async () => {
    if (!preview || !preview.feasible) return;
    setSaving(true);
    try {
      await commitGoalAllocation(
        { name: name.trim(), targetAmount: parseFloat(target), startingAmount: parseFloat(current) || 0, targetDate: targetDate.trim() },
        preview,
        color
      );
      reset(); onSaved(); onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={m.wrap}>
        <View style={m.handle} />
        {step === 'form' ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={m.title}>New Goal</Text>
            <Text style={m.label}>GOAL NAME</Text>
            <TextInput style={m.input} placeholder="e.g. Emergency Fund" placeholderTextColor="#475569" value={name} onChangeText={setName} />
            <Text style={m.label}>TARGET AMOUNT</Text>
            <TextInput style={m.input} placeholder="10000" placeholderTextColor="#475569" keyboardType="numeric" value={target} onChangeText={setTarget} />
            <Text style={m.label}>ALREADY SAVED (STARTING BALANCE)</Text>
            <TextInput style={m.input} placeholder="0" placeholderTextColor="#475569" keyboardType="numeric" value={current} onChangeText={setCurrent} />
            <Text style={m.label}>TARGET DATE (YYYY-MM-DD)</Text>
            <TextInput style={m.input} placeholder="2027-01-01" placeholderTextColor="#475569" value={targetDate} onChangeText={setTargetDate} maxLength={10} />
            <Text style={m.label}>COLOR</Text>
            <ColorPicker value={color} onChange={setColor} />
            <TouchableOpacity style={m.saveBtn} onPress={handlePreview}>
              <Text style={m.saveBtnText}>Preview Impact</Text>
            </TouchableOpacity>
            <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
              <Text style={m.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <ScrollView>
            <Text style={m.title}>Review Allocation</Text>
            {preview && !preview.feasible ? (
              <View style={s.previewError}>
                <Text style={s.previewErrorTitle}>Not enough flexible budget</Text>
                <Text style={s.previewErrorBody}>
                  You need {preview.shortfallPct.toFixed(1)}% more slack.
                  Extend the goal timeline or confirm more fixed items.
                </Text>
              </View>
            ) : (
              <>
                <View style={s.previewSummary}>
                  <Text style={s.previewLabel}>MONTHLY CONTRIBUTION</Text>
                  <Text style={s.previewValue}>{fmt(preview?.monthlyContribution ?? 0)}/mo</Text>
                  <Text style={s.previewLabel}>ALLOCATED</Text>
                  <Text style={s.previewValue}>{preview?.goalTargetPct.toFixed(1)}% of income</Text>
                </View>
                <Text style={[m.label, { marginTop: 16 }]}>BUCKET REDUCTIONS</Text>
                {preview?.cuts.map(cut => (
                  <View key={cut.categoryId} style={s.previewCutRow}>
                    <Text style={s.previewCutName}>{cut.name}</Text>
                    <Text style={s.previewCutDelta}>{cut.oldPct.toFixed(1)}% → {cut.newPct.toFixed(1)}%</Text>
                  </View>
                ))}
                <TouchableOpacity style={m.saveBtn} onPress={handleConfirm} disabled={saving}>
                  <Text style={m.saveBtnText}>{saving ? 'Saving…' : 'Confirm Goal'}</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={m.cancelBtn} onPress={() => setStep('form')}>
              <Text style={m.cancelBtnText}>Back</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Add Income Modal ─────────────────────────────────────────────────────────

function AddIncomeModal({ visible, onClose, onSaved }: {
  visible: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setAmount(''); };

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Name required');
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return Alert.alert('Invalid amount');
    setSaving(true);
    try {
      await addManualIncomeSource(name.trim(), amt);
      reset(); onSaved(); onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={m.wrap}>
        <View style={m.handle} />
        <Text style={m.title}>Add Income Source</Text>
        <Text style={m.label}>SOURCE NAME</Text>
        <TextInput style={m.input} placeholder="e.g. Employer, Freelance" placeholderTextColor="#475569" value={name} onChangeText={setName} />
        <Text style={m.label}>MONTHLY AMOUNT ($)</Text>
        <TextInput style={m.input} placeholder="3000" placeholderTextColor="#475569" keyboardType="numeric" value={amount} onChangeText={setAmount} />
        <TouchableOpacity style={m.saveBtn} onPress={handleSave} disabled={saving}>
          <Text style={m.saveBtnText}>{saving ? 'Saving…' : 'Add Income'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
          <Text style={m.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Income Tab ───────────────────────────────────────────────────────────────

function IncomeTab({ onReload }: { onReload: () => void }) {
  const { sources, confirmedMonthlyIncome, reload } = useIncome();
  const [showAdd, setShowAdd] = useState(false);
  const confirmed = sources.filter(s => s.isConfirmed);
  const unconfirmed = sources.filter(s => !s.isConfirmed);

  const handleConfirm = async (id: string) => {
    await confirmIncomeSource(id);
    reload();
    onReload();
  };

  const handleDismiss = async (id: string) => {
    await dismissIncomeSource(id);
    reload();
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert(`Remove "${name}"?`, 'This income source will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await deleteIncomeSource(id); reload(); onReload(); } },
    ]);
  };

  const freqLabel = (f: string) => f === 'biweekly' ? 'Biweekly' : f === 'monthly' ? 'Monthly' : 'Manual';

  return (
    <View>
      {/* Total */}
      <View style={s.incomeTotalCard}>
        <Text style={s.incomeTotalLabel}>CONFIRMED MONTHLY INCOME</Text>
        <Text style={s.incomeTotalValue}>{fmt(confirmedMonthlyIncome)}</Text>
      </View>

      {/* Confirmed sources */}
      {confirmed.length > 0 && (
        <>
          <Text style={s.incomeSection}>CONFIRMED SOURCES</Text>
          {confirmed.map(src => (
            <View key={src.id} style={s.incomeRow}>
              <View style={s.incomeLeft}>
                <View style={s.incomeConfirmedBar} />
                <View>
                  <Text style={s.incomeRowName}>{src.name}</Text>
                  <Text style={s.incomeRowFreq}>{freqLabel(src.frequency)}</Text>
                </View>
              </View>
              <View style={s.incomeRight}>
                <Text style={s.incomeRowAmount}>{fmt(src.amountMonthly)}/mo</Text>
                <TouchableOpacity onPress={() => handleDelete(src.id, src.name)} style={s.incomeDeleteBtn}>
                  <Text style={s.incomeDeleteText}>×</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </>
      )}

      {/* Suggestions */}
      {unconfirmed.length > 0 && (
        <>
          <Text style={s.incomeSection}>SUGGESTED — TAP TO REVIEW</Text>
          {unconfirmed.map(src => (
            <View key={src.id} style={s.incomeRow}>
              <View style={s.incomeLeft}>
                <View style={s.incomeSuggestedBar} />
                <View>
                  <Text style={s.incomeRowName}>{src.name}</Text>
                  <Text style={s.incomeRowFreq}>{freqLabel(src.frequency)} · detected</Text>
                </View>
              </View>
              <View style={s.incomeRight}>
                <Text style={s.incomeRowAmount}>{fmt(src.amountMonthly)}/mo</Text>
                <View style={s.incomeActions}>
                  <TouchableOpacity onPress={() => handleConfirm(src.id)} style={s.confirmBtn}>
                    <Text style={s.confirmBtnText}>Confirm</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDismiss(src.id)} style={s.dismissBtn}>
                    <Text style={s.dismissBtnText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </>
      )}

      {confirmed.length === 0 && unconfirmed.length === 0 && (
        <Text style={s.emptyHint}>
          No income sources yet. We'll detect recurring deposits automatically after syncing your accounts.
        </Text>
      )}

      {/* Add manually */}
      <TouchableOpacity style={[s.addRowBtn, { marginTop: 16 }]} onPress={() => setShowAdd(true)}>
        <Text style={s.addRowBtnText}>+ Add Income Source</Text>
      </TouchableOpacity>

      <AddIncomeModal visible={showAdd} onClose={() => setShowAdd(false)} onSaved={() => { reload(); onReload(); }} />
    </View>
  );
}

// ─── Bucket Detail Sheet ──────────────────────────────────────────────────────

function BucketDetailSheet({
  visible,
  budget,
  allBudgets,
  fixedItems,
  confirmedMonthlyIncome,
  onClose,
  onSaved,
  onDeleted,
  onReloadFixed,
}: {
  visible: boolean;
  budget: BudgetCategory | null;
  allBudgets: BudgetCategory[];
  fixedItems: FixedItem[];
  confirmedMonthlyIncome: number;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onReloadFixed: () => void;
}) {
  const [pctValue, setPctValue] = useState(0);
  const [floorInput, setFloorInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [floorError, setFloorError] = useState('');

  useEffect(() => {
    if (budget) {
      setPctValue(budget.targetPct ?? 0);
      setFloorInput(String(budget.monthlyFloor));
      setFloorError('');
    }
  }, [budget?.id]);

  const confirmedFloorMin = fixedItems
    .filter(fi => fi.isConfirmed && !fi.needsReview)
    .reduce((s, fi) => s + fi.effectiveAmount, 0);

  const allocationAmt = budget && confirmedMonthlyIncome > 0
    ? confirmedMonthlyIncome * pctValue / 100
    : (budget?.monthlyLimit ?? 0);

  // Slider range: floor % as minimum, max = current + slack available from others
  const floorPct = budget && confirmedMonthlyIncome > 0
    ? (confirmedFloorMin / confirmedMonthlyIncome) * 100
    : 0;
  const othersSlack = allBudgets
    .filter(c => c.id !== budget?.id && !c.isGoal && (c.targetPct ?? 0) > 0)
    .reduce((s, c) => {
      const fp = confirmedMonthlyIncome > 0 ? (c.monthlyFloor / confirmedMonthlyIncome) * 100 : 0;
      return s + Math.max(0, (c.targetPct ?? 0) - Math.max(fp, 1));
    }, 0);
  const allocatedTotal = allBudgets.reduce((s, b) => s + (b.targetPct ?? 0), 0);
  const unallocated = Math.max(0, 100 - allocatedTotal);
  const sliderMax = Math.min(100, (budget?.targetPct ?? 0) + othersSlack + unallocated);
  const sliderMin = Math.max(0, floorPct);

  const handleSave = async () => {
    if (!budget) return;
    const floorVal = parseFloat(floorInput) || 0;

    if (floorVal < confirmedFloorMin - 0.01) {
      setFloorError(`Floor cannot be below ${fmt(confirmedFloorMin)} — remove a confirmed fixed charge first`);
      return;
    }
    setFloorError('');
    setSaving(true);
    try {
      const pctChanged = Math.abs(pctValue - (budget.targetPct ?? 0)) > 0.01;
      if (pctChanged && allBudgets.length > 1) {
        await rebalanceBucketPct(budget.id, pctValue, allBudgets, confirmedMonthlyIncome);
      } else {
        await updateBudget(budget.id, { targetPct: pctValue });
      }
      if (floorVal !== budget.monthlyFloor) {
        await updateBudget(budget.id, { monthlyFloor: floorVal });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert('Error saving', e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!budget) return;
    Alert.alert(`Delete "${budget.name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteBudgetWithRedistribution(budget.id, allBudgets);
          onDeleted();
          onClose();
        },
      },
    ]);
  };

  const handleConfirmFixed = async (fi: FixedItem) => {
    await confirmFixedItem(fi.id);
    await recomputeFloor(fi.categoryId);
    onReloadFixed();
    // Update floor input to reflect new confirmed floor
    const newFloor = fixedItems
      .filter(x => x.id === fi.id ? true : (x.isConfirmed && !x.needsReview))
      .reduce((s, x) => s + x.effectiveAmount, 0);
    setFloorInput(String(Math.round(newFloor)));
  };

  const handleDismissFixed = async (fi: FixedItem) => {
    await dismissFixedItem(fi.id);
    onReloadFixed();
  };

  const handleRemoveConfirmedFixed = (fi: FixedItem) => {
    Alert.alert(
      'Remove fixed charge?',
      `${fi.merchantName} will no longer count toward this bucket's floor.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            await dismissFixedItem(fi.id);
            await recomputeFloor(fi.categoryId);
            onReloadFixed();
            const newFloor = fixedItems
              .filter(x => x.id !== fi.id && x.isConfirmed && !x.needsReview)
              .reduce((s, x) => s + x.effectiveAmount, 0);
            setFloorInput(String(Math.round(newFloor)));
          },
        },
      ]
    );
  };

  if (!budget) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: '#0f172a' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.detailContent} keyboardShouldPersistTaps="handled">
          {/* Handle + header */}
          <View style={s.detailHandle} />
          <View style={s.detailHeader}>
            <View style={[s.bucketAccentBar, { backgroundColor: budget.color, height: 24, marginRight: 10 }]} />
            <Text style={s.detailTitle}>{budget.name}{budget.isGoal ? '  ·  Goal' : ''}</Text>
          </View>

          {/* Current allocation summary */}
          <View style={s.detailSummaryRow}>
            <View style={s.detailSummaryItem}>
              <Text style={s.detailSummaryLabel}>ALLOCATION</Text>
              <Text style={s.detailSummaryValue}>{fmt(allocationAmt)}/mo</Text>
            </View>
            <View style={s.detailSummaryItem}>
              <Text style={s.detailSummaryLabel}>SPENT</Text>
              <Text style={[s.detailSummaryValue, { color: budget.spent > allocationAmt ? '#ef4444' : '#f1f5f9' }]}>
                {fmt(budget.spent)}
              </Text>
            </View>
            <View style={s.detailSummaryItem}>
              <Text style={s.detailSummaryLabel}>FLOOR</Text>
              <Text style={s.detailSummaryValue}>{fmt(budget.monthlyFloor)}</Text>
            </View>
          </View>

          {/* Pct editor — slider */}
          <View style={s.detailLabelRow}>
            <Text style={s.detailLabel}>ALLOCATION</Text>
            <Text style={s.detailPctBadge}>
              {pctValue.toFixed(1)}%
              {confirmedMonthlyIncome > 0 && `  ·  ${fmt(confirmedMonthlyIncome * pctValue / 100)}/mo`}
            </Text>
          </View>
          <PercentSlider
            value={pctValue}
            min={sliderMin}
            max={Math.max(sliderMin + 1, sliderMax)}
            onChange={setPctValue}
          />

          {/* Floor editor */}
          <Text style={s.detailLabel}>MONTHLY FLOOR</Text>
          <View style={s.detailInputRow}>
            <Text style={s.detailInputPrefix}>$</Text>
            <TextInput
              style={s.detailInput}
              value={floorInput}
              onChangeText={v => { setFloorInput(v); setFloorError(''); }}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#334155"
            />
          </View>
          {confirmedFloorMin > 0 && (
            <Text style={s.detailFloorHint}>
              Min {fmt(confirmedFloorMin)} from {fixedItems.filter(fi => fi.isConfirmed && !fi.needsReview).length} confirmed fixed charge{fixedItems.filter(fi => fi.isConfirmed && !fi.needsReview).length !== 1 ? 's' : ''}
            </Text>
          )}
          {floorError ? <Text style={s.detailFloorError}>{floorError}</Text> : null}

          {/* Fixed charges */}
          <Text style={[s.detailLabel, { marginTop: 20 }]}>FIXED CHARGES</Text>
          {fixedItems.length === 0 ? (
            <Text style={s.txnEmpty}>No fixed charges detected yet.</Text>
          ) : (
            fixedItems.map(fi => (
              <View key={fi.id} style={s.fixedItemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fixedItemName}>{fi.merchantName}</Text>
                  <Text style={s.fixedItemSub}>
                    {fmt(fi.detectedAmount)} detected
                    {fi.confirmedAmount != null ? ` · ${fmt(fi.confirmedAmount)} confirmed` : ''}
                    {fi.needsReview ? ' · AMOUNT CHANGED' : ''}
                  </Text>
                </View>
                {fi.isConfirmed && !fi.needsReview ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={s.confirmedChip}>
                      <Text style={s.confirmedChipText}>Fixed</Text>
                    </View>
                    <TouchableOpacity onPress={() => handleRemoveConfirmedFixed(fi)}>
                      <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '600' }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={s.fixedItemActions}>
                    <TouchableOpacity onPress={() => handleConfirmFixed(fi)} style={s.confirmBtn}>
                      <Text style={s.confirmBtnText}>{fi.needsReview ? 'Accept' : 'Confirm'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDismissFixed(fi)} style={s.dismissBtn}>
                      <Text style={s.dismissBtnText}>Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))
          )}

          {/* Actions */}
          <TouchableOpacity style={s.savePctsBtn} onPress={handleSave} disabled={saving}>
            <Text style={s.savePctsText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.detailDeleteBtn} onPress={handleDelete}>
            <Text style={s.detailDeleteText}>Delete Bucket</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.detailCancelBtn} onPress={onClose}>
            <Text style={s.detailCancelText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Buckets Tab ──────────────────────────────────────────────────────────────

function BucketsTab({ budgets, transactions, confirmedMonthlyIncome, onReload, highlightId }: {
  budgets: ReturnType<typeof useBudgets>['budgets'];
  transactions: Transaction[];
  confirmedMonthlyIncome: number;
  onReload: (savedBudgetId?: string) => void;
  highlightId?: string;
}) {
  const { items: fixedItems, pendingReview, reload: reloadFixed } = useFixedItems();
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [detailBudget, setDetailBudget] = useState<BudgetCategory | null>(null);

  const fixedByCategory = useMemo(() => {
    const map = new Map<string, typeof fixedItems>();
    for (const item of fixedItems) {
      if (!map.has(item.categoryId)) map.set(item.categoryId, []);
      map.get(item.categoryId)!.push(item);
    }
    return map;
  }, [fixedItems]);

  const allocatedTotal = budgets.reduce((s, b) => s + (b.targetPct ?? 0), 0);

  return (
    <View>
      {pendingReview.length > 0 && (
        <View style={s.reviewBanner}>
          <Text style={s.reviewBannerText}>
            {pendingReview.length} fixed charge{pendingReview.length > 1 ? 's' : ''} need review
          </Text>
        </View>
      )}

      {budgets.length === 0 ? (
        <Text style={s.emptyHint}>No budgets yet. Add one below.</Text>
      ) : (
        budgets.map(b => {
          const pct = b.targetPct ?? 0;
          const allocationAmt = confirmedMonthlyIncome > 0 ? confirmedMonthlyIncome * pct / 100 : b.monthlyLimit;
          const isHighlighted = b.id === highlightId;

          return (
            <TouchableOpacity
              key={b.id}
              style={[s.bucketCard, isHighlighted && s.bucketCardHighlighted]}
              onPress={() => setDetailBudget(b)}
              activeOpacity={0.75}
            >
              <View style={[s.bucketAccentBar, { backgroundColor: b.color }]} />
              <View style={{ flex: 1 }}>
                <View style={s.bucketCardRow}>
                  <Text style={s.bucketCardName}>{b.name}{b.isGoal ? '  ·  Goal' : ''}</Text>
                  <Text style={s.bucketPctDisplay}>{pct > 0 ? `${pct}%` : '—'}</Text>
                </View>
                <Text style={s.bucketCardSub}>
                  {allocationAmt > 0 ? fmt(allocationAmt) : '—'}/mo
                  {b.monthlyFloor > 0 ? `  ·  floor ${fmt(b.monthlyFloor)}` : ''}
                </Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          );
        })
      )}

      <View style={s.bucketFooter}>
        <Text style={s.allocatedText}>
          Allocated: {allocatedTotal.toFixed(0)}%
          {confirmedMonthlyIncome > 0 && ` · ${fmt(confirmedMonthlyIncome * allocatedTotal / 100)}/mo`}
        </Text>
        <TouchableOpacity style={s.addRowBtn} onPress={() => setShowBudgetModal(true)}>
          <Text style={s.addRowBtnText}>+ Add Bucket</Text>
        </TouchableOpacity>
      </View>

      <BucketDetailSheet
        visible={detailBudget != null}
        budget={detailBudget}
        allBudgets={budgets}
        fixedItems={detailBudget ? (fixedByCategory.get(detailBudget.id) ?? []) : []}
        confirmedMonthlyIncome={confirmedMonthlyIncome}
        onClose={() => setDetailBudget(null)}
        onSaved={() => { onReload(detailBudget?.id); }}
        onDeleted={onReload}
        onReloadFixed={reloadFixed}
      />

      <AddBudgetModal
        visible={showBudgetModal}
        onClose={() => setShowBudgetModal(false)}
        onSaved={onReload}
        transactions={transactions}
        confirmedMonthlyIncome={confirmedMonthlyIncome}
      />
    </View>
  );
}

// ─── Suggestion Sheet ─────────────────────────────────────────────────────────

function SuggestionSheet({
  visible, onClose, goal, budgets, confirmedMonthlyIncome, onApplied,
}: {
  visible: boolean;
  onClose: () => void;
  goal: Goal;
  budgets: ReturnType<typeof useBudgets>['budgets'];
  confirmedMonthlyIncome: number;
  onApplied: () => void;
}) {
  const [applying, setApplying] = useState(false);

  const shortfall = goal.monthlyContributionNeeded ?? 0;

  const suggestionBuckets = useMemo(() => budgets.map(b => ({
    id: b.id,
    name: b.name,
    targetPct: b.targetPct ?? 0,
    monthlyFloor: b.monthlyFloor,
    monthlyLimit: b.monthlyLimit,
    priorityRank: b.priorityRank,
    isGoal: b.isGoal,
  })), [budgets]);

  const { cuts, timelineExtensionMonths } = useMemo(() => computeSuggestions({
    shortfall,
    buckets: suggestionBuckets,
    confirmedMonthlyIncome,
    goalMonthlyContribution: goal.monthlyContributionNeeded ?? 0,
    monthsLeft: goal.monthsLeft ?? 0,
  }), [shortfall, suggestionBuckets, confirmedMonthlyIncome, goal.monthlyContributionNeeded, goal.monthsLeft]);

  const handleAutoApply = async () => {
    setApplying(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await Promise.all(
        cuts.map(cut =>
          supabase
            .from('budget_categories')
            .update({ target_pct: Math.round(cut.suggestedPct * 100) / 100 })
            .eq('id', cut.bucketId)
        )
      );

      await writeGoalEvent({
        userId: user.id,
        goalId: goal.id,
        eventType: 'adjustment',
        trigger: 'manual',
        shortfall: 0,
        snapshot: {
          cuts: cuts.map(c => ({
            bucket_id: c.bucketId,
            bucket_name: c.bucketName,
            old_pct: c.currentPct,
            new_pct: c.suggestedPct,
            cut_amount: c.cutAmount,
            reason: c.reason,
          })),
        },
      });

      onApplied();
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setApplying(false);
    }
  };

  const handleExtendTimeline = async () => {
    if (!goal.targetDate || timelineExtensionMonths <= 0) return;
    setApplying(true);
    try {
      const d = new Date(goal.targetDate);
      d.setMonth(d.getMonth() + timelineExtensionMonths);
      const newDate = d.toISOString().split('T')[0];
      const { error } = await supabase
        .from('savings_goals')
        .update({ target_date: newDate })
        .eq('id', goal.id);
      if (error) throw error;
      onApplied();
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to extend timeline');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#0f172a', padding: 24 }}>
        <View style={{ width: 36, height: 4, backgroundColor: '#334155', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
        <Text style={{ color: '#f1f5f9', fontSize: 17, fontWeight: '700', marginBottom: 4 }}>
          To stay on track for {goal.name}:
        </Text>

        {cuts.length === 0 ? (
          <Text style={{ color: '#64748b', marginTop: 12 }}>
            Not enough slack in your budgets to cover the shortfall. Consider extending the timeline.
          </Text>
        ) : (
          <>
            <Text style={{ color: '#64748b', fontSize: 12, marginBottom: 12, marginTop: 4 }}>SUGGESTED BUDGET CUTS</Text>
            {cuts.map(cut => (
              <View key={cut.bucketId} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#f1f5f9', fontSize: 14, fontWeight: '600' }}>{cut.bucketName}</Text>
                  <Text style={{ color: '#fb923c', fontSize: 14 }}>−{fmt(cut.cutAmount)}</Text>
                </View>
                <Text style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{cut.reason}</Text>
                <Text style={{ color: '#475569', fontSize: 11 }}>
                  {cut.currentPct.toFixed(1)}% → {cut.suggestedPct.toFixed(1)}% of income
                </Text>
              </View>
            ))}

            <TouchableOpacity
              style={{ backgroundColor: '#6366f1', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 20 }}
              onPress={handleAutoApply}
              disabled={applying}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                {applying ? 'Applying…' : 'Apply These Cuts'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {timelineExtensionMonths > 0 && (
          <TouchableOpacity
            style={{ borderWidth: 1, borderColor: '#334155', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 12 }}
            onPress={handleExtendTimeline}
          >
            <Text style={{ color: '#94a3b8', fontWeight: '600', fontSize: 14 }}>
              Extend timeline by {timelineExtensionMonths} month{timelineExtensionMonths > 1 ? 's' : ''} instead
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={onClose} style={{ marginTop: 16, alignItems: 'center' }}>
          <Text style={{ color: '#475569', fontSize: 14 }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── Goals Tab ────────────────────────────────────────────────────────────────

function GoalStatusPill({ status }: { status: string }) {
  const config = {
    on_track:  { label: 'On track',  bg: '#14532d', text: '#4ade80' },
    at_risk:   { label: 'At risk',   bg: '#431407', text: '#fb923c' },
    completed: { label: 'Completed', bg: '#1e1b4b', text: '#818cf8' },
  }[status] ?? { label: status, bg: '#1e293b', text: '#94a3b8' };
  return (
    <View style={{ backgroundColor: config.bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: config.text, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 }}>{config.label.toUpperCase()}</Text>
    </View>
  );
}

function GoalCard({
  g, budgets, confirmedMonthlyIncome, onDeleted, onReload,
}: {
  g: Goal;
  budgets: ReturnType<typeof useBudgets>['budgets'];
  confirmedMonthlyIncome: number;
  onDeleted: () => void;
  onReload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<GoalEvent[]>([]);
  const [eventsError, setEventsError] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const loadEvents = async () => {
    try {
      setEventsError(false);
      setEvents(await loadGoalEvents(g.id, 5));
    } catch {
      setEventsError(true);
    }
  };

  const handleExpand = () => {
    if (!expanded) loadEvents();
    setExpanded(e => !e);
  };

  const handleDelete = () => {
    Alert.alert(`Delete "${g.name}"?`, 'This will redistribute its budget allocation back to other buckets.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          await removeGoalAllocation(g.id, budgets);
          onDeleted();
        }
      },
    ]);
  };

  return (
    <View style={s.goalCard}>
      <TouchableOpacity onLongPress={handleDelete} activeOpacity={0.9}>
        <View style={s.goalCardRow}>
          <Text style={s.goalCardName}>{g.name}</Text>
          <GoalStatusPill status={g.status} />
        </View>

        <View style={s.barTrack}>
          <View style={[s.barFill, {
            width: `${Math.min(g.progressPercent / 100, 1) * 100}%`,
            backgroundColor: g.status === 'at_risk' ? '#fb923c' : '#6366f1',
          }]} />
        </View>

        <Text style={s.goalSub}>
          {fmt(g.currentAmount)} of {fmt(g.targetAmount)}
          {g.monthsLeft !== null ? ` · ~${g.monthsLeft}mo left` : ''}
        </Text>

        {g.monthlyContributionNeeded !== null && (
          <Text style={[s.goalSub, { marginTop: 2, color: '#64748b' }]}>
            Needs {fmt(g.monthlyContributionNeeded)}/mo
          </Text>
        )}

        {g.status === 'at_risk' && (
          <View style={{ marginTop: 8, padding: 10, backgroundColor: '#1c1012', borderRadius: 6, borderLeftWidth: 3, borderLeftColor: '#fb923c' }}>
            <Text style={{ color: '#fb923c', fontSize: 12, fontWeight: '600', marginBottom: 6 }}>
              This goal may fall behind schedule.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#fb923c', borderRadius: 6, paddingVertical: 6, alignItems: 'center' }}
                onPress={() => setShowSuggestions(true)}
              >
                <Text style={{ color: '#0f0f0f', fontSize: 12, fontWeight: '700' }}>Adjust Budgets</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={handleExpand} style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={{ color: '#475569', fontSize: 11 }}>{expanded ? '▲ Hide history' : '▼ Show history'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 6 }}>
          {events.length === 0 && !eventsError ? (
            <Text style={{ color: '#475569', fontSize: 11 }}>No events yet.</Text>
          ) : eventsError ? (
            <Text style={{ color: '#ef4444', fontSize: 11 }}>Could not load history.</Text>
          ) : events.map(e => (
            <View key={e.id} style={{ paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#1e293b' }}>
              <Text style={{ color: '#94a3b8', fontSize: 11 }}>
                {e.eventType === 'at_risk' ? `⚠️ Fell at risk — $${e.shortfall?.toFixed(0) ?? '?'} shortfall` :
                 e.eventType === 'back_on_track' ? '✓ Back on track' :
                 e.eventType === 'adjustment' ? `Budgets adjusted` :
                 '✓ Goal reached'}
                {' · '}
                {new Date(e.createdAt).toLocaleDateString()}
              </Text>
            </View>
          ))}
        </View>
      )}

      <SuggestionSheet
        visible={showSuggestions}
        onClose={() => setShowSuggestions(false)}
        goal={g}
        budgets={budgets}
        confirmedMonthlyIncome={confirmedMonthlyIncome}
        onApplied={onReload}
      />
    </View>
  );
}

function GoalsTab({ budgets, confirmedMonthlyIncome, onReload }: {
  budgets: ReturnType<typeof useBudgets>['budgets'];
  confirmedMonthlyIncome: number;
  onReload: () => void;
}) {
  const { goals, reload: reloadGoals } = useGoals();
  const [showGoalModal, setShowGoalModal] = useState(false);

  return (
    <View>
      {goals.length === 0 ? (
        <Text style={s.emptyHint}>No goals yet. Add one to see how it affects your budget.</Text>
      ) : (
        goals.map(g => (
          <GoalCard
            key={g.id}
            g={g}
            budgets={budgets}
            confirmedMonthlyIncome={confirmedMonthlyIncome}
            onDeleted={() => { reloadGoals(); onReload(); }}
            onReload={() => { reloadGoals(); onReload(); }}
          />
        ))
      )}
      <TouchableOpacity style={[s.addRowBtn, { marginTop: 12 }]} onPress={() => setShowGoalModal(true)}>
        <Text style={s.addRowBtnText}>+ Add Goal</Text>
      </TouchableOpacity>
      <AddGoalModal
        visible={showGoalModal}
        onClose={() => setShowGoalModal(false)}
        onSaved={() => { reloadGoals(); onReload(); }}
        budgets={budgets}
        confirmedMonthlyIncome={confirmedMonthlyIncome}
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type PlanningTab = 'buckets' | 'goals' | 'income';

export default function PlanScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const transactions = useCurrentPeriodTransactions('month');
  const { budgets, reload: reloadBudgets } = useBudgets(transactions);
  const { confirmedMonthlyIncome, reload: reloadIncome } = useIncome();
  const [refreshing, setRefreshing] = useState(false);
  const [planningTab, setPlanningTab] = useState<PlanningTab>('buckets');
  const [lastSavedBudgetId, setLastSavedBudgetId] = useState<string | undefined>(undefined);
  const [showViewImpact, setShowViewImpact] = useState(false);

  // Respond to navigation params — deep links from income tile, Report's Adjust Plan, etc.
  useEffect(() => {
    if (route.params?.planningTab) setPlanningTab(route.params.planningTab);
  }, [route.params?.planningTab]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reloadBudgets(), reloadIncome()]);
    setRefreshing(false);
  }, [reloadBudgets, reloadIncome]);

  const handleReload = useCallback(async (savedBudgetId?: string) => {
    await Promise.all([reloadBudgets(), reloadIncome()]);
    if (savedBudgetId !== undefined) {
      setLastSavedBudgetId(savedBudgetId);
      setShowViewImpact(true);
    }
  }, [reloadBudgets, reloadIncome]);

  const goToReport = () => {
    setShowViewImpact(false);
    navigation.navigate('Report', { budgetId: lastSavedBudgetId, period: 'month' });
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={s.container}
        contentContainerStyle={[s.content, { paddingTop: top + 16 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6366f1" />}
      >
        {/* Three-tab segmented control — the only nav on this screen */}
        <View style={s.segControl}>
          {(['buckets', 'goals', 'income'] as PlanningTab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[s.segBtn, planningTab === tab && s.segBtnActive]}
              onPress={() => setPlanningTab(tab)}
            >
              <Text style={[s.segText, planningTab === tab && s.segTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {planningTab === 'income' && (
          <IncomeTab onReload={() => handleReload()} />
        )}
        {planningTab === 'buckets' && (
          <BucketsTab
            budgets={budgets}
            transactions={transactions}
            confirmedMonthlyIncome={confirmedMonthlyIncome}
            onReload={handleReload}
            highlightId={route.params?.highlightId}
          />
        )}
        {planningTab === 'goals' && (
          <GoalsTab
            budgets={budgets}
            confirmedMonthlyIncome={confirmedMonthlyIncome}
            onReload={handleReload}
          />
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* View Impact toast — appears after saving allocations */}
      {showViewImpact && (
        <View style={s.viewImpactBar}>
          <Text style={s.viewImpactText}>Allocations saved</Text>
          <TouchableOpacity onPress={goToReport} style={s.viewImpactBtn}>
            <Text style={s.viewImpactBtnText}>View Impact →</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowViewImpact(false)} style={s.viewImpactDismiss}>
            <Text style={s.viewImpactDismissText}>×</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 100 },

  segControl: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 8, padding: 3, marginBottom: 16 },
  segBtn: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 6 },
  segBtnActive: { backgroundColor: '#0f172a' },
  segText: { fontSize: 12, color: '#475569', fontWeight: '500' },
  segTextActive: { color: '#a5b4fc', fontWeight: '700' },

  emptyHint: { fontSize: 12, color: '#334155', textAlign: 'center', paddingVertical: 24 },
  txnEmpty: { fontSize: 11, color: '#334155', paddingVertical: 8 },
  barTrack: { backgroundColor: '#1e293b', borderRadius: 4, height: 4 },
  barFill: { height: 4, borderRadius: 4 },

  // Bucket cards (planning)
  bucketCard: { backgroundColor: '#0d1526', borderRadius: 10, marginBottom: 8, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', padding: 12 },
  bucketCardHighlighted: { borderWidth: 1, borderColor: '#6366f1' },
  bucketAccentBar: { width: 3, height: 36, borderRadius: 2, marginRight: 10 },
  bucketCardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bucketCardName: { fontSize: 13, color: '#cbd5e1', fontWeight: '500' },
  bucketCardSub: { fontSize: 10, color: '#475569', marginTop: 2 },
  bucketPctDisplay: { fontSize: 13, color: '#a5b4fc', fontWeight: '600', fontVariant: ['tabular-nums'] },
  chevron: { fontSize: 18, color: '#334155', marginLeft: 8 },

  // Bucket detail sheet
  detailContent: { padding: 24, paddingBottom: 48 },
  detailHandle: { width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  detailTitle: { fontSize: 18, color: '#f1f5f9', fontWeight: '600', flex: 1 },
  detailSummaryRow: { flexDirection: 'row', backgroundColor: '#0d1526', borderRadius: 10, padding: 14, marginBottom: 20, gap: 8 },
  detailSummaryItem: { flex: 1 },
  detailSummaryLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5 },
  detailSummaryValue: { fontSize: 16, color: '#f1f5f9', fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  detailLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 8 },
  detailInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  detailInput: { backgroundColor: '#1e293b', borderRadius: 8, padding: 12, color: '#f1f5f9', fontSize: 16, flex: 1 },
  detailInputPrefix: { fontSize: 16, color: '#475569' },
  detailInputSuffix: { fontSize: 16, color: '#475569' },
  detailInputHint: { fontSize: 12, color: '#475569' },
  detailFloorHint: { fontSize: 11, color: '#475569', marginBottom: 4 },
  detailFloorError: { fontSize: 11, color: '#ef4444', marginBottom: 8 },
  detailLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  detailPctBadge: { fontSize: 14, color: '#a5b4fc', fontWeight: '700', fontVariant: ['tabular-nums'] as const },
  detailDeleteBtn: { borderWidth: 1, borderColor: '#7f1d1d', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  detailDeleteText: { color: '#ef4444', fontWeight: '600', fontSize: 14 },
  detailCancelBtn: { padding: 14, alignItems: 'center', marginTop: 4 },
  detailCancelText: { color: '#475569', fontSize: 14 },

  // Fixed items
  fixedItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a2540' },
  fixedItemName: { fontSize: 12, color: '#94a3b8' },
  fixedItemSub: { fontSize: 10, color: '#475569', marginTop: 1 },
  fixedItemActions: { flexDirection: 'row', gap: 6 },
  confirmedChip: { backgroundColor: '#14532d', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  confirmedChipText: { fontSize: 10, color: '#4ade80' },

  bucketFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 4 },
  allocatedText: { fontSize: 11, color: '#475569', flex: 1 },
  savePctsBtn: { backgroundColor: '#6366f1', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 8, marginBottom: 16 },
  savePctsText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  viewImpactBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#1e293b', borderTopWidth: 1, borderTopColor: '#334155',
    flexDirection: 'row', alignItems: 'center', padding: 14,
  },
  viewImpactText: { flex: 1, fontSize: 13, color: '#94a3b8' },
  viewImpactBtn: { backgroundColor: '#6366f1', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  viewImpactBtnText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  viewImpactDismiss: { padding: 8, marginLeft: 8 },
  viewImpactDismissText: { fontSize: 18, color: '#475569' },

  reviewBanner: { backgroundColor: '#431407', borderRadius: 8, padding: 10, marginBottom: 10 },
  reviewBannerText: { fontSize: 12, color: '#fb923c', fontWeight: '500' },

  // Income tab
  incomeTotalCard: { backgroundColor: '#0d1526', borderRadius: 10, padding: 16, marginBottom: 16 },
  incomeTotalLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5 },
  incomeTotalValue: { fontSize: 28, color: '#f1f5f9', fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  incomeSection: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },
  incomeRow: { backgroundColor: '#0d1526', borderRadius: 8, padding: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  incomeLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  incomeRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  incomeConfirmedBar: { width: 3, height: 32, borderRadius: 2, backgroundColor: '#4ade80', marginRight: 10 },
  incomeSuggestedBar: { width: 3, height: 32, borderRadius: 2, backgroundColor: '#f59e0b', marginRight: 10 },
  incomeRowName: { fontSize: 13, color: '#cbd5e1', fontWeight: '500' },
  incomeRowFreq: { fontSize: 10, color: '#475569', marginTop: 2 },
  incomeRowAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  incomeDeleteBtn: { padding: 4 },
  incomeDeleteText: { fontSize: 18, color: '#475569' },
  incomeActions: { flexDirection: 'column', gap: 4 },

  confirmBtn: { backgroundColor: '#1e1b4b', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  confirmBtnText: { fontSize: 11, color: '#6366f1' },
  dismissBtn: { backgroundColor: '#1e293b', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  dismissBtnText: { fontSize: 11, color: '#475569' },

  addRowBtn: { backgroundColor: '#1e1b4b', borderRadius: 8, padding: 12, alignItems: 'center' },
  addRowBtnText: { fontSize: 13, color: '#6366f1', fontWeight: '500' },

  // Goals tab
  goalCard: { backgroundColor: '#0d1526', borderRadius: 10, padding: 12, marginBottom: 8 },
  goalCardRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  goalCardName: { fontSize: 13, color: '#cbd5e1', fontWeight: '500' },
  goalPct: { fontSize: 12, color: '#a5b4fc' },
  goalSub: { fontSize: 10, color: '#475569', marginTop: 6 },

  // Goal preview
  previewError: { backgroundColor: '#450a0a', borderRadius: 10, padding: 16, marginBottom: 16 },
  previewErrorTitle: { fontSize: 14, color: '#ef4444', fontWeight: '600', marginBottom: 6 },
  previewErrorBody: { fontSize: 12, color: '#fca5a5' },
  previewSummary: { backgroundColor: '#0d1526', borderRadius: 10, padding: 16, marginBottom: 4 },
  previewLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginTop: 10 },
  previewValue: { fontSize: 20, color: '#f1f5f9', fontWeight: '700', fontVariant: ['tabular-nums'] },
  previewCutRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  previewCutName: { fontSize: 13, color: '#94a3b8' },
  previewCutDelta: { fontSize: 12, color: '#f59e0b', fontVariant: ['tabular-nums'] },
});

const m = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0f172a', padding: 24 },
  handle: { width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
  title: { fontSize: 18, color: '#f1f5f9', fontWeight: '600', marginBottom: 20 },
  label: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 8, marginTop: 18 },
  hint: { fontSize: 10, color: '#334155', marginBottom: 8 },
  input: { backgroundColor: '#1e293b', borderRadius: 8, padding: 12, color: '#f1f5f9', fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  pctHint: { fontSize: 11, color: '#6366f1', marginTop: 6, fontWeight: '500' },
});

const ss = StyleSheet.create({
  sliderTrack: {
    height: 36,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    marginBottom: 20,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#6366f1',
    borderRadius: 8,
  },
  sliderThumb: {
    position: 'absolute',
    width: THUMB_R * 2,
    height: THUMB_R * 2,
    borderRadius: THUMB_R,
    backgroundColor: '#f1f5f9',
    top: 6, // (36 - 24) / 2
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
});
