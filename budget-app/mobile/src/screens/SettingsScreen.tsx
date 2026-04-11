import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlaidLink, LinkSuccess, LinkExit } from 'react-native-plaid-link-sdk';
import { fetchLinkToken } from '../plaid/linkToken';
import { exchangePublicToken } from '../plaid/exchangeToken';
import { syncTransactions } from '../plaid/syncTransactions';
import { database } from '../db';
import PlaidItem from '../db/models/PlaidItem';
import { useAccounts } from '../hooks/useTransactions';
import { useAuth } from '../auth/AuthContext';

export default function SettingsScreen() {
  const { top } = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const accounts = useAccounts();

  const institutions = [...new Set(accounts.map(a => a.institutionName))];

  const handleAddAccount = useCallback(async () => {
    setLinking(true);
    try {
      const token = await fetchLinkToken();
      setLinkToken(token);
    } catch (e) {
      Alert.alert('Error', 'Could not start bank linking. Try again.');
      setLinking(false);
    }
  }, []);

  const handleLinkSuccess = useCallback(async (success: LinkSuccess) => {
    try {
      const { itemId } = await exchangePublicToken(success.publicToken);

      await database.write(async () => {
        await database.get<PlaidItem>('plaid_items').create(item => {
          item.itemId = itemId;
          item.accessToken = '';  // blank — token lives in Vault now
          item.institutionId = success.metadata.institution?.id ?? '';
          item.institutionName = success.metadata.institution?.name ?? 'Bank';
          item.cursor = '';
        });
      });

      const item = (await database.get<PlaidItem>('plaid_items')
        .query().fetch()).find(i => i.itemId === itemId)!;

      await syncTransactions(item);
      Alert.alert('Connected!', `${success.metadata.institution?.name} linked successfully.`);
    } catch (e) {
      Alert.alert('Error', 'Failed to connect account.');
    } finally {
      setLinkToken(null);
      setLinking(false);
    }
  }, []);

  const handleLinkExit = useCallback((_exit: LinkExit) => {
    setLinkToken(null);
    setLinking(false);
  }, []);

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

      {linkToken ? (
        <PlaidLink
          tokenConfig={{ token: linkToken }}
          onSuccess={handleLinkSuccess}
          onExit={handleLinkExit}
        >
          <View style={s.addButton}>
            <Text style={s.addButtonText}>Opening Plaid...</Text>
          </View>
        </PlaidLink>
      ) : (
        <TouchableOpacity style={s.addButton} onPress={handleAddAccount} disabled={linking}>
          <Text style={s.addButtonText}>{linking ? 'Loading...' : '+ Add Account'}</Text>
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
  signOutButton: { marginTop: 32, padding: 14, alignItems: 'center' },
  signOutText: { color: '#475569', fontSize: 14 },
});
