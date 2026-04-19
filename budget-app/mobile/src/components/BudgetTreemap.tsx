import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { computeLayout } from '../budget/squarify';

interface Bucket {
  id: string;
  name: string;
  targetPct: number | null;
  color: string; // hex e.g. '#6366f1'
}

interface BudgetTreemapProps {
  buckets: Bucket[];
  selectedId: string | null;
  onTilePress: (id: string | null) => void;
  height?: number;
}

/** Convert #rrggbb to rgba(r,g,b,alpha) string. Falls back to a neutral color. */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(100,100,100,${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const UNALLOCATED_ID = '__unallocated__';
const CONTAINER_W = 390; // layout computed at a fixed logical width; tiles use % of measured width

export function BudgetTreemap({
  buckets,
  selectedId,
  onTilePress,
  height = 175,
}: BudgetTreemapProps) {
  const [containerWidth, setContainerWidth] = useState(CONTAINER_W);

  const totalAllocated = buckets.reduce((s, b) => s + (b.targetPct ?? 0), 0);
  const unallocated = Math.max(0, 100 - totalAllocated);

  // Build items for squarify (only buckets with positive targetPct)
  const allocatedItems: Array<{ id: string; value: number }> = buckets
    .filter(b => (b.targetPct ?? 0) > 0)
    .map(b => ({ id: b.id, value: b.targetPct! }));

  // No bucket has any allocation set — show placeholder instead of a 100% unallocated tile
  if (allocatedItems.length === 0) {
    return (
      <View
        testID="budget-treemap"
        style={[styles.container, { height }]}
      >
        <View testID="treemap-placeholder" style={styles.placeholder}>
          <Text style={styles.placeholderText}>No allocations yet</Text>
        </View>
      </View>
    );
  }

  const squarifyItems = [...allocatedItems];
  if (unallocated > 0) {
    squarifyItems.push({ id: UNALLOCATED_ID, value: unallocated });
  }

  const rects = computeLayout(squarifyItems, containerWidth, height);

  // Build a quick lookup: id → bucket color
  const colorMap = new Map(buckets.map(b => [b.id, b.color]));

  return (
    <View
      testID="budget-treemap"
      style={[styles.container, { height }]}
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {rects.map(rect => {
        const isUnalloc = rect.id === UNALLOCATED_ID;
        const isSelected = rect.id === selectedId;
        const bucket = buckets.find(b => b.id === rect.id);
        const color = colorMap.get(rect.id) ?? '#6366f1';
        const bgColor = isUnalloc
          ? 'rgba(30,41,59,0.6)'
          : hexToRgba(color, 0.5);

        // Only show label text if tile is wide and tall enough to be readable
        const showName = rect.w >= 40 && rect.h >= 30;
        const showPct = rect.h >= 20;
        const pct = isUnalloc
          ? unallocated
          : bucket?.targetPct ?? 0;

        const pressHandler = () => onTilePress(isUnalloc ? null : rect.id);
        return (
          <TouchableOpacity
            key={rect.id}
            activeOpacity={0.75}
            onPress={pressHandler}
            style={[
              styles.tile,
              {
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                backgroundColor: bgColor,
              },
              isUnalloc && styles.unallocTile,
              isSelected && styles.selectedTile,
            ]}
          >
            <View
              testID="treemap-tile"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onPress={pressHandler as any}
              style={StyleSheet.absoluteFillObject}
            />
            {showName && !isUnalloc && (
              <Text style={styles.tileName} numberOfLines={1}>
                {bucket?.name ?? ''}
              </Text>
            )}
            {showName && isUnalloc && (
              <Text style={[styles.tileName, styles.unallocName]} numberOfLines={1}>
                Free
              </Text>
            )}
            {showPct && (
              <Text
                style={[styles.tilePct, isUnalloc && styles.unallocPct]}
                numberOfLines={1}
              >
                {pct > 0 ? `${Math.round(pct)}%` : ''}
              </Text>
            )}
            {/* Inner shadow overlay */}
            <View style={styles.innerShadow} pointerEvents="none" />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    backgroundColor: '#1e293b',
  },
  tile: {
    position: 'absolute',
    justifyContent: 'flex-end',
    padding: 8,
  },
  unallocTile: {
    borderWidth: 1.5,
    borderColor: '#334155',
    borderStyle: 'dashed',
  },
  selectedTile: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    borderStyle: 'solid',
  },
  tileName: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 13,
  },
  tilePct: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 13,
  },
  unallocName: {
    color: '#475569',
  },
  unallocPct: {
    color: '#334155',
  },
  innerShadow: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 12,
    color: '#475569',
  },
});
