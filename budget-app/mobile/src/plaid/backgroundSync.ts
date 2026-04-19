import * as Notifications from 'expo-notifications';
import { AppState, AppStateStatus } from 'react-native';
import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import { syncTransactions, migrateAccessTokens } from './syncTransactions';
import { detectIncomeSources } from './incomeDetector';
import { detectFixedItems } from './fixedItemClassifier';
import { supabase } from '../supabase/client';
import { checkBudgetAlerts } from '../notifications/budgetAlerts';
import { checkGoalFeasibility } from '../goals/checkGoalFeasibility';

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export async function registerPushToken(userId: string) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: '91e461dd-f379-4f2d-9a69-72b76f755076',
  })).data;

  await supabase
    .from('app_preferences')
    .upsert({ user_id: userId, expo_push_token: token }, { onConflict: 'user_id' });
}

export async function syncStaleItems() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await migrateAccessTokens();

  // Only sync this user's items
  const items = await database.get<PlaidItem>('plaid_items')
    .query(Q.where('user_id', user.id))
    .fetch();
  const now = Date.now();

  for (const item of items) {
    const lastSync = item.lastSyncedAt ?? 0;
    if (now - lastSync > STALE_THRESHOLD_MS) {
      await syncTransactions(item, user.id);
    }
  }

  await detectIncomeSources().catch(() => {});
  await detectFixedItems().catch(() => {});
  await checkBudgetAlerts(user.id).catch(() => {});
  await checkGoalFeasibility(user.id).catch(() => {});
}

export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const type = notification.request.content.data?.type;
      const show = type === 'budget_alert' || type === 'goal_at_risk';
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });

  return Notifications.addNotificationReceivedListener(async notification => {
    const itemId = notification.request.content.data?.itemId as string | undefined;
    if (!itemId) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const items = await database.get<PlaidItem>('plaid_items')
      .query(Q.where('user_id', user.id))
      .fetch();
    const item = items.find(i => i.itemId === itemId);
    if (item) await syncTransactions(item, user.id);
  });
}

export function setupAppStateSync() {
  let lastState = AppState.currentState;

  return AppState.addEventListener('change', async (nextState: AppStateStatus) => {
    if (lastState.match(/inactive|background/) && nextState === 'active') {
      await syncStaleItems();
    }
    lastState = nextState;
  });
}
