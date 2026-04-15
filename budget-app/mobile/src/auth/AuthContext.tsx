import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../supabase/client';
import { database } from '../db';

const LAST_USER_KEY = 'tower_last_user_id';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Resets the local WatermelonDB and updates the stored last-user marker.
 *
 * If the reset throws (e.g. an open observer holds the DB), we CANNOT
 * safely show data — the caller must sign the user out immediately.
 *
 * Returns true if reset succeeded, false if it failed.
 */
async function resetDatabaseForUser(userId: string): Promise<boolean> {
  try {
    await database.unsafeResetDatabase();
    await SecureStore.setItemAsync(LAST_USER_KEY, userId);
    return true;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (newSession?.user) {
          const userId = newSession.user.id;
          const lastUserId = await SecureStore.getItemAsync(LAST_USER_KEY).catch(() => null);

          // Only reset if this is a different user than last time.
          // Same user on cold-start (INITIAL_SESSION) skips the wipe.
          if (lastUserId !== userId) {
            const ok = await resetDatabaseForUser(userId);
            if (!ok) {
              // Reset failed — cannot guarantee data isolation. Force sign-out.
              await supabase.auth.signOut().catch(() => {});
              setSession(null);
              setLoading(false);
              return;
            }
          }
        }
        setSession(newSession);
        setLoading(false);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setLoading(false);
        // Best-effort cleanup on sign-out; clear last-user marker so the next
        // sign-in always triggers a fresh reset regardless of who signs in.
        await SecureStore.deleteItemAsync(LAST_USER_KEY).catch(() => {});
        await database.unsafeResetDatabase().catch(() => {});
      } else {
        // TOKEN_REFRESHED, USER_UPDATED, etc. — just update session
        setSession(newSession);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    // Null session first so the tab navigator unmounts all observers before
    // we wipe the database — prevents WatermelonDB "open observer" errors.
    setSession(null);
    await supabase.auth.signOut().catch(() => {});
    await SecureStore.deleteItemAsync(LAST_USER_KEY).catch(() => {});
    await database.unsafeResetDatabase().catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
