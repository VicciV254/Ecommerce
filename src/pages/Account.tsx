import { ReactNode, useState, useEffect } from 'react';
import { Link, navigate, useLocation } from '../router';
import { useAuth } from '../contexts/AuthContext';

interface AccountProps {
  children: ReactNode;
}

export default function Account({ children }: AccountProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const currentPath = location.pathname;
  const [previousPath, setPreviousPath] = useState('/');

  useEffect(() => {
    // Store the previous path when entering account pages
    const handleBeforeUnload = () => {
      sessionStorage.setItem('lastPathBeforeAccount', currentPath);
    };
    handleBeforeUnload();
    
    // Get the last path from session storage
    const lastPath = sessionStorage.getItem('lastPathBeforeAccount');
    if (lastPath && lastPath !== currentPath) {
      setPreviousPath(lastPath);
    }
  }, [currentPath]);

  const navItems = [
    { path: '/account/profile', label: 'Profile' },
    { path: '/account/orders', label: 'Orders' },
    { path: '/account/addresses', label: 'Addresses' },
  ];

  const isActive = (path: string) => currentPath.startsWith(path);

  const handleBack = () => {
    navigate(previousPath);
  };

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
    <div className="bg-off-white min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <button
            onClick={handleBack}
            className="text-sm font-medium text-brand-primary hover:text-brand-secondary transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>
        
        <div className="flex flex-col md:flex-row gap-6">
          <div className="md:w-64 shrink-0">
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
