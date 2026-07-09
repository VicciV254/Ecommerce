import { FormEvent, useState } from 'react';
import { Link, navigate, parseRoute, useRoute } from '../router';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../api/auth';

export default function Login() {
  const route = useRoute();
  const { params } = parseRoute(route);
  const verified = params.get('verified') === '1';
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { login } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const result = await login(email, password);
    if (result.ok) {
      navigate('/');
    } else if (result.requiresOtp) {
      navigate(`/verify-email?email=${encodeURIComponent(result.email || email)}`);
    } else {
      setError(result.error || 'Could not sign in. Please check your details.');
    }

    setLoading(false);
  };

  const resendVerification = async () => {
    if (!email) {
      setError('Enter your email address first, then request a new OTP.');
      return;
    }
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await authAPI.resendVerification(email);
      if (data?.verificationEmailSent === false) throw new Error('Email not sent');
      setNotice('A fresh OTP has been sent. The previous code is now void.');
    } catch {
      setError('Could not send a new OTP. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-light-pink py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-lg shadow-lg">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Or{' '}
            <Link to="/register" className="font-medium text-brand-secondary hover:text-brand-accent">
              create a new account
            </Link>
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {verified && (
            <div className="rounded-md bg-success/10 p-3 text-center text-sm font-medium text-success">
              Email verified. Sign in to continue.
            </div>
          )}
          {error && (
            <div className="rounded-md bg-error/10 p-3 text-center text-sm text-error">
              <p>{error}</p>
              <button
                type="button"
                onClick={resendVerification}
                disabled={resending}
                className="mt-2 font-bold underline underline-offset-4 disabled:opacity-50"
              >
                {resending ? 'Sending...' : 'Resend OTP'}
              </button>
            </div>
          )}
          {notice && (
            <div className="rounded-md bg-success/10 p-3 text-center text-sm font-medium text-success">
              {notice}
            </div>
          )}
          <div className="rounded-md border border-brand-secondary/30 bg-light-pink/40 p-3 text-center text-sm text-charcoal">
            Need a new verification code?
            <button
              type="button"
              onClick={resendVerification}
              disabled={resending}
              className="ml-2 font-bold text-brand-primary underline underline-offset-4 disabled:opacity-50"
            >
              {resending ? 'Sending...' : 'Resend OTP'}
            </button>
          </div>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary focus:z-10 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary focus:z-10 sm:text-sm"
                placeholder="Password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-brand-secondary hover:bg-brand-accent focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


