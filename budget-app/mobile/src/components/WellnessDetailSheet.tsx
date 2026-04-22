import React, { useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import Svg, { Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { WellnessResult, ScoreFactor } from '../hooks/useWellnessScore';
import Transaction from '../db/models/Transaction';

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
  const range = max - min || 1;

  const points = history.map((v, i) => {
    const x = PAD + (i / (history.length - 1)) * (chartWidth - PAD * 2);
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');

  const lastX = PAD + (chartWidth - PAD * 2);
  const lastY = PAD + (1 - (history[history.length - 1] - min) / range) * (H - PAD * 2);

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
            <Text style={[s.factorRatioPct, { color: factor.ratio > 1 ? '#ef4444' : '#64748b' }]}>
              {Math.round(factor.ratio * 100)}%
            </Text>
            <Text style={[
              s.factorDeltaText,
              { color: isOnTrack ? '#475569' : '#ef4444' },
            ]}>
              {isOnTrack ? 'on track' : `${factor.scoreDelta} pts`}
            </Text>
          </View>
        </View>
        <Text style={[s.factorSpend, isOnTrack && s.textMuted]}>
          {fmt(factor.actualSpend)} / {fmt(factor.targetSpend)}
        </Text>
        {topTxns.length > 0 && (
          <Text style={s.factorTxns} numberOfLines={1}>
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
      <View style={s.container}>
        <View style={s.handle} />

        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerLabel}>WELLNESS SCORE</Text>
          <Text style={s.headerScore}>{wellness.score}</Text>
          <Text style={[s.headerStatus, { color: wellness.statusColor }]}>
            {wellness.status}
          </Text>
          <Text style={[
            s.headerDelta,
            { color: wellness.delta >= 0 ? '#4ade80' : '#ef4444' },
          ]}>
            {wellness.delta >= 0 ? '↑' : '↓'} {Math.abs(wellness.delta)} pts this week
          </Text>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
          {/* Sparkline */}
          <Text style={s.sectionTitle}>7-day trend</Text>
          <View style={s.sparklineWrap}>
            <ExpandedSparkline history={wellness.history} color={wellness.statusColor} />
          </View>

          {/* Factor list */}
          <Text style={s.sectionTitle}>What's affecting your score</Text>
          {wellness.factors.length === 0 ? (
            <Text style={s.emptyHint}>
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

        <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.75}>
          <Text style={s.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0f1e' },
  handle: {
    width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2,
    alignSelf: 'center', marginTop: 12, marginBottom: 8,
  },
  header: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 24 },
  headerLabel: {
    fontSize: 10, color: '#f59e0b', letterSpacing: 1.5, marginBottom: 8,
  },
  headerScore: { fontSize: 56, fontWeight: '800', color: '#e2e8f0', letterSpacing: -2 },
  headerStatus: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  headerDelta: { fontSize: 13, marginTop: 6 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 24 },

  sectionTitle: {
    fontSize: 11, color: '#64748b', letterSpacing: 1, textTransform: 'uppercase',
    marginTop: 20, marginBottom: 12,
  },
  sparklineWrap: { backgroundColor: '#0d1526', borderRadius: 10, padding: 12 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  dayLabel: { fontSize: 9, color: '#475569' },

  factorRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0d1526',
  },
  factorRowMuted: { opacity: 0.5 },
  factorDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, marginRight: 12 },
  factorContent: { flex: 1 },
  factorTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  factorName: { fontSize: 13, color: '#cbd5e1', fontWeight: '500' },
  factorRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factorRatioPct: { fontSize: 12, fontWeight: '600' },
  factorDeltaText: { fontSize: 11, fontWeight: '500', minWidth: 56, textAlign: 'right' },
  factorSpend: { fontSize: 11, color: '#475569', marginTop: 2 },
  factorTxns: { fontSize: 10, color: '#334155', marginTop: 4 },
  textMuted: { color: '#475569' },

  emptyHint: { fontSize: 13, color: '#475569', textAlign: 'center', paddingVertical: 24 },

  closeBtn: {
    margin: 20, backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, color: '#e2e8f0', fontWeight: '600' },
});
