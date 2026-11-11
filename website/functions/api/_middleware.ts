// Runs for every /api/* request (before the more specific middlewares such as api/admin/_middleware.ts).
// - Security headers on every API response (public/_headers only covers the static pages).
// - No CORS: no Access-Control-Allow-Origin, so other sites can't read API answers.
// - A crash never shows internals: generic 500, details only in the server log.
// - Security log: refused requests (401/403/429) as one JSON line each, for Cloudflare's logs (Workers & Pages → Logs).

import { json, type Handler } from '../_lib/auth.ts';
import { database, tooMany } from '../_lib/accounts.ts';

const HEADERS: Record<string, string> = {
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/** Called by Stripe or by GitHub Actions (no browser, no Origin header); they check what they need themselves. */
const MACHINE_ROUTES = new Set(['/api/stripe-webhook', '/api/auctions/tick', '/api/drop/notify']);
/** Checkout holds pieces for a while: at most this many checkouts per IP and hour. */
const CHECKOUT_ROUTES = new Set(['/api/checkout', '/api/offers/checkout', '/api/auctions/checkout']);

export const onRequest: Handler = async (context) => {
	const { request, env } = context;
	const url = new URL(request.url);
	const changes = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
	let res: Response;
	try {
		if (changes && !MACHINE_ROUTES.has(url.pathname)) {
			// CSRF: every change must come from a page of this site (the cookies are SameSite=Strict as well).
			if (request.headers.get('Origin') !== url.origin) {
				res = json({ error: 'origin' }, 403);
				return finish(request, res);
			}
			// A general brake per IP: 300 changes per 10 minutes, 20 checkouts per hour.
			if (env.DB) {
				const db = await database(env);
				const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
				if (
					(await tooMany(db, `api-ip:${ip}`, 300, 10)) ||
					(CHECKOUT_ROUTES.has(url.pathname) && (await tooMany(db, `checkout-ip:${ip}`, 20, 60)))
				) {
					return finish(request, json({ error: 'too-many' }, 429));
				}
			}
		}
		res = await context.next();
	} catch (error) {
		console.error(JSON.stringify({ event: 'api-error', path: new URL(request.url).pathname, error: String(error) }));
		res = json({ error: 'server' }, 500);
	}
	return finish(request, res);
};

function finish(request: Request, res: Response) {
	// Responses from fetch() (e.g. passed through) have immutable headers: copy first.
	const out = new Response(res.body, res);
	for (const [name, value] of Object.entries(HEADERS)) out.headers.set(name, value);
	out.headers.delete('Access-Control-Allow-Origin');
	if (!out.headers.has('Cache-Control')) out.headers.set('Cache-Control', 'no-store');

	if (out.status === 401 || out.status === 403 || out.status === 429) {
		const url = new URL(request.url);
		console.warn(
			JSON.stringify({
				event: 'api-refused',
				status: out.status,
				method: request.method,
				path: url.pathname,
				ip: request.headers.get('CF-Connecting-IP') ?? '',
				country: request.headers.get('CF-IPCountry') ?? '',
			}),
		);
	}
	return out;
}
