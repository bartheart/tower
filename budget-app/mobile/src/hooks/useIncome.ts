import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabase/client';

export interface IncomeSource {
  id: string;
  name: string;
  amountMonthly: number;
  frequency: 'biweekly' | 'monthly' | 'manual';
  sourceAccountId: string | null;
  isConfirmed: boolean;
}

function toIncomeSource(r: any): IncomeSource {
  return {
    id: r.id,
    name: r.name,
    amountMonthly: r.amount_monthly,
    frequency: r.frequency,
    sourceAccountId: r.source_account_id ?? null,
    isConfirmed: r.is_confirmed,
  };
}

export function useIncome(): {
  sources: IncomeSource[];
  confirmedMonthlyIncome: number;
  reload: () => void;
} {
  const [sources, setSources] = useState<IncomeSource[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('income_sources')
      .select('*')
      .order('created_at');
    if (data) setSources(data.map(toIncomeSource));
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirmedMonthlyIncome = useMemo(
    () => sources
      .filter(s => s.isConfirmed)
      .reduce((sum, s) => sum + s.amountMonthly, 0),
    [sources]
  );

  return { sources, confirmedMonthlyIncome, reload: load };
}

export async function confirmIncomeSource(id: string): Promise<void> {
  const { error } = await supabase
    .from('income_sources')
    .update({ is_confirmed: true })
    .eq('id', id);
  if (error) throw error;
}

export async function dismissIncomeSource(id: string): Promise<void> {
  const { error } = await supabase
    .from('income_sources')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function addManualIncomeSource(
  name: string,
  amountMonthly: number
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase.from('income_sources').insert({
    user_id: user.id,
    name,
    amount_monthly: amountMonthly,
    frequency: 'manual',
    is_confirmed: true,
  });
  if (error) throw error;
}

export async function updateIncomeSource(
  id: string,
  fields: { name?: string; amountMonthly?: number }
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.amountMonthly !== undefined) patch.amount_monthly = fields.amountMonthly;
  const { error } = await supabase
    .from('income_sources')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteIncomeSource(id: string): Promise<void> {
  const { error } = await supabase
    .from('income_sources')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
