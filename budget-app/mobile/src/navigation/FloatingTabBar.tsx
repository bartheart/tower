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
