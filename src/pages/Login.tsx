import { FormEvent, useState } from 'react';
import { Link, navigate, parseRoute, useRoute } from '../router';
import { useAuth } from '../contexts/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { AuthLayout, authStyles } from '../components/AuthLayout';
import { registerRoute, safeReturnTo, verifyEmailRoute } from '../store/returnTo';

export default function Login() {
  const route = useRoute();
  const { params } = parseRoute(route);
  const verified = params.get('verified') === '1';
  // Only an internal shopper route is honoured; anything else returns to the home page.
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await login(email, password);
    if (result.ok) {
      // The sign-in page leaves history: Back from the returned-to page skips it.
      navigate(returnTo, { replace: true });
    } else if (result.requiresOtp) {
      // Unverified accounts go to the verification page, which owns sending a new code.
      navigate(verifyEmailRoute(result.email || email, returnTo));
    } else {
      setError(result.error || 'Could not sign in. Please check your details.');
    }

    setLoading(false);
  };

  return (
    <AuthLayout
      title="Sign in to your account"
      intro={<>New here? <Link to={registerRoute(returnTo)} className={authStyles.link}>Create an account</Link></>}
    >
      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        {verified && <p role="status" className={`${authStyles.success} text-center`}>Email verified. Sign in to continue.</p>}
        {error && <p role="alert" className={`${authStyles.error} text-center`}>{error}</p>}
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
