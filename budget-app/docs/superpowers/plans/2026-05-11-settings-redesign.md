# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-scroll SettingsScreen with a hub-and-spoke navigation structure: a profile-card hub that pushes to LinkedAccounts, Profile, Notifications, Preferences, and About sub-screens.

**Architecture:** The existing root `Stack.Navigator` in `App.tsx` already pushes `ReportScreen` on top of tabs — we extend the same pattern with five new screens. All Plaid logic moves verbatim to `LinkedAccountsScreen`. The hub becomes ~80 lines. User preferences (notifications, cycle day, currency) are stored in Supabase `user_metadata` so they sync across devices.

**Tech Stack:** React Native, React Navigation v7 native stack, Supabase Auth (`updateUser` / `resetPasswordForEmail`), `expo-constants`, `ActionSheetIOS`, `Switch` (React Native core)

**Spec:** `docs/superpowers/specs/2026-05-11-settings-redesign.md`

---

## File Map

| File | Status | What changes |
|---|---|---|
| `mobile/src/navigation/types.ts` | **New** | `RootStackParamList` type |
| `mobile/src/constants.ts` | **New** | Shared URLs, closes #65 |
| `mobile/App.tsx` | **Modified** | Register 5 new Stack screens |
| `mobile/src/screens/LinkedAccountsScreen.tsx` | **New** | Current SettingsScreen content, back btn added |
| `mobile/src/screens/SettingsScreen.tsx` | **Rewritten** | Hub only (~80 lines) |
| `mobile/src/screens/ProfileScreen.tsx` | **New** | Display name edit, email, password reset |
| `mobile/src/screens/NotificationsScreen.tsx` | **New** | Two preference toggles |
| `mobile/src/screens/PreferencesScreen.tsx` | **New** | Cycle day picker + currency selector |
| `mobile/src/screens/AboutScreen.tsx` | **New** | Version + external links |

---

## Task 1: Foundation — types, constants, App wiring

**Files:**
- Create: `mobile/src/navigation/types.ts`
- Create: `mobile/src/constants.ts`
- Modify: `mobile/App.tsx`

- [ ] **Step 1: Create navigation types file**

Create `mobile/src/navigation/types.ts`:

```typescript
export type RootStackParamList = {
  Tabs: undefined;
  Report: { budgetId?: string; period?: string };
  LinkedAccounts: undefined;
  Profile: undefined;
  Notifications: undefined;
  Preferences: undefined;
  About: undefined;
};
```

- [ ] **Step 2: Create constants file**

Create `mobile/src/constants.ts`:

```typescript
export const SUPABASE_OAUTH_REDIRECT_URL =
  'https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect';

export const PRIVACY_POLICY_URL = 'https://example.com/privacy';
export const TERMS_URL = 'https://example.com/terms';
export const SUPPORT_EMAIL = 'support@example.com';
```

- [ ] **Step 3: Register new screens in App.tsx**

Open `mobile/App.tsx`. Import the five new screens and add them to `RootNavigator`. The screens don't exist yet — TypeScript will complain until Task 2, but the wiring is correct.

Replace the imports block at the top of `App.tsx`:

```typescript
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import HomeScreen from './src/screens/HomeScreen';
import PlanScreen from './src/screens/PlanScreen';
import ReportScreen from './src/screens/ReportScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import LinkedAccountsScreen from './src/screens/LinkedAccountsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import PreferencesScreen from './src/screens/PreferencesScreen';
import AboutScreen from './src/screens/AboutScreen';
import AuthScreen from './src/screens/AuthScreen';
import FloatingTabBar from './src/navigation/FloatingTabBar';
import {
  registerPushToken,
  setupNotificationHandler,
  setupAppStateSync,
  syncStaleItems,
} from './src/plaid/backgroundSync';
```

Replace `RootNavigator` with:

```typescript
function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="Report" component={ReportScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="LinkedAccounts" component={LinkedAccountsScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="Preferences" component={PreferencesScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add mobile/src/navigation/types.ts mobile/src/constants.ts mobile/App.tsx
git commit -m "feat: add navigation types, constants, and register settings sub-screens"
```

---

## Task 2: LinkedAccountsScreen

**Files:**
- Create: `mobile/src/screens/LinkedAccountsScreen.tsx`

- [ ] **Step 1: Copy current SettingsScreen into LinkedAccountsScreen**

Create `mobile/src/screens/LinkedAccountsScreen.tsx` with the full content of the current `SettingsScreen.tsx`, then make three edits:

**a) Add `useNavigation` import** (add to existing imports):

```typescript
import { useNavigation } from '@react-navigation/native';
```

**b) Replace the hardcoded redirectUri string** in both `handleAddAccount` and `handleReconnect`. Find:

