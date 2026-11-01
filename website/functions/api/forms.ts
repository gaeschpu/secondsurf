// Contact, sell and returns forms: checks for bots, then emails the owner and confirms to the customer.

import { SITE } from '../../src/config.ts';
import { json, type Env, type Handler } from '../_lib/auth.ts';

const FORMS = {
	contact: { subject: 'Nachricht', fields: ['phone'], required: ['message'] },
	stockist: { subject: 'Stockist-Anfrage', fields: ['company', 'website', 'amount', 'photos'], required: ['message', 'company'] },
	sellOnce: { subject: 'Einmal verkaufen', fields: ['amount', 'photos'], required: ['message'] },
	returns: { subject: 'Rückgabe', fields: ['piece', 'orderDate', 'reason'], required: ['message', 'piece', 'orderDate', 'reason'] },
} as const;

const LABELS: Record<string, string> = {
	phone: 'Telefon',
	company: 'Shop / Firma',
	website: 'Website',
	amount: 'Anzahl Pieces',
	photos: 'Fotos',
	piece: 'Piece',
	orderDate: 'Bestelldatum',
	reason: 'Grund',
	message: 'Nachricht',
};

const CONFIRMATION = {
	de: {
		subject: 'Danke für deine Nachricht an secondsurf',
		text: 'Hallo\n\nDanke, deine Nachricht ist bei uns angekommen. Wir antworten meist innert einem Tag.\n\nBitte antworte nicht auf diese E-Mail.\n\nsecondsurf',
	},
	fr: {
		subject: 'Merci pour ton message à secondsurf',
		text: 'Bonjour\n\nMerci, ton message nous est bien parvenu. Nous répondons en général en un jour.\n\nMerci de ne pas répondre à cet e-mail.\n\nsecondsurf',
	},
	en: {
		subject: 'Thanks for your message to secondsurf',
		text: 'Hello\n\nThanks, we got your message. We usually answer within a day.\n\nPlease do not reply to this email.\n\nsecondsurf',
	},
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELD = 300;
const MAX_MESSAGE = 5000;

const clean = (value: unknown, max = MAX_FIELD) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

async function isHuman(env: Env, token: string, ip: string | null) {
	const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
	if (ip) body.set('remoteip', ip);
	const verifyUrl = env.FORMS_TEST_API ? `${env.FORMS_TEST_API}/siteverify` : 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
	const res = await fetch(verifyUrl, { method: 'POST', body });
	const data = (await res.json()) as { success?: boolean };
	return data.success === true;
}

async function sendMail(env: Env, mail: { to: string; subject: string; text: string; reply_to?: string }) {
	const res = await fetch(`${env.FORMS_TEST_API ?? 'https://api.resend.com'}/emails`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ from: env.MAIL_FROM ?? 'secondsurf <noreply@secondsurf.ch>', ...mail }),
	});
	if (!res.ok) throw new Error(`Resend answered ${res.status}`);
}

export const onRequestPost: Handler = async ({ request, env }) => {
	if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'origin' }, 403);
	if (!env.RESEND_API_KEY || !env.TURNSTILE_SECRET_KEY) return json({ error: 'unavailable' }, 503);

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const form = FORMS[clean(body?.kind) as keyof typeof FORMS];
	if (!body || !form) return json({ error: 'invalid' }, 400);

	// Bots fill the invisible field. Pretend it worked, so they don't try again.
	if (body.botcheck) return json({ ok: true });

	const name = clean(body.name, 120).replace(/[\r\n]+/g, ' ');
	const email = clean(body.email, 200);
	const values: Record<string, string> = { message: clean(body.message, MAX_MESSAGE) };
	for (const field of form.fields) values[field] = clean(body[field]);

	if (!name || !EMAIL.test(email) || body.privacy !== 'on' || form.required.some((field) => !values[field])) return json({ error: 'invalid' }, 400);

	const token = clean(body['cf-turnstile-response'], 2048);
	if (!token || !(await isHuman(env, token, request.headers.get('CF-Connecting-IP')))) return json({ error: 'captcha' }, 400);

	const details = Object.entries(values)
		.filter(([, value]) => value)
		.map(([field, value]) => `${LABELS[field]}:\n${value}`)
		.join('\n\n');
	try {
		await sendMail(env, {
			to: SITE.email,
			reply_to: email,
			subject: `${form.subject} von ${name}`,
			text: `Name: ${name}\nE-Mail: ${email}\n\n${details}`,
		});
	} catch (error) {
		console.error(error);
		return json({ error: 'send' }, 502);
	}

	// The owner has the message, so a failed confirmation shouldn't show the customer an error.
	// It repeats nothing they typed, so the form can't be used to send other people custom text.
	const lang = clean(body.lang) as keyof typeof CONFIRMATION;
	await sendMail(env, { to: email, ...(CONFIRMATION[lang] ?? CONFIRMATION.de) }).catch((error) => console.error(error));
	return json({ ok: true });
};
