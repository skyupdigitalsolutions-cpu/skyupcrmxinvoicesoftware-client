import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { PauseCircle } from 'lucide-react';
import { api, setAccessToken, onAuthFailure, onAccountPaused } from '../api/client.js';
import { authApi } from '../api/endpoints.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pausedMsg, setPausedMsg] = useState(null);

  const clear = useCallback(() => { setAccessToken(null); setUser(null); }, []);

  // On load, attempt silent refresh to restore session
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.post('/auth/refresh');
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        clear();
      } finally {
        setLoading(false);
      }
    })();
    onAuthFailure(clear);
    onAccountPaused((msg) => setPausedMsg(msg || 'Your account is paused.'));
  }, [clear]);

  const login = async (username, password) => {
    const data = await authApi.login({ username, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    setPausedMsg(null);
    clear();
  };

  const isAdmin = user?.role === 'admin';
  const isDeveloper = user?.role === 'developer';

  // Tenant info attached by the server (currency + branding). Null for developer.
  const company = user?.company && typeof user.company === 'object' ? user.company : null;
  const branding = company?.branding || null;
  const currency = company?.currency || null;
  const subscription = company?.subscription || null;

  // When the server reports the subscription is paused (402), show a blocking
  // notice over everything. Developers are never paused, so this only affects
  // admin/sales users of an expired company.
  if (pausedMsg && !isDeveloper) {
    return (
      <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isDeveloper, company, branding, currency, subscription, paused: true }}>
        <AccountPausedScreen message={pausedMsg} onLogout={logout} brandName={branding?.headerName} />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isDeveloper, company, branding, currency, subscription, paused: false }}>
      {children}
    </AuthContext.Provider>
  );
}

// Full-screen blocking notice shown when a company's subscription is paused.
function AccountPausedScreen({ message, onLogout, brandName }) {
  return (
    <div
      style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', background: 'var(--bg-base, #f6f7fb)',
      }}
    >
      <div
        style={{
          maxWidth: 460, width: '100%', textAlign: 'center', borderRadius: 16,
          background: 'var(--bg-card, #fff)', boxShadow: '0 10px 40px rgba(0,0,0,.12)',
          padding: '36px 28px', border: '1px solid var(--border-card, #eee)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: 'var(--primary, #6D28D9)' }}>
          <PauseCircle size={44} strokeWidth={1.5} />
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary, #111)' }}>
          {brandName ? `${brandName} — ` : ''}Account Paused
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary, #555)', margin: '0 0 22px' }}>
          {message}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', margin: '0 0 22px' }}>
          Access will resume automatically once the subscription is renewed and the
          payment status is updated.
        </p>
        <button
          onClick={onLogout}
          style={{
            padding: '10px 22px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--primary, #6D28D9)', color: '#fff', fontWeight: 700, fontSize: 14,
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}