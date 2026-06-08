import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { C, T } from '../theme';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { top } = useSafeAreaInsets();
  const { signOut, user } = useAuth();

  const displayName = user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? '—';
  const email = user?.email ?? '—';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingTop: top + 8, paddingBottom: 60 }}>
      <Text style={s.title}>Settings</Text>

      {/* Profile strip */}
      <TouchableOpacity style={s.profileStrip} onPress={() => navigation.navigate('Profile')} activeOpacity={0.7}>
        <View style={s.monogram}><Text style={s.monogramText}>{initials}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.profName}>{displayName}</Text>
          <Text style={s.profEmail}>{email}</Text>
        </View>
        <Text style={s.chevron}>›</Text>
      </TouchableOpacity>

      {/* Accounts group */}
      <View style={s.group}>
        <Text style={s.groupLabel}>Accounts</Text>
        <View style={s.groupCard}>
          <TouchableOpacity style={s.row} onPress={() => navigation.navigate('LinkedAccounts')} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Linked Accounts</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowLast]} onPress={() => navigation.navigate('Plan', { planningTab: 'income' })} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Income Sources</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Preferences group */}
      <View style={s.group}>
        <Text style={s.groupLabel}>Preferences</Text>
        <View style={s.groupCard}>
          <TouchableOpacity style={s.row} onPress={() => navigation.navigate('Notifications')} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Notifications</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowLast]} onPress={() => navigation.navigate('Preferences')} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Preferences</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* About group */}
      <View style={s.group}>
        <Text style={s.groupLabel}>About</Text>
        <View style={s.groupCard}>
          <TouchableOpacity style={[s.row, s.rowLast]} onPress={() => navigation.navigate('About')} activeOpacity={0.7}>
            <Text style={s.rowLabel}>About Tower</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={s.signOut} onPress={signOut} activeOpacity={0.7}>
        <Text style={s.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  title: { ...T.screenTitle, color: C.w, paddingHorizontal: 20, paddingBottom: 14 },

  profileStrip: {
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.b1,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  monogram: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.b2,
    alignItems: 'center', justifyContent: 'center',
  },
  monogramText: { fontSize: 14, fontWeight: '700', color: C.emerald },
  profName: { fontSize: 13, fontWeight: '600', color: C.w },
  profEmail: { fontSize: 10, color: C.w4, marginTop: 1 },

  group: { marginTop: 16, marginHorizontal: 20 },
  groupLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 6, paddingHorizontal: 2 },
  groupCard: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden' },
  row: {
    paddingHorizontal: 14, paddingVertical: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: C.b1,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: C.w2 },
  chevron: { fontSize: 14, color: C.w4 },

  signOut: { marginTop: 20, paddingVertical: 10, alignItems: 'center' },
  signOutText: { fontSize: 12, fontWeight: '500', color: C.rose, opacity: 0.65 },
});
