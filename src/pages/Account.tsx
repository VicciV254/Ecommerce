import { ReactNode } from 'react';
import { Link, navigate, useLocation } from '../router';
import { useAuth } from '../contexts/AuthContext';

interface AccountProps {
  children: ReactNode;
}

export default function Account({ children }: AccountProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;

  const navItems = [
    { path: '/account/profile', label: 'Profile' },
    { path: '/account/orders', label: 'Orders' },
    { path: '/account/addresses', label: 'Addresses' },
  ];

  const isActive = (path: string) => currentPath.startsWith(path);

  if (!user) {
    return (
      <div className="max-w-6xl mx-auto p-4 py-16 text-center">
        <p className="text-gray-600 mb-4">Please sign in to view your account.</p>
        <Link to="/login" className="btn-primary inline-block">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-off-white px-4 py-8">
      <div className="mx-auto max-w-6xl">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-64 flex-shrink-0">
          <div className="rounded-lg border border-brand-secondary/30 bg-light-pink p-4 shadow-card">
            <div className="text-center mb-4">
              {user.profileImage ? (
                <img src={user.profileImage} alt="" className="mx-auto h-16 w-16 rounded-full object-cover ring-2 ring-brand-secondary/40" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-brand-secondary/20 mx-auto flex items-center justify-center text-2xl text-brand-primary">
                  {user.firstName?.[0] || 'U'}
                </div>
              )}
              <p className="font-medium mt-2">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-sm text-gray-500">{user.email}</p>
            </div>
            <hr className="my-4 border-brand-secondary/30" />
            <nav className="space-y-1">
              <Link
                to="/"
                className="block px-3 py-2 rounded-md text-sm font-medium transition-colors text-brand-primary hover:bg-white/70"
              >
                Back to Site
              </Link>
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                    isActive(item.path)
                      ? 'bg-brand-primary text-white font-medium'
                      : 'hover:bg-white/70 text-charcoal'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              <button
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
                className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-error hover:bg-white/70 transition-colors"
              >
                Logout
              </button>
            </nav>
          </div>
        </div>

        <div className="flex-1">
          <div className="rounded-lg border border-light-gray bg-white p-6 shadow-card">{children}</div>
        </div>
      </div>
      </div>
    </div>
  );
}
