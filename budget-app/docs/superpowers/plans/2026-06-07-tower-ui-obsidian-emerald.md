# Tower UI — Obsidian Emerald Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin all 11 Tower screens to the Obsidian Emerald design — dark foundation, emerald accent, no logic changes, 211 tests pass throughout.

**Architecture:** A single shared `src/theme.ts` token file is created first. All screens import from it and replace their inline hex values with token references. The `Report` route/screen is renamed to `Spend`. PlanScreen's three-tab internal nav becomes a two-segment control (Buckets|Goals) with the income tab converted to a bottom-sheet modal. All other screens are StyleSheet-only rewrites.

**Tech Stack:** React Native, StyleSheet.create(), @react-navigation/native, react-native-svg, react-native-safe-area-context

**Branch:** `feat/obsidian-emerald-redesign`

---

## File Map

| Action | Path |
|--------|------|
| **Create** | `mobile/src/theme.ts` |
| **Modify** | `mobile/src/navigation/types.ts` |
| **Modify** | `mobile/src/navigation/FloatingTabBar.tsx` |
| **Modify** | `mobile/App.tsx` |
| **Rename + modify** | `mobile/src/screens/ReportScreen.tsx` → `SpendScreen.tsx` |
| **Modify** | `mobile/src/screens/HomeScreen.tsx` |
| **Modify** | `mobile/src/screens/PlanScreen.tsx` |
| **Modify** | `mobile/src/screens/SettingsScreen.tsx` |
| **Modify** | `mobile/src/screens/ProfileScreen.tsx` |
| **Modify** | `mobile/src/screens/NotificationsScreen.tsx` |
| **Modify** | `mobile/src/screens/PreferencesScreen.tsx` |
| **Modify** | `mobile/src/screens/AboutScreen.tsx` |
| **Modify** | `mobile/src/screens/LinkedAccountsScreen.tsx` |
| **Modify** | `mobile/src/screens/AuthScreen.tsx` |
| **Modify** | `mobile/src/components/WellnessDetailSheet.tsx` |

---

## Task 1: Theme tokens + navigation foundation

**Files:**
- Create: `mobile/src/theme.ts`
- Modify: `mobile/src/navigation/types.ts`
- Modify: `mobile/App.tsx`
- Rename + modify: `mobile/src/screens/ReportScreen.tsx` → `SpendScreen.tsx`
- Modify: `mobile/src/navigation/FloatingTabBar.tsx`

- [ ] **Step 1.1 — Create `src/theme.ts`**

```typescript
// mobile/src/theme.ts
export const C = {
  bg:       '#09090c',
  s1:       '#111116',
  s2:       '#18181f',
  b1:       '#1f1f28',
  b2:       '#2a2a36',

  w:        '#ece8f8',
  w2:       'rgba(236,232,248,0.52)',
  w3:       'rgba(236,232,248,0.28)',
  w4:       'rgba(236,232,248,0.14)',

  emerald:  '#34d399',
  emeraldBg:'rgba(52,211,153,0.10)',
  emeraldBd:'rgba(52,211,153,0.18)',

  rose:     '#f0a8a8',
  roseBg:   'rgba(240,168,168,0.08)',
  roseBd:   'rgba(240,168,168,0.18)',

  sky:      '#96cfe8',
  amber:    '#e8c87a',
} as const;

export const T = {
  balanceHero:  { fontSize: 50, fontWeight: '800' as const, letterSpacing: -3, lineHeight: 48 },
  screenTitle:  { fontSize: 21, fontWeight: '700' as const, letterSpacing: -0.7 },
  sectionLabel: { fontSize: 8.5, fontWeight: '500' as const, letterSpacing: 1.1, textTransform: 'uppercase' as const },
  body:         { fontSize: 12, fontWeight: '400' as const },
  bodyMed:      { fontSize: 12, fontWeight: '500' as const },
  caption:      { fontSize: 10, fontWeight: '400' as const },
  micro:        { fontSize: 9, fontWeight: '400' as const },
  tabular:      { fontVariant: ['tabular-nums'] as const },
} as const;
```

- [ ] **Step 1.2 — Rename ReportScreen → SpendScreen**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
git mv src/screens/ReportScreen.tsx src/screens/SpendScreen.tsx
```

- [ ] **Step 1.3 — Update `navigation/types.ts`**

Replace the entire file:

```typescript
// mobile/src/navigation/types.ts
export type RootStackParamList = {
  Tabs: undefined;
  Spend: { budgetId?: string; period?: string };
  LinkedAccounts: undefined;
  Profile: undefined;
  Notifications: undefined;
  Preferences: undefined;
  About: undefined;
};
```

- [ ] **Step 1.4 — Update `App.tsx`**

Replace the entire file:

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
import SpendScreen from './src/screens/SpendScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import LinkedAccountsScreen from './src/screens/LinkedAccountsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import PreferencesScreen from './src/screens/PreferencesScreen';
import AboutScreen from './src/screens/AboutScreen';
import AuthScreen from './src/screens/AuthScreen';
import FloatingTabBar from './src/navigation/FloatingTabBar';
import { C } from './src/theme';
import {
  registerPushToken,
  setupNotificationHandler,
  setupAppStateSync,
  syncStaleItems,
} from './src/plaid/backgroundSync';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={props => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Plan" component={PlanScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="Spend" component={SpendScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="LinkedAccounts" component={LinkedAccountsScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="Preferences" component={PreferencesScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ animation: 'slide_from_right', gestureEnabled: true }} />
    </Stack.Navigator>
  );
}

function AppContent() {
  const { session, loading } = useAuth();

  React.useEffect(() => {
    if (!session) return;
    registerPushToken(session.user.id);
    syncStaleItems();
    const notifSub = setupNotificationHandler();
    const appStateSub = setupAppStateSync();
    return () => {
      notifSub.remove();
      appStateSub.remove();
    };
  }, [session]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.emerald} />
      </View>
    );
  }

  if (!session) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <AuthScreen />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
```

- [ ] **Step 1.5 — Update SpendScreen.tsx: fix route name in title + navigate calls**

Open `src/screens/SpendScreen.tsx`. Find and replace:
- `{focusedBudget ? focusedBudget.name : 'Report'}` → `{focusedBudget ? focusedBudget.name : 'Spend'}`

