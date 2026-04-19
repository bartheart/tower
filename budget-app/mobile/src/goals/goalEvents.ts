import { supabase } from '../supabase/client';

export type GoalEventType = 'at_risk' | 'back_on_track' | 'adjustment' | 'completed';
export type GoalEventTrigger = 'sync' | 'manual';

export interface GoalEvent {
  id: string;
  goalId: string;
  eventType: GoalEventType;
  trigger: GoalEventTrigger;
  shortfall: number | null;
  snapshot: Record<string, unknown>;
  createdAt: string;
}

export interface WriteGoalEventParams {
  userId: string;
  goalId: string;
  eventType: GoalEventType;
  trigger: GoalEventTrigger;
  shortfall: number;
  snapshot: Record<string, unknown>;
}

export async function writeGoalEvent(params: WriteGoalEventParams): Promise<void> {
  const { error } = await supabase.from('goal_events').insert({
    user_id: params.userId,
    goal_id: params.goalId,
    event_type: params.eventType,
    trigger: params.trigger,
    shortfall: params.shortfall,
    snapshot: params.snapshot,
  });
  if (error) throw new Error(error.message);
}

export async function loadGoalEvents(goalId: string, limit = 10): Promise<GoalEvent[]> {
  const { data, error } = await supabase
    .from('goal_events')
    .select('*')
    .eq('goal_id', goalId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id,
    goalId: r.goal_id,
    eventType: r.event_type as GoalEventType,
    trigger: r.trigger as GoalEventTrigger,
    shortfall: r.shortfall ?? null,
    snapshot: r.snapshot ?? {},
    createdAt: r.created_at,
  }));
}
