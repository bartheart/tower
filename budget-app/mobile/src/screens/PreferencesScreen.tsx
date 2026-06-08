import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, ActionSheetIOS,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../supabase/client';
import { C, T } from '../theme';

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
    const prev = cycleDay;
    setCycleDay(day);
    const { error } = await supabase.auth.updateUser({ data: { budget_cycle_start_day: day } });
    if (error) {
      setCycleDay(prev);
      Alert.alert('Error', error.message);
    }
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
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Preferences</Text>
        <View style={{ width: 70 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={C.w4} style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={s.sectionWrap}>
            <Text style={s.sectionLabel}>BUDGET CYCLE</Text>
          </View>
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

          <View style={s.group}>
            <TouchableOpacity style={s.row} onPress={handleCurrencyPress}>
              <Text style={s.rowLabel}>{currentCurrencyLabel}</Text>
              <Text style={s.rowValue}>›</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.w, letterSpacing: -0.4 },
  content: { paddingBottom: 60 },
  sectionWrap: { paddingHorizontal: 20, marginTop: 16 },
  sectionLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 8 },
  dayList: { paddingVertical: 2 },
  dayItem: {
    width: 32, height: 32, borderRadius: 8, marginRight: 6,
    backgroundColor: C.b1, alignItems: 'center', justifyContent: 'center',
  },
  dayItemSelected: { backgroundColor: C.emerald, opacity: 0.85 },
  dayText: { fontSize: 11, color: C.w3 },
  dayTextSelected: { color: C.bg, fontWeight: '700' },
  group: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden', marginHorizontal: 20, marginTop: 16 },
  row: { paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 12, color: C.w2 },
  rowValue: { fontSize: 12, color: C.w3 },
  saving: { opacity: 0.5 },
});
