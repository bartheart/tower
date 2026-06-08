import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { PRIVACY_POLICY_URL, TERMS_URL, SUPPORT_EMAIL } from '../constants';
import { C, T } from '../theme';

export default function AboutScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const version = Constants.expoConfig?.version ?? '—';

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingTop: top + 16, paddingBottom: 60 }}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>About</Text>
        <View style={{ width: 70 }} />
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
    <TouchableOpacity style={[s.row, s.rowLast]} onPress={() => Linking.openURL(url)}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.w, letterSpacing: -0.4 },
  group: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden', marginHorizontal: 20, marginTop: 16 },
  row: { paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.b1 },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: C.w2 },
  rowValue: { fontSize: 12, color: C.w3 },
  chevron: { fontSize: 14, color: C.w4 },
});
