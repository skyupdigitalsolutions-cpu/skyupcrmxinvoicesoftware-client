import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { apiError } from '../api/client.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.username || !form.password) return setErr('Please enter username and password.');
    setBusy(true);
    try {
      await login(form.username.trim(), form.password);
      navigate('/dashboard');
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy to-navy-700 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-[380px] rounded-2xl bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.4)] sm:p-9"
      >
        <div className="mb-7 text-center">
          <div className="text-2xl font-black leading-tight tracking-wide text-navy">
            Sole &amp; Stride <span style={{ color: 'var(--primary)' }}>FOOTWEAR</span>
          </div>
        </div>

        <div className="mb-4">
          <label className="field-label">Username</label>
          <input
            autoFocus
            className="input"
            placeholder="Enter username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </div>
        <div className="mb-2">
          <label className="field-label">Password</label>
          <input
            type="password"
            className="input"
            placeholder="Enter password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>

        {err && (
          <div className="mb-3 mt-1 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-center text-xs font-medium text-danger">
            {err}
          </div>
        )}

        <button
          disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          {busy ? 'Signing in…' : <><LogIn size={16} /> Sign In</>}
        </button>
      </form>
    </div>
  );
}