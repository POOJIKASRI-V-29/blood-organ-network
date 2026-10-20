import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Field, Spinner } from '../components/ui/index.jsx';
import Logo from '../components/Logo.jsx';

const DEMO_ACCOUNTS = [
  { label: 'Administrator',    email: 'admin@bon.health',      password: 'Admin@123' },
  { label: 'Donor',            email: 'donor@bon.health',      password: 'Password@123' },
  { label: 'Recipient',        email: 'recipient@bon.health',  password: 'Password@123' },
  { label: 'Hospital',         email: 'hospital@bon.health',   password: 'Password@123' },
  { label: 'Blood bank',       email: 'bloodbank@bon.health',  password: 'Password@123' },
  { label: 'Transplant centre',email: 'transplant@bon.health', password: 'Password@123' },
];

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to={location.state?.from ?? '/app'} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const user = await login(form.email.trim(), form.password);
      toast.success(`Signed in as ${user.fullName}`);
      navigate(location.state?.from ?? '/app', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const useDemo = (account) => setForm({ email: account.email, password: account.password });

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10 sm:py-16 grid lg:grid-cols-2 gap-8 items-start">
      <Card className="order-2 lg:order-1">
        <div className="flex items-center gap-2.5 mb-1">
          <Logo className="h-7 w-7" />
          <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
        </div>
        <p className="text-sm text-slate-500 mb-5">Access your dashboard.</p>

        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && (
            <div role="alert" className="rounded-lg bg-brand-50 border border-brand-200 text-brand-800 text-sm px-3 py-2">
              {error}
            </div>
          )}
          <Field label="Email address" htmlFor="email" required>
            <input id="email" type="email" className="input" autoComplete="username" required
                   value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password" htmlFor="password" required>
            <input id="password" type="password" className="input" autoComplete="current-password" required
                   value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner className="h-4 w-4 text-white" />} Sign in
          </button>
        </form>

        <p className="mt-5 text-sm text-slate-600">
          No account? <Link to="/register" className="link">Register here</Link>
        </p>
      </Card>

      <Card title="Demo accounts" subtitle="Seeded data — click to fill the form" className="order-1 lg:order-2">
        <ul className="divide-y divide-slate-100">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{account.label}</p>
                <p className="text-xs text-slate-500 font-mono truncate">{account.email}</p>
              </div>
              <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => useDemo(account)}>
                Use
              </button>
            </li>
          ))}
        </ul>
        <p className="hint mt-3">
          Passwords: <span className="font-mono">Admin@123</span> for the administrator,{' '}
          <span className="font-mono">Password@123</span> for everyone else.
        </p>
      </Card>
    </div>
  );
}
