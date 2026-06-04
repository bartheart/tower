import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { PRIVACY_POLICY_URL, TERMS_URL, SUPPORT_EMAIL } from '../constants';

export default function AboutScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const version = Constants.expoConfig?.version ?? '—';

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>About</Text>
      </View>

      <View style={s.group}>
        <View style={s.row}>
          <Text style={s.rowLabel}>App version</Text>
          <Text style={s.rowValue}>{version}</Text>
        </View>
        <LinkRow label="Privacy Policy" url={PRIVACY_POLICY_URL} />
        <LinkRow label="Terms of Service" url={TERMS_URL} />
        <LinkRow label="Send Feedback" url={`mailto:${SUPPORT_EMAIL}`} />
      </View>
    </ScrollView>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <TouchableOpacity style={[s.row, s.rowBorder]} onPress={() => Linking.openURL(url)}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backBtn: { marginRight: 12 },
  backText: { fontSize: 17, color: '#6366f1' },
  headerTitle: { flex: 1, fontSize: 17, color: '#f1f5f9', fontWeight: '600' },
  group: { backgroundColor: '#1e293b', borderRadius: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#0f172a' },
  rowLabel: { flex: 1, color: '#f1f5f9', fontSize: 14 },
  rowValue: { color: '#64748b', fontSize: 14 },
  chevron: { color: '#475569', fontSize: 18 },
});
