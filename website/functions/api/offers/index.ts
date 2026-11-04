// POST /api/offers: a customer proposes a price for a piece (at most 35 % below the price).
// Checks for bots, stores the offer, emails the owner and confirms to the customer with a link to follow it.

import { database, tooMany } from '../../_lib/accounts.ts';
import { json, type Handler } from '../../_lib/auth.ts';
import { asLang, loadPiece, titleIn } from '../../_lib/checkout.ts';
import { EMAIL, isHuman } from '../../_lib/mail.ts';
import { mailCustomer, mailOwner, minimumOffer, newToken, now, offersDb, type Offer } from '../../_lib/offers.ts';
import { PRODUCT_ID } from '../../_lib/product.ts';
import { checkoutReady } from '../../_lib/checkout.ts';

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export const onRequestPost: Handler = async ({ request, env, waitUntil }) => {
	const origin = new URL(request.url).origin;
	if (request.headers.get('Origin') !== origin) return json({ error: 'origin' }, 403);
	if (!env.RESEND_API_KEY || !env.TURNSTILE_SECRET_KEY) return json({ error: 'unavailable' }, 503);
	const db = await offersDb(env);
	if (!db) return json({ error: 'unavailable' }, 503);

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return json({ error: 'invalid' }, 400);
	if (body.botcheck) return json({ ok: true });

	const id = clean(body.id, 120);
	const lang = asLang(body.lang);
	const name = clean(body.name, 120).replace(/[\r\n]+/g, ' ');
	const email = clean(body.email, 200);
	const message = clean(body.message, 1000);
	const amount = Math.round(Number(body.amount) * 100) / 100;
	if (!PRODUCT_ID.test(id) || !name || !EMAIL.test(email) || !Number.isFinite(amount)) return json({ error: 'invalid' }, 400);

	const piece = await loadPiece(env, request, id);
	if (!piece || piece.sold) return json({ error: 'sold' }, 409);
	if (amount < minimumOffer(piece.price)) return json({ error: 'tooLow', minimum: minimumOffer(piece.price) }, 400);
	if (amount >= piece.price) return json({ error: 'notLower' }, 400);

	const token = clean(body['cf-turnstile-response'], 2048);
	if (!token || !(await isHuman(env, token, request.headers.get('CF-Connecting-IP')))) return json({ error: 'captcha' }, 400);
	const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
	if (await tooMany(await database(env), `offer:${ip}`, 10, 60)) return json({ error: 'tooMany' }, 429);

	// One open offer per person and piece: a new one replaces the old.
	await db
		.prepare("DELETE FROM offers WHERE product_id = ? AND lower(email) = lower(?) AND status IN ('pending', 'countered')")
		.bind(id, email)
		.run();
	const offer: Offer = {
		id: 0,
		token: newToken(),
		product_id: id,
		product_name: `${piece.brand} ${titleIn(piece, lang)}`,
		list_price: piece.price,
		amount,
		counter: null,
		status: 'pending',
		name,
		email,
		message,
		lang,
		created_at: now(),
		updated_at: now(),
	};
	const saved = await db
		.prepare(
			'INSERT INTO offers (token, product_id, product_name, list_price, amount, status, name, email, message, lang, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
		)
		.bind(offer.token, id, offer.product_name, piece.price, amount, 'pending', name, email, message, lang, offer.created_at, offer.updated_at)
		.run();
	offer.id = saved.meta.last_row_id;

	const mails = Promise.all([
		mailOwner(env, offer, origin, 'new'),
		mailCustomer(env, 'received', offer, origin, checkoutReady(env)),
	]).catch((error) => console.error('Offer emails failed', error));
	if (waitUntil) waitUntil(mails);
	else await mails;
	return json({ ok: true, link: `/offer/?t=${offer.token}` });
};
