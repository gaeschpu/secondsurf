// Two-factor login for /admin: makes a new random secret for your authenticator app.
// Run: node scripts/admin-2fa-setup.mjs   (prints only; nothing is saved, nothing is sent anywhere)
//
// 1. In the authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …): "Add" → "Enter a setup key",
//    name "secondsurf admin", key = the secret below, type "time-based".
// 2. Cloudflare → Workers & Pages → secondsurf → Settings → Variables and Secrets → Add → Type "Secret",
//    name ADMIN_TOTP_SECRET, value = the same secret. Then redeploy (or push any change).
// 3. From then on the dashboard login asks for the 6-digit code. Keep the secret only in the app and in Cloudflare:
//    never in a file, a chat or the repository.

import crypto from 'node:crypto';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const bytes = crypto.randomBytes(20);
let bits = '';
for (const b of bytes) bits += b.toString(2).padStart(8, '0');
const secret = bits.match(/.{5}/g).map((chunk) => A[parseInt(chunk, 2)]).join('');

console.log('\nSecret (setup key):', secret.match(/.{4}/g).join(' '));
console.log('\nOr open this link on the phone that has the authenticator app:');
console.log(`otpauth://totp/secondsurf:admin?secret=${secret}&issuer=secondsurf&algorithm=SHA1&digits=6&period=30\n`);