Then update the StyleSheet — replace the entire `StyleSheet.create({...})` block at the bottom with:

```typescript
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14,
  },
  title: { ...T.screenTitle, color: C.w },
  periodNav: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  periodLabel: { fontSize: 11, color: C.w3 },
  periodArrow: { fontSize: 16, color: C.w4, paddingHorizontal: 2 },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14 },
  heroCell: {},
  heroLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 3 },
  heroValue: { fontSize: 20, fontWeight: '700', color: C.w, letterSpacing: -0.8, ...T.tabular },
  heroValuePos: { fontSize: 20, fontWeight: '700', color: C.emerald, letterSpacing: -0.8, ...T.tabular },
  rule: { height: 1, backgroundColor: C.b1 },
  sankey: {
    margin: 20, marginBottom: 12, padding: 12,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 10,
  },
  sankeyLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 10 },
  secStrip: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  catItem: { paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.b1 },
  catTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  catName: { fontSize: 11, color: C.w2 },
  catNums: { fontSize: 10, color: C.w3, ...T.tabular },
  catNumsWarn: { fontSize: 10, color: C.rose, ...T.tabular },
  catTrack: { height: 1.5, backgroundColor: C.b2, borderRadius: 1, overflow: 'hidden' },
  adjustBtn: {
    margin: 20, padding: 12, borderRadius: 10,
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1,
    alignItems: 'center',
  },
  adjustBtnText: { fontSize: 13, fontWeight: '600', color: C.w2 },
});
```

Also add `import { C, T } from '../theme';` to the top imports of SpendScreen.tsx.

> **Self-review fix:** `SpendScreen` is a stack screen, not a tab — it has no FloatingTabBar icon. The `SpendIcon` component defined in FloatingTabBar.tsx (Task 1.7) is intentionally omitted from the `ICONS` map. Remove `SpendIcon` from FloatingTabBar.tsx entirely to avoid unused-variable lint errors.

- [ ] **Step 1.6 — Update SpendScreen.tsx: fix navigate call**

Find `navigation.navigate('Report',` → replace with `navigation.navigate('Spend',`

Find any `navigate('Report'` references → replace with `navigate('Spend'`

- [ ] **Step 1.7 — Update FloatingTabBar.tsx**

Replace entire file:

```typescript
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Polyline, Circle, Rect } from 'react-native-svg';
import { C } from '../theme';

const ICON_SIZE = 20;
const STROKE = { stroke: C.w, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function HomeIcon({ active }: { active: boolean }) {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" opacity={active ? 0.9 : 0.22}>
      <Path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" {...STROKE} />
      <Polyline points="9 21 9 12 15 12 15 21" {...STROKE} />
    </Svg>
  );
}

function PlanIcon({ active }: { active: boolean }) {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" opacity={active ? 0.9 : 0.22}>
      <Rect x="3" y="3" width="18" height="18" rx="2" {...STROKE} />
      <Path d="M9 9h6M9 12h6M9 15h4" {...STROKE} />
    </Svg>
  );
}

function SpendIcon({ active }: { active: boolean }) {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" opacity={active ? 0.9 : 0.22}>
      <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" {...STROKE} />
    </Svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none" opacity={active ? 0.9 : 0.22}>
      <Circle cx="12" cy="12" r="3" {...STROKE} />
      <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" {...STROKE} />
    </Svg>
  );
}

const ICONS: Record<string, (active: boolean) => React.ReactElement> = {
  Home:     (a) => <HomeIcon active={a} />,
  Plan:     (a) => <PlanIcon active={a} />,
  Settings: (a) => <SettingsIcon active={a} />,
};
// Spend is pushed as a stack screen, not a tab — no icon needed for it here.

const LABELS: Record<string, string> = {
  Home: 'Home', Plan: 'Plan', Settings: 'Settings',
};

export default function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[s.wrapper, { paddingBottom: Math.max(bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        const renderIcon = ICONS[route.name];
        if (!renderIcon) return null;
        return (
          <TouchableOpacity
            key={route.key}
            style={s.tab}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
          >
            {renderIcon(isFocused)}
            <Text style={[s.label, isFocused && s.labelActive]}>
              {LABELS[route.name] ?? route.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    backgroundColor: 'rgba(9,9,12,0.98)',
    borderTopWidth: 1,
    borderTopColor: C.b1,
    flexDirection: 'row',
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase', color: C.w4 },
  labelActive: { color: C.w3 },
});
```

- [ ] **Step 1.8 — Update HomeScreen.tsx and PlanScreen.tsx navigate calls**

In `HomeScreen.tsx` line ~212:
```typescript
navigation.navigate('Report', { budgetId, period });
```
→
```typescript
navigation.navigate('Spend', { budgetId, period });
```

In `PlanScreen.tsx` line ~1290:
```typescript
navigation.navigate('Report', { budgetId: lastSavedBudgetId, period: 'month' });
```
→
```typescript
navigation.navigate('Spend', { budgetId: lastSavedBudgetId, period: 'month' });
```

- [ ] **Step 1.9 — Run tests**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -8
```

Expected: `Tests: 211 passed, 211 total`

- [ ] **Step 1.10 — Commit**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app
git add mobile/src/theme.ts mobile/src/navigation/types.ts mobile/src/navigation/FloatingTabBar.tsx mobile/App.tsx "mobile/src/screens/SpendScreen.tsx" mobile/src/screens/HomeScreen.tsx mobile/src/screens/PlanScreen.tsx
git commit -m "feat: add theme tokens, rename Report→Spend, replace tab icons with SVG"
```

---

## Task 2: HomeScreen reskin

**Files:**
- Modify: `mobile/src/screens/HomeScreen.tsx`

The HomeScreen currently uses a horizontal FlatList carousel for budget tiles. Replace the carousel with a flat bucket list and bank-statement transaction rows. **Do not touch any hook calls, modal logic, or navigation logic.**

- [ ] **Step 2.1 — Add theme import**

At the top of `HomeScreen.tsx`, after the existing imports add:
```typescript
import { C, T } from '../theme';
```

- [ ] **Step 2.2 — Remove `Sparkline` SVG component and `ScoreTile` component**

Delete the `Sparkline` function component (lines ~28–46) and the `ScoreTile` function component. These will be replaced inline in the main render.

- [ ] **Step 2.3 — Replace the main `HomeScreen` return JSX**

