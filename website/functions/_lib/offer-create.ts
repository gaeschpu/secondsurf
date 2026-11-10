// A logged-in customer proposes a price for a piece (at most 35 % below the price).
// Called from POST /api/account/offer, so name and email come from the customer's account.
// Stores the offer, emails the owner and confirms to the customer with a link to follow it.

import { database, tooMany, type User } from './accounts.ts';
import { auctionBlocksSale } from './auctions.ts';
import { json, type Env } from './auth.ts';
import { asLang, checkoutReady, loadPiece, titleIn } from './checkout.ts';
import { mailCustomer, mailOwner, minimumOffer, newToken, now, offersDb, type Offer } from './offers.ts';
import { PRODUCT_ID } from './product.ts';

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export async function createOffer(
	env: Env,
	request: Request,
	user: User,
	body: Record<string, unknown>,
	waitUntil?: (promise: Promise<unknown>) => void,
) {
	const origin = new URL(request.url).origin;
	if (!env.RESEND_API_KEY) return json({ error: 'unavailable' }, 503);
	const db = await offersDb(env);
	if (!db) return json({ error: 'unavailable' }, 503);

	const id = clean(body.id, 120);
	const lang = asLang(body.lang);
	const message = clean(body.message, 1000);
	const amount = Math.round(Number(body.amount) * 100) / 100;
	if (!PRODUCT_ID.test(id) || !Number.isFinite(amount)) return json({ error: 'invalid' }, 400);

	const piece = await loadPiece(env, request, id);
	if (!piece || piece.sold) return json({ error: 'sold' }, 409);
	if (piece.auctionOnly || (await auctionBlocksSale(env, id))) return json({ error: 'auction' }, 409);
	if (amount < minimumOffer(piece.price)) return json({ error: 'tooLow', minimum: minimumOffer(piece.price) }, 400);
	if (amount >= piece.price) return json({ error: 'notLower' }, 400);
	if (await tooMany(await database(env), `offer:${user.id}`, 10, 60)) return json({ error: 'tooMany' }, 429);

	const name = user.name;
	const email = user.email;
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
}
