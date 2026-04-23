import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Translator from './components/Translator';
import AuthGate from './components/AuthGate';
import { fetchAuthStatus, getStoredToken } from './services/auth';

type AuthState =
  | { kind: 'checking' }
  | { kind: 'gate' }
  | { kind: 'ready' };

export default function App() {
  const [state, setState] = useState<AuthState>({ kind: 'checking' });

  useEffect(() => {
    fetchAuthStatus(getStoredToken())
      .then((status) => {
        if (!status.authRequired || status.authenticated) {
          setState({ kind: 'ready' });
        } else {
          setState({ kind: 'gate' });
        }
      })
      .catch(() => {
        // Health check failed (network / backend down). Let the app load;
        // actual API calls will surface the real error.
        setState({ kind: 'ready' });
      });
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50">
      {state.kind === 'checking' && (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      )}
      {state.kind === 'gate' && (
        <AuthGate onUnlock={() => setState({ kind: 'ready' })} />
      )}
      {state.kind === 'ready' && <Translator />}
    </div>
  );
}
