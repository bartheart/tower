# Tower — Auth Screen Design Spec

**Date:** 2026-04-11  
**App:** Tower (formerly Budget — rename throughout codebase)  
**Scope:** Login + signup screen, session persistence, inline error handling, tests

---

## Overview

A single, frictionless auth screen. One "Continue" button handles both sign-in and sign-up — it attempts `signInWithPassword` first; if the user does not exist, it calls `signUp` automatically. No mode switching, no tabs, no separate screens.

---

## Visual Design

**Aesthetic:** Monolithic minimalism. Architectural. Financial-grade precision.

| Token | Value |
|---|---|
| Background | `#0a0a14` |
| Surface | `rgba(255,255,255,0.02)` |
| Border default | `#1a1a2e` |
| Border focused | `#4f46e5` |
| Accent | `#4f46e5` (indigo) |
| Text primary | `#f0f0f5` |
| Text muted | `#2d2d4a` |
| Error | `#ef4444` |
| Display font | Syne 200 (wordmark), Syne 300 (button) |
| Mono font | DM Mono 300 (labels, hints, errors) |

**Wordmark:** `Tower.` — the dot is indigo (`#4f46e5`), the rest is `#f0f0f5`, weight 200, letter-spacing -2px.  
**Tagline:** `YOUR MONEY, CLEARLY` — DM Mono, 10px, letter-spacing 3px, color `#2d2d4a`.

---

## Screen Structure

```
┌─────────────────────────────┐
│                             │
│   Tower.                    │
│   YOUR MONEY, CLEARLY       │
│                             │
│   EMAIL                     │
│   ┌─────────────────────┐   │
│   │                     │   │
│   └─────────────────────┘   │
│   [inline error if any]     │
│                             │
│   PASSWORD                  │
│   ┌─────────────────────┐   │
│   │                     │   │
│   └─────────────────────┘   │
│   [inline error if any]     │
│                             │
│   ┌─────────────────────┐   │
│   │      Continue       │   │
│   └─────────────────────┘   │
│                             │
│   No account? We'll create  │
│   one.                      │
│                             │
└─────────────────────────────┘
```

---

## Interaction Design

### Continue Button Flow

```
tap Continue
  → validate: email non-empty, password ≥ 8 chars (inline, no submit)
  → button text → "…" (loading, disabled)
  → call signInWithPassword(email, password)
    → success → session set → App.tsx navigates to tabs
    → error "Invalid login credentials"
        → call signUp(email, password)
          → success → session set → App.tsx navigates to tabs
          → error → show inline under password field
    → other error → show inline under relevant field
```

### Input Behaviour
- `EMAIL` label in DM Mono caps above field
- `PASSWORD` label in DM Mono caps above field
- On focus: border changes to `#4f46e5`, background tints `rgba(79,70,229,0.04)`
- Password field: `secureTextEntry`, returnKeyType `"go"` → triggers Continue
- Email field: `returnKeyType "next"` → focus jumps to password
- `KeyboardAvoidingView` with `behavior="padding"` on iOS

### Loading State
- Button text fades to `"…"` — no spinner overlay
- Both inputs disabled during request

### Error States
- Wrong password / bad credentials: shown under password field
- Invalid email format: shown under email field (client-side, on blur)
- Network error: shown under password field as "Connection error. Try again."
- All errors in DM Mono 10px, `#ef4444`, fade in

### Session Persistence
- Supabase client uses `expo-secure-store` adapter (already wired)
- On app launch, `getSession()` is checked in `App.tsx` — valid session bypasses auth entirely

---

## Files

| File | Action |
|---|---|
| `mobile/src/screens/AuthScreen.tsx` | Create — the auth UI component |
| `mobile/src/screens/__tests__/AuthScreen.test.tsx` | Create — unit tests |
| `mobile/App.tsx` | Modify — replace placeholder `AuthScreen` with real one, rename app |
| `mobile/app.json` | Modify — rename `name` from "Budget" to "Tower" |

---

## Tests

All tests use Jest + `@testing-library/react-native`. The Supabase client is mocked.

### Test Cases

1. **Renders wordmark and form fields** — `Tower.` text, email input, password input, Continue button all present
2. **Continue disabled while loading** — after tap, button is non-interactive until response
3. **Sign-in success** — `signInWithPassword` resolves → `onAuthSuccess` callback called
4. **Auto sign-up on unknown email** — `signInWithPassword` returns "Invalid login credentials" → `signUp` called automatically → `onAuthSuccess` called
5. **Sign-up failure shown inline** — `signUp` rejects → error text visible under password field
6. **Invalid email format** — blur with bad email → inline error under email field
7. **Short password** — password < 8 chars on submit → inline error under password field
8. **Network error** — fetch throws → "Connection error. Try again." shown
9. **Password field focused on email return** — pressing return on email focuses password
10. **Continue triggered on password return key** — `returnKeyType "go"` submits form

---

## Rename: Budget → Tower

- `app.json`: `name` → `"Tower"`, `slug` → `"tower"`
- `App.tsx`: import + usage of real `AuthScreen`
- No other files reference the app name directly

---

## Out of Scope

- Magic link / passwordless auth
- Social auth (Google, Apple)
- Forgot password flow
- Email verification resend UI
