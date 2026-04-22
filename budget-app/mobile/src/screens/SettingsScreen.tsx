import React, { useState, useCallback, useEffect } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, Linking, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create, open, LinkSuccess, LinkExit } from 'react-native-plaid-link-sdk';
import { fetchLinkToken } from '../plaid/linkToken';
import { exchangePublicToken } from '../plaid/exchangeToken';
import { Q } from '@nozbe/watermelondb';
import { syncTransactions } from '../plaid/syncTransactions';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import { supabase } from '../supabase/client';
import { useAccounts } from '../hooks/useTransactions';
import { useAuth } from '../auth/AuthContext';

export default function SettingsScreen() {
  const { top } = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [linking, setLinking] = useState(false);
  const { accounts, loading: accountsLoading } = useAccounts();

  const institutions = [...new Set(accounts.map(a => a.institutionName))];

  const handlePlaidSuccess = useCallback(async (success: LinkSuccess) => {
    console.log('[Plaid] onSuccess fired, institution:', success.metadata.institution?.name);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { itemId } = await exchangePublicToken(success.publicToken);
      await database.write(async () => {
        await database.get<PlaidItem>('plaid_items').create(item => {
          item.userId = user.id;
          item.itemId = itemId;
          item.accessToken = '';
          item.institutionId = success.metadata.institution?.id ?? '';
          item.institutionName = success.metadata.institution?.name ?? 'Bank';
          item.cursor = '';
        });
      });
      const item = (await database.get<PlaidItem>('plaid_items')
        .query(Q.where('user_id', user.id)).fetch()).find(i => i.itemId === itemId)!;
      await syncTransactions(item, user.id);
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

      {accountsLoading ? (
        <ActivityIndicator color="#475569" style={{ marginVertical: 20 }} />
      ) : institutions.length === 0 ? (
        <View style={s.emptyCard}>
          <Text style={s.emptyText}>No accounts linked yet</Text>
          <Text style={s.emptyHint}>Tap Add Account to connect your bank</Text>
        </View>
      ) : (
        institutions.map(name => (
          <View key={name} style={s.institutionCard}>
            <View>
              <Text style={s.institutionName}>{name}</Text>
              <Text style={s.accountCount}>
                {accounts.filter(a => a.institutionName === name).length} account
                {accounts.filter(a => a.institutionName === name).length !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={s.syncStatus}>
              <Text style={s.syncDot}>●</Text>
              <Text style={s.syncLabel}>linked</Text>
            </View>
          </View>
        ))
      )}

      <TouchableOpacity style={s.addButton} onPress={handleAddAccount} disabled={linking}>
        <Text style={s.addButtonText}>{linking ? 'Linking...' : '+ Add Account'}</Text>
      </TouchableOpacity>

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
  addButton: {
    backgroundColor: '#6366f1', borderRadius: 8, padding: 14,
    alignItems: 'center', marginTop: 8,
  },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  emptyCard: { padding: 20, alignItems: 'center', marginBottom: 8 },
  emptyText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  emptyHint: { fontSize: 11, color: '#334155', marginTop: 4 },
  accountCount: { fontSize: 11, color: '#64748b', marginTop: 2 },
  syncStatus: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  syncDot: { fontSize: 8, color: '#22c55e' },
  syncLabel: { fontSize: 11, color: '#475569' },
  signOutButton: { marginTop: 32, padding: 14, alignItems: 'center' },
  signOutText: { color: '#475569', fontSize: 14 },
});
