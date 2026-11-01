export const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  profileImage: true,
};

export const userSessionSelect = {
  ...userSummarySelect,
  isDisabled: true,
  emailVerified: true,
};

export const addressSummarySelect = {
  id: true,
  street: true,
  city: true,
  county: true,
  postalCode: true,
  isDefault: true,
};

export function userAccessError(user) {
  if (user.isDisabled) {
    return { error: 'This account has been disabled. Please contact support.' };
  }
  if (process.env.ENABLE_EMAIL_VERIFICATION === 'true' && !user.emailVerified) {
    return { error: 'Please verify your email before signing in', requiresOtp: true, email: user.email };
  }
  return null;
}
