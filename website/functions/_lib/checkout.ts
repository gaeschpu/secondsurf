// Shared by /api/checkout (the cart: one or more pieces at their price), /api/offers/checkout (an agreed offer price) and
// /api/auctions/checkout (an auction price): holds the pieces for this browser and sends the customer to Stripe Checkout.

import { database, tooMany } from './accounts.ts';
import type { Env } from './auth.ts';
import { createOrder, ordersDb } from './orders.ts';
import { dropNewHold, HOLD_SECONDS, holds, setHoldSession, stripe, takeHold } from './stripe.ts';
import { CHECKOUT, SHIPPING } from '../../src/config.ts';
import { ui } from '../../src/i18n/ui.ts';

export type Lang = keyof typeof ui;
export type Listed = {
	id: string;
	brand: string;
	title: string | Record<string, string>;
	category: string;
	price: number;
	sold: boolean;
	/** Auction lot: only the auction can sell it. */
	auctionOnly?: boolean;
	image: string | null;
};

const COOKIE = 'secondsurf_checkout';

export const asLang = (value: unknown): Lang => (typeof value === 'string' && value in ui ? (value as Lang) : 'de');
export const langPrefix = (lang: Lang) => (lang === 'de' ? '' : `/${lang}`);
export const text = (lang: Lang, key: string) => (ui[lang] as Record<string, string>)[key] ?? (ui.de as Record<string, string>)[key];
export const titleIn = (piece: Listed, lang: Lang) => (typeof piece.title === 'string' ? piece.title : (piece.title[lang] ?? piece.title.de));

export const redirect = (location: string, cookie?: string) =>
	new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });

/** The piece as published on the built site: prices never come from the browser. */
export async function loadPiece(env: Env, request: Request, id: string) {
	const assets = env.ASSETS ?? { fetch };
	const list = (await assets
		.fetch(new URL('/products.json', request.url))
		.then((r) => r.json())
		.catch(() => [])) as Listed[];
	return list.find((p) => p.id === id) ?? null;
}

export const checkoutReady = (env: Env) => CHECKOUT.enabled && Boolean(env.STRIPE_SECRET_KEY);

/** One piece in a checkout and the price it is sold for. */
export type CheckoutItem = { piece: Listed; price: number };

/** No real limit for customers: Stripe takes at most 100 lines per checkout. The piece ids are kept in the order (D1). */
export const MAX_CART = 100;

/**
 * Holds every piece and redirects to Stripe. `backUrl` is where errors and "reserved" send the customer back to
 * (with #checkout-error or #reserved appended); `metadata` is copied onto the session for the webhook.
 * Pass `items` for several pieces, or `piece` and `price` for one.
 */
export async function startCheckout(opts: {
	env: Env;
	request: Request;
	lang: Lang;
	items?: CheckoutItem[];
	piece?: Listed;
	price?: number;
	backUrl: string;
	metadata?: Record<string, string>;
}) {
	const { env, request, lang, backUrl } = opts;
	const origin = new URL(request.url).origin;
	const items = opts.items ?? [{ piece: opts.piece!, price: opts.price! }];
	const ids = items.map((item) => item.piece.id);

	// One hold per browser, remembered in a cookie, so going back and pressing "Buy" again works.
	const owner = request.headers.get('Cookie')?.match(new RegExp(`${COOKIE}=([\\w-]{20,64})`))?.[1] ?? crypto.randomUUID();
	const cookie = `${COOKIE}=${owner}; Path=/api; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`;

	const db = await holds(env);
	if (db) {
		const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
		if (await tooMany(await database(env), `checkout:${ip}`, 20, 60)) return redirect(`${backUrl}#checkout-error`, cookie);
		// All or nothing: if someone else is paying for one of the pieces, release the ones held just now.
		const held: string[] = [];
		for (const id of ids) {
			const hold = await takeHold(db, id, owner);
			if (hold.result === 'taken') {
				for (const done of held) await dropNewHold(db, done, owner).catch(() => {});
				return redirect(`${backUrl}#reserved`, cookie);
			}
			held.push(id);
			// Close this browser's earlier checkout for the piece, so only the new one can be paid.
			if (hold.previousSession) await stripe(env, `/checkout/sessions/${hold.previousSession}/expire`, {}).catch(() => {});
		}
	}

	const total = items.reduce((sum, item) => sum + item.price, 0);
	const shipping =
		total >= SHIPPING.freeFrom
			? { amount: 0, name: text(lang, 'checkout.shippingFree') }
			: { amount: SHIPPING.price, name: text(lang, 'checkout.shippingPost') };
	// lang and product_name are for the customer's order confirmation; product_ids for the webhook (functions/api/stripe-webhook.ts).
	const names = items.map(({ piece }) => `${piece.brand} ${titleIn(piece, lang)}`);
	// The order keeps all piece ids (any number); Stripe's metadata (500 characters per value) gets the reference,
	// plus the ids themselves when they fit, for the webhook to fall back on.
	const orders = await ordersDb(env).catch(() => null);
	const orderRef = orders ? await createOrder(orders, ids, names, lang).catch((error) => (console.error('Saving the order failed', error), null)) : null;
	const idList = ids.join(',');
	const metadata = {
		product_id: ids[0],
		...(idList.length <= 490 ? { product_ids: idList } : {}),
		...(orderRef ? { order_ref: orderRef } : {}),
		lang,
		product_name: names.join(' + ').slice(0, 450),
		...opts.metadata,
	};

	try {
		const session = await stripe<{ id: string; url: string }>(env, '/checkout/sessions', {
			mode: 'payment',
			locale: lang,
			line_items: items.map(({ piece, price }, i) => ({
				quantity: 1,
				price_data: {
					currency: 'chf',
					unit_amount: Math.round(price * 100),
					product_data: {
						name: names[i],
						...(piece.image ? { images: [new URL(piece.image, origin).href] } : {}),
						metadata: { product_id: piece.id },
					},
				},
			})),
			shipping_address_collection: { allowed_countries: ['CH', 'LI'] },
			shipping_options: [
				{
					shipping_rate_data: {
						type: 'fixed_amount',
						display_name: shipping.name,
						fixed_amount: { amount: Math.round(shipping.amount * 100), currency: 'chf' },
						delivery_estimate: { minimum: { unit: 'business_day', value: 1 }, maximum: { unit: 'business_day', value: 4 } },
					},
				},
			],
			phone_number_collection: { enabled: true },
			expires_at: Math.floor(Date.now() / 1000) + HOLD_SECONDS,
			success_url: `${origin}${langPrefix(lang)}/thanks/?order=1`,
			cancel_url: backUrl,
			metadata,
			payment_intent_data: { metadata },
		});
		if (db) for (const id of ids) await setHoldSession(db, id, session.id);
		return redirect(session.url, cookie);
	} catch (error) {
		console.error('Checkout failed', error);
		if (db) for (const id of ids) await dropNewHold(db, id, owner).catch(() => {});
		return redirect(`${backUrl}#checkout-error`, cookie);
	}
}
