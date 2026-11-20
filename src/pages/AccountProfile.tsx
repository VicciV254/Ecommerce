import { FormEvent, useEffect, useRef, useState } from 'react';
import { PERSON_LIMITS } from '../api/auth';
import { fieldClass, fieldLabelClass } from '../components/AddressForm';
import { useAuth } from '../contexts/AuthContext';
import { useEntryFocus } from '../router';

const panelClass = 'rounded-lg bg-surface p-4 shadow-card sm:p-6';
const saveClass =
  'inline-flex min-h-[48px] items-center justify-center rounded-sm bg-navy-900 px-6 text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900 disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-muted';

type Message = { tone: 'success' | 'error'; text: string };

export default function AccountProfile() {
  const { user, updateProfile, updatePromotionalEmails } = useAuth();
  const [formData, setFormData] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    phone: user?.phone ?? '',
    profileImage: user?.profileImage ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [promotionalEmails, setPromotionalEmails] = useState(user?.promotionalEmails ?? false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEntryFocus(heading);

  // Follow the saved preference when the profile is refreshed.
  useEffect(() => {
    if (user?.promotionalEmails !== undefined) {
      setPromotionalEmails(user.promotionalEmails);
    }
  }, [user?.promotionalEmails]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setFormData((prev) => ({ ...prev, profileImage: String(reader.result) }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile(formData);
      setMessage({ tone: 'success', text: 'Profile updated.' });
    } catch {
      setMessage({ tone: 'error', text: 'Your profile could not be updated. Try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePromotionalEmailsToggle = async () => {
    const newValue = !promotionalEmails;
    setSaving(true);
    try {
      await updatePromotionalEmails(newValue);
      setPromotionalEmails(newValue);
      setMessage({ tone: 'success', text: 'Email preferences updated.' });
    } catch {
      setMessage({ tone: 'error', text: 'Your email preferences could not be updated. Try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 ref={heading} tabIndex={-1} className="type-h1 text-navy-900">Profile</h1>
        <p className="mt-1 text-navy-800">Your name, phone number and email preferences.</p>
      </div>
      <form onSubmit={handleSubmit} className={`max-w-2xl space-y-4 ${panelClass}`}>
        <div className="flex flex-wrap items-center gap-4">
          {formData.profileImage ? (
            <img src={formData.profileImage} alt="" className="size-20 rounded-full object-cover" />
          ) : (
            <span aria-hidden="true" className="flex size-20 items-center justify-center rounded-full bg-surface-soft text-2xl font-semibold text-navy-900">
              {user?.firstName?.[0] ?? 'A'}
            </span>
          )}
          <div className="min-w-0 flex-1 basis-48">
            <label htmlFor="profile-photo" className={fieldLabelClass}>Profile photo</label>
            <input id="profile-photo" type="file" accept="image/*" onChange={handlePhotoFile} className="mt-1 block min-h-[44px] w-full max-w-full text-sm text-navy-800" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className={fieldLabelClass}>First name</label>
            <input id="firstName" name="firstName" type="text" autoComplete="given-name" required maxLength={PERSON_LIMITS.nameMax} value={formData.firstName} onChange={handleChange} className={fieldClass} />
          </div>
          <div>
            <label htmlFor="lastName" className={fieldLabelClass}>Last name</label>
            <input id="lastName" name="lastName" type="text" autoComplete="family-name" required maxLength={PERSON_LIMITS.nameMax} value={formData.lastName} onChange={handleChange} className={fieldClass} />
          </div>
        </div>
        <div>
          <label htmlFor="phone" className={fieldLabelClass}>Phone</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={PERSON_LIMITS.phoneMax} value={formData.phone} onChange={handleChange} className={fieldClass} />
        </div>
        <div>
          <label htmlFor="profile-email" className={fieldLabelClass}>Email</label>
          <input id="profile-email" type="email" value={user?.email ?? ''} disabled aria-describedby="profile-email-note" className={fieldClass} />
          <p id="profile-email-note" className="mt-1 text-sm text-muted">Your sign-in email cannot be changed here.</p>
        </div>
        {message && (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-md p-3 text-sm font-semibold ${message.tone === 'error' ? 'bg-error-tint text-error' : 'bg-success-tint text-success'}`}>
            {message.text}
          </p>
        )}
        <button type="submit" disabled={saving} className={saveClass}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <section aria-labelledby="profile-emails" className={`max-w-2xl ${panelClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1 basis-56">
            <h2 id="profile-emails" className="type-h3 text-navy-900">Promotional emails</h2>
            <p id="profile-emails-note" className="mt-1 text-sm text-navy-800">Receive updates about new products and special offers.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={promotionalEmails}
            aria-labelledby="profile-emails"
            aria-describedby="profile-emails-note"
            onClick={handlePromotionalEmailsToggle}
            disabled={saving}
            className="inline-flex min-h-[44px] items-center gap-3 rounded-sm px-1 text-sm font-semibold text-navy-900 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true" className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors duration-(--motion-feedback) ${promotionalEmails ? 'border-navy-900 bg-navy-900' : 'border-control bg-surface'}`}>
              <span className={`inline-block size-5 rounded-full transition-transform duration-(--motion-feedback) ${promotionalEmails ? 'translate-x-5 bg-white' : 'translate-x-0.5 bg-control'}`} />
            </span>
            <span aria-hidden="true">{promotionalEmails ? 'On' : 'Off'}</span>
          </button>
        </div>
      </section>

      <section aria-labelledby="profile-mpesa" className={`max-w-2xl ${panelClass}`}>
        <h2 id="profile-mpesa" className="type-h3 text-navy-900">M-Pesa payments</h2>
        <p className="mt-1 text-sm text-navy-800">
          Payment availability and status are shown on each order. Enter your M-Pesa PIN only in the prompt on your phone, never on this website.
        </p>
      </section>
    </div>
  );
}
