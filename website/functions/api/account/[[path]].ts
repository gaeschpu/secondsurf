// Customer accounts under /api/account/. Errors are short codes; the account page shows them in the customer's language.
//
// POST   register  { email, password, name, phone, lang, models?, remember?, cf-turnstile-response }
// POST   login     { email, password, remember? }   remember: false = logged out when the browser closes
// POST   logout
// GET    me                        profile, wishlist and addresses
// PATCH  me        { name?, phone?, lang?, priceAlerts?, models? }   models: 'women' | 'men' | ''
// DELETE me        { password }    deletes the account and everything in it
// POST   password  { current, password }
// POST   verify/resend
// GET    verify?token=…&lang=…     link from the email, then opens the profile
// POST   forgot    { email, lang, cf-turnstile-response }
// POST   reset     { token, password, remember? }
// PUT    addresses { addresses: [...] }
// PUT    wishlist/<piece>, DELETE wishlist/<piece>
// POST   offer     { id, amount, message?, lang }   price offer for a piece, see functions/_lib/offer-create.ts

import { WELCOME } from '../../../src/config.ts';
import { url } from '../../../src/i18n/index.ts';
import { json, type D1Database, type Env, type Handler } from '../../_lib/auth.ts';
import {
	asLang,
	asModels,
	asPhone,
	setPhone,
	setModels,
	canEmail,
	checkPassword,
	createLink,
	currentUser,
	database,
	endSession,
	endSessionCookie,
	oldSessionCookieClear,
	welcomeUsed,
	hashPassword,
	isLongSession,
	isValidPassword,
	parseAddresses,
	sendAccountMail,
	startSession,
	tooMany,
	useLink,
	clearFailures,
	dropExpiredSessions,
	isPwned,
	loginLocked,
	recordFailure,
	type User,
} from '../../_lib/accounts.ts';
import { EMAIL, isHuman } from '../../_lib/mail.ts';
import { createOffer } from '../../_lib/offer-create.ts';
import { PRODUCT_ID } from '../../_lib/product.ts';

type Body = Record<string, unknown>;
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const emailOf = (value: unknown) => text(value, 200).toLowerCase();
const fail = (error: string, status = 400) => json({ error }, status);

async function profile(db: D1Database, env: Env, user: User) {
	const [wishlist, addresses, usedWelcome, preferences, phone] = await Promise.all([
		db.prepare('SELECT product_id, saved_price FROM wishlist WHERE user_id = ? ORDER BY created_at DESC').bind(user.id).all<{ product_id: string; saved_price: number }>(),
		db.prepare('SELECT list FROM addresses WHERE user_id = ?').bind(user.id).first<{ list: string }>(),
		welcomeUsed(db, user.id),
		db.prepare('SELECT models FROM preferences WHERE user_id = ?').bind(user.id).first<{ models: string }>(),
		db.prepare('SELECT phone FROM phones WHERE user_id = ?').bind(user.id).first<{ phone: string }>(),
	]);
	return {
		email: user.email,
		name: user.name,
		phone: phone?.phone ?? '',
		lang: user.lang,
		verified: user.verified === 1,
		priceAlerts: user.price_alerts === 1,
		models: asModels(preferences?.models),
		canEmail: canEmail(env),
		wishlist: wishlist.results.map((row) => ({ id: row.product_id, savedPrice: row.saved_price })),
		addresses: addresses ? JSON.parse(addresses.list) : [],
		// The welcome code, until it has been used in a paid order.
		welcome: usedWelcome ? null : WELCOME,
	};
}

/** Current price and availability, from the list the site publishes at every build. */
async function findPiece(env: Env, request: Request, id: string) {
	const assets = env.ASSETS ?? { fetch };
	const res = await assets.fetch(new URL('/products.json', request.url));
	if (!res.ok) return null;
	const pieces = (await res.json()) as { id: string; price: number; sold: boolean }[];
	return pieces.find((piece) => piece.id === id) ?? null;
}

async function needsHuman(env: Env, request: Request, body: Body) {
	if (!env.TURNSTILE_SECRET_KEY) return false;
	const token = text(body['cf-turnstile-response'], 2048);
	return !token || !(await isHuman(env, token, request.headers.get('CF-Connecting-IP')));
}

async function sendVerification(env: Env, db: D1Database, user: Pick<User, 'id' | 'email' | 'lang'>, origin: string) {
	if (!canEmail(env)) return;
	try {
		await sendAccountMail(env, 'verify', user.email, asLang(user.lang), await createLink(db, user.id, 'verify'), origin);
	} catch (error) {
		console.error(error);
	}
}

export const onRequest: Handler = async (context) => {
	const res = await handle(context);
	// Logins used to be limited to /api/account: whenever the login changes, drop such an old cookie too.
	if (res.headers.get('Set-Cookie')?.startsWith('secondsurf_session=')) res.headers.append('Set-Cookie', oldSessionCookieClear);
	return res;
};

