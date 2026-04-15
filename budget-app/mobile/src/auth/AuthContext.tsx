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
 * Best-effort local DB wipe when the signed-in user changes.
 *
 * Security note: this is cleanup, NOT the security boundary.
 * All WatermelonDB reads are scoped by user_id, so even if this
 * reset fails, a different user cannot see another user's rows.
 * We therefore never block sign-in on a reset failure.
 */
async function tryResetForNewUser(userId: string): Promise<void> {
  try {
    await database.unsafeResetDatabase();
    await SecureStore.setItemAsync(LAST_USER_KEY, userId);
  } catch (e) {
    // Reset failed — log and continue. The user_id-scoped queries
    // ensure data isolation regardless.
    console.warn('[AuthContext] DB reset failed, continuing anyway:', e);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // getSession() handles cold-start: INITIAL_SESSION from onAuthStateChange
    // can race with async SecureStore reads, so we seed the session state
    // immediately and let the auth listener handle any subsequent changes.
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'SIGNED_IN') {
        if (newSession?.user) {
          const userId = newSession.user.id;
          const lastUserId = await SecureStore.getItemAsync(LAST_USER_KEY).catch(() => null);
          // Only wipe if a different user is signing in
          if (lastUserId !== userId) {
            await tryResetForNewUser(userId);
          }
        }
        setSession(newSession);
        setLoading(false);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setLoading(false);
        await SecureStore.deleteItemAsync(LAST_USER_KEY).catch(() => {});
        await database.unsafeResetDatabase().catch(() => {});
      } else if (event === 'INITIAL_SESSION') {
        // Cold-start: check if a different user's session was restored
        if (newSession?.user) {
          const userId = newSession.user.id;
          const lastUserId = await SecureStore.getItemAsync(LAST_USER_KEY).catch(() => null);
          if (lastUserId !== userId) {
            await tryResetForNewUser(userId);
          }
        }
        // getSession() above already seeded state — no setSession/setLoading needed here
      } else {
        // TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY, etc.
        setSession(newSession);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    // Null session first so the tab navigator unmounts all observers
    // before we wipe the DB — avoids WatermelonDB "open observer" errors.
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
