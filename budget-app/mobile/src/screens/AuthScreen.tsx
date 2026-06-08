import React, { useState, useRef, useEffect } from 'react';
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
import Svg, { Path, G } from 'react-native-svg';
import { signInWithEmail, signUpWithEmail, signInWithApple, signInWithGoogle, supabase } from '../supabase/client';
import * as AppleAuthentication from 'expo-apple-authentication';
import { C, T } from '../theme';

type Mode = 'signin' | 'signup';
type Screen = 'form' | 'confirm_email';

// ─── Password strength ────────────────────────────────────────────────────────

const RULES = [
  { label: 'At least 8 characters',           test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter',             test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number or special character',  test: (p: string) => /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p) },
];

function scorePassword(pw: string) {
  const failures = RULES.filter(r => !r.test(pw)).map(r => r.label);
  return { score: (3 - failures.length) as 0 | 1 | 2 | 3, failures };
}

const STRENGTH_COLORS = [C.rose, C.amber, C.emerald];
const STRENGTH_LABELS  = ['Weak', 'Fair', 'Strong'];

// ─── Brand logos (SVG) ────────────────────────────────────────────────────────

/** Official Google "G" logo — four-color paths on a 24×24 canvas */
function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={{ marginRight: 10 }}>
      <Path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <Path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <Path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <Path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </Svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AuthScreen() {
  const { top, bottom } = useSafeAreaInsets();

  const [mode,   setMode]   = useState<Mode>('signin');
  const [screen, setScreen] = useState<Screen>('form');

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  // Check once on mount whether the native Sign-in-with-Apple module is available.
  // isAvailableAsync() returns false when running in Expo Go or a dev client
  // that was built before expo-apple-authentication was added — prevents the
  // RCTManager native-view crash.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  const passwordRef = useRef<TextInput>(null);
  const confirmRef  = useRef<TextInput>(null);

  const { score, failures } = scorePassword(password);
  const passwordsMatch = password === confirm;
  const showStrength   = mode === 'signup' && password.length > 0;

  const signInReady = email.trim().length > 0 && password.length >= 8;
  const signUpReady = email.trim().length > 0 && score === 3 && confirm.length > 0 && passwordsMatch;
  const ready       = mode === 'signin' ? signInReady : signUpReady;

  function switchMode(m: Mode) {
    setMode(m);
    setPassword('');
    setConfirm('');
    setError(null);
    setShowPw(false);
    setShowConfirmPw(false);
  }

  async function handleAppleSignIn() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await signInWithApple();
      // AuthContext listener takes over from here — no further state change needed
    } catch (e: any) {
      // User cancelled — silently ignore
      if (e?.code === 'ERR_REQUEST_CANCELED') return;
      setError(e?.message || 'Apple sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      // AuthContext listener takes over — no further state change needed
    } catch (e: any) {
      setError(e?.message ?? 'Google sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setError('Enter your email address above first.');
      return;
    }
    try {
      await supabase.auth.resetPasswordForEmail(email.trim());
    } catch { /* swallow — don't reveal account existence */ }
    Alert.alert(
      'Check your inbox',
      `If an account exists for ${email.trim()}, a reset link is on its way.`,
    );
  }

  async function handleSubmit() {
    if (!ready || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
        setScreen('confirm_email');
      }
    } catch (e: any) {
      const msg: string = (e?.message ?? '').toLowerCase();
      if (msg.includes('already registered') || msg.includes('user already exists')) {
        setError('An account already exists for this email.');
        switchMode('signin');
      } else if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('invalid email or password')) {
        setError('Wrong password.');
      } else if (msg.includes('email not confirmed')) {
        setError('Confirm your email before signing in — check your inbox.');
      } else if (msg.includes('rate limit')) {
        setError('Too many attempts. Please wait a moment.');
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
        <Text style={s.confirmBody}>We sent a link to</Text>
        <Text style={s.confirmEmail}>{email}</Text>
        <Text style={[s.confirmBody, { marginTop: 12 }]}>
          Open it to activate your account, then come back to sign in.
        </Text>
        <TouchableOpacity
          style={s.openMailBtn}
          onPress={() => Linking.openURL('message://').catch(() => {})}
          activeOpacity={0.8}
        >
          <Text style={s.openMailText}>Open Mail</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.continueBtn, { marginTop: 12, width: '100%' }]}
          onPress={() => { setScreen('form'); switchMode('signin'); }}
          activeOpacity={0.85}
        >
          <Text style={s.continueBtnText}>Go to Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Auth form ───────────────────────────────────────────────────────────────
  const isSignUp = mode === 'signup';

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[s.container, { paddingTop: top + 40, paddingBottom: bottom + 32 }]}>

        {/* Wordmark */}
        <View style={s.wordmark}>
          <Text style={s.appName}>Tower</Text>
          <Text style={s.tagline}>your money, simplified</Text>
        </View>

        {/* Form */}
        <View style={s.form}>

          {/* Email */}
          <Text style={s.fieldLabel}>{isSignUp ? 'Your Email' : 'Your Email'}</Text>
          <TextInput
            style={s.input}
            placeholder="you@example.com"
            placeholderTextColor={C.w4}
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

          {/* Password */}
          <Text style={[s.fieldLabel, { marginTop: 16 }]}>Password</Text>
          <View style={s.inputWrap}>
            <TextInput
              ref={passwordRef}
              style={[s.inputInner, error === 'Wrong password.' && s.inputError]}
              placeholder={isSignUp ? '8+ chars, uppercase, number/symbol' : ''}
              placeholderTextColor={C.w4}
              value={password}
              onChangeText={v => { setPassword(v); setError(null); }}
              secureTextEntry={!showPw}
              returnKeyType={isSignUp ? 'next' : 'done'}
              onSubmitEditing={() => isSignUp ? confirmRef.current?.focus() : handleSubmit()}
              editable={!loading}
              testID="password-input"
            />
            <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPw(v => !v)}>
              <Text style={s.eyeIcon}>{showPw ? '○' : '◎'}</Text>
            </TouchableOpacity>
          </View>

          {/* Strength meter (signup) */}
          {showStrength && (
            <>
              <View style={s.strengthWrap}>
                <View style={s.strengthBar}>
                  {[0, 1, 2].map(i => (
                    <View
                      key={i}
                      style={[s.strengthSegment, { backgroundColor: i < score ? STRENGTH_COLORS[score - 1] : C.b2 }]}
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
                  {failures.map(f => <Text key={f} style={s.requirementItem}>· {f}</Text>)}
                </View>
              )}
            </>
          )}

          {/* Error + Forgot password row */}
          <View style={s.errorRow}>
            {error ? (
              <Text style={s.errorText} testID="error-text">{error}</Text>
            ) : (
              <View />
            )}
            {mode === 'signin' && (
              <TouchableOpacity onPress={handleForgotPassword}>
                <Text style={s.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Confirm password (signup) */}
          {isSignUp && (
            <>
              <Text style={[s.fieldLabel, { marginTop: 4 }]}>Confirm Password</Text>
              <View style={s.inputWrap}>
                <TextInput
                  ref={confirmRef}
                  style={[s.inputInner, confirm.length > 0 && !passwordsMatch && s.inputError]}
                  placeholder="re-enter password"
                  placeholderTextColor={C.w4}
                  value={confirm}
                  onChangeText={v => { setConfirm(v); setError(null); }}
                  secureTextEntry={!showConfirmPw}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  editable={!loading}
                  testID="confirm-input"
                />
                <TouchableOpacity style={s.eyeBtn} onPress={() => setShowConfirmPw(v => !v)}>
                  <Text style={s.eyeIcon}>{showConfirmPw ? '○' : '◎'}</Text>
                </TouchableOpacity>
              </View>
              {confirm.length > 0 && !passwordsMatch && (
                <Text style={s.matchError}>Passwords don't match</Text>
              )}
            </>
          )}

          {/* Continue / Create Account */}
          <TouchableOpacity
            style={[s.continueBtn, { marginTop: isSignUp ? 20 : 4 }, (!ready || loading) && s.continueBtnDisabled]}
            onPress={handleSubmit}
            disabled={!ready || loading}
            activeOpacity={0.85}
            testID="submit-button"
          >
            {loading
              ? <ActivityIndicator color={C.bg} size="small" />
              : <Text style={s.continueBtnText}>{isSignUp ? 'Create Account' : 'Continue'}</Text>
            }
          </TouchableOpacity>

          {/* Or divider */}
          {!isSignUp && (
            <>
              <View style={s.dividerRow}>
                <View style={s.dividerLine} />
                <Text style={s.dividerText}>Or</Text>
                <View style={s.dividerLine} />
              </View>

              {/* Apple — only render when native module confirms availability.
                  Prevents RCTManager crash on dev clients built without the module. */}
              {appleAvailable && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={10}
                  style={s.appleBtn}
                  onPress={handleAppleSignIn}
                />
              )}

              {/* Google */}
              <TouchableOpacity
                style={[s.socialBtn, { marginTop: 10 }]}
                activeOpacity={0.8}
                onPress={handleGoogleSignIn}
                testID="google-signin-button"
              >
                <GoogleLogo />
                <Text style={s.socialBtnText}>Login with Google</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Switch mode link */}
          <View style={s.switchRow}>
            {isSignUp ? (
              <>
                <Text style={s.switchText}>Already have an account? </Text>
                <TouchableOpacity onPress={() => switchMode('signin')}>
                  <Text style={s.switchLink}>Sign In</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.switchText}>Don't have an account? </Text>
                <TouchableOpacity onPress={() => switchMode('signup')} testID="goto-signup">
                  <Text style={s.switchLink}>Sign Up</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // Root / layout
  root: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between' },

  // Wordmark
  wordmark: { marginTop: 32 },
  appName: { fontSize: 42, fontWeight: '300', color: C.w, letterSpacing: -1 },
  tagline: { fontSize: 13, color: C.w4, marginTop: 4, letterSpacing: 0.2 },

  form: { marginBottom: 8 },

  // Fields
  fieldLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 8 },

  input: {
    backgroundColor: C.s1,
    borderWidth: 1,
    borderColor: C.b1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 13,
    color: C.w,
  },

  // Input with eye toggle
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.s1,
    borderWidth: 1,
    borderColor: C.b1,
    borderRadius: 10,
  },
  inputInner: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 13,
    color: C.w,
  },
  inputError: { borderColor: C.roseBd },
  eyeBtn: { paddingHorizontal: 14, paddingVertical: 13 },
  eyeIcon: { fontSize: 14, color: C.w4 },

  // Strength meter (segments)
  strengthWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  strengthBar: { flexDirection: 'row', gap: 4, flex: 1 },
  strengthSegment: { flex: 1, height: 2, borderRadius: 1, backgroundColor: C.b2 },
  strengthLabel: { fontSize: 10, fontWeight: '600', width: 40 },
  requirementList: { marginTop: 6, gap: 2 },
  requirementItem: { fontSize: 11, color: C.w4 },

  // Error + forgot row
  errorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
    minHeight: 18,
  },
  errorText: { fontSize: 12, color: C.rose, flex: 1 },
  forgotText: { fontSize: 12, color: C.emerald, fontWeight: '500', opacity: 0.85 },

  // Confirm mismatch
  matchError: { fontSize: 11, color: C.rose, marginTop: 4, marginBottom: 4 },

  // Continue / primary button
  continueBtn: { backgroundColor: C.w, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  continueBtnDisabled: { opacity: 0.35 },
  continueBtnText: { fontSize: 13, fontWeight: '700', color: C.bg, letterSpacing: 0.1 },

  // Or divider
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 14, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.b1 },
  dividerText: { fontSize: 9, color: C.w4 },

  // Social buttons
  socialBtn: {
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 10,
    paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8,
  },
  socialBtnText: { fontSize: 12, color: C.w2, fontWeight: '500' },
  appleBtn: { height: 50, width: '100%' },

  // Switch mode
  switchRow: { marginTop: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  switchText: { fontSize: 11, color: C.w4 },
  switchLink: { fontSize: 11, color: C.emerald, opacity: 0.85, fontWeight: '600' },

  // Email confirmation screen
  confirmRoot: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  confirmIcon: { fontSize: 52, marginBottom: 24 },
  confirmTitle: { fontSize: 22, fontWeight: '700', color: C.w, letterSpacing: -0.6, marginBottom: 8 },
  confirmBody: { fontSize: 13, color: C.w3, textAlign: 'center', lineHeight: 20 },
  confirmEmail: { fontSize: 13, color: C.emerald, fontWeight: '600', textAlign: 'center', marginTop: 4, opacity: 0.85 },
  openMailBtn: {
    marginTop: 32,
    borderWidth: 1,
    borderColor: C.b1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  openMailText: { fontSize: 13, color: C.w3, fontWeight: '500' },
});
