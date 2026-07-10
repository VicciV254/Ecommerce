import { FormEvent, useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function AccountProfile() {
  const { user, updateProfile, updatePromotionalEmails } = useAuth();
  const [formData, setFormData] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    phone: user?.phone ?? '',
    profileImage: user?.profileImage ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [promotionalEmails, setPromotionalEmails] = useState(user?.promotionalEmails ?? false);

  // Sync promotionalEmails when user data changes
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
      setMessage('Profile updated successfully.');
    } catch {
      setMessage('Failed to update profile.');
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
      setMessage('Email preferences updated.');
    } catch {
      setMessage('Failed to update email preferences.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6 rounded-lg bg-brand-primary p-5 text-white">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-secondary">Account</p>
        <h2 className="mt-1 font-display text-2xl">Profile Settings</h2>
      </div>
      <form onSubmit={handleSubmit} className="max-w-md space-y-4">
        <div className="rounded-md border border-brand-secondary/30 bg-light-pink p-4">
          <div className="flex items-center gap-4">
            {formData.profileImage ? (
              <img src={formData.profileImage} alt="" className="h-20 w-20 rounded-full object-cover ring-2 ring-brand-secondary" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-secondary/20 text-2xl font-bold text-brand-primary">
                {user?.firstName?.[0] ?? 'U'}
              </div>
            )}
            <div className="flex-1">
              <label className="block text-sm font-semibold text-brand-primary mb-1">Profile Photo</label>
              <input type="file" accept="image/*" onChange={handlePhotoFile} className="text-sm" />
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
            First Name
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            value={formData.firstName}
            onChange={handleChange}
            className="w-full rounded-md border border-light-gray bg-off-white p-2 focus:border-brand-secondary focus:outline-none"
            required
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
            Last Name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            value={formData.lastName}
            onChange={handleChange}
            className="w-full rounded-md border border-light-gray bg-off-white p-2 focus:border-brand-secondary focus:outline-none"
            required
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            value={formData.phone}
            onChange={handleChange}
            className="w-full rounded-md border border-light-gray bg-off-white p-2 focus:border-brand-secondary focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            value={user?.email ?? ''}
            disabled
            className="w-full rounded-md border border-light-gray bg-light-pink/40 p-2 text-charcoal/60"
          />
        </div>
        <div className="rounded-md border border-brand-secondary/30 bg-light-pink p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-brand-primary">Promotional Emails</h3>
              <p className="mt-1 text-xs text-gray-500">Receive updates about new products and special offers.</p>
            </div>
            <button
              type="button"
              onClick={handlePromotionalEmailsToggle}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                promotionalEmails ? 'bg-brand-primary' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  promotionalEmails ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-md border border-brand-secondary/30 bg-light-pink p-4">
          <h3 className="text-sm font-semibold text-brand-primary">Checkout Preferences</h3>
          <p className="mt-1 text-xs text-gray-500">Payments are visual in this demo. No payment credentials are stored.</p>
        </div>
        {message && (
          <p className={`text-sm ${message.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
            {message}
          </p>
        )}
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}


