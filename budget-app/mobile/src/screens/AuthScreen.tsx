import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signInWithEmail, signUpWithEmail } from '../supabase/client';

export default function AuthScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const isValid = email.trim().length > 0 && password.length >= 6;

  async function handleContinue() {
    if (!isValid || loading) return;
    setLoading(true);
    setError(null);
    try {
      await signInWithEmail(email.trim(), password);
    } catch (signInErr: any) {
      // If account doesn't exist, create it
      if (
        signInErr?.message?.toLowerCase().includes('invalid login') ||
        signInErr?.message?.toLowerCase().includes('email not confirmed') ||
        signInErr?.message?.toLowerCase().includes('invalid credentials') ||
        signInErr?.message?.toLowerCase().includes('user not found')
      ) {
        try {
          await signUpWithEmail(email.trim(), password);
        } catch (signUpErr: any) {
          setError(signUpErr?.message ?? 'Something went wrong. Please try again.');
        }
      } else {
        setError(signInErr?.message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[s.container, { paddingTop: top + 40, paddingBottom: bottom + 24 }]}>
        {/* Wordmark */}
        <View style={s.wordmark}>
          <Text style={s.appName}>Tower</Text>
          <Text style={s.tagline}>your money, simplified</Text>
        </View>

        {/* Form */}
        <View style={s.form}>
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>EMAIL</Text>
            <TextInput
              style={s.input}
              placeholder="you@example.com"
              placeholderTextColor="#334155"
              value={email}
              onChangeText={v => { setEmail(v); setError(null); }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!loading}
              testID="email-input"
            />
          </View>

          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>PASSWORD</Text>
            <TextInput
              ref={passwordRef}
              style={s.input}
              placeholder="min. 6 characters"
              placeholderTextColor="#334155"
              value={password}
              onChangeText={v => { setPassword(v); setError(null); }}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              editable={!loading}
              testID="password-input"
            />
          </View>

          {error ? (
            <Text style={s.errorText} testID="error-message">{error}</Text>
          ) : null}

          <TouchableOpacity
            style={[s.button, (!isValid || loading) && s.buttonDisabled]}
            onPress={handleContinue}
            disabled={!isValid || loading}
            activeOpacity={0.85}
            testID="continue-button"
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={s.buttonText}>Continue</Text>
            )}
          </TouchableOpacity>

          <Text style={s.hint}>
            New? We'll create your account automatically.
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a14' },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  wordmark: {
    marginTop: 32,
  },
  appName: {
    fontSize: 42,
    fontWeight: '300',
    color: '#f0f0f5',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 13,
    color: '#475569',
    marginTop: 4,
    letterSpacing: 0.2,
  },
  form: {
    marginBottom: 8,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 9,
    color: '#475569',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0f1729',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#f0f0f5',
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    marginBottom: 12,
    lineHeight: 16,
  },
  button: {
    backgroundColor: '#4f46e5',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  hint: {
    fontSize: 11,
    color: '#334155',
    textAlign: 'center',
    marginTop: 16,
  },
});
