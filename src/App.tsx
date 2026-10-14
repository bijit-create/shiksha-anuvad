import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Loader2, LogOut } from 'lucide-react';
import Translator from './components/Translator';
import AuthGate from './components/AuthGate';
import { supabase, isAllowedEmail, ALLOWED_DOMAIN } from './lib/supabase';
import { signOut } from './services/auth';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const accept = (s: Session | null) => {
      if (s && !isAllowedEmail(s.user.email)) {
        setNotice(`${s.user.email} is not a ${ALLOWED_DOMAIN} account.`);
        signOut();
        setSession(null);
        return;
      }
      setSession(s);
    };
    supabase.auth.getSession().then(({ data }) => accept(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => accept(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }
  if (!session) return <AuthGate notice={notice} />;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="flex justify-end items-center gap-3 px-6 pt-4 text-xs text-zinc-500">
        <span>{session.user.email}</span>
        <button onClick={() => signOut()} className="flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-700">
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
      <Translator />
    </div>
  );
}