Keep all hook calls, `useFocusEffect`, `useNavigation`, `goToReport`, `goToIncome` and all other logic above the `return` statement unchanged.

Replace only the `return (...)` JSX with:

```tsx
const wellnessHistory = scoreHistory ?? [];
const balanceDollars = Math.floor(Math.abs(totalBalance));
const balanceCents = Math.abs(totalBalance - Math.floor(totalBalance)).toFixed(2).slice(1);
const isNegative = totalBalance < 0;

return (
  <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 100 }}>
    {/* ── Hero ── */}
    <View style={[s.hero, { paddingTop: top + 6 }]}>
      <Text style={s.wordmark}>Tower</Text>
      <Text style={s.balance}>
        {isNegative ? '−' : ''}<Text style={s.balCurrency}>$</Text>
        {balanceDollars.toLocaleString()}
        <Text style={s.balCents}>.{balanceCents.slice(1)}</Text>
      </Text>
      <Text style={s.balMeta}>
        {monthLabel} · {daysLeft} days left
      </Text>
    </View>

    <View style={s.rule} />

    {/* ── Wellness ── */}
    <TouchableOpacity
      style={s.wellBlock}
      onPress={() => setWellnessSheetVisible(true)}
      activeOpacity={0.7}
    >
      <Text style={[s.micro, { marginBottom: 10 }]}>Wellness</Text>
      <View style={s.wellInner}>
        <View>
          <Text style={s.wellScore}>
            {wellnessScore}<Text style={s.wellDenom}> /100</Text>
          </Text>
          <Text style={s.wellSub}>
            {wellnessDelta >= 0 ? `Good · up ${wellnessDelta} pts` : `Needs work · down ${Math.abs(wellnessDelta)} pts`}
          </Text>
        </View>
        <View style={s.sparkWrap}>
          {wellnessHistory.slice(-7).map((val, i, arr) => {
            const max = Math.max(...arr, 1);
            const h = Math.max(4, Math.round((val / max) * 20));
            const isLast = i === arr.length - 1;
            return (
              <View
                key={i}
                style={[s.sparkBar, { height: h, opacity: isLast ? 0.85 : 0.45 },
                  i === arr.length - 1 && s.sparkBarNow]}
              />
            );
          })}
        </View>
      </View>
    </TouchableOpacity>

    <View style={s.rule} />

    {/* ── Buckets ── */}
    <View style={s.secStrip}>
      <Text style={s.micro}>Buckets</Text>
      <TouchableOpacity onPress={() => navigation.navigate('Tabs', { screen: 'Plan' })}>
        <Text style={s.secAction}>Plan →</Text>
      </TouchableOpacity>
    </View>

    {budgets.slice(0, 5).map((b, i) => {
      const isOver = b.spent > (b.targetAmount ?? Infinity);
      return (
        <TouchableOpacity
          key={b.id}
          style={[s.bktRow, isOver && s.bktRowWarn]}
          onPress={() => goToReport(b.id)}
          activeOpacity={0.7}
        >
          <Text style={s.bktRank}>0{i + 1}</Text>
          <Text style={[s.bktName, isOver && s.bktNameWarn]}>{b.name}</Text>
          <Text style={[s.bktSpent, isOver && s.bktNameWarn]}>
            {fmt(b.spent)}
          </Text>
          <Text style={s.bktOf}> / {fmt(b.targetAmount ?? 0)}</Text>
        </TouchableOpacity>
      );
    })}

    <View style={[s.rule, { marginTop: 4 }]} />

    {/* ── Recent transactions ── */}
    <View style={s.secStrip}>
      <Text style={s.micro}>Recent</Text>
      <TouchableOpacity onPress={() => setShowAllTxns(true)}>
        <Text style={s.secAction}>All →</Text>
      </TouchableOpacity>
    </View>

    {displayedTxns.map(txn => (
      <TouchableOpacity
        key={txn.id}
        style={s.txnRow}
        onPress={() => { setSelectedTxn(txn); setTxnModalVisible(true); }}
        activeOpacity={0.7}
      >
        <View style={s.txnDateWrap}>
          <Text style={s.txnDateMon}>{txnMonth(txn.date)}</Text>
          <Text style={s.txnDateDay}>{txnDay(txn.date)}</Text>
        </View>
        <View style={s.txnInfo}>
          <Text style={s.txnMerchant} numberOfLines={1}>{txn.merchantName ?? txn.name}</Text>
          <Text style={s.txnCat}>{txn.categoryL1}</Text>
        </View>
        <Text style={[s.txnAmt, txn.amount < 0 && s.txnAmtPos]}>
          {txn.amount < 0 ? '+' : '−'}{fmt(Math.abs(txn.amount))}
        </Text>
      </TouchableOpacity>
    ))}

    {/* Keep all existing modals unchanged below */}
    <WellnessDetailSheet
      visible={wellnessSheetVisible}
      onClose={() => setWellnessSheetVisible(false)}
      score={wellnessScore}
      history={wellnessHistory}
      delta={wellnessDelta}
      factors={wellnessFactors}
      transactions={transactions}
    />
    {/* TransactionDetailModal — keep exactly as-is */}
    {txnModalVisible && selectedTxn && (
      // ... existing modal JSX unchanged ...
    )}
  </ScrollView>
);
```

> **Note to implementer:** Keep all existing state variables (`showAllTxns`, `txnModalVisible`, `selectedTxn`, `wellnessSheetVisible`). Keep the existing `TransactionDetailModal` JSX block exactly as-is — only wrap it inside the new ScrollView. The helper functions `txnMonth` and `txnDay` need to be added:
```typescript
function txnMonth(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-US', { month: 'short' });
}
function txnDay(dateStr: string) {
  return new Date(dateStr).getDate().toString().padStart(2, '0');
}
```
Add these just before the `HomeScreen` function declaration.

- [ ] **Step 2.4 — Replace StyleSheet at the bottom of HomeScreen.tsx**

Delete the existing `const t = StyleSheet.create({...})` and `const s = StyleSheet.create({...})` blocks. Replace with:

