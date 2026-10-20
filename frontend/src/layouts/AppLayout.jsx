import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { directoryApi } from '../services/api.js';
import { ROLES, ROLE_LABELS } from '../constants/index.js';

/**
 * Navigation is derived from the signed-in role, so a user is never shown a
 * link they would be refused at the API. The backend authorises independently;
 * this only keeps the UI honest.
 */
const NAV = [
  { to: '/app', label: 'Dashboard', icon: '▦', end: true, roles: 'ALL' },
  { section: 'Blood' },
  { to: '/app/blood/availability', label: 'Blood availability', icon: '🩸', roles: 'ALL' },
  { to: '/app/blood/requests', label: 'Blood requests', icon: '📋', roles: 'ALL' },
  { to: '/app/blood/donations', label: 'Donations', icon: '💉',
    roles: [ROLES.ADMIN, ROLES.BLOOD_BANK, ROLES.DONOR] },
  { to: '/app/blood/inventory', label: 'Inventory', icon: '📦',
    roles: [ROLES.ADMIN, ROLES.BLOOD_BANK, ROLES.HOSPITAL] },
  { section: 'Organs' },
  { to: '/app/organs/availability', label: 'Organ availability', icon: '🫀', roles: 'ALL' },
  { to: '/app/organs/requests', label: 'Organ requests', icon: '🗂️', roles: 'ALL' },
  { to: '/app/organs/my-donation', label: 'My organ pledge', icon: '🤝', roles: [ROLES.DONOR] },
  { to: '/app/organs/registry', label: 'Organ registry', icon: '🧬',
    roles: [ROLES.ADMIN, ROLES.TRANSPLANT_CENTER] },
  { section: 'Network' },
  { to: '/app/analytics', label: 'Analytics', icon: '📈', roles: 'ALL' },
  { to: '/app/directory', label: 'Directory', icon: '🏥', roles: 'ALL' },
  { to: '/app/admin/users', label: 'Manage users', icon: '👥', roles: [ROLES.ADMIN] },
  { to: '/app/admin/audit', label: 'Audit log', icon: '🧾', roles: [ROLES.ADMIN] },
];

function visibleFor(role) {
  const out = [];
  let pendingSection = null;
  for (const item of NAV) {
    if (item.section) { pendingSection = item; continue; }
    if (item.roles !== 'ALL' && !item.roles.includes(role)) continue;
    if (pendingSection) { out.push(pendingSection); pendingSection = null; }
    out.push(item);
  }
  return out;
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  useEffect(() => {
    let active = true;
    const load = () => directoryApi.unreadCount()
      .then((result) => { if (active) setUnread(result.unread); })
      .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    const onRefresh = () => load();
    window.addEventListener('bon:notifications-changed', onRefresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('bon:notifications-changed', onRefresh); };
  }, []);

  const items = visibleFor(user?.role);

  const linkClass = ({ isActive }) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
      isActive ? 'bg-brand-50 text-brand-800 font-medium ring-1 ring-inset ring-brand-100'
               : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`;

  const sidebar = (
    <nav className="flex flex-col gap-0.5 p-3">
      {items.map((item, index) => item.section ? (
        <p key={`s-${index}`} className="px-3 pt-4 pb-1 text-[0.68rem] font-semibold uppercase tracking-wider text-slate-400">
          {item.section}
        </p>
      ) : (
        <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
          <span aria-hidden="true" className="text-base leading-none w-5 text-center">{item.icon}</span>
          <span className="truncate">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="h-16 px-3 sm:px-5 flex items-center gap-3">
          <button className="btn-ghost btn-sm lg:hidden" onClick={() => setSidebarOpen((v) => !v)}
                  aria-label="Toggle navigation" aria-expanded={sidebarOpen}>
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <Link to="/app" className="flex items-center gap-2.5 min-w-0">
            <Logo />
            <span className="font-semibold text-slate-900 hidden sm:block truncate">
              Blood &amp; Organ Network
            </span>
          </Link>

          <div className="flex-1" />

          <Link to="/app/notifications" className="relative btn-ghost btn-sm" aria-label={`Notifications (${unread} unread)`}>
            <span className="text-base" aria-hidden="true">🔔</span>
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full
                               bg-brand-600 text-white text-[0.65rem] font-semibold grid place-items-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>

          <div className="hidden sm:flex flex-col items-end leading-tight mr-1">
            <span className="text-sm font-medium text-slate-800 truncate max-w-[12rem]">{user?.fullName}</span>
            <span className="text-[0.7rem] text-slate-500">{ROLE_LABELS[user?.role] ?? user?.role}</span>
          </div>
          <Link to="/app/profile" className="btn-secondary btn-sm" title="Profile">
            <span aria-hidden="true">👤</span><span className="sr-only sm:not-sr-only">Profile</span>
          </Link>
          <button className="btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="mx-auto max-w-[95rem] flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-60 shrink-0 border-r border-slate-200 bg-white min-h-[calc(100vh-4rem)] sticky top-16 self-start">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSidebarOpen(false)} />
            <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-pop overflow-y-auto animate-slide-in">
              <div className="h-16 flex items-center gap-2.5 px-4 border-b border-slate-200">
                <Logo /><span className="font-semibold">Navigation</span>
              </div>
              {sidebar}
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0 p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
