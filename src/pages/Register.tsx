import { FormEvent, useState } from 'react';
import { Link, navigate } from '../router';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../api/auth';
import { PasswordInput } from '../components/PasswordInput';
import { AuthLayout, authStyles } from '../components/AuthLayout';

/** The API's minimum password length. */
const PASSWORD_MIN = 8;

export default function Register() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    phone: '',
    promotionalEmails: false,
  });
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

    const success = await register(formData);
    if (success) {
      setNotice('Account created. Enter the OTP sent to your email to verify your account.');
      window.setTimeout(() => navigate(`/verify-email?email=${encodeURIComponent(formData.email)}`), 700);
    } else {
      setError('Registration failed. Email may already be in use.');
    }

    setLoading(false);
  };

  const resendVerification = async () => {
    setResending(true);
    setError(null);
    try {
      const { data } = await authAPI.resendVerification(formData.email);
      if (data?.verificationEmailSent === false) throw new Error('Email not sent');
      setNotice('A fresh OTP has been sent. The previous code is now void.');
    } catch {
      setError('Could not resend OTP. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      intro={<>Or <Link to="/login" className={authStyles.link}>sign in to an existing account</Link></>}
    >
      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        {error && <p role="alert" className={`${authStyles.error} text-center`}>{error}</p>}
        {notice && (
          <div role="status" className={`${authStyles.success} text-center`}>
            {notice}
            <div className="mt-1 flex flex-wrap justify-center gap-x-4">
              <button type="button" onClick={() => navigate(`/verify-email?email=${encodeURIComponent(formData.email)}`)} className="inline-flex min-h-[44px] items-center font-bold underline underline-offset-4">
                Enter OTP
              </button>
              <button type="button" onClick={resendVerification} disabled={resending} className="inline-flex min-h-[44px] items-center font-bold underline underline-offset-4 disabled:cursor-not-allowed">
                {resending ? 'Sending...' : 'Resend OTP'}
              </button>
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className={authStyles.label}>First name</label>
            <input id="firstName" name="firstName" type="text" autoComplete="given-name" required value={formData.firstName} onChange={handleChange} className={authStyles.field} />
          </div>
          <div>
            <label htmlFor="lastName" className={authStyles.label}>Last name</label>
            <input id="lastName" name="lastName" type="text" autoComplete="family-name" required value={formData.lastName} onChange={handleChange} className={authStyles.field} />
          </div>
        </div>
        <div>
          <label htmlFor="email" className={authStyles.label}>Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required value={formData.email} onChange={handleChange} className={authStyles.field} />
        </div>
        <div>
          <label htmlFor="phone" className={authStyles.label}>Phone (optional)</label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" value={formData.phone} onChange={handleChange} className={authStyles.field} />
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
