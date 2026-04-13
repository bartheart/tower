import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase/client';

export interface FixedItem {
  id: string;
  categoryId: string;
  merchantName: string;
  detectedAmount: number;
  confirmedAmount: number | null;
  effectiveAmount: number;  // confirmedAmount ?? detectedAmount
  lastSeenDate: string | null;
  isConfirmed: boolean;
  needsReview: boolean;
}

function toFixedItem(r: any): FixedItem {
  const confirmed = r.confirmed_amount ?? null;
  return {
    id: r.id,
    categoryId: r.category_id,
    merchantName: r.merchant_name,
    detectedAmount: r.detected_amount,
    confirmedAmount: confirmed,
    effectiveAmount: confirmed ?? r.detected_amount,
    lastSeenDate: r.last_seen_date ?? null,
    isConfirmed: r.is_confirmed,
    needsReview: r.needs_review,
  };
}

export function useFixedItems(): {
  items: FixedItem[];
  pendingReview: FixedItem[];
  reload: () => void;
} {
  const [items, setItems] = useState<FixedItem[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('fixed_items')
      .select('*')
      .order('merchant_name');
    if (data) setItems(data.map(toFixedItem));
  }, []);

  useEffect(() => { load(); }, [load]);

  const pendingReview = items.filter(i => !i.isConfirmed || i.needsReview);

  return { items, pendingReview, reload: load };
}

export async function confirmFixedItem(
  id: string,
  confirmedAmount?: number
): Promise<void> {
  const patch: Record<string, unknown> = { is_confirmed: true, needs_review: false };
  if (confirmedAmount !== undefined) patch.confirmed_amount = confirmedAmount;
  const { error } = await supabase.from('fixed_items').update(patch).eq('id', id);
  if (error) throw error;
}

export async function dismissFixedItem(id: string): Promise<void> {
  const { error } = await supabase.from('fixed_items').delete().eq('id', id);
  if (error) throw error;
}

export async function updateFixedItemAmount(
  id: string,
  confirmedAmount: number
): Promise<void> {
  const { error } = await supabase
    .from('fixed_items')
    .update({ confirmed_amount: confirmedAmount, needs_review: false })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Recomputes monthly_floor for a category from its confirmed fixed items
 * and writes it back to budget_categories.
 */
export async function recomputeFloor(categoryId: string): Promise<void> {
  const { data } = await supabase
    .from('fixed_items')
    .select('detected_amount, confirmed_amount')
    .eq('category_id', categoryId)
    .eq('is_confirmed', true);

  const floor = (data ?? []).reduce(
    (sum, item) => sum + (item.confirmed_amount ?? item.detected_amount),
    0
  );

  await supabase
    .from('budget_categories')
    .update({ monthly_floor: floor })
    .eq('id', categoryId);
}
