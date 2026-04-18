import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as AppleAuthentication from 'expo-apple-authentication';
import { authorize } from 'react-native-app-auth';
import { getRandomBytes, digestStringAsync, CryptoDigestAlgorithm, CryptoEncoding } from 'expo-crypto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Sign in with Apple (iOS only).
 *
 * Presents the native Apple credential sheet, then exchanges the identity
 * token with Supabase. No email confirmation step — Supabase provisions the
 * session immediately.
 *
 * Throws AppleAuthentication.AppleAuthenticationUserCancelledError if the
 * user taps Cancel (callers should catch and silently ignore that case).
 */
export async function signInWithApple(): Promise<void> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken!,
  });

  if (error) throw error;
}

/**
 * Sign in with Google (iOS and Android).
 *
 * Uses react-native-app-auth to open Google's sign-in page directly via
 * ASWebAuthenticationSession (iOS). We generate and control the nonce so
 * Supabase can verify it. AuthContext listener takes over on success.
 *
 * Throws with message containing 'cancel' if the user dismisses —
 * callers should catch and silently ignore that case.
 */
export async function signInWithGoogle(): Promise<void> {
  // Generate a cryptographically random nonce via expo-crypto (native).
  // Send the SHA-256 hash to Google → it goes into the JWT nonce claim.
  // Send the raw value to Supabase → it re-hashes and verifies.
  const rawNonce = Array.from(getRandomBytes(16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const hashedNonce = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    rawNonce,
    { encoding: CryptoEncoding.HEX },
  );

  const authState = await authorize({
    issuer: 'https://accounts.google.com',
    clientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID!,
    redirectUrl: 'com.googleusercontent.apps.78330911812-pgerchhlsf6rk0a45jbqs6b8g3emulsb:/oauth2redirect/google',
    scopes: ['openid', 'profile', 'email'],
    useNonce: false,          // disable library's auto-nonce — we manage it ourselves
    additionalParameters: {
      nonce: hashedNonce,
    },
  });

  const idToken = authState.idToken;
  if (!idToken) throw new Error('Google sign-in: no ID token returned');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce: rawNonce,
  });
  if (error) throw error;
}
