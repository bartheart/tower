import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  ScrollView, View, Text, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
  RefreshControl, useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { useBudgets, createBudget, updateBudget, deleteBudget } from '../hooks/useBudgets';
import { useGoals, updateGoalProgress } from '../hooks/useGoals';
import { useCurrentPeriodTransactions, useMonthlyIncome } from '../hooks/useTransactions';
import { useIncome, confirmIncomeSource, dismissIncomeSource, addManualIncomeSource, deleteIncomeSource } from '../hooks/useIncome';
import { useFixedItems, confirmFixedItem, dismissFixedItem, updateFixedItemAmount, recomputeFloor } from '../hooks/useFixedItems';
import { previewGoalAllocation, commitGoalAllocation, removeGoalAllocation } from '../budget/goalAllocator';
import SankeyChart from '../sankey/SankeyChart';
import { buildSankeyData } from '../sankey/buildGraph';
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

// ─── Expanded Budget Row (Report view) ──────────────────────────────────────

function BudgetReportRow({ budget, transactions }: {
  budget: ReturnType<typeof useBudgets>['budgets'][0];
  transactions: Transaction[];
}) {
  const [expanded, setExpanded] = useState(false);
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
          <Text style={s.reportName}>{budget.name}</Text>
        </View>
        <View style={s.reportRowRight}>
          <Text style={[s.reportAmount, ratio > 1 && { color: '#ef4444' }]}>
            {fmt(budget.spent)}{ratio > 1 ? '  !' : ''}
          </Text>
          <Text style={s.chevronInline}>{expanded ? '  −' : '  +'}</Text>
        </View>
      </TouchableOpacity>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: barColor }]} />
      </View>
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

// ─── Add Budget Modal ─────────────────────────────────────────────────────────

