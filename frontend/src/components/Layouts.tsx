import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Badge, Logo, cx } from './ui';

const navCls = ({ isActive }: { isActive: boolean }) =>
  cx('rounded-lg px-3 py-2 text-sm font-semibold transition', isActive ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-100');

export function StudentLayout() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" aria-label="Home"><Logo /></Link>
          <nav className="hidden items-center gap-1 md:flex">
            <NavLink to="/" end className={navCls}>Dashboard</NavLink>
            <NavLink to="/programs" className={navCls}>Programs</NavLink>
            <NavLink to="/leaderboard" className={navCls}>Leaderboard</NavLink>
            <NavLink to="/profile" className={navCls}>Profile</NavLink>
            {profile?.role === 'ADMIN' && <NavLink to="/admin" className={navCls}>Admin</NavLink>}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <span className="text-sm text-ink-600">{profile?.full_name}</span>
            <button onClick={signOut} className="text-sm font-semibold text-ink-600 hover:text-ink-900">Sign out</button>
          </div>
          <button className="rounded-lg p-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>☰</button>
        </div>
        {open && (
          <nav className="flex flex-col gap-1 border-t border-ink-100 bg-paper px-4 py-3 md:hidden" onClick={() => setOpen(false)}>
            <NavLink to="/" end className={navCls}>Dashboard</NavLink>
            <NavLink to="/programs" className={navCls}>Programs</NavLink>
            <NavLink to="/leaderboard" className={navCls}>Leaderboard</NavLink>
            <NavLink to="/profile" className={navCls}>Profile</NavLink>
            {profile?.role === 'ADMIN' && <NavLink to="/admin" className={navCls}>Admin</NavLink>}
            <button onClick={signOut} className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-bad">Sign out</button>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8"><Outlet /></main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-center text-xs text-ink-400">
        CodeCrafter Club · IIT Madras — problems are solved on LeetCode; we only verify and keep score.
      </footer>
    </div>
  );
}

const ADMIN_NAV: Array<[string, string, string]> = [
  ['/admin', 'Dashboard', '▦'], ['/admin/programs', 'Programs', '🗂'], ['/admin/challenges', 'Challenges', '🧩'],
  ['/admin/participants', 'Students', '👥'], ['/admin/leaderboards', 'Leaderboards', '🏆'], ['/admin/sync', 'Sync', '🔄'],
  ['/admin/certificates', 'Certificates', '🎓'], ['/admin/analytics', 'Analytics', '📈'], ['/admin/settings', 'Settings', '⚙'],
];

export function AdminLayout() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const links = (
    <>
      {ADMIN_NAV.map(([to, label, icon]) => (
        <NavLink key={to} to={to} end={to === '/admin'} onClick={() => setOpen(false)}
          className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', isActive ? 'bg-saffron-500 text-ink-950' : 'text-ink-100 hover:bg-ink-800')}>
          <span className="w-5 text-center" aria-hidden>{icon}</span>{label}
        </NavLink>
      ))}
    </>
  );
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="hidden flex-col bg-ink-900 p-4 lg:flex lg:sticky lg:top-0 lg:h-screen">
        <Link to="/admin" className="mb-6 px-1"><Logo light /></Link>
        <Badge tone="accent" className="mb-4 self-start">ADMIN CONSOLE</Badge>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">{links}</nav>
        <div className="mt-4 border-t border-ink-800 pt-4 text-sm text-ink-200">
          <div className="truncate font-semibold text-white">{profile?.full_name}</div>
          <div className="mt-2 flex gap-3"><Link to="/" className="hover:text-white">Student view</Link><button onClick={signOut} className="hover:text-white">Sign out</button></div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between bg-ink-900 px-4 py-3 lg:hidden">
          <Logo light compact /><span className="font-display font-bold text-white">Admin</span>
          <button className="rounded-lg p-2 text-white" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>☰</button>
        </header>
        {open && <nav className="flex flex-col gap-1 bg-ink-900 px-3 pb-3 lg:hidden">{links}<Link to="/" className="px-3 py-2 text-sm text-ink-200">Student view</Link><button onClick={signOut} className="px-3 py-2 text-left text-sm text-ink-200">Sign out</button></nav>}
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><Outlet /></main>
      </div>
    </div>
  );
}
