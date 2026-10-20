import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="min-h-[60vh] grid place-items-center px-4">
      <div className="text-center">
        <p className="text-5xl mb-3" aria-hidden="true">🧭</p>
        <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
        <p className="text-slate-500 mt-2 max-w-md">
          The page you were looking for does not exist or has moved.
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <Link to="/app" className="btn-primary">Go to dashboard</Link>
          <Link to="/" className="btn-secondary">Home</Link>
        </div>
      </div>
    </div>
  );
}
