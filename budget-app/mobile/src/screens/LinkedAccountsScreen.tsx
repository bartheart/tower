import React, { useState, useCallback, useEffect } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Alert, Linking, ActivityIndicator, ActionSheetIOS,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { create, open, LinkSuccess, LinkExit } from 'react-native-plaid-link-sdk';
import { Q } from '@nozbe/watermelondb';
import { useAccounts } from '../hooks/useTransactions';
import { fetchLinkToken, fetchUpdateLinkToken } from '../plaid/linkToken';
import { exchangePublicToken, PlaidAccount } from '../plaid/exchangeToken';
import { removePlaidItem } from '../plaid/removePlaidItem';
import { syncTransactions } from '../plaid/syncTransactions';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import Account from '../db/models/Account';
import { supabase } from '../supabase/client';
import { SUPABASE_OAUTH_REDIRECT_URL } from '../constants';
import { C, T } from '../theme';

// Lightweight hook — returns all PlaidItem records for the current user.
function usePlaidItems(refreshKey: number): PlaidItem[] {
  const [items, setItems] = useState<PlaidItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const result = await database.get<PlaidItem>('plaid_items')
        .query(Q.where('user_id', user.id))
        .fetch();
      if (!cancelled) setItems(result);
    }
    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  return items;
}