```typescript
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  hero: { paddingHorizontal: 20, paddingBottom: 20 },
  wordmark: { fontSize: 11, fontWeight: '700', letterSpacing: 1.98, textTransform: 'uppercase', color: C.w4, marginBottom: 18 },
  balance: { fontSize: 50, fontWeight: '800', letterSpacing: -3, color: C.w, lineHeight: 48, fontVariant: ['tabular-nums'] },
  balCurrency: { fontSize: 22, fontWeight: '400', color: C.w3, letterSpacing: -1 },
  balCents: { fontSize: 22, fontWeight: '300', color: C.w3, letterSpacing: -1 },
  balMeta: { marginTop: 8, fontSize: 11, color: C.w3 },

  rule: { height: 1, backgroundColor: C.b1 },

  wellBlock: { paddingHorizontal: 20, paddingVertical: 14 },
  wellInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wellScore: { fontSize: 32, fontWeight: '700', color: C.emerald, letterSpacing: -1.5, lineHeight: 32, fontVariant: ['tabular-nums'] },
  wellDenom: { fontSize: 14, fontWeight: '300', color: C.w4 },
  wellSub: { fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: C.w4, marginTop: 3 },
  sparkWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  sparkBar: { width: 5, borderRadius: 2, backgroundColor: C.emerald },
  sparkBarNow: { opacity: 0.85 },

  secStrip: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  micro: { ...T.sectionLabel, color: C.w4 },
  secAction: { fontSize: 10, color: C.w4 },

  bktRow: { paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'baseline', borderBottomWidth: 1, borderBottomColor: 'rgba(31,31,40,0.7)' },
  bktRowWarn: { backgroundColor: C.roseBg },
  bktRank: { fontSize: 9, color: C.w4, fontVariant: ['tabular-nums'], width: 16, marginRight: 8 },
  bktName: { fontSize: 12, color: C.w2, flex: 1 },
  bktNameWarn: { color: C.rose },
  bktSpent: { fontSize: 12, fontWeight: '600', color: C.w2, fontVariant: ['tabular-nums'], marginRight: 3 },
  bktOf: { fontSize: 11, color: C.w4, fontVariant: ['tabular-nums'] },

  txnRow: { paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(31,31,40,0.5)' },
  txnDateWrap: { width: 28, alignItems: 'center' },
  txnDateMon: { fontSize: 8, color: C.w4, letterSpacing: 0.3, textTransform: 'uppercase' },
  txnDateDay: { fontSize: 10, color: C.w4, fontVariant: ['tabular-nums'] },
  txnInfo: { flex: 1, minWidth: 0 },
  txnMerchant: { fontSize: 11, color: C.w2, fontWeight: '500' },
  txnCat: { fontSize: 9, color: C.w4, marginTop: 1 },
  txnAmt: { fontSize: 12, fontWeight: '600', color: C.w2, fontVariant: ['tabular-nums'] },
  txnAmtPos: { color: C.emerald },
});
```

- [ ] **Step 2.5 — Run tests**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -8
```

Expected: `Tests: 211 passed, 211 total`

- [ ] **Step 2.6 — Commit**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app
git add mobile/src/screens/HomeScreen.tsx
git commit -m "feat: HomeScreen — Obsidian Emerald reskin, balance hero, sparkline, bank-statement txns"
```

---

## Task 3: PlanScreen restructure

**Files:**
- Modify: `mobile/src/screens/PlanScreen.tsx`

PlanScreen currently has three tabs: `buckets | goals | income`. Replace with two segments (`buckets | goals`) and an income bottom-sheet modal triggered by a tappable income strip. The deep-link `planningTab: 'income'` must open the modal instead.

**Do not change:** any CRUD functions, `useBudgets`, `useGoals`, `useIncome`, `useFixedItems`, `AddBudgetModal`, `AddGoalModal`, `AddIncomeModal`, `BucketDetailModal`, gesture handlers, `PercentSlider`.

- [ ] **Step 3.1 — Add theme import**

Add at top of PlanScreen.tsx imports:
```typescript
import { C, T } from '../theme';
```

- [ ] **Step 3.2 — Expose `sources` in main PlanScreen scope**

Find the `useIncome` destructure in the main `PlanScreen` component (around line 1262):
```typescript
const { confirmedMonthlyIncome, reload: reloadIncome } = useIncome();
```
Replace with:
```typescript
const { sources, confirmedMonthlyIncome, reload: reloadIncome } = useIncome();
```

- [ ] **Step 3.3 — Change PlanningTab type and add modal state**

Find (line ~1254):
```typescript
type PlanningTab = 'buckets' | 'goals' | 'income';
```
Replace with:
```typescript
type PlanningTab = 'buckets' | 'goals';
```

Find the state declarations block in `PlanScreen` (around line 1264). Add one new state variable after `setPlanningTab`:
```typescript
const [incomeModalVisible, setIncomeModalVisible] = useState(false);
```

- [ ] **Step 3.3 — Update deep-link useEffect to open modal for income param**

Find the `useEffect` that reads `route.params?.planningTab` (around line 1271):
```typescript
if (route.params?.planningTab) setPlanningTab(route.params.planningTab);
```
Replace with:
```typescript
if (route.params?.planningTab === 'income') {
  setIncomeModalVisible(true);
} else if (route.params?.planningTab) {
  setPlanningTab(route.params.planningTab as PlanningTab);
}
```

- [ ] **Step 3.4 — Replace the tab-bar render + income tab render section**

Find the segment control render (around line 1303):
```tsx
{(['buckets', 'goals', 'income'] as PlanningTab[]).map(tab => (
  ...
))}
```
And the three conditional renders:
```tsx
{planningTab === 'income' && (<IncomeTab ... />)}
{planningTab === 'buckets' && (...)}
{planningTab === 'goals' && (...)}
```

Replace the entire section (from the segment bar through all three conditionals) with:

