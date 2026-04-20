# Budget Treemap Design Spec

## Overview

Add a squarified treemap visualization at the top of the Buckets tab in `PlanScreen`. Each tile represents a budget bucket, sized proportionally to its `targetPct`. Tapping a tile scrolls to and highlights that bucket's card in the list below.

## Visual Design

- Container: 175px tall, `borderRadius: 12`, `overflow: hidden`
- Each tile: absolute-positioned `View` with `backgroundColor` = bucket's `color` at 50% opacity via `rgba(r, g, b, 0.5)`
- Tile content (bottom-aligned): bucket name (10px bold) + percentage (11px, 60% opacity white)
- Small tiles (< 8% of total width): show only the percentage or nothing if too narrow to read
- Unallocated slack tile: dark background `rgba(30,41,59,0.6)` + dashed `1.5px` border `#334155`, label "Free" + unallocated %
- Inner shadow on all tiles: `inset 0 0 0 1px rgba(0,0,0,0.15)` via a sibling `View` overlay
- No spend-progress bars in tiles

## Layout Algorithm (Squarify)

Pure JS squarify implementation in `BudgetTreemap.tsx`. Input: sorted array of `{id, value}` (value = targetPct). Output: `{id, x, y, width, height}` rects in 0–1 normalized space, then scaled to container pixel dimensions.

Squarify algorithm (Bruls et al.):
1. Sort items descending by value
2. Lay out rows. For each row, greedily add items while the worst aspect ratio improves
3. A "row" is a strip along the shorter remaining dimension
4. Recurse on the remaining rectangle

If all `targetPct` values are 0 (no allocations yet), the treemap renders a single full-width placeholder tile.

After computing bucket tiles, append an unallocated tile with `value = max(0, 100 - sum(targetPcts))`. If unallocated = 0, omit the tile.

## Component: `BudgetTreemap`

**File:** `mobile/src/components/BudgetTreemap.tsx`

**Props:**
```typescript
interface BudgetTreemapProps {
  buckets: Array<{ id: string; name: string; targetPct: number | null; color: string }>;
  selectedId: string | null;
  onTilePress: (id: string | null) => void; // null = unallocated tile
  height?: number; // default 175
}
```

**Internal helpers (same file, not exported):**
- `hexToRgb(hex: string): { r: number; g: number; b: number }` — converts `#rrggbb` to rgb components for opacity blending
- `squarify(items: {id:string; value:number}[], rect: {x:number;y:number;w:number;h:number}): TileRect[]` — returns normalized rects
- `TileRect = { id: string; x: number; y: number; w: number; h: number }`

**Rendering:**
- Outer `View` with `position: relative`, `height`, `borderRadius: 12`, `overflow: hidden`
- One `TouchableOpacity` per tile, `position: absolute`, `left/top/width/height` in pixels
- Selected tile gets a 2px white inset border (highlight) and no opacity reduction
- Non-selected tiles: normal rendering

## Integration in `PlanScreen.tsx`

### ScrollView ref
The outer `ScrollView` in PlanScreen (line ~1222) gets a ref:
```typescript
const scrollRef = useRef<ScrollView>(null);
```
Pass `scrollRef` to `BucketsTab` as a new prop.

### BucketsTab changes

New props added to `BucketsTab`:
```typescript
scrollRef: React.RefObject<ScrollView>;
```

New state inside `BucketsTab`:
```typescript
const [selectedTreemapId, setSelectedTreemapId] = useState<string | null>(null);
const bucketYOffsets = useRef<Record<string, number>>({});
const tabYOffset = useRef<number>(0);
```

BucketsTab's root `View` gets:
```tsx
<View onLayout={e => { tabYOffset.current = e.nativeEvent.layout.y; }}>
```

Each bucket card `TouchableOpacity` gets:
```tsx
onLayout={e => { bucketYOffsets.current[b.id] = e.nativeEvent.layout.y; }}
```

`onTilePress` handler inside BucketsTab:
```typescript
const handleTilePress = (id: string | null) => {
  setSelectedTreemapId(id);
  if (id && bucketYOffsets.current[id] != null) {
    scrollRef.current?.scrollTo({
      y: tabYOffset.current + bucketYOffsets.current[id],
      animated: true,
    });
  }
};
```

`BudgetTreemap` renders as the first child inside BucketsTab's root View, above the bucket cards:
```tsx
<BudgetTreemap
  buckets={budgets}
  selectedId={selectedTreemapId}
  onTilePress={handleTilePress}
/>
```

### Highlighted bucket card

The existing `isHighlighted` logic in BucketsTab uses `highlightId` (from route params). Extend it to also highlight when `b.id === selectedTreemapId`:
```typescript
const isHighlighted = b.id === highlightId || b.id === selectedTreemapId;
```

## Color Conversion

Bucket colors are stored as hex strings (e.g. `#6366f1`). To render at 50% opacity, convert to rgba:
```typescript
function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}
// Usage:
const { r, g, b } = hexToRgb(bucket.color);
const bg = `rgba(${r},${g},${b},0.5)`;
```

## Files Changed

| File | Action |
|------|--------|
| `mobile/src/components/BudgetTreemap.tsx` | Create |
| `mobile/src/screens/PlanScreen.tsx` | Modify — add scrollRef, pass to BucketsTab, add treemap + highlight + onLayout |

## Out of Scope

- Animated tile transitions on data change
- Spend-progress overlay in tiles
- Drag-to-resize tiles
- Any change to the squarify algorithm after initial implementation (correctness over aesthetics)