export default function LinkedAccountsScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [linking, setLinking] = useState(false);
  const [reconnectingItemId, setReconnectingItemId] = useState<string | null>(null);
  const [unlinkingItemId, setUnlinkingItemId] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const { accounts, loading: accountsLoading } = useAccounts();
  const plaidItems = usePlaidItems(refreshCount);

  // Group accounts by institution name
  const institutions = [...new Set(accounts.map(a => a.institutionName))];

  // Returns whether any plaid_items row for this institution has has_error = true
  function institutionHasError(institutionName: string): { hasError: boolean; itemId: string | null } {
    const instAccounts = accounts.filter(a => a.institutionName === institutionName);
    for (const acc of instAccounts) {
      const item = plaidItems.find(i => i.itemId === acc.plaidItemId);
      if (item?.hasError) return { hasError: true, itemId: item.itemId };
    }
    return { hasError: false, itemId: null };
  }

  const handlePlaidSuccess = useCallback(async (success: LinkSuccess) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { itemId, accounts: freshAccounts }: { itemId: string; accounts: PlaidAccount[] } = await exchangePublicToken(success.publicToken);
      const institutionName = success.metadata.institution?.name ?? 'Bank';

      await database.write(async () => {
        // Write PlaidItem
        await database.get<PlaidItem>('plaid_items').create(item => {
          item.userId = user.id;
          item.itemId = itemId;
          item.accessToken = '';
          item.institutionId = success.metadata.institution?.id ?? '';
          item.institutionName = institutionName;
          item.cursor = '';
          item.hasError = false;
        });

        // Write accounts immediately from /accounts/get — don't wait for sync
        // because /transactions/sync returns empty accounts on new production items
        // until Plaid finishes processing the item.
        for (const acc of freshAccounts) {
          await database.get<Account>('accounts').create(a => {
            a.userId = user.id;
            a.plaidAccountId = acc.account_id;
            a.plaidItemId = itemId;
            a.name = acc.name;
            a.type = acc.type;
            a.subtype = acc.subtype ?? '';
            a.currentBalance = acc.balances?.current ?? 0;
            a.availableBalance = acc.balances?.available ?? 0;
            a.institutionName = institutionName;
          });
        }
      });

      // Sync transactions in background — webhook will also trigger this later
      const item = (await database.get<PlaidItem>('plaid_items')
        .query(Q.where('user_id', user.id)).fetch()).find(i => i.itemId === itemId)!;
      syncTransactions(item, user.id).catch(e => console.warn('syncTransactions error:', e));

      Alert.alert('Connected!', `${institutionName} linked successfully.`);
    } catch (err) {
      Alert.alert('Error', `Failed to connect account: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLinking(false);
    }
  }, []);

  const handleReconnectSuccess = useCallback(async (success: LinkSuccess, itemId: string) => {
    try {
      await database.write(async () => {
        const items = await database.get<PlaidItem>('plaid_items')
          .query(Q.where('item_id', itemId))
          .fetch();
        for (const item of items) {
          await item.update(i => { (i as PlaidItem).hasError = false; });
        }
      });
      Alert.alert('Reconnected!', `${success.metadata.institution?.name ?? 'Account'} has been refreshed.`);
    } catch (err) {
      Alert.alert('Error', `Could not clear error state: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReconnectingItemId(null);
      setRefreshCount(c => c + 1);
    }
  }, []);

  const handlePlaidExit = useCallback((_exit: LinkExit) => {
    setLinking(false);
    setReconnectingItemId(null);
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('tower://plaid-oauth')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        open({
          receivedRedirectUri: url,
          onSuccess: handlePlaidSuccess,
          onExit: handlePlaidExit,
        } as any);
      }
    });
    return () => sub.remove();
  }, [handlePlaidSuccess, handlePlaidExit]);

  const handleAddAccount = useCallback(async () => {
    setLinking(true);
    try {
      const token = await fetchLinkToken();
      create({ token, redirectUri: SUPABASE_OAUTH_REDIRECT_URL } as any);
      open({ onSuccess: handlePlaidSuccess, onExit: handlePlaidExit });
    } catch (err) {
      Alert.alert('Error', `Bank linking failed: ${err instanceof Error ? err.message : String(err)}`);
      setLinking(false);
    }
  }, [handlePlaidSuccess, handlePlaidExit]);

  const handleReconnect = useCallback(async (itemId: string) => {
    setReconnectingItemId(itemId);
    try {
      const token = await fetchUpdateLinkToken(itemId);
      create({ token, redirectUri: SUPABASE_OAUTH_REDIRECT_URL } as any);
      open({
        onSuccess: (success) => handleReconnectSuccess(success, itemId),
        onExit: handlePlaidExit,
      });
    } catch (err) {
      Alert.alert('Error', `Reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
      setReconnectingItemId(null);
    }
  }, [handleReconnectSuccess, handlePlaidExit]);

  const handleLongPressAccount = useCallback((accountName: string, plaidItemId: string) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [`Unlink ${accountName}`, 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      async (buttonIndex) => {
        if (buttonIndex !== 0) return;
        Alert.alert(
          'Unlink account?',
          `This will disconnect ${accountName}. Your transaction history will be preserved.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Unlink',
              style: 'destructive',
              onPress: async () => {
                setUnlinkingItemId(plaidItemId);
                try {
                  await removePlaidItem(plaidItemId);
                } catch (err) {
                  Alert.alert('Error', `Could not unlink: ${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setUnlinkingItemId(null);
                  setRefreshCount(c => c + 1);
                }
              },
            },
          ]
        );
      }
    );
  }, []);

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Linked Accounts</Text>
      </View>
      <Text style={s.sectionLabel}>LINKED ACCOUNTS</Text>

      {accountsLoading ? (
        <ActivityIndicator color={C.w4} style={{ marginVertical: 20 }} />
      ) : institutions.length === 0 ? (
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>No accounts linked yet</Text>
          <Text style={s.emptyHint}>Tap Add Account to connect your bank</Text>
        </View>
      ) : (
        institutions.map(name => {
          const { hasError, itemId: errorItemId } = institutionHasError(name);
          const instAccounts = accounts.filter(a => a.institutionName === name);
          const isReconnecting = reconnectingItemId === errorItemId;

          return (
            <View key={name} style={s.institutionCard}>
              <View style={s.institutionHeader}>
                <View style={s.institutionInfo}>
                  <View style={s.nameRow}>
                    {hasError && <View style={s.errorDot} />}
                    <Text style={s.institutionName}>{name}</Text>
                  </View>
                  <Text style={s.accountCount}>
                    {instAccounts.length} account{instAccounts.length !== 1 ? 's' : ''}
                  </Text>
                </View>

                {hasError && errorItemId ? (
                  <TouchableOpacity
                    style={[s.reconnectButton, isReconnecting && s.reconnectButtonDisabled]}
                    onPress={() => handleReconnect(errorItemId)}
                    disabled={isReconnecting}
                  >
                    <Text style={s.reconnectText}>
                      {isReconnecting ? 'Reconnecting…' : 'Reconnect'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={s.syncStatus}>
                    <Text style={s.syncDot}>●</Text>
                    <Text style={s.syncLabel}>linked</Text>
                  </View>
                )}
              </View>

              {instAccounts.map(account => {
                const isUnlinking = unlinkingItemId === account.plaidItemId;
                return (
                  <TouchableOpacity
                    key={account.plaidAccountId}
                    style={s.accountRow}
                    onLongPress={() => handleLongPressAccount(account.name, account.plaidItemId)}
                    disabled={isUnlinking}
                  >
                    <View>
                      <Text style={s.accountName}>{account.name}</Text>
                      <Text style={s.accountSubtype}>{account.subtype}</Text>
                    </View>
                    {isUnlinking ? (
                      <ActivityIndicator size="small" color={C.w4} />
                    ) : (
                      <Text style={s.accountBalance}>
                        ${account.currentBalance.toFixed(2)}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })
      )}

      <TouchableOpacity style={s.addButton} onPress={handleAddAccount} disabled={linking}>
        <Text style={s.addButtonText}>{linking ? 'Linking...' : '+ Add Account'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8, marginBottom: 8 },
  backBtn: { padding: 4 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.w, letterSpacing: -0.4 },
  sectionLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 10, paddingHorizontal: 14 },

  // Institution cards
  institutionCard: { marginHorizontal: 14, marginBottom: 10, backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden' },
  institutionHeader: { paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.b1 },
  institutionInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.rose },
  institutionName: { fontSize: 12, fontWeight: '600', color: C.w },
  accountCount: { fontSize: 9, color: C.w4, letterSpacing: 0.4, marginTop: 1 },

  // Reconnect button (rose/error state)
  reconnectButton: { padding: 8, backgroundColor: C.roseBg, borderWidth: 1, borderColor: C.roseBd, borderRadius: 8, alignItems: 'center' },
  reconnectButtonDisabled: { opacity: 0.5 },
  reconnectText: { fontSize: 11, color: C.rose },

  // Sync status
  syncStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncDot: { fontSize: 8, color: C.emerald },
  syncLabel: { fontSize: 11, color: C.w4 },

  // Account rows
  accountRow: { paddingHorizontal: 13, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(31,31,40,0.4)' },
  accountName: { fontSize: 10, color: C.w2 },
  accountSubtype: { fontSize: 8.5, color: C.w4, marginTop: 1, textTransform: 'capitalize' },
  accountBalance: { fontSize: 10, color: C.w4, fontVariant: ['tabular-nums'] },

  // Add account button
  addButton: { marginHorizontal: 14, marginTop: 4, padding: 11, borderWidth: 1, borderStyle: 'dashed', borderColor: C.b2, borderRadius: 10, alignItems: 'center' },
  addButtonText: { fontSize: 11, color: C.w4 },

  // Empty state
  emptyCard: { padding: 20, alignItems: 'center', marginBottom: 8 },
  emptyText: { fontSize: 13, color: C.w4, fontWeight: '500' },
  emptyHint: { fontSize: 11, color: C.w4, marginTop: 4, opacity: 0.6 },

  // Loading
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  unlinkText: { fontSize: 12, color: C.rose },
});