```tsx
{/* Income strip — tappable, opens modal */}
<TouchableOpacity
  style={s.incomeStrip}
  onPress={() => setIncomeModalVisible(true)}
  activeOpacity={0.8}
>
  <View>
    <Text style={s.incomeStripLabel}>Monthly Income</Text>
    <Text style={s.incomeStripVal}>{fmt(confirmedMonthlyIncome)}</Text>
    <Text style={s.incomeStripSrcs}>
      {sources.filter(src => src.isConfirmed).map(src => src.name).join(' · ') || 'No sources confirmed'}
    </Text>
  </View>
  <Text style={s.incomeStripManage}>Manage ›</Text>
</TouchableOpacity>

{/* Buckets | Goals segment */}
<View style={s.segBar}>
  {(['buckets', 'goals'] as PlanningTab[]).map(tab => (
    <TouchableOpacity
      key={tab}
      style={[s.segBtn, planningTab === tab && s.segBtnActive]}
      onPress={() => setPlanningTab(tab)}
    >
      <Text style={[s.segText, planningTab === tab && s.segTextActive]}>
        {tab.charAt(0).toUpperCase() + tab.slice(1)}
      </Text>
    </TouchableOpacity>
  ))}
</View>

{planningTab === 'buckets' && (
  /* Keep existing buckets render exactly as-is */
  ...existing buckets JSX...
)}
{planningTab === 'goals' && (
  /* Keep existing goals render exactly as-is */
  ...existing goals JSX...
)}

{/* Income Modal */}
<Modal
  visible={incomeModalVisible}
  animationType="slide"
  presentationStyle="pageSheet"
  onRequestClose={() => setIncomeModalVisible(false)}
>
  <View style={s.incomeModalWrap}>
    <View style={s.incomeModalDrag} />
    <Text style={s.incomeModalTitle}>Income Sources</Text>
    <View style={s.incomeModalRule} />
    <IncomeTab onReload={() => { handleReload(); }} />
    <TouchableOpacity
      style={s.incomeModalDone}
      onPress={() => setIncomeModalVisible(false)}
    >
      <Text style={s.incomeModalDoneText}>Done</Text>
    </TouchableOpacity>
  </View>
</Modal>
```

> **Note:** Preserve the existing `buckets` and `goals` JSX content exactly. Only the wrapping/structural code changes.

- [ ] **Step 3.5 — Update StyleSheet at bottom of PlanScreen.tsx**

Add these new style entries to the existing `StyleSheet.create({})` block (do not delete existing styles that are still used by modals, sliders, etc.):

```typescript
// Add to existing StyleSheet.create block:
incomeStrip: {
  paddingHorizontal: 20, paddingVertical: 11,
  backgroundColor: C.emeraldBg,
  borderTopWidth: 1, borderTopColor: C.emeraldBd,
  borderBottomWidth: 1, borderBottomColor: C.emeraldBd,
  flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
},
incomeStripLabel: { fontSize: 8.5, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(52,211,153,0.4)', marginBottom: 3 },
incomeStripVal: { fontSize: 20, fontWeight: '700', color: C.emerald, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
incomeStripSrcs: { fontSize: 10, color: 'rgba(52,211,153,0.35)', marginTop: 3 },
incomeStripManage: { fontSize: 9, color: 'rgba(52,211,153,0.3)' },

segBar: { flexDirection: 'row', margin: 12, marginBottom: 2, backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 8, padding: 3, gap: 2 },
segBtn: { flex: 1, paddingVertical: 6, borderRadius: 6, alignItems: 'center' },
segBtnActive: { backgroundColor: C.s2 },
segText: { fontSize: 11, fontWeight: '500', color: C.w3 },
segTextActive: { color: C.w },

incomeModalWrap: { flex: 1, backgroundColor: C.bg, paddingTop: 8 },
incomeModalDrag: { width: 36, height: 4, backgroundColor: C.b2, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
incomeModalTitle: { fontSize: 15, fontWeight: '700', color: C.w, letterSpacing: -0.3, paddingHorizontal: 20, paddingBottom: 14 },
incomeModalRule: { height: 1, backgroundColor: C.b1 },
incomeModalDone: { padding: 16, borderTopWidth: 1, borderTopColor: C.b1, alignItems: 'center' },
incomeModalDoneText: { fontSize: 12, color: C.w4 },
```

Also update the existing segment-related styles that reference the old indigo colors:
```typescript
// Replace old segBtn/segText styles (they'll conflict with new ones above):
// Find: segBtn, segBtnActive, segText, segTextActive in old StyleSheet and remove them
// (The new versions added above take over)
```

- [ ] **Step 3.6 — Run tests**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -8
```

Expected: `Tests: 211 passed, 211 total`

- [ ] **Step 3.7 — Commit**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app
git add mobile/src/screens/PlanScreen.tsx
git commit -m "feat: PlanScreen — income strip modal, Buckets|Goals segment, Obsidian Emerald reskin"
```

---

## Task 4: SpendScreen (formerly ReportScreen) — full reskin

**Files:**
- Modify: `mobile/src/screens/SpendScreen.tsx`

Task 1 already renamed the file and fixed the route name. This task applies the visual reskin.

- [ ] **Step 4.1 — Add theme import**

```typescript
import { C, T } from '../theme';
```

- [ ] **Step 4.2 — Replace StyleSheet**

Replace the entire `StyleSheet.create({})` block with the one defined in Task 1.5. Also update any inline style references to use `C.*` tokens instead of hardcoded hex values throughout the JSX.

Key replacements in JSX:
- `backgroundColor: '#0f172a'` → `backgroundColor: C.bg`
- `color: '#f1f5f9'` → `color: C.w`
- `color: '#64748b'` → `color: C.w3`
- `color: '#6366f1'` → `color: C.emerald`
- `color: '#ef4444'` → `color: C.rose`
- `borderColor: '#1e293b'` → `borderColor: C.b1`
- `backgroundColor: '#1e293b'` → `backgroundColor: C.s1`

- [ ] **Step 4.3 — Update Sankey SVG stroke colors**

In the Sankey SVG render, replace stroke colors:
- Income node fill: `rgba(52,211,153,0.4)` (emerald)
- Main flows: `rgba(236,232,248,0.08)` (dim white)
- Over-budget flow: `rgba(240,168,168,0.18)` (rose)
- Smaller flows: `rgba(236,232,248,0.04)`

- [ ] **Step 4.4 — Update category bar tints**

For each category bar fill, use the per-category pastel based on index:
```typescript
const CAT_TINTS = [
  'rgba(52,211,153,0.5)',   // emerald
  'rgba(150,207,232,0.5)',  // sky
  'rgba(240,168,168,0.5)',  // rose
  'rgba(52,211,153,0.4)',   // emerald lighter
  'rgba(232,200,122,0.5)',  // amber
];
// usage: backgroundColor: CAT_TINTS[index % CAT_TINTS.length]
```

