import { FormEvent, useState } from 'react';
import { Link, navigate, parseRoute, useRoute } from '../router';
import { PERSON_LIMITS } from '../api/auth';
import { useAuth } from '../contexts/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { AuthLayout, authStyles } from '../components/AuthLayout';
import { loginRoute, safeReturnTo, verifyEmailRoute } from '../store/returnTo';

/** The API's minimum password length. */
const PASSWORD_MIN = 8;

export default function Register() {
  // Where the shopper was going (for example checkout): carried through verification and sign-in, checked at each step.
  const returnTo = safeReturnTo(parseRoute(useRoute()).params.get('returnTo'));
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    promotionalEmails: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register } = useAuth();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value,
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const outcome = await register(formData);
    setLoading(false);
    if (outcome === 'signed-in') {
      // Already verified and signed in: straight back to where the shopper was going; Back skips this page.
      navigate(returnTo, { replace: true });
    } else if (outcome === 'verify') {
      // The account exists now; Back from verification leaves the flow rather than showing this form again.
      navigate(verifyEmailRoute(formData.email, returnTo), { replace: true });
    } else {
      setError(outcome.error);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      intro={<>Already have an account? <Link to={loginRoute(returnTo)} className={authStyles.link}>Sign in</Link></>}
    >
      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        {error && <p role="alert" className={`${authStyles.error} text-center`}>{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className={authStyles.label}>First name</label>
            <input id="firstName" name="firstName" type="text" autoComplete="given-name" required minLength={PERSON_LIMITS.nameMin} maxLength={PERSON_LIMITS.nameMax} value={formData.firstName} onChange={handleChange} className={authStyles.field} />
          </div>
          <div>
            <label htmlFor="lastName" className={authStyles.label}>Last name</label>
            <input id="lastName" name="lastName" type="text" autoComplete="family-name" required minLength={PERSON_LIMITS.nameMin} maxLength={PERSON_LIMITS.nameMax} value={formData.lastName} onChange={handleChange} className={authStyles.field} />
          </div>
        </div>
        <div>
          <label htmlFor="email" className={authStyles.label}>Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required value={formData.email} onChange={handleChange} className={authStyles.field} />
        </div>
        <div>
          <label htmlFor="phone" className={authStyles.label}>Phone (optional)</label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={PERSON_LIMITS.phoneMax} value={formData.phone} onChange={handleChange} className={authStyles.field} />
        </div>
        <div>
          <label htmlFor="password" className={authStyles.label}>Password</label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN}
            aria-describedby="password-hint"
            value={formData.password}
            onChange={handleChange}
            className={authStyles.field}
          />
          <p id="password-hint" className="mt-1 text-sm text-muted">At least {PASSWORD_MIN} characters.</p>
        </div>
        <div className="flex items-start gap-3">
          <input
            id="promotionalEmails"
            name="promotionalEmails"
            type="checkbox"
            checked={formData.promotionalEmails}
            onChange={handleChange}
            className="mt-1 size-[18px] shrink-0 accent-navy-900"
          />
          <label htmlFor="promotionalEmails" className="text-sm text-navy-800">
            I would like to receive promotional emails about new products and special offers
          </label>
        </div>
        <button type="submit" disabled={loading} className={authStyles.submit}>
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
