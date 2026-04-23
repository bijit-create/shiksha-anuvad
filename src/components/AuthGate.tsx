import { useState, FormEvent } from 'react';
import { Lock, Loader2, AlertCircle, KeyRound } from 'lucide-react';
import { fetchAuthStatus, storeToken } from '../services/auth';

interface Props {
  onUnlock: () => void;
}

export default function AuthGate({ onUnlock }: Props) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const status = await fetchAuthStatus(trimmed);
      if (status.authenticated) {
        storeToken(trimmed);
        onUnlock();
      } else {
        setError('Invalid access token. Please try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not validate token. Check your connection.');
    } finally {
      setLoading(false);
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
            <p className="text-sm text-zinc-500 mt-1">This translator is access-restricted.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="access-token" className="text-xs font-semibold text-zinc-600 uppercase tracking-wider flex items-center gap-2">
              <KeyRound className="w-3.5 h-3.5" />
              Access Token
            </label>
            <input
              id="access-token"
              type="password"
              autoComplete="off"
              autoFocus
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your access token"
              disabled={loading}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-400 outline-none transition-all disabled:opacity-60"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-200/50
              ${loading || !token.trim()
                ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98]'}
            `}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying…
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                Unlock
              </>
            )}
          </button>
        </form>

        <p className="text-[11px] text-zinc-400 text-center leading-relaxed">
          Contact the administrator if you do not have a token. Tokens are shared secrets — do not publish them.
        </p>
      </div>
    </div>
  );
}
