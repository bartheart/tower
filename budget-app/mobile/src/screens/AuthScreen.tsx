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
  Alert,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signInWithEmail, signUpWithEmail, supabase } from '../supabase/client';

type Mode = 'signin' | 'signup';
type Screen = 'form' | 'confirm_email';

// ─── Password strength ────────────────────────────────────────────────────────
// Rules: ≥8 chars, ≥1 uppercase, ≥1 digit or symbol
const RULES = [
  { label: 'At least 8 characters',        test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter',          test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number or special character', test: (p: string) => /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p) },
];

function scorePassword(pw: string): { score: 0 | 1 | 2 | 3; failures: string[] } {
  const failures = RULES.filter(r => !r.test(pw)).map(r => r.label);
  return { score: (3 - failures.length) as 0 | 1 | 2 | 3, failures };
}

const STRENGTH_COLORS = ['#ef4444', '#f59e0b', '#22c55e'];
const STRENGTH_LABELS = ['Weak', 'Fair', 'Strong'];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AuthScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('signin');
  const [screen, setScreen] = useState<Screen>('form');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);
  const confirmRef  = useRef<TextInput>(null);

  const { score, failures } = scorePassword(password);
  const passwordsMatch = password === confirm;
  const showStrength = mode === 'signup' && password.length > 0;

  const signInReady  = email.trim().length > 0 && password.length >= 8;
  const signUpReady  = email.trim().length > 0 && score === 3 && confirm.length > 0 && passwordsMatch;
  const ready        = mode === 'signin' ? signInReady : signUpReady;

  function switchMode(m: Mode) {
    setMode(m);
    setPassword('');
    setConfirm('');
    setError(null);
  }

  function clearError() { setError(null); }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setError('Enter your email address above first.');
      return;
    }
    try {
      // No redirectTo — Supabase serves its own hosted reset page
      await supabase.auth.resetPasswordForEmail(email.trim());
    } catch {
      // Intentionally swallow — don't reveal whether email exists
    }
    Alert.alert(
      'Check your inbox',
      `If an account exists for ${email.trim()}, a password reset link is on its way.`,
    );
  }

  async function handleSubmit() {
    if (!ready || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
        // Session change handled by AuthContext — no extra navigation needed
      } else {
        await signUpWithEmail(email.trim(), password);
        setScreen('confirm_email');
      }
    } catch (e: any) {
      const msg: string = (e?.message ?? '').toLowerCase();
      if (msg.includes('already registered') || msg.includes('user already exists')) {
        setError('An account already exists for this email. Sign in instead.');
        switchMode('signin');
      } else if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('invalid email or password')) {
        setError('Incorrect email or password.');
      } else if (msg.includes('email not confirmed')) {
        setError('Confirm your email before signing in — check your inbox.');
      } else if (msg.includes('rate limit')) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError(e?.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Email confirmation screen ───────────────────────────────────────────────
  if (screen === 'confirm_email') {
    return (
      <View style={[s.root, s.confirmRoot]}>
        <Text style={s.confirmIcon}>✉️</Text>
        <Text style={s.confirmTitle}>Confirm your email</Text>
        <Text style={s.confirmBody}>
          We sent a link to
        </Text>
        <Text style={s.confirmEmail}>{email}</Text>
        <Text style={[s.confirmBody, { marginTop: 12 }]}>
          Open it to activate your account, then come back here to sign in.
        </Text>

        <TouchableOpacity
          style={s.openMailBtn}
          onPress={() => Linking.openURL('message://').catch(() => {})}
          activeOpacity={0.8}
        >
          <Text style={s.openMailText}>Open Mail</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.button, s.confirmSignInBtn]}
          onPress={() => { setScreen('form'); switchMode('signin'); }}
          activeOpacity={0.85}
        >
          <Text style={s.buttonText}>Go to Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Auth form ───────────────────────────────────────────────────────────────
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

        <View style={s.formArea}>
          {/* Sign In / Create Account toggle */}
          <View style={s.modeToggle}>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'signin' && s.modeBtnActive]}
              onPress={() => switchMode('signin')}
              testID="mode-signin"
            >
              <Text style={[s.modeBtnText, mode === 'signin' && s.modeBtnTextActive]}>
                Sign In
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'signup' && s.modeBtnActive]}
              onPress={() => switchMode('signup')}
              testID="mode-signup"
            >
              <Text style={[s.modeBtnText, mode === 'signup' && s.modeBtnTextActive]}>
                Create Account
              </Text>
            </TouchableOpacity>
          </View>

          {/* Email */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>EMAIL</Text>
            <TextInput
              style={s.input}
              placeholder="you@example.com"
              placeholderTextColor="#334155"
              value={email}
              onChangeText={v => { setEmail(v); clearError(); }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!loading}
              testID="email-input"
            />
          </View>

          {/* Password */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>PASSWORD</Text>
            <TextInput
              ref={passwordRef}
              style={s.input}
              placeholder={mode === 'signup' ? '8+ chars, uppercase, number/symbol' : ''}
              placeholderTextColor="#334155"
              value={password}
              onChangeText={v => { setPassword(v); clearError(); }}
              secureTextEntry
              returnKeyType={mode === 'signup' ? 'next' : 'done'}
              onSubmitEditing={() => mode === 'signup' ? confirmRef.current?.focus() : handleSubmit()}
              editable={!loading}
              testID="password-input"
            />

            {/* Strength meter (signup only) */}
            {showStrength && (
              <>
                <View style={s.strengthWrap}>
                  <View style={s.strengthBar}>
                    {[0, 1, 2].map(i => (
                      <View
                        key={i}
                        style={[
                          s.strengthSegment,
                          { backgroundColor: i < score ? STRENGTH_COLORS[score - 1] : '#1e293b' },
                        ]}
                      />
                    ))}
                  </View>
                  {score > 0 && (
                    <Text style={[s.strengthLabel, { color: STRENGTH_COLORS[score - 1] }]}>
                      {STRENGTH_LABELS[score - 1]}
                    </Text>
                  )}
                </View>
                {failures.length > 0 && (
                  <View style={s.requirementList}>
                    {failures.map(f => (
                      <Text key={f} style={s.requirementItem}>· {f}</Text>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>

          {/* Confirm password (signup only) */}
          {mode === 'signup' && (
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>CONFIRM PASSWORD</Text>
              <TextInput
                ref={confirmRef}
                style={[s.input, confirm.length > 0 && !passwordsMatch && s.inputBorderError]}
                placeholder="re-enter password"
                placeholderTextColor="#334155"
                value={confirm}
                onChangeText={v => { setConfirm(v); clearError(); }}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                editable={!loading}
                testID="confirm-input"
              />
              {confirm.length > 0 && !passwordsMatch && (
                <Text style={s.matchError}>Passwords don't match</Text>
              )}
            </View>
          )}

          {/* Error */}
          {error ? <Text style={s.errorText} testID="error-text">{error}</Text> : null}

          {/* Submit */}
          <TouchableOpacity
            style={[s.button, (!ready || loading) && s.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!ready || loading}
            activeOpacity={0.85}
            testID="submit-button"
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.buttonText}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>
            }
          </TouchableOpacity>

          {/* Forgot password (sign in only) */}
          {mode === 'signin' && (
            <TouchableOpacity style={s.forgotWrap} onPress={handleForgotPassword}>
              <Text style={s.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a14' },

  container: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },

  // Wordmark
  wordmark: { marginTop: 32 },
  appName: { fontSize: 42, fontWeight: '300', color: '#f0f0f5', letterSpacing: -1 },
  tagline: { fontSize: 13, color: '#475569', marginTop: 4, letterSpacing: 0.2 },

  formArea: { marginBottom: 8 },

  // Mode toggle
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#0f1729',
    borderRadius: 10,
    padding: 3,
    marginBottom: 24,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeBtnActive: { backgroundColor: '#1e293b' },
  modeBtnText: { fontSize: 13, color: '#475569', fontWeight: '500' },
  modeBtnTextActive: { color: '#f0f0f5', fontWeight: '600' },

  // Fields
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 6 },
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
  inputBorderError: { borderColor: '#7f1d1d' },

  // Strength meter
  strengthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  strengthBar: { flexDirection: 'row', gap: 4, flex: 1 },
  strengthSegment: { flex: 1, height: 3, borderRadius: 2 },
  strengthLabel: { fontSize: 10, fontWeight: '600', width: 40 },

  // Requirements list
  requirementList: { marginTop: 6, gap: 2 },
  requirementItem: { fontSize: 11, color: '#475569' },

  // Confirm password mismatch
  matchError: { fontSize: 11, color: '#ef4444', marginTop: 4 },

  // Error
  errorText: { fontSize: 12, color: '#ef4444', marginBottom: 12, lineHeight: 17 },

  // Submit button
  button: {
    backgroundColor: '#4f46e5',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },

  // Forgot password
  forgotWrap: { alignItems: 'center', marginTop: 16 },
  forgotText: { fontSize: 12, color: '#475569' },

  // Confirm email screen
  confirmRoot: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  confirmIcon: { fontSize: 52, marginBottom: 24 },
  confirmTitle: { fontSize: 22, color: '#f0f0f5', fontWeight: '600', marginBottom: 16 },
  confirmBody: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20 },
  confirmEmail: {
    fontSize: 14,
    color: '#a5b4fc',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  openMailBtn: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  openMailText: { fontSize: 14, color: '#94a3b8', fontWeight: '500' },
  confirmSignInBtn: { marginTop: 12, width: '100%' },
});
