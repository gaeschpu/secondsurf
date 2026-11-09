// Shared by /api/checkout (full price) and /api/offers/checkout (an agreed offer price):
// holds the piece for this browser and sends the customer to Stripe Checkout.

import { database, tooMany } from './accounts.ts';
import type { Env } from './auth.ts';
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

/**
 * Holds the piece and redirects to Stripe. `backUrl` is where errors and "reserved" send the customer back to
 * (with #checkout-error or #reserved appended); `metadata` is copied onto the session for the webhook.
 */
export async function startCheckout(opts: {
	env: Env;
	request: Request;
	lang: Lang;
	piece: Listed;
	price: number;
	backUrl: string;
	metadata?: Record<string, string>;
}) {
	const { env, request, lang, piece, price, backUrl } = opts;
	const origin = new URL(request.url).origin;
	const id = piece.id;

	// One hold per browser, remembered in a cookie, so going back and pressing "Buy" again works.
	const owner = request.headers.get('Cookie')?.match(new RegExp(`${COOKIE}=([\\w-]{20,64})`))?.[1] ?? crypto.randomUUID();
	const cookie = `${COOKIE}=${owner}; Path=/api; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`;

	const db = await holds(env);
	if (db) {
		const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
		if (await tooMany(await database(env), `checkout:${ip}`, 20, 60)) return redirect(`${backUrl}#checkout-error`, cookie);
		const hold = await takeHold(db, id, owner);
		if (hold.result === 'taken') return redirect(`${backUrl}#reserved`, cookie);
		// Close this browser's earlier checkout for the piece, so only the new one can be paid.
		if (hold.previousSession) await stripe(env, `/checkout/sessions/${hold.previousSession}/expire`, {}).catch(() => {});
	}

	const shipping =
		price >= SHIPPING.freeFrom
			? { amount: 0, name: text(lang, 'checkout.shippingFree') }
			: { amount: SHIPPING.price, name: text(lang, 'checkout.shippingPost') };
	// lang and product_name are for the customer's order confirmation (functions/api/stripe-webhook.ts).
	const metadata = { product_id: id, lang, product_name: `${piece.brand} ${titleIn(piece, lang)}`.slice(0, 450), ...opts.metadata };

	try {
		const session = await stripe<{ id: string; url: string }>(env, '/checkout/sessions', {
			mode: 'payment',
			locale: lang,
			line_items: [
				{
					quantity: 1,
					price_data: {
						currency: 'chf',
						unit_amount: Math.round(price * 100),
						product_data: {
							name: `${piece.brand} ${titleIn(piece, lang)}`,
							...(piece.image ? { images: [new URL(piece.image, origin).href] } : {}),
							metadata: { product_id: id },
						},
					},
				},
			],
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
			success_url: `${origin}${langPrefix(lang)}/thanks/`,
			cancel_url: backUrl,
			metadata,
			payment_intent_data: { metadata },
		});
		if (db) await setHoldSession(db, id, session.id);
		return redirect(session.url, cookie);
	} catch (error) {
		console.error('Checkout failed', error);
		if (db) await dropNewHold(db, id, owner).catch(() => {});
		return redirect(`${backUrl}#checkout-error`, cookie);
	}
}
