# Google Sign-In Implementation Plan

> **Status: COMPLETED 2026-04-18**
> Original plan targeted `@react-native-google-signin/google-signin`. Actual implementation switched to `react-native-app-auth` + `expo-crypto` due to a fundamental incompatibility between Google Sign-In iOS SDK v7+ and Supabase's nonce verification (see Decision Log below).

**Goal:** Wire up native Google Sign-In for the Tower budget app so users can authenticate with their Google account via a native account picker.

**Architecture:** `react-native-app-auth` (wrapping AppAuth SDK) opens Google's OAuth 2.0 flow via `ASWebAuthenticationSession`. We control the nonce ourselves: generate a raw random nonce → SHA-256 hash it → send the hash to Google (goes into the JWT `nonce` claim) → send the raw nonce to Supabase (`signInWithIdToken`) → Supabase re-hashes and verifies. AppDelegate must conform to `RNAppAuthAuthorizationFlowManager` for the redirect URL handling.

**Tech Stack:** `react-native-app-auth ^8.1.0`, `expo-crypto ~15.0.8`, Supabase JS v2, Expo bare workflow, TypeScript.

---

## Decision Log

### Why not `@react-native-google-signin/google-signin`?

`@react-native-google-signin` wraps Google Sign-In iOS SDK v7+. That SDK auto-generates nonces internally without ever exposing the raw value to JavaScript. Supabase's `signInWithIdToken` requires the raw nonce to verify the JWT's `nonce` claim (`SHA256(rawNonce) == jwt.nonce`). Since the raw nonce is never accessible, this approach cannot work with Supabase on iOS — at any version of the library.

Previous attempts (downgrading to v13 with `nonce: undefined`, web OAuth flow, implicit-flow token parsing) all failed for related reasons.

### Why `react-native-app-auth`?

`react-native-app-auth` wraps the AppAuth SDK but lets us pass parameters directly to Google's `/token` endpoint via `additionalParameters`. We pass `nonce: hashedNonce` and disable the library's own auto-nonce (`useNonce: false`). This gives us full control over the nonce.

### Why `expo-crypto` instead of `crypto.getRandomValues`?

Hermes (React Native's JS engine) does not expose a `crypto` global. `expo-crypto` provides `getRandomBytes()` and `digestStringAsync()` as native module calls that work correctly in Hermes.

---

## Prerequisites

### Google Cloud Console
- iOS OAuth 2.0 Client ID: `78330911812-pgerchhlsf6rk0a45jbqs6b8g3emulsb.apps.googleusercontent.com`
- Web OAuth 2.0 Client ID: `78330911812-bmn8k013imouifkil59k387hr7fsuu34.apps.googleusercontent.com`
- Authorized redirect URI for the iOS client: `com.googleusercontent.apps.78330911812-pgerchhlsf6rk0a45jbqs6b8g3emulsb:/oauth2redirect/google`

### Supabase Dashboard
- Authentication → Providers → Google → Client ID: **iOS** client ID (`78330911812-pgerchhlsf6rk0a45jbqs6b8g3emulsb.apps.googleusercontent.com`)

### Environment variables (`.env`)
```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=78330911812-bmn8k013imouifkil59k387hr7fsuu34.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=78330911812-pgerchhlsf6rk0a45jbqs6b8g3emulsb.apps.googleusercontent.com
```

---

## Files Changed

| File | Change |
|---|---|
| `budget-app/mobile/package.json` | Added `react-native-app-auth ^8.1.0`; removed `@react-native-google-signin/google-signin` |
| `budget-app/mobile/app.json` | Added `CFBundleURLTypes` with Google reverse-client-ID URL scheme; removed google-signin plugin |
| `budget-app/mobile/eas.json` | Added `EXPO_PUBLIC_GOOGLE_*` env vars to development build profile |
| `budget-app/mobile/src/supabase/client.ts` | Replaced `@react-native-google-signin` with `react-native-app-auth` + `expo-crypto` nonce flow |
| `budget-app/mobile/App.tsx` | Removed `GoogleSignin.configure()` call (not needed with react-native-app-auth) |
| `budget-app/mobile/src/screens/AuthScreen.tsx` | Error handler uses `e?.message`; removed google-signin imports |
| `budget-app/mobile/ios/Tower/AppDelegate.swift` | Added `RNAppAuthAuthorizationFlowManager` conformance + `resumeExternalUserAgentFlow` in URL handler |
| `budget-app/mobile/ios/Tower/Tower-Bridging-Header.h` | Added `<react-native-app-auth/RNAppAuth.h>` and `<react-native-app-auth/RNAppAuthAuthorizationFlowManager.h>` |
| `budget-app/docs/AUTH.md` | Updated Google Sign-In section from Backlog → Implemented |

---

## Nonce Flow (reference)

```
rawNonce (16 random bytes, hex-encoded)
    │
    ├─ SHA-256 ──→ hashedNonce
    │                   │
    │              sent to Google via additionalParameters.nonce
    │              Google puts hashedNonce into JWT nonce claim
    │
    └─ sent to Supabase as nonce param in signInWithIdToken
         Supabase: SHA256(rawNonce) == jwt.nonce  ✓
```
