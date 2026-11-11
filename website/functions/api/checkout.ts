// POST /api/checkout (form from the cart: one or more id fields, lang, an optional discount code): holds the pieces and sends
// the customer to Stripe Checkout with all of them in one payment. Shipping is per order (free from SHIPPING.freeFrom).
// Payment methods (card, TWINT, Apple Pay …) are switched on in the Stripe dashboard. When the payment arrives,
// functions/api/stripe-webhook.ts marks every piece as sold. The work is in _lib/checkout.ts.
//
// The welcome code (WELCOME in src/config.ts) only works for a logged-in customer who hasn't used it in a paid order yet;
// it takes the percentage off every piece. Any number of pieces (up to Stripe's 100 lines). Problems send the customer back to the cart with #code-invalid, #code-login,
// #code-used or #unavailable (a piece was sold, is an auction lot or is being auctioned meanwhile).

import { WELCOME } from '../../src/config.ts';
import { currentUser, database, normalizeCode, welcomePrice, welcomeUsed } from '../_lib/accounts.ts';
import { auctionBlocksSale } from '../_lib/auctions.ts';
import type { Handler } from '../_lib/auth.ts';
import { asLang, checkoutReady, langPrefix, loadPiece, MAX_CART, redirect, startCheckout, type CheckoutItem } from '../_lib/checkout.ts';
import { PRODUCT_ID } from '../_lib/product.ts';

export const onRequestPost: Handler = async ({ request, env }) => {
	const origin = new URL(request.url).origin;
	const form = await request.formData().catch(() => null);
	const lang = asLang(form?.get('lang'));
	const ids = [...new Set((form?.getAll('id') ?? []).map(String))].filter((id) => PRODUCT_ID.test(id)).slice(0, MAX_CART);
	const cartUrl = `${origin}${langPrefix(lang)}/cart/`;
	if (!ids.length) return redirect(cartUrl);
	if (!checkoutReady(env)) return redirect(`${cartUrl}#checkout-error`);

	const items: CheckoutItem[] = [];
	for (const id of ids) {
		const piece = await loadPiece(env, request, id);
		// Sold, an auction lot or in an auction right now: only the auction can sell it.
		if (!piece || piece.sold || piece.auctionOnly || (await auctionBlocksSale(env, id))) return redirect(`${cartUrl}#unavailable`);
		items.push({ piece, price: piece.price });
	}

	const code = normalizeCode(form?.get('code'));
	if (!code) return startCheckout({ env, request, lang, items, backUrl: cartUrl });

	if (code !== WELCOME.code) return redirect(`${cartUrl}#code-invalid`);
	const db = env.DB ? await database(env) : null;
	const user = db ? await currentUser(db, request) : null;
	if (!db || !user) return redirect(`${cartUrl}#code-login`);
	if (await welcomeUsed(db, user.id)) return redirect(`${cartUrl}#code-used`);
	return startCheckout({
		env,
		request,
		lang,
		items: items.map(({ piece }) => ({ piece, price: welcomePrice(piece.price) })),
		backUrl: cartUrl,
		// The webhook marks the code as used for this account once the payment arrives.
		metadata: { welcome_user: String(user.id), discount: WELCOME.code },
	});
};
