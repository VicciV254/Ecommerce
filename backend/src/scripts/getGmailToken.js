import 'dotenv/config';
import axios from 'axios';
import readline from 'readline';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost';

if (!clientId || !clientSecret) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in backend/.env');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.send');
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\nAuthorize Gmail API by opening this URL:\n');
console.log(authUrl.toString());
console.log('\nAfter approving, Google may show "localhost refused to connect". That is okay.');
console.log('Copy the full localhost URL from the browser address bar, or just the code= value.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function extractCode(input) {
  const value = input.trim();
  if (value.startsWith('http://') || value.startsWith('https://')) {
    const url = new URL(value);
    return url.searchParams.get('code') || '';
  }
  return value;
}

rl.question('Paste authorization code or localhost URL here: ', async (input) => {
  try {
    const code = extractCode(input);
    if (!code) {
      throw new Error('No OAuth code found. Paste the full localhost URL or the value after code=');
    }

    const { data } = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log('\nAdd these values to backend/.env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token || ''}`);
    console.log(`GOOGLE_ACCESS_TOKEN=${data.access_token || ''}`);
    console.log(`GOOGLE_TOKEN_EXPIRY=${Date.now() + Number(data.expires_in || 3600) * 1000}`);
  } catch (error) {
    console.error('Could not exchange code for token:', error.response?.data || error.message);
  } finally {
    rl.close();
  }
});
