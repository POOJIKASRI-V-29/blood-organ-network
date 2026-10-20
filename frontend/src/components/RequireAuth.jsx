import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading, EmptyState } from './ui/index.jsx';

/** Route guard: requires a session, and optionally one of a set of roles. */
export default function RequireAuth({ roles, children }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  if (loading) return <div className="min-h-screen grid place-items-center"><Loading label="Checking your session…" /></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  if (roles && !roles.includes(user.role)) {
    return (
      <EmptyState
        icon="🔒"
        title="You do not have access to this page"
        message={`This area is limited to: ${roles.join(', ')}. Your role is ${user.role}.`}
      />
    );
  }
  return children;
}
