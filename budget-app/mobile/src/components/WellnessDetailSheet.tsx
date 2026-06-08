import React, { useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import Svg, { Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { WellnessResult, ScoreFactor } from '../hooks/useWellnessScore';
import Transaction from '../db/models/Transaction';
import { C, T } from '../theme';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// ─── Expanded Sparkline ───────────────────────────────────────────────────────

function ExpandedSparkline({ history, color }: { history: number[]; color: string }) {
  const [chartWidth, setChartWidth] = useState(300);
  const H = 120;
  const PAD = 12;

  if (history.length < 2) return null;

  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min;

  const points = history.map((v, i) => {
    const x = PAD + (i / (history.length - 1)) * (chartWidth - PAD * 2);
    const y = range === 0
      ? H / 2
      : PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');

  const lastX = PAD + (chartWidth - PAD * 2);
  const lastY = range === 0
    ? H / 2
    : PAD + (1 - (history[history.length - 1] - min) / range) * (H - PAD * 2);

  const dayLabels = history.map((_, i) => {
    const offset = history.length - 1 - i;
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  });

  return (
    <View onLayout={e => setChartWidth(e.nativeEvent.layout.width)}>
      <Svg width={chartWidth} height={H}>
        <Polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={lastX} cy={lastY} r={4} fill={color} />
        <SvgText
          x={lastX - 2}
          y={lastY - 8}
          fontSize={10}
          fill={color}
          textAnchor="end"
        >
          {history[history.length - 1]}
        </SvgText>
      </Svg>
      <View style={s.dayRow}>
        {dayLabels.map((label, i) => (
          <Text key={i} style={s.dayLabel}>{label}</Text>
        ))}
      </View>
    </View>
  );
}

// ─── Transaction matching ─────────────────────────────────────────────────────

function topTransactionsForFactor(
  factor: ScoreFactor,
  transactions: Transaction[],
  limit = 2
): Transaction[] {
  const name = factor.name.toLowerCase();
  return transactions
    .filter(t =>
      t.amount > 0 &&
      !t.pending &&
      (t.categoryL1.toLowerCase() === name ||
       (t.categoryL2?.toLowerCase() ?? '') === name)
    )
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// ─── Factor Row ───────────────────────────────────────────────────────────────

function FactorRow({ factor, transactions }: { factor: ScoreFactor; transactions: Transaction[] }) {
  const isOnTrack = factor.catScore === 100;
  const topTxns = isOnTrack ? [] : topTransactionsForFactor(factor, transactions);

  return (
    <View style={[s.factorRow, isOnTrack && s.factorRowMuted]}>
      <View style={[s.factorDot, { backgroundColor: factor.color }]} />
      <View style={s.factorContent}>
        <View style={s.factorTopLine}>
          <Text style={[s.factorName, isOnTrack && s.textMuted]}>{factor.name}</Text>
          <View style={s.factorRight}>
            <Text style={[s.factorRatioPct, { color: factor.ratio > 1 ? C.rose : C.emerald }]}>
              {Math.round(factor.ratio * 100)}%
            </Text>
            <Text style={[
              s.factorAmount,
              { color: isOnTrack ? C.w4 : C.rose },
            ]}>
              {isOnTrack ? 'on track' : `${factor.scoreDelta > 0 ? '+' : ''}${factor.scoreDelta} pts`}
            </Text>
          </View>
        </View>
        <Text style={[s.factorAmount, isOnTrack && s.textMuted]}>
          {fmt(factor.actualSpend)} / {fmt(factor.targetSpend)}
        </Text>
        {topTxns.length > 0 && (
          <Text style={s.txnItem} numberOfLines={1}>
            {topTxns
              .map(t => `· ${t.merchantName ?? t.categoryL1} ${fmt(t.amount)}`)
              .join('  ')}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Sheet ────────────────────────────────────────────────────────────────────

interface WellnessDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  wellness: WellnessResult;
  transactions: Transaction[];
}

export function WellnessDetailSheet({
  visible,
  onClose,
  wellness,
  transactions,
}: WellnessDetailSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.drag} />

          <ScrollView style={s.scroll}>
            {/* Top row: score + close */}
            <View style={s.topRow}>
              <View>
                <View style={s.scoreRow}>
                  <Text style={s.score}>{wellness.score}</Text>
                  <Text style={s.scoreDenom}> /100</Text>
                </View>
                <Text style={s.scoreStatus}>{wellness.status}</Text>
              </View>
              <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.75}>
                <Text style={s.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Sparkline */}
            <View style={s.chartWrap}>
              <ExpandedSparkline history={wellness.history} color={C.emerald} />
            </View>

            <View style={s.rule} />
            <Text style={s.sectionLabel}>What's affecting your score</Text>

            {/* Factor list */}
            {wellness.factors.length === 0 ? (
              <Text style={[s.factorAmount, { textAlign: 'center', paddingVertical: 24 }]}>
                Set budget allocations on the Plan tab to see your score breakdown.
              </Text>
            ) : (
              wellness.factors.map(factor => (
                <FactorRow
                  key={factor.categoryId}
                  factor={factor}
                  transactions={transactions}
                />
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(9,9,12,0.9)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40, maxHeight: '85%' },
  drag: { width: 36, height: 4, backgroundColor: C.b2, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  scroll: { paddingHorizontal: 20 },

  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 12 },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline' },
  score: { fontSize: 42, fontWeight: '700', color: C.emerald, letterSpacing: -2, lineHeight: 42, fontVariant: ['tabular-nums'] },
  scoreDenom: { fontSize: 18, fontWeight: '300', color: C.w4 },
  scoreStatus: { ...T.sectionLabel, color: C.w4, marginTop: 3 },
  closeBtn: { padding: 8 },
  closeText: { fontSize: 20, color: C.w4 },

  chartWrap: { marginBottom: 12 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  dayLabel: { fontSize: 8, color: C.w4 },

  rule: { height: 1, backgroundColor: C.b1, marginBottom: 8 },
  sectionLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 10 },

  factorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(31,31,40,0.5)' },
  factorRowMuted: { opacity: 0.4 },
  factorDot: { width: 5, height: 5, borderRadius: 3, marginTop: 4 },
  factorContent: { flex: 1 },
  factorTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  factorName: { fontSize: 12, color: C.w2 },
  textMuted: { color: C.w4 },
  factorRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  factorRatioPct: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  factorAmount: { fontSize: 11, color: C.w3, fontVariant: ['tabular-nums'] },
  txnList: { marginTop: 4 },
  txnItem: { fontSize: 10, color: C.w4, marginTop: 2 },
});
