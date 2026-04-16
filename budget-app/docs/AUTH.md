# Tower — Authentication

## Current Implementation

Two explicit paths: **Sign In** and **Create Account**, toggled by a pill control at the top of the form. No silent auto-detection — the user always knows which path they're on.

### Sign In
- Email + password (≥8 characters to enable the button)
- Specific error messages (wrong credentials, unconfirmed email, rate-limit)
- **Forgot password?** link — fires `supabase.auth.resetPasswordForEmail` and shows an alert regardless of whether the email exists (avoids account enumeration)

### Create Account
- Email + password + confirm password
- **Password requirements** (enforced before the button enables):
  - ≥ 8 characters
  - ≥ 1 uppercase letter
  - ≥ 1 number or special character (`!@#$%^&*` etc.)
- Real-time strength meter (Weak / Fair / Strong) with remaining-requirement hints
- Confirm-password mismatch shown inline
- On success → **Email Confirmation screen**: tells the user to check their inbox, offers "Open Mail" deep-link, then "Go to Sign In" to return

### Email Confirmation
Supabase sends a confirmation email on signup. Until confirmed, sign-in returns `"Email not confirmed"` — the auth screen surfaces this with a helpful message rather than a silent failure.

### Error handling
| Supabase error | User-facing message |
|---|---|
| `invalid login credentials` | "Incorrect email or password." |
| `email not confirmed` | "Confirm your email before signing in — check your inbox." |
| `user already exists` | "An account already exists for this email. Sign in instead." (auto-switches mode) |
| `rate limit` | "Too many attempts. Please wait a moment and try again." |
| other | Raw Supabase message as fallback |

---

## Social / OAuth Login

### Sign in with Apple  ✅ Implemented
- Package: `expo-apple-authentication` (~8.0.8)
- `signInWithApple()` in `supabase/client.ts` calls `AppleAuthentication.signInAsync()` then `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken })`
- iOS only — the native `AppleAuthenticationButton` renders on `Platform.OS === 'ios'`
- User cancels (`ERR_REQUEST_CANCELED`) are silently ignored
- **Still required before App Store submission:**
  1. Enable "Sign in with Apple" capability in Xcode (Signing & Capabilities)
  2. Configure Apple provider in Supabase Dashboard → Authentication → Providers → Apple (Service ID + private key)

## Backlog — Remaining OAuth

### Sign in with Google
- Package: `@react-native-google-signin/google-signin` (or `expo-auth-session` with Google)
- Call `GoogleSignin.signIn()` → exchange `idToken` via `supabase.auth.signInWithIdToken({ provider: 'google', token })`
- Requires: Google Cloud OAuth client ID (iOS + Android), Supabase Google provider configured
- UX: show Google button below Apple button (or below mode toggle on Android)

### Future OAuth providers
- GitHub, Facebook — lower priority, same pattern as Google above
- Passkeys / WebAuthn — track for future Supabase support

### Implementation notes for social login
- Add a visual divider `─── or ───` between social buttons and the email form
- On first social sign-in, no email confirmation step is needed — Supabase provisions the session immediately
- Gracefully handle `OAuthProviderNotEnabled` errors if a provider isn't configured in a given environment
