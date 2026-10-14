import { useState, FormEvent } from 'react';
import { Lock, Loader2, AlertCircle, Mail, CheckCircle2 } from 'lucide-react';
import { signInWithGoogle, sendEmailLink } from '../services/auth';
import { ALLOWED_DOMAIN, supabaseConfigured } from '../lib/supabase';

interface Props {
  notice?: string | null;
}

export default function AuthGate({ notice }: Props) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(notice || null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState<'google' | 'email' | null>(null);

  const google = async () => {
    setLoading('google');
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed.');
      setLoading(null);
    }
  };

  const emailLink = async (e: FormEvent) => {
    e.preventDefault();
    setLoading('email');
    setError(null);
    try {
      await sendEmailLink(email);
      setSent(true);
    } catch (err: any) {
      setError(err?.message || 'Could not send the sign-in link.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-zinc-50 via-indigo-50/30 to-zinc-50">
      <div className="w-full max-w-md bg-white border border-zinc-200 rounded-3xl shadow-xl shadow-indigo-100/40 p-8 space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center">
            <Lock className="w-7 h-7 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Shiksha Anuvad</h1>
            <p className="text-sm text-zinc-500 mt-1">Sign in with your {ALLOWED_DOMAIN} account.</p>
          </div>
        </div>

        {!supabaseConfigured && (
          <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800">
            Sign-in is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
          </div>
        )}

        <button
          onClick={google}
          disabled={!!loading || !supabaseConfigured}
          className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:bg-zinc-100 disabled:text-zinc-400"
        >
          {loading === 'google' && <Loader2 className="w-4 h-4 animate-spin" />}
          Sign in with Google
        </button>

        <div className="flex items-center gap-3 text-[11px] text-zinc-400 uppercase tracking-wider">
          <div className="h-px flex-1 bg-zinc-200" /> or <div className="h-px flex-1 bg-zinc-200" />
        </div>

        {sent ? (
          <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-800">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Check {email} for a sign-in link.</span>
          </div>
        ) : (
          <form onSubmit={emailLink} className="space-y-3">
            <label htmlFor="email" className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-2">
              <Mail className="w-3.5 h-3.5" /> Email link
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`name@${ALLOWED_DOMAIN}`}
              disabled={!!loading || !supabaseConfigured}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none transition-all disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!!loading || !email.trim() || !supabaseConfigured}
              className="w-full py-2.5 rounded-xl font-semibold text-sm border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading === 'email' && <Loader2 className="w-4 h-4 animate-spin" />}
              Send me a link
            </button>
          </form>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
