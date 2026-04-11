import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './src/screens/HomeScreen';
import PlanScreen from './src/screens/PlanScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { supabase } from './src/supabase/client';
import {
  registerPushToken,
  setupNotificationHandler,
  setupAppStateSync,
  syncStaleItems,
} from './src/plaid/backgroundSync';
import type { Session } from '@supabase/supabase-js';

const Tab = createBottomTabNavigator();

function AuthScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#f8fafc', fontSize: 20, fontWeight: '300' }}>Tower</Text>
      <Text style={{ color: '#64748b', marginTop: 8 }}>Sign in to continue</Text>
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
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

  if (!session) return <AuthScreen />;

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
            tabBarActiveTintColor: '#6366f1',
            tabBarInactiveTintColor: '#475569',
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
          <Tab.Screen name="Plan" component={PlanScreen} options={{ tabBarLabel: 'Plan' }} />
          <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