- [ ] **Step 4.5 — Run tests + commit**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -8
```
Expected: `Tests: 211 passed, 211 total`

```bash
cd /Users/manicmonk/Downloads/Code/budget-app
git add mobile/src/screens/SpendScreen.tsx
git commit -m "feat: SpendScreen — Obsidian Emerald reskin, emerald Sankey, per-category tints"
```

---

## Task 5: SettingsScreen hub

**Files:**
- Modify: `mobile/src/screens/SettingsScreen.tsx`

- [ ] **Step 5.1 — Add theme import**

```typescript
import { C, T } from '../theme';
```

- [ ] **Step 5.2 — Replace entire file**

```typescript
import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { C, T } from '../theme';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { top } = useSafeAreaInsets();
  const { signOut, user } = useAuth();

  const displayName = user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? '—';
  const email = user?.email ?? '—';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingTop: top + 8, paddingBottom: 60 }}>
      <Text style={s.title}>Settings</Text>

      {/* Profile strip */}
      <TouchableOpacity style={s.profileStrip} onPress={() => navigation.navigate('Profile')} activeOpacity={0.7}>
        <View style={s.monogram}><Text style={s.monogramText}>{initials}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.profName}>{displayName}</Text>
          <Text style={s.profEmail}>{email}</Text>
        </View>
        <Text style={s.chevron}>›</Text>
      </TouchableOpacity>

      {/* Accounts group */}
      <View style={s.group}>
        <Text style={s.groupLabel}>Accounts</Text>
        <View style={s.groupCard}>
          <TouchableOpacity style={s.row} onPress={() => navigation.navigate('LinkedAccounts')} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Linked Accounts</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowLast]} onPress={() => navigation.navigate('Plan', { planningTab: 'income' })} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Income Sources</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Preferences group */}
      <View style={s.group}>
        <Text style={s.groupLabel}>Preferences</Text>
        <View style={s.groupCard}>
          <TouchableOpacity style={s.row} onPress={() => navigation.navigate('Notifications')} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Notifications</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowLast]} onPress={() => navigation.navigate('Preferences')} activeOpacity={0.7}>
            <Text style={s.rowLabel}>Preferences</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* About group */}
      <View style={s.group}>
        <Text style={s.groupLabel}>About</Text>
        <View style={s.groupCard}>
          <TouchableOpacity style={[s.row, s.rowLast]} onPress={() => navigation.navigate('About')} activeOpacity={0.7}>
            <Text style={s.rowLabel}>About Tower</Text>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={s.signOut} onPress={signOut} activeOpacity={0.7}>
        <Text style={s.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  title: { ...T.screenTitle, color: C.w, paddingHorizontal: 20, paddingBottom: 14 },

  profileStrip: {
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.b1,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  monogram: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.s2, borderWidth: 1, borderColor: C.b2,
    alignItems: 'center', justifyContent: 'center',
  },
  monogramText: { fontSize: 14, fontWeight: '700', color: C.emerald },
  profName: { fontSize: 13, fontWeight: '600', color: C.w },
  profEmail: { fontSize: 10, color: C.w4, marginTop: 1 },

  group: { marginTop: 16, marginHorizontal: 20 },
  groupLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 6, paddingHorizontal: 2 },
  groupCard: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden' },
  row: {
    paddingHorizontal: 14, paddingVertical: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: C.b1,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: C.w2 },
  chevron: { fontSize: 14, color: C.w4 },

  signOut: { marginTop: 20, paddingVertical: 10, alignItems: 'center' },
  signOutText: { fontSize: 12, fontWeight: '500', color: C.rose, opacity: 0.65 },
});
```

- [ ] **Step 5.3 — Run tests + commit**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -8
```
Expected: `Tests: 211 passed, 211 total`

```bash
cd /Users/manicmonk/Downloads/Code/budget-app
git add mobile/src/screens/SettingsScreen.tsx
git commit -m "feat: SettingsScreen — Obsidian Emerald hub, monogram avatar, Income Sources row"
```

---

## Task 6: Settings subpages — Profile, Notifications, Preferences, About

**Files:**
- Modify: `mobile/src/screens/ProfileScreen.tsx`
- Modify: `mobile/src/screens/NotificationsScreen.tsx`
- Modify: `mobile/src/screens/PreferencesScreen.tsx`
- Modify: `mobile/src/screens/AboutScreen.tsx`

All four share the same structural pattern: back nav (‹ Settings) + screen title + content groups. Replace only StyleSheets and back-link color. Keep all logic.

- [ ] **Step 6.1 — Add theme import to all four files**

Add to each:
```typescript
import { C, T } from '../theme';
```

- [ ] **Step 6.2 — ProfileScreen StyleSheet**

Replace the `StyleSheet.create({})` block with:
```typescript
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
```

- [ ] **Step 6.3 — NotificationsScreen: replace Switch with custom toggle pill**

Replace the `Switch` component usage with a custom `TogglePill`:

Add this component above the `NotificationsScreen` function:
```typescript
function TogglePill({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <TouchableOpacity
      style={[tp.pill, value ? tp.on : tp.off]}
      onPress={() => onChange(!value)}
      activeOpacity={0.8}
    >
      <View style={tp.knob} />
    </TouchableOpacity>
  );
}
const tp = StyleSheet.create({
  pill: { width: 36, height: 20, borderRadius: 10, padding: 2, justifyContent: 'center' },
  on: { backgroundColor: C.emerald, alignItems: 'flex-end' },
  off: { backgroundColor: C.b2, alignItems: 'flex-start' },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: C.bg },
});
```

In the JSX, replace each `<Switch ... />` with:
```tsx
<TogglePill value={bankErrors} onChange={v => toggle('notif_bank_errors', v)} />
// and
<TogglePill value={budgetAlerts} onChange={v => toggle('notif_budget_alerts', v)} />
```

Remove `Switch` from the React Native import line.

NotificationsScreen StyleSheet:
```typescript
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.w, letterSpacing: -0.4 },
  group: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden', marginHorizontal: 20, marginTop: 8 },
  toggleRow: { paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.b1 },
  toggleRowLast: { borderBottomWidth: 0 },
  toggleLeft: { flex: 1, paddingRight: 12 },
  rowLabel: { fontSize: 12, color: C.w2 },
  rowSub: { fontSize: 9, color: C.w4, marginTop: 2, lineHeight: 14 },
});
```

- [ ] **Step 6.4 — PreferencesScreen StyleSheet**

