export interface SquarifyInput {
  id: string;
  value: number; // e.g. targetPct (any positive unit)
}

export interface TileRect {
  id: string;
  x: number; // pixels from container left
  y: number; // pixels from container top
  w: number; // pixels
  h: number; // pixels
}

interface Rect { x: number; y: number; w: number; h: number }
interface ScaledItem { id: string; area: number }

/** Worst aspect ratio of tiles in a row laid along a strip of given sideLen. */
function worstRatio(row: number[], sideLen: number): number {
  if (row.length === 0 || sideLen === 0) return Infinity;
  const s = row.reduce((a, b) => a + b, 0);
  if (s === 0) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = s * s;
  const side2 = sideLen * sideLen;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/** Place one row of items into rect, push TileRects into result. */
function placeRow(items: ScaledItem[], rect: Rect, result: TileRect[]): void {
  const isHoriz = rect.w >= rect.h;
  const rowSum = items.reduce((s, i) => s + i.area, 0);

  if (isHoriz) {
    // Horizontal strip at top of rect
    const stripH = rect.w > 0 ? rowSum / rect.w : 0;
    let cx = rect.x;
    for (const item of items) {
      const tileW = stripH > 0 ? item.area / stripH : 0;
      result.push({ id: item.id, x: cx, y: rect.y, w: tileW, h: stripH });
      cx += tileW;
    }
  } else {
    // Vertical strip at left of rect
    const stripW = rect.h > 0 ? rowSum / rect.h : 0;
    let cy = rect.y;
    for (const item of items) {
      const tileH = stripW > 0 ? item.area / stripW : 0;
      result.push({ id: item.id, x: rect.x, y: cy, w: stripW, h: tileH });
      cy += tileH;
    }
  }
}

/** Remaining rect after removing a placed row. */
function remainingRect(rowArea: number, rect: Rect): Rect {
  if (rect.w >= rect.h) {
    const stripH = rect.w > 0 ? rowArea / rect.w : 0;
    return { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH };
  } else {
    const stripW = rect.h > 0 ? rowArea / rect.h : 0;
    return { x: rect.x + stripW, y: rect.y, w: rect.w - stripW, h: rect.h };
  }
}

// layout is called recursively once per squarify row group.
// Depth is bounded by input length; safe for budget use cases (< ~50 items).
function layout(items: ScaledItem[], rect: Rect, result: TileRect[]): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    result.push({ id: items[0].id, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    return;
  }

  // Use the long side: for a horizontal strip sideLen=rect.w, vertical sideLen=rect.h.
  // The aspect ratio formula is max(area*L²/rowSum², rowSum²/(area*L²)) where L is the
  // dimension tiles span — which is always the long side of the remaining rect.
  const sideLen = Math.max(rect.w, rect.h);

  // Build row greedily: keep adding items while worst ratio improves
  let row = [items[0]];
  for (let i = 1; i < items.length; i++) {
    const candidate = [...row, items[i]];
    if (
      worstRatio(candidate.map(x => x.area), sideLen) <=
      worstRatio(row.map(x => x.area), sideLen)
    ) {
      row = candidate;
    } else {
      break;
    }
  }

  const rowArea = row.reduce((s, i) => s + i.area, 0);
  placeRow(row, rect, result);
  layout(items.slice(row.length), remainingRect(rowArea, rect), result);
}

/**
 * Compute squarified treemap layout.
 * Items are sorted descending by value internally; the returned rects preserve
 * each item's id so callers don't need to worry about sort order.
 * Precondition: all input values must be non-negative. Negative or zero values
 * are silently filtered out and produce no tile.
 */
export function computeLayout(
  items: SquarifyInput[],
  containerW: number,
  containerH: number,
): TileRect[] {
  if (items.length === 0 || containerW <= 0 || containerH <= 0) return [];

  // Filter out non-positive values — negative or zero values produce no tile.
  const positiveItems = items.filter(i => i.value > 0);
  if (positiveItems.length === 0) return [];

  const totalValue = positiveItems.reduce((s, i) => s + i.value, 0);
  const containerArea = containerW * containerH;
  const scaled: ScaledItem[] = positiveItems
    .map(item => ({ id: item.id, area: (item.value / totalValue) * containerArea }))
    .sort((a, b) => b.area - a.area);

  const result: TileRect[] = [];
  layout(scaled, { x: 0, y: 0, w: containerW, h: containerH }, result);
  return result;
}