function AddBudgetModal({ visible, onClose, onSaved, transactions }: {
  visible: boolean; onClose: () => void; onSaved: () => void; transactions: Transaction[];
}) {
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [saving, setSaving] = useState(false);
  const categoryOptions = useCategoryOptions(transactions);

  const reset = () => { setName(''); setLimit(''); setColor('#6366f1'); };

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Name required', 'Pick a category or type a name.');
    const amount = parseFloat(limit);
    if (isNaN(amount) || amount <= 0) return Alert.alert('Invalid limit', 'Enter a dollar amount.');
    setSaving(true);
    try {
      await createBudget(name.trim(), '💰', amount, color);
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
          <Text style={m.title}>New Budget</Text>
          {categoryOptions.length > 0 && (
            <>
              <Text style={m.label}>YOUR CATEGORIES</Text>
              <Text style={m.hint}>Tap to use — name must match exactly for spend to be tracked</Text>
              <View style={m.chipRow}>
                {categoryOptions.map(c => (
                  <TouchableOpacity key={c} style={[m.chip, name === c && m.chipSel]} onPress={() => setName(c)}>
                    <Text style={[m.chipText, name === c && { color: '#f1f5f9' }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          <Text style={m.label}>NAME</Text>
          <TextInput style={m.input} placeholder="e.g. Food and Drink" placeholderTextColor="#475569" value={name} onChangeText={setName} />
          <Text style={m.label}>MONTHLY LIMIT ($)</Text>
          <TextInput style={m.input} placeholder="500" placeholderTextColor="#475569" keyboardType="numeric" value={limit} onChangeText={setLimit} />
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
      { name: name.trim(), targetAmount: t, currentAmount: parseFloat(current) || 0, targetDate: targetDate.trim() },
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
        { name: name.trim(), targetAmount: parseFloat(target), currentAmount: parseFloat(current) || 0, targetDate: targetDate.trim() },
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
            <Text style={m.label}>SAVED SO FAR</Text>
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

// ─── Buckets Tab ──────────────────────────────────────────────────────────────

function BucketsTab({ budgets, transactions, confirmedMonthlyIncome, onReload }: {
  budgets: ReturnType<typeof useBudgets>['budgets'];
  transactions: Transaction[];
  confirmedMonthlyIncome: number;
  onReload: () => void;
}) {
  const { items: fixedItems, pendingReview, reload: reloadFixed } = useFixedItems();
  const [editingPcts, setEditingPcts] = useState<Record<string, string>>({});
  const [savingPcts, setSavingPcts] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());

  // Init pct inputs when budgets load
  useEffect(() => {
    const initial: Record<string, string> = {};
    budgets.forEach(b => { initial[b.id] = b.targetPct != null ? String(b.targetPct) : ''; });
    setEditingPcts(initial);
  }, [budgets]);

  const toggleBucket = (id: string) => {
    setExpandedBuckets(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSavePcts = async () => {
    setSavingPcts(true);
    try {
      await Promise.all(
        Object.entries(editingPcts).map(async ([id, pctStr]) => {
          const pct = parseFloat(pctStr);
          await updateBudget(id, { targetPct: isNaN(pct) || pct <= 0 ? 0 : pct });
        })
      );
      await onReload();
    } catch (e: any) {
      Alert.alert('Error saving', e.message);
    } finally { setSavingPcts(false); }
  };

  const handleDeleteBudget = (id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteBudget(id); onReload(); } },
    ]);
  };

  const handleConfirmFixed = async (itemId: string, categoryId: string, amount?: number) => {
    await confirmFixedItem(itemId, amount);
    await recomputeFloor(categoryId);
    reloadFixed();
    onReload();
  };

  const handleDismissFixed = async (itemId: string) => {
    await dismissFixedItem(itemId);
    reloadFixed();
  };

  const allocatedTotal = Object.values(editingPcts).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  const fixedByCategory = useMemo(() => {
    const map = new Map<string, typeof fixedItems>();
    for (const item of fixedItems) {
      if (!map.has(item.categoryId)) map.set(item.categoryId, []);
      map.get(item.categoryId)!.push(item);
    }
    return map;
  }, [fixedItems]);

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
          const floorPct = allocationAmt > 0 ? Math.min(b.monthlyFloor / allocationAmt, 1) : 0;
          const catFixed = fixedByCategory.get(b.id) ?? [];
          const expanded = expandedBuckets.has(b.id);

          return (
            <View key={b.id} style={s.bucketCard}>
              <TouchableOpacity style={s.bucketCardTop} onPress={() => toggleBucket(b.id)} onLongPress={() => handleDeleteBudget(b.id, b.name)}>
                <View style={[s.bucketAccentBar, { backgroundColor: b.color }]} />
                <View style={{ flex: 1 }}>
                  <View style={s.bucketCardRow}>
                    <Text style={s.bucketCardName}>{b.name}{b.isGoal ? '  ·  Goal' : ''}</Text>
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
                  <Text style={s.bucketCardSub}>{fmt(allocationAmt)}/mo · floor {fmt(b.monthlyFloor)}</Text>
                  {/* Allocation bar with floor marker */}
                  <View style={s.allocBarTrack}>
                    <View style={[s.allocBarFloor, { width: `${floorPct * 100}%`, backgroundColor: b.color + '60' }]} />
                    <View style={[s.allocBarVariable, { width: `${(1 - floorPct) * 100}%`, backgroundColor: b.color }]} />
                  </View>
                  {floorPct > 0 && (
                    <View style={[s.floorMarker, { left: `${floorPct * 100}%` as any }]} />
                  )}
                </View>
                <Text style={[s.chevron, { marginLeft: 8 }]}>{expanded ? '−' : '+'}</Text>
              </TouchableOpacity>

              {expanded && (
                <View style={s.bucketExpanded}>
                  {catFixed.length === 0 ? (
                    <Text style={s.txnEmpty}>No fixed charges detected in this bucket.</Text>
                  ) : (
                    catFixed.map(fi => (
                      <View key={fi.id} style={s.fixedItemRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.fixedItemName}>{fi.merchantName}</Text>
                          <Text style={s.fixedItemSub}>
                            Detected {fmt(fi.detectedAmount)}
                            {fi.confirmedAmount != null ? ` · Confirmed ${fmt(fi.confirmedAmount)}` : ''}
                            {fi.needsReview ? ' · CHANGED' : ''}
                          </Text>
                        </View>
                        {fi.isConfirmed && !fi.needsReview ? (
                          <View style={s.confirmedChip}>
                            <Text style={s.confirmedChipText}>Confirmed</Text>
                          </View>
                        ) : (
                          <View style={s.fixedItemActions}>
                            <TouchableOpacity onPress={() => handleConfirmFixed(fi.id, fi.categoryId)} style={s.confirmBtn}>
                              <Text style={s.confirmBtnText}>{fi.needsReview ? 'Accept' : 'Confirm'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDismissFixed(fi.id)} style={s.dismissBtn}>
                              <Text style={s.dismissBtnText}>Dismiss</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    ))
                  )}
                </View>
              )}
            </View>
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

      <TouchableOpacity style={s.savePctsBtn} onPress={handleSavePcts} disabled={savingPcts}>
        <Text style={s.savePctsText}>{savingPcts ? 'Saving…' : 'Save Allocations'}</Text>
      </TouchableOpacity>

      <AddBudgetModal
        visible={showBudgetModal}
        onClose={() => setShowBudgetModal(false)}
        onSaved={onReload}
        transactions={transactions}
      />
    </View>
  );
}

// ─── Goals Tab ────────────────────────────────────────────────────────────────

function GoalsTab({ budgets, confirmedMonthlyIncome, onReload }: {
  budgets: ReturnType<typeof useBudgets>['budgets'];
  confirmedMonthlyIncome: number;
  onReload: () => void;
}) {
  const { goals, reload: reloadGoals } = useGoals();
  const [showGoalModal, setShowGoalModal] = useState(false);

  const handleUpdateProgress = (id: string, current: number) => {
    Alert.prompt('Update Progress', 'Current saved amount:',
      async (value) => {
        const amount = parseFloat(value);
        if (!isNaN(amount) && amount >= 0) { await updateGoalProgress(id, amount); reloadGoals(); }
      },
      'plain-text', String(current), 'numeric'
    );
  };

  const handleDeleteGoal = (id: string, name: string) => {
    Alert.alert(`Delete "${name}"?`, 'This will redistribute its budget allocation back to other buckets.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await removeGoalAllocation(id, budgets);
          reloadGoals();
          onReload();
        }
      },
    ]);
  };

  return (
    <View>
      {goals.length === 0 ? (
        <Text style={s.emptyHint}>No goals yet. Add one to see how it affects your budget.</Text>
      ) : (
        goals.map(g => (
          <TouchableOpacity
            key={g.id}
            style={s.goalCard}
            onPress={() => handleUpdateProgress(g.id, g.currentAmount)}
            onLongPress={() => handleDeleteGoal(g.id, g.name)}
          >
            <View style={s.goalCardRow}>
              <Text style={s.goalCardName}>{g.name}</Text>
              <Text style={s.goalPct}>{g.progressPercent}%</Text>
            </View>
            <View style={s.barTrack}>
              <View style={[s.barFill, { width: `${Math.min(g.progressPercent / 100, 1) * 100}%`, backgroundColor: '#6366f1' }]} />
            </View>
            <Text style={s.goalSub}>
              {fmt(g.currentAmount)} of {fmt(g.targetAmount)}
              {g.monthsLeft !== null ? ` · ~${g.monthsLeft}mo left` : ''}
            </Text>
          </TouchableOpacity>
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

type PlanView = 'report' | 'planning';
type PlanningTab = 'buckets' | 'goals' | 'income';

export default function PlanScreen() {
  const { top } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const route = useRoute<any>();
  const transactions = useCurrentPeriodTransactions('month');
  const { budgets, reload: reloadBudgets } = useBudgets(transactions);
  const { confirmedMonthlyIncome, reload: reloadIncome } = useIncome();
  const monthlyIncome = useMonthlyIncome(transactions);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<PlanView>('report');
  const [planningTab, setPlanningTab] = useState<PlanningTab>('buckets');

  // Respond to navigation params from Home tile / income tile tap
  useEffect(() => {
    if (route.params?.view) setView(route.params.view);
    if (route.params?.planningTab) setPlanningTab(route.params.planningTab);
  }, [route.params?.view, route.params?.planningTab]);

  const sankeyData = useMemo(() => buildSankeyData(transactions, monthlyIncome), [transactions, monthlyIncome]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reloadBudgets(), reloadIncome()]);
    setRefreshing(false);
  }, [reloadBudgets, reloadIncome]);

  const handleReload = useCallback(async () => {
    await Promise.all([reloadBudgets(), reloadIncome()]);
  }, [reloadBudgets, reloadIncome]);

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

      {/* ── REPORT VIEW ──────────────────────────────────── */}
      {view === 'report' && (
        <>
          <Text style={s.sectionLabel}>FLOW ANALYSIS · this month</Text>
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
              <Text style={s.emptyHint}>No data yet — transactions will appear here once synced.</Text>
            )}
            {sankeyData.nodes.length > 1 && (
              <Text style={s.zoomHint}>Pinch to zoom</Text>
            )}
          </View>

          <Text style={[s.sectionLabel, { marginTop: 20 }]}>BREAKDOWN</Text>
          {budgets.length === 0 ? (
            <Text style={s.emptyHint}>Add budgets in Planning to see your breakdown.</Text>
          ) : (
            budgets.map(b => (
              <BudgetReportRow key={b.id} budget={b} transactions={transactions} />
            ))
          )}
        </>
      )}

      {/* ── PLANNING VIEW ────────────────────────────────── */}
      {view === 'planning' && (
        <>
          {/* Three-tab segmented control */}
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
            <IncomeTab onReload={handleReload} />
          )}
          {planningTab === 'buckets' && (
            <BucketsTab
              budgets={budgets}
              transactions={transactions}
              confirmedMonthlyIncome={confirmedMonthlyIncome}
              onReload={handleReload}
            />
          )}
          {planningTab === 'goals' && (
            <GoalsTab
              budgets={budgets}
              confirmedMonthlyIncome={confirmedMonthlyIncome}
              onReload={handleReload}
            />
          )}
        </>
      )}
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

  segControl: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 8, padding: 3, marginBottom: 16 },
  segBtn: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 6 },
  segBtnActive: { backgroundColor: '#0f172a' },
  segText: { fontSize: 12, color: '#475569', fontWeight: '500' },
  segTextActive: { color: '#a5b4fc', fontWeight: '700' },

  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 10 },
  emptyHint: { fontSize: 12, color: '#334155', textAlign: 'center', paddingVertical: 24 },

  sankeyContainer: { backgroundColor: '#0d1526', borderRadius: 10, padding: 8, marginBottom: 4, overflow: 'hidden' },
  zoomHint: { fontSize: 9, color: '#334155', textAlign: 'right', marginTop: 4, marginRight: 4 },

  // Report rows
  reportRow: { marginBottom: 10, backgroundColor: '#0d1526', borderRadius: 8, padding: 12 },
  reportRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  reportRowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  reportRowRight: { flexDirection: 'row', alignItems: 'center' },
  colorDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  reportName: { fontSize: 13, color: '#cbd5e1' },
  reportAmount: { fontSize: 13, color: '#f1f5f9', fontVariant: ['tabular-nums'] },
  chevronInline: { fontSize: 13, color: '#475569' },
  barTrack: { backgroundColor: '#1e293b', borderRadius: 4, height: 4 },
  barFill: { height: 4, borderRadius: 4 },
  txnList: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#1e293b', paddingTop: 8 },
  txnEmpty: { fontSize: 11, color: '#334155', paddingVertical: 8 },
  txnListRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  txnListLeft: { flex: 1 },
  txnListMerchant: { fontSize: 12, color: '#94a3b8' },
  txnListDate: { fontSize: 10, color: '#475569', marginTop: 1 },
  txnListAmount: { fontSize: 12, color: '#cbd5e1', fontVariant: ['tabular-nums'] },

  // Bucket cards (planning)
  bucketCard: { backgroundColor: '#0d1526', borderRadius: 10, marginBottom: 8, overflow: 'hidden' },
  bucketCardTop: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  bucketAccentBar: { width: 3, height: 36, borderRadius: 2, marginRight: 10 },
  bucketCardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bucketCardName: { fontSize: 13, color: '#cbd5e1', fontWeight: '500' },
  bucketCardSub: { fontSize: 10, color: '#475569', marginTop: 2, marginBottom: 6 },
  allocBarTrack: { flexDirection: 'row', height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: '#1e293b' },
  allocBarFloor: { height: 5 },
  allocBarVariable: { height: 5 },
  floorMarker: { position: 'absolute', bottom: 0, width: 2, height: 10, backgroundColor: '#f1f5f9', borderRadius: 1 },
  bucketExpanded: { borderTopWidth: 1, borderTopColor: '#1e293b', padding: 12 },
  bucketPctWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  bucketPctInput: { backgroundColor: '#1e293b', borderRadius: 6, padding: 6, color: '#a5b4fc', fontSize: 14, width: 52, textAlign: 'right' },
  bucketPctSymbol: { fontSize: 12, color: '#475569' },
  chevron: { fontSize: 18, color: '#475569' },

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
});
