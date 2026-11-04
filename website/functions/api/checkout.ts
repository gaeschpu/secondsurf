// POST /api/checkout (form with id and lang): holds the piece and sends the customer to Stripe Checkout.
// Shipping is chosen and paid there. Payment methods (card, TWINT, Apple Pay …) are switched on in the Stripe dashboard.
// When the payment arrives, functions/api/stripe-webhook.ts marks the piece as sold.

import { database, tooMany } from '../_lib/accounts.ts';
import type { Handler } from '../_lib/auth.ts';
import { PRODUCT_ID } from '../_lib/product.ts';
import { dropNewHold, HOLD_SECONDS, holds, setHoldSession, stripe, takeHold } from '../_lib/stripe.ts';
import { CHECKOUT, SHIPPING } from '../../src/config.ts';
import { ui } from '../../src/i18n/ui.ts';

type Lang = keyof typeof ui;
type Listed = { id: string; brand: string; title: string | Record<string, string>; category: string; price: number; sold: boolean; image: string | null };

const COOKIE = 'secondsurf_checkout';

const redirect = (location: string, cookie?: string) =>
	new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });

export const onRequestPost: Handler = async ({ request, env }) => {
	const origin = new URL(request.url).origin;
	const form = await request.formData().catch(() => null);
	const id = String(form?.get('id') ?? '');
	const langValue = String(form?.get('lang') ?? 'de');
	const lang: Lang = langValue in ui ? (langValue as Lang) : 'de';
	const prefix = lang === 'de' ? '' : `/${lang}`;
	const t = (key: string) => (ui[lang] as Record<string, string>)[key] ?? (ui.de as Record<string, string>)[key];
	if (!PRODUCT_ID.test(id)) return redirect(`${origin}${prefix}/shop/`);
	const itemUrl = `${origin}${prefix}/item/${id}/`;

	if (!CHECKOUT.enabled || !env.STRIPE_SECRET_KEY) return redirect(`${itemUrl}#checkout-error`);

	// The price comes from the built site, never from the browser.
	const assets = env.ASSETS ?? { fetch };
	const list = (await assets
		.fetch(new URL('/products.json', request.url))
		.then((r) => r.json())
		.catch(() => [])) as Listed[];
	const piece = list.find((p) => p.id === id);
	if (!piece || piece.sold) return redirect(itemUrl);

	// One hold per browser, remembered in a cookie, so going back and pressing "Buy" again works.
	const owner = request.headers.get('Cookie')?.match(new RegExp(`${COOKIE}=([\\w-]{20,64})`))?.[1] ?? crypto.randomUUID();
	const cookie = `${COOKIE}=${owner}; Path=/api/checkout; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`;

	const db = await holds(env);
	if (db) {
		const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
		if (await tooMany(await database(env), `checkout:${ip}`, 20, 60)) return redirect(`${itemUrl}#checkout-error`, cookie);
		const hold = await takeHold(db, id, owner);
		if (hold.result === 'taken') return redirect(`${itemUrl}#reserved`, cookie);
		// Close this browser's earlier checkout for the piece, so only the new one can be paid.
		if (hold.previousSession) await stripe(env, `/checkout/sessions/${hold.previousSession}/expire`, {}).catch(() => {});
	}

	const title = typeof piece.title === 'string' ? piece.title : (piece.title[lang] ?? piece.title.de);
	const free = piece.price >= SHIPPING.freeFrom;
	const heavy = CHECKOUT.heavyCategories.includes(piece.category);
	const shipping = free
		? { amount: 0, name: t('checkout.shippingFree') }
		: heavy
			? { amount: SHIPPING.upTo10kg, name: t('checkout.shippingBig') }
			: { amount: SHIPPING.upTo2kg, name: t('checkout.shippingSmall') };

	try {
		const session = await stripe<{ id: string; url: string }>(env, '/checkout/sessions', {
			mode: 'payment',
			locale: lang,
			line_items: [
				{
					quantity: 1,
					price_data: {
						currency: 'chf',
						unit_amount: Math.round(piece.price * 100),
						product_data: {
							name: `${piece.brand} ${title}`,
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
			success_url: `${origin}${prefix}/thanks/`,
			cancel_url: itemUrl,
			metadata: { product_id: id },
			payment_intent_data: { metadata: { product_id: id } },
		});
		if (db) await setHoldSession(db, id, session.id);
		return redirect(session.url, cookie);
	} catch (error) {
		console.error('Checkout failed', error);
		if (db) await dropNewHold(db, id, owner).catch(() => {});
		return redirect(`${itemUrl}#checkout-error`, cookie);
	}
};