const handle: Handler = async ({ request, env, params, waitUntil }) => {
	if (!env.DB) return fail('unavailable', 503);
	const { origin } = new URL(request.url);
	const method = request.method;
	if (method !== 'GET' && request.headers.get('Origin') !== origin) return fail('origin', 403);
	if (Number(request.headers.get('Content-Length') ?? 0) > 20_000) return fail('invalid', 413);

	const route = (Array.isArray(params.path) ? params.path : [params.path ?? '']).filter(Boolean).join('/');
	const body: Body = method === 'GET' || method === 'HEAD' ? {} : ((await request.json().catch(() => ({}))) as Body) ?? {};
	const ip = request.headers.get('CF-Connecting-IP') ?? 'local';

	try {
		const db = await database(env);

		// ------------------------------------------------ without login

		if (route === 'register' && method === 'POST') {
			const email = emailOf(body.email);
			const name = text(body.name, 120).replace(/[\r\n]+/g, ' ');
			if (!EMAIL.test(email) || !name) return fail('invalid');
			const phone = asPhone(body.phone);
			if (!phone) return fail('phone');
			if (!isValidPassword(body.password)) return fail('weak-password');
			if ((await tooMany(db, `register:${ip}`, 5, 60)) || (await tooMany(db, `register-email:${email}`, 3, 60))) return fail('too-many', 429);
			if (await needsHuman(env, request, body)) return fail('captcha', 403);
			if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) return fail('email-taken', 409);
			if (await isPwned(env, body.password)) return fail('pwned-password');

			const lang = asLang(body.lang);
			const { meta } = await db
				.prepare('INSERT INTO users (email, password, name, lang, created_at) VALUES (?, ?, ?, ?, ?)')
				.bind(email, await hashPassword(body.password), name, lang, Math.floor(Date.now() / 1000))
				.run();
			const user = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(meta.last_row_id).first<User>())!;
			if (asModels(body.models)) await setModels(db, user.id, asModels(body.models));
			await setPhone(db, user.id, phone);
			await sendVerification(env, db, user, origin);
			return json(await profile(db, env, user), 201, { 'Set-Cookie': await startSession(db, user.id, body.remember !== false) });
		}

		if (route === 'login' && method === 'POST') {
			const email = emailOf(body.email);
			const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
			if (!email || !password) return fail('invalid');
			if (await loginLocked(db, email, ip)) return fail('too-many', 429);
			if (await needsHuman(env, request, body)) return fail('captcha', 403);
			const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
			// Hash even for unknown emails, so the answer takes as long either way. Same error for both cases.
			const check = await checkPassword(password, user?.password ?? 'pbkdf2$50000$AAAAAAAAAAAAAAAAAAAAAA==$');
			if (!user || !check.ok) {
				await recordFailure(db, `login:${email}`, `login-ip:${ip}`);
				console.warn(JSON.stringify({ event: 'login-failed', ip, known: Boolean(user) }));
				return fail('wrong-login', 401);
			}
			await clearFailures(db, `login:${email}`);
			if (check.outdated) await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(await hashPassword(password), user.id).run();
			await dropExpiredSessions(db);
			// A new random session id at every login (never reused from before the login).
			return json(await profile(db, env, user), 200, { 'Set-Cookie': await startSession(db, user.id, body.remember !== false) });
		}

		if (route === 'logout' && method === 'POST') {
			await endSession(db, request);
			return json({ ok: true }, 200, { 'Set-Cookie': endSessionCookie });
		}

		if (route === 'verify' && method === 'GET') {
			const params = new URL(request.url).searchParams;
			const userId = await useLink(db, params.get('token') ?? '', 'verify');
			if (userId) await db.prepare('UPDATE users SET verified = 1 WHERE id = ?').bind(userId).run();
			const target = `${url(asLang(params.get('lang')), '/account/')}?verified=${userId ? 1 : 0}`;
			return new Response(null, { status: 303, headers: { Location: target, 'Cache-Control': 'no-store' } });
		}

		if (route === 'forgot' && method === 'POST') {
			const email = emailOf(body.email);
			if (!EMAIL.test(email)) return fail('invalid');
			if (!canEmail(env)) return fail('unavailable', 503);
			if ((await tooMany(db, `forgot:${email}`, 3, 60)) || (await tooMany(db, `forgot-ip:${ip}`, 10, 60))) return fail('too-many', 429);
			if (await needsHuman(env, request, body)) return fail('captcha', 403);
			const user = await db.prepare('SELECT id, email, lang FROM users WHERE email = ?').bind(email).first<User>();
			// Same answer, and about the same time, whether or not the email has an account: the email goes out after the answer.
			if (user) {
				const send = (async () => {
					try {
						await sendAccountMail(env, 'reset', user.email, asLang(body.lang ?? user.lang), await createLink(db, user.id, 'reset'), origin);
					} catch (error) {
						console.error(error);
					}
				})();
				if (waitUntil) waitUntil(send);
				else await send;
			}
			return json({ ok: true });
		}

		if (route === 'reset' && method === 'POST') {
			if (!isValidPassword(body.password)) return fail('weak-password');
			if (await tooMany(db, `reset-ip:${ip}`, 10, 60)) return fail('too-many', 429);
			if (await needsHuman(env, request, body)) return fail('captcha', 403);
			if (await isPwned(env, body.password)) return fail('pwned-password');
			const userId = await useLink(db, text(body.token, 100), 'reset');
			if (!userId) return fail('link-expired', 410);
			// The link came by email, so the address is confirmed too. Every device is logged out.
			await db.batch([
				db.prepare('UPDATE users SET password = ?, verified = 1 WHERE id = ?').bind(await hashPassword(body.password), userId),
				db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
			]);
			const user = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>())!;
			return json(await profile(db, env, user), 200, { 'Set-Cookie': await startSession(db, user.id, body.remember !== false) });
		}

		// ------------------------------------------------ logged in

		const user = await currentUser(db, request);
		if (!user) return json({ error: 'login' }, 401, { 'Set-Cookie': endSessionCookie });

		if (route === 'me' && method === 'GET') return json(await profile(db, env, user));

		if (route === 'me' && method === 'PATCH') {
			const name = body.name === undefined ? user.name : text(body.name, 120).replace(/[\r\n]+/g, ' ');
			if (!name) return fail('invalid');
			const phone = body.phone === undefined ? undefined : asPhone(body.phone);
			if (phone === null) return fail('phone');
			const lang = body.lang === undefined ? user.lang : asLang(body.lang);
			const alerts = body.priceAlerts === undefined ? user.price_alerts : body.priceAlerts ? 1 : 0;
			await db.prepare('UPDATE users SET name = ?, lang = ?, price_alerts = ? WHERE id = ?').bind(name, lang, alerts, user.id).run();
			if (body.models !== undefined) await setModels(db, user.id, asModels(body.models));
			if (phone) await setPhone(db, user.id, phone);
			return json(await profile(db, env, { ...user, name, lang, price_alerts: alerts }));
		}

		if (route === 'me' && method === 'DELETE') {
			const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
			if (await loginLocked(db, user.email, ip)) return fail('too-many', 429);
			if (!(await checkPassword(password, user.password)).ok) {
				await recordFailure(db, `login:${user.email}`, `login-ip:${ip}`);
				return fail('wrong-password', 401);
			}
			await db.batch(
				['wishlist', 'addresses', 'preferences', 'phones', 'sessions', 'tokens'].map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(user.id)).concat(
					db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
				),
			);
			// Auction tables exist only once auctions were used. Bids stay (as proof of finished auctions), without a name.
			await db.prepare('DELETE FROM auction_terms WHERE user_id = ?').bind(user.id).run().catch(() => {});
			return json({ ok: true }, 200, { 'Set-Cookie': endSessionCookie });
		}

		if (route === 'password' && method === 'POST') {
			const current = typeof body.current === 'string' ? body.current.slice(0, 200) : '';
			if (!isValidPassword(body.password)) return fail('weak-password');
			if (await loginLocked(db, user.email, ip)) return fail('too-many', 429);
			if (!(await checkPassword(current, user.password)).ok) {
				await recordFailure(db, `login:${user.email}`, `login-ip:${ip}`);
				return fail('wrong-password', 401);
			}
			if (await isPwned(env, body.password)) return fail('pwned-password');
			// Log out every other device.
			await db.batch([
				db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(await hashPassword(body.password), user.id),
				db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
			]);
			return json({ ok: true }, 200, { 'Set-Cookie': await startSession(db, user.id, await isLongSession(db, request)) });
		}

		if (route === 'verify/resend' && method === 'POST') {
			if (user.verified) return json({ ok: true });
			if (!canEmail(env)) return fail('unavailable', 503);
			if (await tooMany(db, `verify:${user.id}`, 3, 60)) return fail('too-many', 429);
			await sendVerification(env, db, user, origin);
			return json({ ok: true });
		}

		if (route === 'offer' && method === 'POST') return createOffer(env, request, user, body, waitUntil);

		if (route === 'addresses' && method === 'PUT') {
			const addresses = parseAddresses(body.addresses);
			if (!addresses) return fail('invalid');
			await db.prepare('INSERT INTO addresses (user_id, list) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET list = excluded.list').bind(user.id, JSON.stringify(addresses)).run();
			return json(await profile(db, env, user));
		}

		const piece = route.match(/^wishlist\/(.+)$/)?.[1];
		if (piece && PRODUCT_ID.test(piece)) {
			if (method === 'DELETE') {
				await db.prepare('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?').bind(user.id, piece).run();
				return json({ ok: true });
			}
			if (method === 'PUT') {
				const found = await findPiece(env, request, piece);
				if (!found) return fail('not-found', 404);
				const count = await db.prepare('SELECT COUNT(*) AS n FROM wishlist WHERE user_id = ?').bind(user.id).first<{ n: number }>();
				if ((count?.n ?? 0) >= 200) return fail('too-many', 429);
				// Remembers the price at saving time; a lower price later triggers the alert.
				await db
					.prepare('INSERT INTO wishlist (user_id, product_id, saved_price, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
					.bind(user.id, piece, found.price, Math.floor(Date.now() / 1000))
					.run();
				return json({ ok: true });
			}
		}

		return fail('not-found', 404);
	} catch (error) {
		console.error(error);
		return fail('server', 500);
	}
};
