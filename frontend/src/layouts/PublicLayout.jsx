import { Link, NavLink, Outlet } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function PublicLayout() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            <Logo />
            <span className="font-semibold text-slate-900 truncate">
              Blood &amp; Organ <span className="hidden sm:inline">Availability </span>Network
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <NavLink to="/compatibility" className={({ isActive }) =>
              `btn-ghost btn-sm hidden sm:inline-flex ${isActive ? 'bg-slate-100' : ''}`}>
              Compatibility
            </NavLink>
            {isAuthenticated ? (
              <Link to="/app" className="btn-primary btn-sm">Go to dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn-secondary btn-sm">Sign in</Link>
                <Link to="/register" className="btn-primary btn-sm">Register</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1"><Outlet /></main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 text-xs text-slate-500 space-y-2">
          <p className="font-medium text-slate-600">
            Blood &amp; Organ Availability Network — Database Systems course project
          </p>
          <p>
            Academic simulation. The matching and allocation mechanisms demonstrated here are
            simplified and must not be used for real-world medical decision-making. All personal
            data shown is fictitious.
          </p>
        </div>
      </footer>
    </div>
  );
}
