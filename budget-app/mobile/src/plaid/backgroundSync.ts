import * as Notifications from 'expo-notifications';
import { AppState, AppStateStatus } from 'react-native';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import { syncTransactions, migrateAccessTokens } from './syncTransactions';
import { detectIncomeSources } from './incomeDetector';
import { detectFixedItems } from './fixedItemClassifier';
import { supabase } from '../supabase/client';

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
  await migrateAccessTokens(); // blank any legacy SQLite tokens
  const items = await database.get<PlaidItem>('plaid_items').query().fetch();
  const now = Date.now();

  for (const item of items) {
    const lastSync = item.lastSyncedAt ?? 0;
    if (now - lastSync > STALE_THRESHOLD_MS) {
      await syncTransactions(item);
    }
  }

  // Run detectors after sync — order matters: income first, then fixed items
  await detectIncomeSources().catch(() => {});
  await detectFixedItems().catch(() => {});
}

export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  // Sync when notification received in foreground
  return Notifications.addNotificationReceivedListener(async notification => {
    const itemId = notification.request.content.data?.itemId as string | undefined;
    if (!itemId) return;

    const items = await database.get<PlaidItem>('plaid_items').query().fetch();
    const item = items.find(i => i.itemId === itemId);
    if (item) await syncTransactions(item);
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
