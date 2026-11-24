// Two-factor login for /admin, switched on and off in the dashboard (Stats → Security). Only for the logged-in admin
// (api/admin/_middleware.ts); setting it up or switching it off also needs a login from the last 10 minutes.
//
// GET                         { enabled, source: 'dashboard' | 'cloudflare' | null }
// POST { action: 'start' }    new secret (not active yet): { secret, uri } for the authenticator app (QR code or link)
// POST { action: 'confirm', code }   the first code from the app: two-factor is on from now on
// POST { action: 'disable', code }   a current code: two-factor is off again (only the dashboard one)

import { checkTotp, isFreshLogin, json, newTotpSecret, readSecret, reauthNeeded, totpSecret, writeSecret, type Handler } from '../../_lib/auth.ts';

const source = async (env: Parameters<Handler>[0]['env']) =>
	env.ADMIN_TOTP_SECRET ? 'cloudflare' : (await readSecret(env, 'totp').catch(() => null)) ? 'dashboard' : null;

export const onRequestGet: Handler = async ({ env }) => {
	const from = await source(env);
	return json({ enabled: Boolean(await totpSecret(env)), source: from });
};

export const onRequestPost: Handler = async ({ request, env }) => {
	if (!env.DB) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	if (!(await isFreshLogin(env, request))) return reauthNeeded();
	const body = (await request.json().catch(() => ({}))) as { action?: unknown; code?: unknown };
	const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '';

	if (body.action === 'start') {
		if (env.ADMIN_TOTP_SECRET) return json({ error: 'Two-factor is already set in Cloudflare (ADMIN_TOTP_SECRET).' }, 409);
		const secret = newTotpSecret();
		await writeSecret(env, 'totp_pending', secret);
		const uri = `otpauth://totp/secondsurf:admin?secret=${secret}&issuer=secondsurf&algorithm=SHA1&digits=6&period=30`;
		return json({ secret, uri });
	}

	if (body.action === 'confirm') {
		const pending = await readSecret(env, 'totp_pending');
		if (!pending) return json({ error: 'Start the setup first.' }, 409);
		if ((await checkTotp(env, code, pending)) === null) return json({ error: 'That code is not right. Check the time on your phone and try the newest code.' }, 400);
		await writeSecret(env, 'totp', pending);
		await writeSecret(env, 'totp_pending', null);
		return json({ ok: true, enabled: true });
	}

	if (body.action === 'disable') {
		if (env.ADMIN_TOTP_SECRET) return json({ error: 'This two-factor is set in Cloudflare: remove ADMIN_TOTP_SECRET there.' }, 409);
		if ((await checkTotp(env, code)) === null) return json({ error: 'That code is not right.' }, 400);
		await writeSecret(env, 'totp', null);
		return json({ ok: true, enabled: false });
	}

	return json({ error: 'Unknown action.' }, 400);
};
