import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabase/client';
import { database } from '../db';

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load existing session on cold start (fires INITIAL_SESSION, not SIGNED_IN)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN') {
        // Reset local DB before mounting the app for the new user.
        // SIGNED_IN fires only on explicit sign-in (not cold-start session restore),
        // so this is safe: no observers are mounted yet when this runs.
        await database.unsafeResetDatabase().catch(() => {});
      }
      setSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    // Null session first so tab navigator unmounts all observers
    setSession(null);
    await supabase.auth.signOut().catch(() => {});
    // Best-effort cleanup (primary cleanup now happens on SIGNED_IN)
    await database.unsafeResetDatabase().catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
