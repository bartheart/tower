import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

/**
 * Key format: goalAtRisk:<YYYY-MM>:<goalId>
 * Ensures the user gets at most one notification per goal per calendar month.
 * Resets when the goal recovers (clearGoalAtRiskKey) so they get re-notified
 * if it falls at-risk again in the same month.
 */
function atRiskKey(goalId: string): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `goalAtRisk:${ym}:${goalId}`;
}

export async function fireGoalAtRiskNotification(
  goalName: string,
  goalId: string,
): Promise<void> {
  const key = atRiskKey(goalId);
  const alreadySent = await SecureStore.getItemAsync(key);
  if (alreadySent) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${goalName} is at risk`,
      body: 'A recent charge may affect your timeline. Tap to review.',
      data: { type: 'goal_at_risk', goalId, screen: 'Plan', tab: 'goals' },
    },
    trigger: null, // fire immediately
  });

  await SecureStore.setItemAsync(key, 'sent');
}

/** Call when a goal recovers (back_on_track) so the next at-risk event re-notifies. */
export async function clearGoalAtRiskKey(goalId: string): Promise<void> {
  await SecureStore.deleteItemAsync(atRiskKey(goalId));
}
