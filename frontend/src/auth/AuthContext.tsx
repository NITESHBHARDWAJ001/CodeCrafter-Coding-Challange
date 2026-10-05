import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import type { Profile, Stats } from '../lib/types';
import { PageSkeleton } from '../components/ui';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  stats: Stats | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s);
      if (!s) qc.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const me = useQuery({
    queryKey: ['me'],
    enabled: !!session,
    queryFn: () => api.get<{ profile: Profile; stats: Stats }>('/me'),
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2,
  });

  const signOut = useCallback(async () => { await supabase.auth.signOut(); qc.clear(); }, [qc]);

  return (
    <Ctx.Provider value={{
      session, profile: me.data?.profile ?? null, stats: me.data?.stats ?? null,
      loading: !ready || (!!session && me.isLoading), refresh: () => qc.invalidateQueries({ queryKey: ['me'] }), signOut,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function RequireAuth() {
  const { session, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="mx-auto max-w-5xl p-6"><PageSkeleton /></div>;
  if (!session) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { profile, loading } = useAuth();
  if (loading) return <div className="mx-auto max-w-5xl p-6"><PageSkeleton /></div>;
  if (profile?.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Outlet />;
}
