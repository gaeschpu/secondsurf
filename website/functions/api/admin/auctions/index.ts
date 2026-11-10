// GET  /api/admin/auctions: all auctions for the dashboard (running, waiting for payment, paid, ended).
// POST /api/admin/auctions { productId, startPrice, endsAt }: turns a piece into an auction. endsAt in milliseconds.
// While it runs (and until the winner has paid), the piece can't be bought or offered for.

import { database } from '../../../_lib/accounts.ts';
import { json, type Handler } from '../../../_lib/auth.ts';
import { auctionsDb, now, settleAll, type Auction } from '../../../_lib/auctions.ts';
import { loadPiece, titleIn } from '../../../_lib/checkout.ts';
import { PRODUCT_ID } from '../../../_lib/product.ts';

const MAX_DAYS = 30;

export const onRequestGet: Handler = async ({ request, env, waitUntil }) => {
	if (!env.DB) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	await database(env);
	const db = (await auctionsDb(env))!;
	// Bring every auction up to date first, so the list shows the real state.
	await settleAll(env, new URL(request.url).origin, (p) => (waitUntil ? waitUntil(p) : void p));
	const { results } = await db
		.prepare(
			`SELECT a.id, a.product_id, a.product_name, a.start_price, a.price, a.bids, a.ends_at, a.status, a.buyer_price, a.pay_until, a.round, a.created_at,
			        l.email AS leader_email, b.email AS buyer_email
			 FROM auctions a LEFT JOIN users l ON l.id = a.leader_id LEFT JOIN users b ON b.id = a.buyer_id
			 ORDER BY CASE a.status WHEN 'running' THEN 0 WHEN 'payment' THEN 1 WHEN 'paid' THEN 2 ELSE 3 END, a.ends_at DESC
			 LIMIT 200`,
		)
		.all<Auction & { leader_email: string | null; buyer_email: string | null }>();
	return json({ auctions: results, now: Date.now() });
};

export const onRequestPost: Handler = async ({ request, env }) => {
	if (!env.DB) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	await database(env);
	const db = (await auctionsDb(env))!;
	const body = (await request.json().catch(() => null)) as { productId?: unknown; startPrice?: unknown; endsAt?: unknown } | null;
	const id = typeof body?.productId === 'string' ? body.productId : '';
	const startPrice = Math.round(Number(body?.startPrice));
	const endsAt = Math.floor(Number(body?.endsAt) / 1000);
	if (!PRODUCT_ID.test(id)) return json({ error: 'Choose a piece.' }, 400);
	if (!(startPrice >= 1)) return json({ error: 'Enter a start price of at least CHF 1.' }, 400);
	if (!(endsAt > now() + 10 * 60) || endsAt > now() + MAX_DAYS * 86400) return json({ error: `Choose an end between 10 minutes and ${MAX_DAYS} days from now.` }, 400);

	const piece = await loadPiece(env, request, id);
	if (!piece) return json({ error: 'This piece isn’t on the site (yet). Wait until it has been published.' }, 404);
	if (piece.sold) return json({ error: 'This piece is sold.' }, 409);

	const names = Object.fromEntries((['de', 'fr', 'it', 'en'] as const).map((lang) => [lang, `${piece.brand} ${titleIn(piece, lang)}`]));
	const t = now();
	try {
		await db
			.prepare(
				`INSERT INTO auctions (product_id, product_name, names, start_price, price, ends_at, status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
			)
			.bind(id, names.de, JSON.stringify(names), startPrice, startPrice, endsAt, t, t)
			.run();
	} catch {
		// The unique index: this piece already has a running auction or one waiting for payment.
		return json({ error: 'This piece already has an auction.' }, 409);
	}
	return json({ ok: true });
};
