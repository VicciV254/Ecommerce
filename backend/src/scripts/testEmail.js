// Quick standalone test: node src/scripts/testEmail.js you@example.com
// Sends one real email and prints the normalized result or error; credentials and provider responses are never printed.
import 'dotenv/config';
import { brandedEmail, isMailConfigured, sendMail } from '../services/mailService.js';

const DIAGNOSTIC_FIELDS = ['code', 'message', 'statusCode', 'provider', 'providerCode', 'providerStatus', 'missingSettings'];

const to = process.argv[2];
if (!to) {
  console.error('Usage: node src/scripts/testEmail.js <recipient-email>');
  process.exit(1);
}

console.log('EMAIL_PROVIDER =', process.env.EMAIL_PROVIDER);
console.log('isMailConfigured() =', isMailConfigured());

try {
  const result = await sendMail({
    to,
    subject: 'Test email from the Apex Cart backend',
    text: 'If you received this, email sending is working.',
    html: brandedEmail({
      eyebrow: 'Email diagnostics',
      title: 'Email sending is working',
      intro: 'If you received this, email sending is working.',
    }),
  });
  console.log('SUCCESS:', result);
} catch (err) {
  console.error('FAILED:');
  for (const field of DIAGNOSTIC_FIELDS) {
    if (err[field] !== undefined) console.error(`  ${field}:`, err[field]);
  }
  process.exit(1);
}
