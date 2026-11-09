// Emails through Resend and bot checks through Turnstile, shared by the forms and customer accounts.

import type { Env } from './auth.ts';

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function isHuman(env: Env, token: string, ip: string | null) {
	const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
	if (ip) body.set('remoteip', ip);
	const verifyUrl = env.FORMS_TEST_API ? `${env.FORMS_TEST_API}/siteverify` : 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
	const res = await fetch(verifyUrl, { method: 'POST', body });
	const data = (await res.json()) as { success?: boolean };
	return data.success === true;
}

export async function sendMail(env: Env, mail: { to: string; subject: string; text: string; reply_to?: string }) {
	const res = await fetch(`${env.FORMS_TEST_API ?? 'https://api.resend.com'}/emails`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ from: env.MAIL_FROM ?? 'secondsurf <noreply@secondsurf.ch>', ...mail }),
	});
	if (!res.ok) throw new Error(`Resend answered ${res.status}`);
}

/** Up to 100 emails in one request (Resend batch), so a Cloudflare function stays within its request limit. */
export async function sendMailBatch(env: Env, mails: { to: string; subject: string; text: string; reply_to?: string }[]) {
	const from = env.MAIL_FROM ?? 'secondsurf <noreply@secondsurf.ch>';
	const res = await fetch(`${env.FORMS_TEST_API ?? 'https://api.resend.com'}/emails/batch`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(mails.map((mail) => ({ from, ...mail }))),
	});
	if (!res.ok) throw new Error(`Resend answered ${res.status}`);
}