```typescript
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.w, letterSpacing: -0.4 },
  content: { paddingBottom: 60 },
  sectionWrap: { paddingHorizontal: 20, marginTop: 16 },
  sectionLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 8 },
  dayList: { paddingVertical: 2 },
  dayItem: {
    width: 32, height: 32, borderRadius: 8, marginRight: 6,
    backgroundColor: C.b1, alignItems: 'center', justifyContent: 'center',
  },
  dayItemSelected: { backgroundColor: C.emerald, opacity: 0.85 },
  dayText: { fontSize: 11, color: C.w3 },
  dayTextSelected: { color: C.bg, fontWeight: '700' },
  group: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden', marginHorizontal: 20, marginTop: 16 },
  row: { paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 12, color: C.w2 },
  rowValue: { fontSize: 12, color: C.w3 },
  saving: { opacity: 0.5 },
});
```

- [ ] **Step 6.5 — AboutScreen StyleSheet**

```typescript
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.w, letterSpacing: -0.4 },
  group: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden', marginHorizontal: 20, marginTop: 16 },
  row: { paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.b1 },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 12, color: C.w2 },
  rowValue: { fontSize: 12, color: C.w3 },
  chevron: { fontSize: 14, color: C.w4 },
});
```

- [ ] **Step 6.6 — Run tests + commit**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -8
```
Expected: `Tests: 211 passed, 211 total`

```bash
cd /Users/manicmonk/Downloads/Code/budget-app
git add mobile/src/screens/ProfileScreen.tsx mobile/src/screens/NotificationsScreen.tsx mobile/src/screens/PreferencesScreen.tsx mobile/src/screens/AboutScreen.tsx
git commit -m "feat: settings subpages — Obsidian Emerald reskin, custom toggle pill"
```

---

## Task 7: LinkedAccountsScreen

**Files:**
- Modify: `mobile/src/screens/LinkedAccountsScreen.tsx`

Keep all Plaid logic, `usePlaidItems`, `useAccounts`, reconnect/unlink flows unchanged. Reskin only.

- [ ] **Step 7.1 — Add theme import**

```typescript
import { C, T } from '../theme';
```

- [ ] **Step 7.2 — Replace StyleSheet**

```typescript
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  backText: { fontSize: 13, color: C.w3 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.w, letterSpacing: -0.4 },
  content: { paddingBottom: 60 },

  instCard: { marginHorizontal: 14, marginBottom: 10, backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 12, overflow: 'hidden' },
  instHead: { paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.b1 },
  instName: { fontSize: 12, fontWeight: '600', color: C.w },
  instErr: { fontSize: 9, color: C.rose, letterSpacing: 0.4 },
  acctRow: { paddingHorizontal: 13, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(31,31,40,0.4)' },
  acctRowLast: { borderBottomWidth: 0 },
  acctName: { fontSize: 10, color: C.w2 },
  acctType: { fontSize: 8.5, color: C.w4, marginTop: 1 },
  acctMask: { fontSize: 10, color: C.w4, fontVariant: ['tabular-nums'] },

  reconnectBtn: {
    margin: 10, padding: 8, backgroundColor: C.roseBg,
    borderWidth: 1, borderColor: C.roseBd, borderRadius: 8,
    alignItems: 'center',
  },
  reconnectText: { fontSize: 11, color: C.rose },

  addBtn: {
    marginHorizontal: 14, marginTop: 4, padding: 11,
    borderWidth: 1, borderStyle: 'dashed', borderColor: C.b2,
    borderRadius: 10, alignItems: 'center',
  },
  addBtnText: { fontSize: 11, color: C.w4 },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  unlinkText: { fontSize: 12, color: C.rose },
});
```

- [ ] **Step 7.3 — Run tests + commit**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -8
```
Expected: `Tests: 211 passed, 211 total`

```bash
cd /Users/manicmonk/Downloads/Code/budget-app
git add mobile/src/screens/LinkedAccountsScreen.tsx
git commit -m "feat: LinkedAccountsScreen — Obsidian Emerald reskin, rose error states"
```

---

## Task 8: AuthScreen reskin

**Files:**
- Modify: `mobile/src/screens/AuthScreen.tsx`

Keep all auth logic (`signInWithEmail`, `signUpWithEmail`, `signInWithApple`, `signInWithGoogle`, password scoring, validation) unchanged.

- [ ] **Step 8.1 — Add theme import**

```typescript
import { C, T } from '../theme';
```

- [ ] **Step 8.2 — Replace StyleSheet**

```typescript
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  inner: { flex: 1, paddingHorizontal: 20, paddingBottom: 40 },

  wordmark: { fontSize: 11, fontWeight: '700', letterSpacing: 1.98, textTransform: 'uppercase', color: C.w4, marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '700', color: C.w, letterSpacing: -0.8, marginBottom: 4 },
  subtitle: { fontSize: 11, color: C.w4, marginBottom: 22 },

  inputWrap: { backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10, marginBottom: 10 },
  inputLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 3 },
  input: { fontSize: 13, color: C.w, padding: 0 },

  strengthRow: { flexDirection: 'row', gap: 4, marginTop: 8 },
  strengthSeg: { flex: 1, height: 2, borderRadius: 1, backgroundColor: C.b2 },
  strengthSegLit: { backgroundColor: C.emerald, opacity: 0.7 },

  primaryBtn: { backgroundColor: C.w, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  primaryBtnText: { fontSize: 13, fontWeight: '700', color: C.bg, letterSpacing: 0.1 },
  primaryBtnDisabled: { opacity: 0.35 },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.b1 },
  dividerText: { fontSize: 9, color: C.w4 },

  socialBtn: {
    backgroundColor: C.s1, borderWidth: 1, borderColor: C.b1, borderRadius: 10,
    paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8,
  },
  socialBtnText: { fontSize: 12, color: C.w2, fontWeight: '500' },

  switchRow: { marginTop: 16, alignItems: 'center' },
  switchText: { fontSize: 11, color: C.w4 },
  switchLink: { color: C.emerald, opacity: 0.85 },

  error: { fontSize: 12, color: C.rose, marginBottom: 10, textAlign: 'center' },
  confirmTitle: { fontSize: 22, fontWeight: '700', color: C.w, letterSpacing: -0.6, marginBottom: 8 },
  confirmText: { fontSize: 13, color: C.w3, lineHeight: 20, marginBottom: 20 },
  resendBtn: { paddingVertical: 12, alignItems: 'center' },
  resendText: { fontSize: 13, color: C.emerald, opacity: 0.8 },
});
```

