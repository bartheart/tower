import React, { useState, useCallback, useEffect } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create, open, LinkSuccess, LinkExit } from 'react-native-plaid-link-sdk';
import { fetchLinkToken } from '../plaid/linkToken';
import { exchangePublicToken } from '../plaid/exchangeToken';
import { syncTransactions, syncAllItems } from '../plaid/syncTransactions';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import { useAccounts } from '../hooks/useTransactions';
import { useAuth } from '../auth/AuthContext';

export default function SettingsScreen() {
  const { top } = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const accounts = useAccounts();

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncAllItems();
    } catch (err) {
      Alert.alert('Sync failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, []);

  const institutions = [...new Set(accounts.map(a => a.institutionName))];

  const handlePlaidSuccess = useCallback(async (success: LinkSuccess) => {
    console.log('[Plaid] onSuccess fired, institution:', success.metadata.institution?.name);
    try {
      const { itemId } = await exchangePublicToken(success.publicToken);
      await database.write(async () => {
        await database.get<PlaidItem>('plaid_items').create(item => {
          item.itemId = itemId;
          item.accessToken = '';
          item.institutionId = success.metadata.institution?.id ?? '';
          item.institutionName = success.metadata.institution?.name ?? 'Bank';
          item.cursor = '';
        });
      });
      const item = (await database.get<PlaidItem>('plaid_items')
        .query().fetch()).find(i => i.itemId === itemId)!;
      await syncTransactions(item);
      Alert.alert('Connected!', `${success.metadata.institution?.name} linked successfully.`);
    } catch (err) {
      Alert.alert('Error', `Failed to connect account: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLinking(false);
    }
  }, []);

  const handlePlaidExit = useCallback((exit: LinkExit) => {
    console.log('[Plaid] onExit fired, status:', exit.metadata.status);
    setLinking(false);
  }, []);

  // Handle OAuth redirect — bank app/Safari redirects back to tower://plaid-oauth
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('tower://plaid-oauth')) {
        open({
          receivedRedirectUri: url,
          onSuccess: handlePlaidSuccess,
          onExit: handlePlaidExit,
        });
      }
    });
    return () => sub.remove();
  }, [handlePlaidSuccess, handlePlaidExit]);

  const handleAddAccount = useCallback(async () => {
    setLinking(true);
    try {
      const token = await fetchLinkToken();
      create({ token });
      open({
        onSuccess: handlePlaidSuccess,
        onExit: handlePlaidExit,
      });
    } catch (err) {
      Alert.alert('Error', `Bank linking failed: ${err instanceof Error ? err.message : String(err)}`);
      setLinking(false);
    }
  }, [handlePlaidSuccess, handlePlaidExit]);

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <Text style={s.sectionLabel}>LINKED ACCOUNTS</Text>

      {institutions.map(name => (
        <View key={name} style={s.institutionCard}>
          <Text style={s.institutionName}>{name}</Text>
          <Text style={s.accountCount}>
            {accounts.filter(a => a.institutionName === name).length} accounts
          </Text>
        </View>
      ))}

      <TouchableOpacity style={s.addButton} onPress={handleAddAccount} disabled={linking || syncing}>
        <Text style={s.addButtonText}>{linking ? 'Linking...' : '+ Add Account'}</Text>
      </TouchableOpacity>

      {accounts.length > 0 && (
        <TouchableOpacity style={s.syncButton} onPress={handleSync} disabled={syncing}>
          <Text style={s.syncButtonText}>{syncing ? 'Syncing...' : '↻  Sync now'}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={s.signOutButton}
        onPress={() => signOut().catch(() => Alert.alert('Error', 'Could not sign out. Try again.'))}
      >
        <Text style={s.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16 },
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 10 },
  institutionCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 8, padding: 14, marginBottom: 8,
  },
  institutionName: { fontSize: 14, color: '#f1f5f9' },
  accountCount: { fontSize: 12, color: '#64748b' },
  addButton: {
    backgroundColor: '#6366f1', borderRadius: 8, padding: 14,
    alignItems: 'center', marginTop: 8,
  },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  syncButton: {
    borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 14,
    alignItems: 'center', marginTop: 8,
  },
  syncButtonText: { color: '#94a3b8', fontSize: 14 },
  signOutButton: { marginTop: 32, padding: 14, alignItems: 'center' },
  signOutText: { color: '#475569', fontSize: 14 },
});
