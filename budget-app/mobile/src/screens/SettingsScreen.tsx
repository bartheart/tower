import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../supabase/client';

type UserMeta = { displayName: string; email: string; initial: string };

export default function SettingsScreen() {
  const { top } = useSafeAreaInsets();
  const { signOut } = useAuth();
  const navigation = useNavigation<any>();
  const [meta, setMeta] = useState<UserMeta>({ displayName: '', email: '', initial: '?' });

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const displayName =
        (user.user_metadata?.display_name as string | undefined) ??
        (user.email?.split('@')[0] ?? '?');
      setMeta({
        displayName,
        email: user.email ?? '',
        initial: displayName[0]?.toUpperCase() ?? '?',
      });
    });
  }, []);

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 24 }]}>
      <TouchableOpacity style={s.profileCard} onPress={() => navigation.navigate('Profile')}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{meta.initial}</Text>
        </View>
        <View style={s.profileInfo}>
          <Text style={s.profileName} numberOfLines={1}>{meta.displayName}</Text>
          <Text style={s.profileEmail} numberOfLines={1}>{meta.email}</Text>
        </View>
        <Text style={s.chevron}>›</Text>
      </TouchableOpacity>

      <Text style={s.sectionLabel}>ACCOUNTS</Text>
      <View style={s.group}>
        <Row icon="🏦" iconBg="#1d4ed8" label="Linked Accounts" onPress={() => navigation.navigate('LinkedAccounts')} />
      </View>

      <Text style={s.sectionLabel}>APP</Text>
      <View style={s.group}>
        <Row icon="🔔" iconBg="#0f766e" label="Notifications" onPress={() => navigation.navigate('Notifications')} border />
        <Row icon="⚙️" iconBg="#7c3aed" label="Preferences" onPress={() => navigation.navigate('Preferences')} />
      </View>

      <Text style={s.sectionLabel}>SUPPORT</Text>
      <View style={s.group}>
        <Row icon="ℹ️" iconBg="#334155" label="About" onPress={() => navigation.navigate('About')} />
      </View>

      <TouchableOpacity
        style={s.signOutBtn}
        onPress={() => signOut().catch(() => Alert.alert('Error', 'Could not sign out. Try again.'))}
      >
        <Text style={s.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({
  icon, iconBg, label, onPress, border,
}: {
  icon: string; iconBg: string; label: string; onPress: () => void; border?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.row, border && s.rowBorder]}
      onPress={onPress}
    >
      <View style={[s.iconTile, { backgroundColor: iconBg }]}>
        <Text style={s.iconText}>{icon}</Text>
      </View>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 40 },

  profileCard: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#6366f1',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileInfo: { flex: 1 },
  profileName: { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  profileEmail: { color: '#64748b', fontSize: 12, marginTop: 2 },

  sectionLabel: {
    fontSize: 9, color: '#475569', letterSpacing: 1.5,
    marginBottom: 6, marginLeft: 4,
  },
  group: { backgroundColor: '#1e293b', borderRadius: 8, marginBottom: 20 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  iconTile: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 14 },
  rowLabel: { flex: 1, color: '#f1f5f9', fontSize: 14 },
  chevron: { color: '#475569', fontSize: 18 },

  signOutBtn: { marginTop: 12, padding: 14, alignItems: 'center' },
  signOutText: { color: '#ef4444', fontSize: 14, fontWeight: '500' },
});