```typescript
create({ token, redirectUri: 'https://ejiqwzhpehtkyqnccode.supabase.co/functions/v1/plaid-oauth-redirect' });
```

Replace both occurrences with:

```typescript
create({ token, redirectUri: SUPABASE_OAUTH_REDIRECT_URL });
```

And add the import at the top:

```typescript
import { SUPABASE_OAUTH_REDIRECT_URL } from '../constants';
```

**c) Rename the export and add back button**

Change `export default function SettingsScreen()` to `export default function LinkedAccountsScreen()`.

Add `useNavigation` inside the function body (right after the existing `const { top }` line):

```typescript
const navigation = useNavigation<any>();
```

In the JSX, replace:

```tsx
<ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
  <Text style={s.sectionLabel}>LINKED ACCOUNTS</Text>
```

With:

```tsx
<ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
  <View style={s.headerRow}>
    <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
      <Text style={s.backText}>‹ Settings</Text>
    </TouchableOpacity>
    <Text style={s.headerTitle}>Linked Accounts</Text>
  </View>
  <Text style={s.sectionLabel}>LINKED ACCOUNTS</Text>
```

**d) Remove the Sign Out button**

Remove these lines from the JSX:

```tsx
<TouchableOpacity
  style={s.signOutButton}
  onPress={() => signOut().catch(() => Alert.alert('Error', 'Could not sign out. Try again.'))}
>
  <Text style={s.signOutText}>Sign Out</Text>
</TouchableOpacity>
```

And remove `signOut` from the `useAuth()` destructure since it's no longer used here:

```typescript
const { } = useAuth();  // or just remove the useAuth import entirely
```

Actually since `useAuth` is no longer needed, remove the import line entirely:

```typescript
import { useAuth } from '../auth/AuthContext';
```

**e) Add header styles** to the `StyleSheet.create` at the bottom:

```typescript
headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
backBtn: { marginRight: 12 },
backText: { fontSize: 17, color: '#6366f1' },
headerTitle: { flex: 1, fontSize: 17, color: '#f1f5f9', fontWeight: '600' },
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx tsc --noEmit 2>&1 | grep LinkedAccounts
```

Expected: no output (no errors for LinkedAccountsScreen).

- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/LinkedAccountsScreen.tsx
git commit -m "feat: add LinkedAccountsScreen (Plaid logic lifted from SettingsScreen)"
```

---

## Task 3: Rewrite SettingsScreen as hub

**Files:**
- Modify: `mobile/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Replace SettingsScreen.tsx entirely**

Overwrite `mobile/src/screens/SettingsScreen.tsx` with:

```typescript
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
```

- [ ] **Step 2: Check TypeScript**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx tsc --noEmit 2>&1 | grep SettingsScreen
```

Expected: no output.

- [ ] **Step 3: Run existing tests to confirm nothing broken**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx jest --no-coverage 2>&1 | tail -5
```

Expected: all tests pass (211 total).

- [ ] **Step 4: Commit**

```bash
git add mobile/src/screens/SettingsScreen.tsx
git commit -m "feat: rewrite SettingsScreen as navigation hub"
```

---

## Task 4: ProfileScreen

**Files:**
- Create: `mobile/src/screens/ProfileScreen.tsx`

- [ ] **Step 1: Create ProfileScreen**

Create `mobile/src/screens/ProfileScreen.tsx`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx tsc --noEmit 2>&1 | grep ProfileScreen
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/ProfileScreen.tsx
git commit -m "feat: add ProfileScreen (display name edit + password reset)"
```

---

## Task 5: NotificationsScreen

**Files:**
- Create: `mobile/src/screens/NotificationsScreen.tsx`

- [ ] **Step 1: Create NotificationsScreen**

Create `mobile/src/screens/NotificationsScreen.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, Switch, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../supabase/client';