- [ ] **Step 8.3 — Run tests + commit**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -8
```
Expected: `Tests: 211 passed, 211 total`

```bash
cd /Users/manicmonk/Downloads/Code/budget-app
git add mobile/src/screens/AuthScreen.tsx
git commit -m "feat: AuthScreen — Obsidian Emerald reskin, emerald strength bars + toggle link"
```

---

## Task 9: WellnessDetailSheet

**Files:**
- Modify: `mobile/src/components/WellnessDetailSheet.tsx`

Keep all score computation, `ExpandedSparkline` chart logic, `FactorRow` transaction lookup, modal open/close unchanged.

- [ ] **Step 9.1 — Add theme import**

```typescript
import { C, T } from '../theme';
```

- [ ] **Step 9.2 — Replace StyleSheet**

```typescript
const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(9,9,12,0.9)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40, maxHeight: '85%' },
  drag: { width: 36, height: 4, backgroundColor: C.b2, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  scroll: { paddingHorizontal: 20 },

  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 12 },
  score: { fontSize: 42, fontWeight: '700', color: C.emerald, letterSpacing: -2, lineHeight: 42, fontVariant: ['tabular-nums'] },
  scoreDenom: { fontSize: 18, fontWeight: '300', color: C.w4 },
  scoreStatus: { ...T.sectionLabel, color: C.w4, marginTop: 3 },
  closeBtn: { padding: 8 },
  closeText: { fontSize: 20, color: C.w4 },

  chartWrap: { marginBottom: 12 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  dayLabel: { fontSize: 8, color: C.w4 },

  rule: { height: 1, backgroundColor: C.b1, marginBottom: 8 },
  sectionLabel: { ...T.sectionLabel, color: C.w4, marginBottom: 10 },

  factorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(31,31,40,0.5)' },
  factorRowMuted: { opacity: 0.4 },
  factorDot: { width: 5, height: 5, borderRadius: 3, marginTop: 4 },
  factorContent: { flex: 1 },
  factorTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  factorName: { fontSize: 12, color: C.w2 },
  textMuted: { color: C.w4 },
  factorRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  factorRatioPct: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  factorAmount: { fontSize: 11, color: C.w3, fontVariant: ['tabular-nums'] },
  txnList: { marginTop: 4 },
  txnItem: { fontSize: 10, color: C.w4, marginTop: 2 },
});
```

- [ ] **Step 9.3 — Update ExpandedSparkline color prop call**

Find where `ExpandedSparkline` is called and ensure it passes `color={C.emerald}`.

Find where factor dots are rendered and update over-budget color:
```typescript
// In FactorRow, the dot color prop usage:
<View style={[s.factorDot, { backgroundColor: factor.color }]} />
// factor.color is set by useWellnessScore — keep as-is

// Update factorRatioPct color:
<Text style={[s.factorRatioPct, { color: factor.ratio > 1 ? C.rose : C.emerald }]}>
```

- [ ] **Step 9.4 — Run tests + commit**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -8
```
Expected: `Tests: 211 passed, 211 total`

```bash
cd /Users/manicmonk/Downloads/Code/budget-app
git add mobile/src/components/WellnessDetailSheet.tsx
git commit -m "feat: WellnessDetailSheet — Obsidian Emerald reskin, emerald sparkline, rose/emerald factor pcts"
```

---

## Task 10: Final verification, push, PR

- [ ] **Step 10.1 — Run full test suite**

```bash
cd /Users/manicmonk/Downloads/Code/budget-app/mobile
npx jest --passWithNoTests 2>&1 | tail -10
```

Expected:
```
Test Suites: 25 passed, 25 total
Tests:       211 passed, 211 total
```

If any tests fail, investigate and fix before continuing.

- [ ] **Step 10.2 — Verify no stray 'Report' route references**

```bash
grep -rn "navigate('Report')\|navigate(\"Report\")\|name=\"Report\"\|name='Report'" \
  /Users/manicmonk/Downloads/Code/budget-app/mobile/src \
  /Users/manicmonk/Downloads/Code/budget-app/mobile/App.tsx
```

Expected: no output (all renamed to Spend).

- [ ] **Step 10.3 — Verify no old color hex values in modified screens**

```bash
grep -rn "#6366f1\|#0f172a\|#1e293b\|#f1f5f9" \
  /Users/manicmonk/Downloads/Code/budget-app/mobile/src/screens \
  /Users/manicmonk/Downloads/Code/budget-app/mobile/src/navigation \
  /Users/manicmonk/Downloads/Code/budget-app/mobile/src/components/WellnessDetailSheet.tsx
```

Expected: no output (all replaced with theme tokens).

- [ ] **Step 10.4 — Push branch**

```bash
git push -u origin feat/obsidian-emerald-redesign 2>&1
```

- [ ] **Step 10.5 — Create PR**

```bash
gh pr create \
  --title "feat: Tower UI — Obsidian Emerald redesign" \
  --body "$(cat <<'EOF'
## Summary
- Full visual reskin across all 11 screens to Obsidian Emerald design system
- New `src/theme.ts` with typed color tokens and typography constants
- `ReportScreen` renamed to `SpendScreen` (route: `Report` → `Spend`)
- `FloatingTabBar` replaces text labels + emoji with SVG line icons
- `PlanScreen` income tab converted to bottom-sheet modal; internal nav simplified to `Buckets | Goals`
- `NotificationsScreen` `Switch` replaced with custom `TogglePill` component
- Zero logic changes — all hooks, queries, modals, gestures unchanged
- 211 tests passing throughout

## Test Plan
- [x] `npx jest --passWithNoTests` — 211 tests pass
- [x] No stray `navigate('Report')` references
- [x] No old hex values (`#6366f1`, `#0f172a`) in modified files
- [ ] Manual: tap income strip on Plan → modal opens/closes
- [ ] Manual: Buckets ↔ Goals segment switches
- [ ] Manual: wellness score tap → detail sheet
- [ ] Manual: deep-link from Home income tile → income modal opens on Plan
- [ ] Manual: navigate to all settings subpages

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Report the PR URL.
