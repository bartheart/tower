import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, Switch, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../supabase/client';

export default function NotificationsScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [bankErrors, setBankErrors] = useState(true);
  const [budgetAlerts, setBudgetAlerts] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const m = user.user_metadata ?? {};
      setBankErrors(m.notif_bank_errors !== false);
      setBudgetAlerts(m.notif_budget_alerts !== false);
      setLoading(false);
    });
  }, []);

  async function toggle(key: 'notif_bank_errors' | 'notif_budget_alerts', value: boolean) {
    if (key === 'notif_bank_errors') setBankErrors(value);
    else setBudgetAlerts(value);

    const { error } = await supabase.auth.updateUser({ data: { [key]: value } });
    if (error) {
      if (key === 'notif_bank_errors') setBankErrors(!value);
      else setBudgetAlerts(!value);
      Alert.alert('Error', error.message);
    }
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Notifications</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#475569" style={{ marginTop: 40 }} />
      ) : (
        <View style={s.group}>
          <View style={s.row}>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Bank connection errors</Text>
              <Text style={s.rowSub}>Notify when an account needs reconnecting</Text>
            </View>
            <Switch
              value={bankErrors}
              onValueChange={v => toggle('notif_bank_errors', v)}
              trackColor={{ true: '#6366f1' }}
            />
          </View>
          <View style={[s.row, s.rowBorder]}>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Budget limit alerts</Text>
              <Text style={s.rowSub}>Notify when spending approaches a limit</Text>
            </View>
            <Switch
              value={budgetAlerts}
              onValueChange={v => toggle('notif_budget_alerts', v)}
              trackColor={{ true: '#6366f1' }}
            />
          </View>
        </View>
      )}
    </ScrollView>
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
  rowInfo: { flex: 1, paddingRight: 12 },
  rowLabel: { color: '#f1f5f9', fontSize: 14 },
  rowSub: { color: '#64748b', fontSize: 11, marginTop: 2 },
});
