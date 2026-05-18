import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../supabase/client';

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
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={displayName}
              onChangeText={setDisplayName}
              onBlur={handleSaveName}
              placeholderTextColor="#475569"
              returnKeyType="done"
            />
            {saving && <ActivityIndicator size="small" color="#475569" style={s.inputSpinner} />}
          </View>
        </View>

        <View style={[s.fieldRow, s.fieldBorder]}>
          <Text style={s.fieldLabel}>EMAIL</Text>
          <Text style={s.fieldValue}>{email}</Text>
        </View>
      </View>

      {hasEmailProvider && (
        <TouchableOpacity
          style={[s.passwordBtn, sendingReset && s.passwordBtnDisabled]}
          onPress={handleChangePassword}
          disabled={sendingReset}
        >
          {sendingReset
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={s.passwordBtnText}>Change Password</Text>}
        </TouchableOpacity>
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

  group: { backgroundColor: '#1e293b', borderRadius: 8, marginBottom: 16 },
  fieldRow: { paddingHorizontal: 16, paddingVertical: 12 },
  fieldBorder: { borderTopWidth: 1, borderTopColor: '#0f172a' },
  fieldLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, color: '#f1f5f9', fontSize: 15, padding: 0 },
  inputSpinner: { marginLeft: 8 },
  fieldValue: { color: '#94a3b8', fontSize: 15 },

  passwordBtn: {
    backgroundColor: '#1e293b', borderRadius: 8, padding: 14,
    alignItems: 'center',
  },
  passwordBtnDisabled: { opacity: 0.5 },
  passwordBtnText: { color: '#f1f5f9', fontSize: 14, fontWeight: '500' },
});
