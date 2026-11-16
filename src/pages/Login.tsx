import { FormEvent, useState } from 'react';
import { Link, navigate, parseRoute, useRoute } from '../router';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../api/auth';
import { PasswordInput } from '../components/PasswordInput';
import { AuthLayout, authStyles } from '../components/AuthLayout';
import { safeReturnTo } from '../store/returnTo';

export default function Login() {
  const route = useRoute();
  const { params } = parseRoute(route);
  const verified = params.get('verified') === '1';
  // Only an internal shopper route is honoured; anything else returns to the home page.
  const returnTo = safeReturnTo(params.get('returnTo'));
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
      // The sign-in page leaves history: Back from the returned-to page skips it.
      navigate(returnTo, { replace: true });
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
    <AuthLayout
      title="Sign in to your account"
      intro={<>Or <Link to="/register" className={authStyles.link}>create a new account</Link></>}
    >
      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        {verified && <p role="status" className={`${authStyles.success} text-center`}>Email verified. Sign in to continue.</p>}
        {error && (
          <div role="alert" className={`${authStyles.error} text-center`}>
            <p>{error}</p>
            <button
              type="button"
              onClick={resendVerification}
              disabled={resending}
              className="mt-1 inline-flex min-h-[44px] items-center font-bold underline underline-offset-4 disabled:cursor-not-allowed"
            >
              {resending ? 'Sending...' : 'Resend OTP'}
            </button>
          </div>
        )}
        {notice && <p role="status" className={`${authStyles.success} text-center`}>{notice}</p>}
        <div>
          <label htmlFor="email" className={authStyles.label}>Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authStyles.field}
          />
        </div>
        <div>
          <label htmlFor="password" className={authStyles.label}>Password</label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authStyles.field}
          />
        </div>
        <button type="submit" disabled={loading} className={authStyles.submit}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
