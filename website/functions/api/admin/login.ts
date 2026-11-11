// POST /api/admin/login { password, code? }: code = 6 digits from the authenticator app, needed once ADMIN_TOTP_SECRET is set.
// Also used to confirm the password again before payouts (a fresh cookie, see isFreshLogin in functions/_lib/auth.ts).
// Brute force: 5 failures per IP within 15 minutes, 20 failures in total within an hour lock the login for that time.
// Each code works only once (a code seen on the screen can't be replayed).

import { checkPassword, checkTotp, json, sessionCookie, totpEnabled, type Handler } from '../../_lib/auth.ts';
import { database, isLocked, recordFailure } from '../../_lib/accounts.ts';

export const onRequestPost: Handler = async ({ request, env }) => {
	const body = (await request.json().catch(() => null)) as { password?: unknown; code?: unknown } | null;
	const password = typeof body?.password === 'string' ? body.password.slice(0, 200) : '';
	const code = typeof body?.code === 'string' ? body.code.replace(/\s/g, '').slice(0, 10) : '';
	const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
	const db = env.DB ? await database(env) : null;

	if (db && ((await isLocked(db, `admin-ip:${ip}`, 5, 15)) || (await isLocked(db, 'admin-all', 20, 60)))) {
		return json({ error: 'Too many attempts. Please wait 15 minutes.' }, 429);
	}

	const passwordOk = await checkPassword(env, password);
	let codeOk = true;
	if (totpEnabled(env)) {
		const step = await checkTotp(env, code);
		codeOk = step !== null && !(db && (await isLocked(db, `admin-totp:${step}`, 1, 5)));
		if (codeOk && passwordOk && db) await recordFailure(db, `admin-totp:${step}`); // marks the code as used
	}

	if (!passwordOk || !codeOk) {
		if (db) await recordFailure(db, `admin-ip:${ip}`, 'admin-all');
		console.warn(JSON.stringify({ event: 'admin-login-failed', ip, country: request.headers.get('CF-IPCountry') ?? '' }));
		// One message for both, so a guess doesn't learn which part was right.
		return json({ error: totpEnabled(env) ? 'Wrong password or code.' : 'Wrong password.', code: totpEnabled(env) }, 401);
	}
	return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env) });
};

/** Whether the login form should ask for the code. */
export const onRequestGet: Handler = ({ env }) => json({ code: totpEnabled(env) });
