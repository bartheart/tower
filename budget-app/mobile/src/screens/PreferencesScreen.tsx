import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, ActionSheetIOS,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../supabase/client';

const CURRENCIES = [
  { code: 'USD', label: 'USD — $' },
  { code: 'EUR', label: 'EUR — €' },
  { code: 'GBP', label: 'GBP — £' },
  { code: 'CAD', label: 'CAD — C$' },
];

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export default function PreferencesScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [cycleDay, setCycleDay] = useState(1);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const m = user.user_metadata ?? {};
      setCycleDay(typeof m.budget_cycle_start_day === 'number' ? m.budget_cycle_start_day : 1);
      setCurrency(typeof m.currency === 'string' ? m.currency : 'USD');
      setLoading(false);
    });
  }, []);

  async function saveCycleDay(day: number) {
    setCycleDay(day);
    const { error } = await supabase.auth.updateUser({ data: { budget_cycle_start_day: day } });
    if (error) Alert.alert('Error', error.message);
  }

  function handleCurrencyPress() {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...CURRENCIES.map(c => c.label), 'Cancel'],
        cancelButtonIndex: CURRENCIES.length,
      },
      async (index) => {
        if (index === CURRENCIES.length) return;
        const selected = CURRENCIES[index].code;
        setCurrency(selected);
        const { error } = await supabase.auth.updateUser({ data: { currency: selected } });
        if (error) {
          setCurrency(currency);
          Alert.alert('Error', error.message);
        }
      }
    );
  }

  const currentCurrencyLabel = CURRENCIES.find(c => c.code === currency)?.label ?? currency;

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Preferences</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#475569" style={{ marginTop: 40 }} />
      ) : (
        <>
          <Text style={s.sectionLabel}>BUDGET CYCLE</Text>
          <View style={s.group}>
            <FlatList
              horizontal
              data={DAYS}
              keyExtractor={d => String(d)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.dayList}
              renderItem={({ item: day }) => (
                <TouchableOpacity
                  style={[s.dayItem, day === cycleDay && s.dayItemSelected]}
                  onPress={() => saveCycleDay(day)}
                >
                  <Text style={[s.dayText, day === cycleDay && s.dayTextSelected]}>
                    {day}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>

          <Text style={s.sectionLabel}>CURRENCY</Text>
          <View style={s.group}>
            <TouchableOpacity style={s.row} onPress={handleCurrencyPress}>
              <Text style={s.rowLabel}>{currentCurrencyLabel}</Text>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          </View>
        </>
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
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 6, marginLeft: 4 },
  group: { backgroundColor: '#1e293b', borderRadius: 8, marginBottom: 20 },
  dayList: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  dayItem: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center',
  },
  dayItemSelected: { backgroundColor: '#6366f1' },
  dayText: { color: '#94a3b8', fontSize: 13 },
  dayTextSelected: { color: '#fff', fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rowLabel: { flex: 1, color: '#f1f5f9', fontSize: 14 },
  chevron: { color: '#475569', fontSize: 18 },
});
