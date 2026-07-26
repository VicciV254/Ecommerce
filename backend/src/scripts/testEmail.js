// Quick standalone test: node src/scripts/testEmail.js you@example.com
// Prints the *actual* error from the mail service so we can see what's really wrong.
import 'dotenv/config';
import { sendMail, isMailConfigured } from '../services/mailService.js';

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
    subject: 'Test email from No Maneno Bazaar backend',
    text: 'If you received this, email sending is working.',
    html: '<p>If you received this, email sending is working.</p>',
  });
  console.log('SUCCESS:', result);
} catch (err) {
  console.error('FAILED:');
  console.error('  message:', err.message);
  console.error('  statusCode:', err.statusCode);
  if (err.response) console.error('  response data:', JSON.stringify(err.response?.data ?? err.response, null, 2));
  if (err.code) console.error('  code:', err.code);
  process.exit(1);
}