export default function NotificationsScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [bankErrors, setBankErrors] = useState(true);
  const [budgetAlerts, setBudgetAlerts] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const m = user.user_metadata ?? {};
      setBankErrors(m.notif_bank_errors !== false);
      setBudgetAlerts(m.notif_budget_alerts !== false);
      setLoading(false);
    });
  }, []);

  async function toggle(key: 'notif_bank_errors' | 'notif_budget_alerts', value: boolean) {
    if (key === 'notif_bank_errors') setBankErrors(value);
    else setBudgetAlerts(value);

    const { error } = await supabase.auth.updateUser({ data: { [key]: value } });
    if (error) {
      // revert on failure
      if (key === 'notif_bank_errors') setBankErrors(!value);
      else setBudgetAlerts(!value);
      Alert.alert('Error', error.message);
    }
  }

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Notifications</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#475569" style={{ marginTop: 40 }} />
      ) : (
        <View style={s.group}>
          <View style={s.row}>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Bank connection errors</Text>
              <Text style={s.rowSub}>Notify when an account needs reconnecting</Text>
            </View>
            <Switch
              value={bankErrors}
              onValueChange={v => toggle('notif_bank_errors', v)}
              trackColor={{ true: '#6366f1' }}
            />
          </View>
          <View style={[s.row, s.rowBorder]}>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>Budget limit alerts</Text>
              <Text style={s.rowSub}>Notify when spending approaches a limit</Text>
            </View>
            <Switch
              value={budgetAlerts}
              onValueChange={v => toggle('notif_budget_alerts', v)}
              trackColor={{ true: '#6366f1' }}
            />
          </View>
        </View>
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
  group: { backgroundColor: '#1e293b', borderRadius: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#0f172a' },
  rowInfo: { flex: 1, paddingRight: 12 },
  rowLabel: { color: '#f1f5f9', fontSize: 14 },
  rowSub: { color: '#64748b', fontSize: 11, marginTop: 2 },
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx tsc --noEmit 2>&1 | grep NotificationsScreen
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/NotificationsScreen.tsx
git commit -m "feat: add NotificationsScreen (bank errors + budget alert toggles)"
```

---

## Task 6: PreferencesScreen

**Files:**
- Create: `mobile/src/screens/PreferencesScreen.tsx`

- [ ] **Step 1: Create PreferencesScreen**

Create `mobile/src/screens/PreferencesScreen.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, ActionSheetIOS,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../supabase/client';

const CURRENCIES = [
  { code: 'USD', label: 'USD — $' },
  { code: 'EUR', label: 'EUR — €' },
  { code: 'GBP', label: 'GBP — £' },
  { code: 'CAD', label: 'CAD — C$' },
];

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export default function PreferencesScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [cycleDay, setCycleDay] = useState(1);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      const m = user.user_metadata ?? {};
      setCycleDay(typeof m.budget_cycle_start_day === 'number' ? m.budget_cycle_start_day : 1);
      setCurrency(typeof m.currency === 'string' ? m.currency : 'USD');
      setLoading(false);
    });
  }, []);

  async function saveCycleDay(day: number) {
    setCycleDay(day);
    const { error } = await supabase.auth.updateUser({ data: { budget_cycle_start_day: day } });
    if (error) Alert.alert('Error', error.message);
  }

  function handleCurrencyPress() {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...CURRENCIES.map(c => c.label), 'Cancel'],
        cancelButtonIndex: CURRENCIES.length,
      },
      async (index) => {
        if (index === CURRENCIES.length) return;
        const selected = CURRENCIES[index].code;
        setCurrency(selected);
        const { error } = await supabase.auth.updateUser({ data: { currency: selected } });
        if (error) {
          setCurrency(currency);
          Alert.alert('Error', error.message);
        }
      }
    );
  }

  const currentCurrencyLabel = CURRENCIES.find(c => c.code === currency)?.label ?? currency;

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Preferences</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#475569" style={{ marginTop: 40 }} />
      ) : (
        <>
          <Text style={s.sectionLabel}>BUDGET CYCLE</Text>
          <View style={s.group}>
            <FlatList
              horizontal
              data={DAYS}
              keyExtractor={d => String(d)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.dayList}
              renderItem={({ item: day }) => (
                <TouchableOpacity
                  style={[s.dayItem, day === cycleDay && s.dayItemSelected]}
                  onPress={() => saveCycleDay(day)}
                >
                  <Text style={[s.dayText, day === cycleDay && s.dayTextSelected]}>
                    {day}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>

          <Text style={s.sectionLabel}>CURRENCY</Text>
          <View style={s.group}>
            <TouchableOpacity style={s.row} onPress={handleCurrencyPress}>
              <Text style={s.rowLabel}>{currentCurrencyLabel}</Text>
              <Text style={s.chevron}>›</Text>
            </TouchableOpacity>
          </View>
        </>
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
  sectionLabel: { fontSize: 9, color: '#475569', letterSpacing: 1.5, marginBottom: 6, marginLeft: 4 },
  group: { backgroundColor: '#1e293b', borderRadius: 8, marginBottom: 20 },
  dayList: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  dayItem: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center',
  },
  dayItemSelected: { backgroundColor: '#6366f1' },
  dayText: { color: '#94a3b8', fontSize: 13 },
  dayTextSelected: { color: '#fff', fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rowLabel: { flex: 1, color: '#f1f5f9', fontSize: 14 },
  chevron: { color: '#475569', fontSize: 18 },
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx tsc --noEmit 2>&1 | grep PreferencesScreen
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/PreferencesScreen.tsx
git commit -m "feat: add PreferencesScreen (budget cycle day + currency)"
```

---

## Task 7: AboutScreen

**Files:**
- Create: `mobile/src/screens/AboutScreen.tsx`

- [ ] **Step 1: Create AboutScreen**

Create `mobile/src/screens/AboutScreen.tsx`:

```typescript
import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { PRIVACY_POLICY_URL, TERMS_URL, SUPPORT_EMAIL } from '../constants';

export default function AboutScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const version = Constants.expoConfig?.version ?? '—';

  return (
    <ScrollView style={s.container} contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
      <View style={s.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>‹ Settings</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>About</Text>
      </View>

      <View style={s.group}>
        <View style={s.row}>
          <Text style={s.rowLabel}>App version</Text>
          <Text style={s.rowValue}>{version}</Text>
        </View>
        <LinkRow label="Privacy Policy" url={PRIVACY_POLICY_URL} />
        <LinkRow label="Terms of Service" url={TERMS_URL} />
        <LinkRow label="Send Feedback" url={`mailto:${SUPPORT_EMAIL}`} />
      </View>
    </ScrollView>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <TouchableOpacity style={[s.row, s.rowBorder]} onPress={() => Linking.openURL(url)}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backBtn: { marginRight: 12 },
  backText: { fontSize: 17, color: '#6366f1' },
  headerTitle: { flex: 1, fontSize: 17, color: '#f1f5f9', fontWeight: '600' },
  group: { backgroundColor: '#1e293b', borderRadius: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#0f172a' },
  rowLabel: { flex: 1, color: '#f1f5f9', fontSize: 14 },
  rowValue: { color: '#64748b', fontSize: 14 },
  chevron: { color: '#475569', fontSize: 18 },
});
```

- [ ] **Step 2: Verify TypeScript and run full test suite**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx tsc --noEmit 2>&1 | tail -5
```

Expected: no errors.

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx jest --no-coverage 2>&1 | tail -5
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/screens/AboutScreen.tsx
git commit -m "feat: add AboutScreen (version, privacy, terms, feedback)"
```

---

## Task 8: Final wiring check + PR

**Files:**
- Verify: `mobile/App.tsx` (all imports resolve)

- [ ] **Step 1: Full TypeScript check**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile && npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass (211+).

- [ ] **Step 3: Manual smoke test on simulator**

Launch: `npx expo run:ios`

Verify:
- Settings tab shows profile card (initial + display name + email)
- Tapping profile card pushes ProfileScreen, back button returns to Settings
- Tapping Linked Accounts pushes LinkedAccountsScreen with full Plaid UI intact
- Add Account flow still works (Plaid Link opens)
- Tapping Notifications shows two toggles; toggling persists on re-open
- Tapping Preferences shows day picker (1–28) and currency row; ActionSheet opens on currency tap
- Tapping About shows version number and all four rows; Privacy/Terms/Feedback open external URLs
- Sign Out button on hub works

- [ ] **Step 4: Create PR**

```bash
git push -u origin feature/tower-auth-flow-review
gh pr create \
  --title "feat: settings hub-and-spoke redesign" \
  --body "$(cat <<'EOF'
## Summary
- Rewrites SettingsScreen (~349 lines) as an ~80-line navigation hub with profile card
- Lifts all Plaid logic to LinkedAccountsScreen (no logic changes)
- Adds ProfileScreen (display name edit, email display, password reset via email)
- Adds NotificationsScreen (bank errors + budget alert toggles stored in user_metadata)
- Adds PreferencesScreen (budget cycle start day + currency, stored in user_metadata)
- Adds AboutScreen (version, privacy policy, ToS, feedback)
- Extracts hardcoded Supabase redirect URL to constants.ts (closes #65)

## Test plan
- [ ] Settings tab shows profile card with correct initial/name/email
- [ ] All 6 rows navigate to their sub-screens with ‹ Settings back button
- [ ] Profile: display name saves on blur; Change Password sends reset email; hidden for OAuth-only users
- [ ] Notifications: toggles update immediately and persist across app restarts
- [ ] Preferences: day picker selects and saves; currency ActionSheet updates row label
- [ ] About: version matches app.json; all three link rows open correct URLs
- [ ] Sign Out still works from hub
- [ ] All 211 existing tests pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- All `navigation.goBack()` calls use the same `useNavigation<any>()` pattern as `ReportScreen` — consistent with existing codebase
- `notif_bank_errors !== false` (not `=== true`) means the default is `true` when the key is absent from `user_metadata` — correct per spec
- `budget_cycle_start_day` is stored but not yet consumed by `useBudgets` — explicitly noted as out of scope in spec; no task claims to wire it up
- `ActionSheetIOS` is iOS-only — Android follow-on noted in spec out-of-scope section; no Android-specific task included
- `CURRENCIES` array and `DAYS` generation are module-level constants, not recreated on each render
- The `currency` variable captured in the `handleCurrencyPress` closure for revert is the value at the time the action sheet opens — correct for the revert-on-error case
