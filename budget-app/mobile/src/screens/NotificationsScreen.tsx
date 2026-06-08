import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../supabase/client';
import { C, T } from '../theme';

function TogglePill({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <TouchableOpacity
      style={[tp.pill, value ? tp.on : tp.off]}
      onPress={() => onChange(!value)}
      activeOpacity={0.8}
    >
      <View style={tp.knob} />
    </TouchableOpacity>
  );
}
const tp = StyleSheet.create({
  pill: { width: 36, height: 20, borderRadius: 10, padding: 2, justifyContent: 'center' },
  on: { backgroundColor: C.emerald, alignItems: 'flex-end' },
  off: { backgroundColor: C.b2, alignItems: 'flex-start' },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: C.bg },
});

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
    <ScrollView style={s.container} contentContainerStyle={{ paddingTop: top + 16, paddingBottom: 60 }}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Notifications</Text>
        <View style={{ width: 70 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={C.w4} style={{ marginTop: 40 }} />
      ) : (
        <View style={s.group}>
          <View style={s.toggleRow}>
            <View style={s.toggleLeft}>
              <Text style={s.rowLabel}>Bank connection errors</Text>
              <Text style={s.rowSub}>Notify when an account needs reconnecting</Text>
            </View>
            <TogglePill value={bankErrors} onChange={v => toggle('notif_bank_errors', v)} />
          </View>
          <View style={[s.toggleRow, s.toggleRowLast]}>
            <View style={s.toggleLeft}>
              <Text style={s.rowLabel}>Budget limit alerts</Text>
              <Text style={s.rowSub}>Notify when spending approaches a limit</Text>
            </View>
            <TogglePill value={budgetAlerts} onChange={v => toggle('notif_budget_alerts', v)} />
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.w, letterSpacing: -0.4 },
  group: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden', marginHorizontal: 20, marginTop: 8 },
  toggleRow: { paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.b1 },
  toggleRowLast: { borderBottomWidth: 0 },
  toggleLeft: { flex: 1, paddingRight: 12 },
  rowLabel: { fontSize: 12, color: C.w2 },
  rowSub: { fontSize: 9, color: C.w4, marginTop: 2, lineHeight: 14 },
});
