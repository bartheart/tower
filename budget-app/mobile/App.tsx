import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import HomeScreen from './src/screens/HomeScreen';
import PlanScreen from './src/screens/PlanScreen';
import ReportScreen from './src/screens/ReportScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AuthScreen from './src/screens/AuthScreen';
import FloatingTabBar from './src/navigation/FloatingTabBar';
import {
  registerPushToken,
  setupNotificationHandler,
  setupAppStateSync,
  syncStaleItems,
} from './src/plaid/backgroundSync';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  scopes: ['profile', 'email'],
});

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// ─── Tab navigator (Home · Plan · Settings) ───────────────────────────────────

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

// ─── Root stack (Tabs + Report pushed on top) ─────────────────────────────────

function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen
        name="Report"
        component={ReportScreen}
        options={{
          animation: 'slide_from_right',
          gestureEnabled: true,
        }}
      />
    </Stack.Navigator>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────

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
      <View style={{ flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <AuthScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
