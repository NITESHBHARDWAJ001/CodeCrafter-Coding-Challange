import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Button, Field, Input, Logo, Select } from '../components/ui';

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-saffron-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-ink-500/30 blur-3xl" />
        <Logo light />
        <div className="relative">
          <p className="num text-sm text-saffron-400">{'// daily.challenge()'}</p>
          <h2 className="mt-3 font-display text-4xl font-bold leading-tight">One problem a day.<br />One streak at a time.</h2>
          <p className="mt-4 max-w-md text-ink-200">Solve on LeetCode. We verify your accepted submissions, keep the leaderboard honest, and issue certificates anyone can verify.</p>
          <div className="mt-8 grid max-w-md grid-cols-3 gap-3 text-center">
            {[['🔥', 'Streaks'], ['🏆', 'Leaderboards'], ['🎓', 'Certificates']].map(([i, l]) => (
              <div key={l} className="rounded-2xl bg-white/5 px-3 py-4 ring-1 ring-white/10"><div className="text-2xl">{i}</div><div className="mt-1 text-xs font-semibold text-ink-100">{l}</div></div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-ink-400">© CodeCrafter Club, IIT Madras</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mt-1.5 text-ink-600">{subtitle}</p>
          {!supabaseConfigured && <div className="mt-4 rounded-xl bg-saffron-100 p-3 text-sm text-ink-800">Supabase isn&apos;t configured. Copy <code>frontend/.env.example</code> to <code>.env</code> and set the project URL and anon key.</div>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { session } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (session) return <Navigate to={loc.state?.from ?? '/'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setErr(/confirm/i.test(error.message) ? 'Please verify your email first — check your inbox for the confirmation link.' : 'Incorrect email or password.');
    nav(loc.state?.from ?? '/', { replace: true });
  }
  return (
    <Shell title="Welcome back" subtitle="Sign in to continue your streak.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Student email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@student.college.edu" /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm font-medium text-bad">{err}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
        <div className="flex justify-between text-sm"><Link to="/forgot-password" className="font-semibold text-ink-600 hover:underline">Forgot password?</Link><Link to="/register" className="font-semibold text-ink-900 hover:underline">Create account</Link></div>
      </form>
    </Shell>
  );
}

export function RegisterPage() {
  const { session } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ full_name: '', email: '', password: '', leetcode_username: '', level: '' });
  const [errs, setErrs] = useState<Record<string, string>>({}); const [top, setTop] = useState('');
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  if (session && !done) return <Navigate to="/" replace />;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault(); setErrs({}); setTop('');
    const local: Record<string, string> = {};
    if (f.full_name.trim().length < 2) local.full_name = 'Enter your full name';
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(f.leetcode_username.trim())) local.leetcode_username = 'Letters, numbers, - and _ only';
    if (f.password.length < 8) local.password = 'At least 8 characters';
    if (!f.level) local.level = 'Choose your level';
    if (Object.keys(local).length) return setErrs(local);
    setBusy(true);
    try {
      const r = await api.post<{ email_confirmation_required: boolean }>('/auth/register', { ...f, leetcode_username: f.leetcode_username.trim() });
      if (r.email_confirmation_required) return setDone(true);
      const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
      if (error) return setDone(true);
      nav('/', { replace: true });
    } catch (e2) {
      if (e2 instanceof ApiError && e2.details?.fieldErrors) {
        setErrs(Object.fromEntries(Object.entries(e2.details.fieldErrors as Record<string, string[]>).map(([k, v]) => [k, v[0]])));
      } else if (e2 instanceof ApiError && e2.code === 'LEETCODE_TAKEN') setErrs({ leetcode_username: e2.message });
      else if (e2 instanceof ApiError && e2.code === 'EMAIL_TAKEN') setErrs({ email: e2.message });
      else setTop(errorMessage(e2));
    } finally { setBusy(false); }
  }

  if (done) return (
    <Shell title="Check your inbox ✉️" subtitle="Your account is created.">
      <p className="rounded-xl bg-ok-bg p-4 text-sm text-ink-800">We sent a confirmation link to <strong>{f.email}</strong>. Click it, then sign in.</p>
      <Link to="/login"><Button className="mt-4 w-full" size="lg">Go to sign in</Button></Link>
    </Shell>
  );
  return (
    <Shell title="Join CodeCrafter" subtitle="Register with your student email and LeetCode username.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" error={errs.full_name}><Input autoComplete="name" required value={f.full_name} onChange={set('full_name')} placeholder="Nitesh Sharma" /></Field>
        <Field label="Student email" error={errs.email}><Input type="email" autoComplete="email" required value={f.email} onChange={set('email')} placeholder="you@student.college.edu" /></Field>
        <Field label="LeetCode username" error={errs.leetcode_username} hint="From your profile URL: leetcode.com/u/<username>. We use it to verify your submissions — double-check it.">
          <Input required value={f.leetcode_username} onChange={set('leetcode_username')} placeholder="NiteshBhardwaj" autoCapitalize="none" spellCheck={false} />
        </Field>
        <Field label="Level" error={errs.level}>
          <Select required value={f.level} onChange={set('level')}><option value="">Select level…</option><option value="Foundation">Foundation</option><option value="Diploma">Diploma</option><option value="Degree">Degree</option></Select>
        </Field>
        <Field label="Password" error={errs.password}><Input type="password" autoComplete="new-password" required minLength={8} value={f.password} onChange={set('password')} /></Field>
        {top && <p role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-sm font-medium text-bad">{top}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Create account</Button>
        <p className="text-center text-sm text-ink-600">Already registered? <Link to="/login" className="font-semibold text-ink-900 hover:underline">Sign in</Link></p>
      </form>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  }
  return (
    <Shell title="Reset your password" subtitle="We'll email you a secure reset link.">
      {sent ? <p className="rounded-xl bg-ok-bg p-4 text-sm">If an account exists for <strong>{email}</strong>, a reset link is on its way.</p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Student email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {err && <p role="alert" className="text-sm font-medium text-bad">{err}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
      <Link to="/login" className="mt-4 block text-center text-sm font-semibold text-ink-600 hover:underline">← Back to sign in</Link>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => { if (evt === 'PASSWORD_RECOVERY' || evt === 'SIGNED_IN') setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (pw.length < 8) return setErr('At least 8 characters');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    nav('/', { replace: true });
  }
  return (
    <Shell title="Choose a new password" subtitle="Pick something you don't use elsewhere.">
      {!ready ? <p className="rounded-xl bg-saffron-100 p-4 text-sm">Open this page from the link in your reset email.</p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password"><Input type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          {err && <p role="alert" className="text-sm font-medium text-bad">{err}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>Update password</Button>
        </form>
      )}
    </Shell>
  );
}
