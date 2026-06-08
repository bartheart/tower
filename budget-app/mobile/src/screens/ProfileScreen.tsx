import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../supabase/client';
import { C, T } from '../theme';

export default function ProfileScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [hasEmailProvider, setHasEmailProvider] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setEmail(user.email ?? '');
      setDisplayName(
        (user.user_metadata?.display_name as string | undefined) ??
        (user.email?.split('@')[0] ?? '')
      );
      setHasEmailProvider(
        user.identities?.some(i => i.provider === 'email') ?? false
      );
    });
  }, []);

  async function handleSaveName() {
    const trimmed = displayName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ data: { display_name: trimmed } });
      if (error) throw error;
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      Alert.alert('Email sent', 'Check your inbox for a password reset link.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : String(err));
    } finally {
      setSendingReset(false);
    }
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Profile</Text>
      </View>

      <View style={s.group}>
        <View style={s.fieldRow}>
          <Text style={s.fieldLabel}>DISPLAY NAME</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TextInput
              style={s.input}
              value={displayName}
              onChangeText={setDisplayName}
              onBlur={handleSaveName}
              placeholderTextColor={C.w4}
              returnKeyType="done"
            />
            {saving && <ActivityIndicator size="small" color={C.w4} style={{ marginLeft: 8 }} />}
          </View>
        </View>

        <View style={[s.fieldRow, s.fieldBorder]}>
          <Text style={s.fieldLabel}>EMAIL</Text>
          <Text style={s.fieldValue}>{email}</Text>
        </View>
      </View>

      {hasEmailProvider && (
        <TouchableOpacity
          style={[s.passwordBtn, sendingReset && s.saving]}
          onPress={handleChangePassword}
          disabled={sendingReset}
        >
          {sendingReset
            ? <ActivityIndicator size="small" color={C.w} />
            : <Text style={s.passwordBtnText}>Change Password</Text>}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, marginBottom: 4 },
  backBtn: { padding: 4 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { ...T.screenTitle, color: C.w, fontSize: 17 },

  group: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden', marginBottom: 12 },
  fieldRow: { paddingHorizontal: 14, paddingVertical: 10 },
  fieldBorder: { borderTopWidth: 1, borderTopColor: C.b1 },
  fieldLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 4 },
  fieldValue: { fontSize: 12, color: C.w3 },
  input: { fontSize: 12, color: C.w, padding: 0 },

  passwordBtn: {
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center',
  },
  passwordBtnText: { fontSize: 12, fontWeight: '500', color: C.emerald, opacity: 0.85 },
  saving: { opacity: 0.5 },
});
