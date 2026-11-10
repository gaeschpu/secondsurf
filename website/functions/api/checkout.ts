// POST /api/checkout (form with id, lang and an optional discount code): holds the piece and sends the customer to
// Stripe Checkout. Shipping is chosen and paid there. Payment methods (card, TWINT, Apple Pay …) are switched on in the
// Stripe dashboard. When the payment arrives, functions/api/stripe-webhook.ts marks the piece as sold. The work is in _lib/checkout.ts.
//
// The welcome code (WELCOME in src/config.ts) only works for a logged-in customer who hasn't used it in a paid order yet.
// Problems with the code send the customer back to the piece with #code-invalid, #code-login or #code-used.

import { WELCOME } from '../../src/config.ts';
import { currentUser, database, normalizeCode, welcomePrice, welcomeUsed } from '../_lib/accounts.ts';
import type { Handler } from '../_lib/auth.ts';
import { auctionBlocksSale } from '../_lib/auctions.ts';
import { asLang, checkoutReady, langPrefix, loadPiece, redirect, startCheckout } from '../_lib/checkout.ts';
import { PRODUCT_ID } from '../_lib/product.ts';

export const onRequestPost: Handler = async ({ request, env }) => {
	const origin = new URL(request.url).origin;
	const form = await request.formData().catch(() => null);
	const id = String(form?.get('id') ?? '');
	const lang = asLang(form?.get('lang'));
	if (!PRODUCT_ID.test(id)) return redirect(`${origin}${langPrefix(lang)}/shop/`);
	const itemUrl = `${origin}${langPrefix(lang)}/item/${id}/`;

	if (!checkoutReady(env)) return redirect(`${itemUrl}#checkout-error`);
	const piece = await loadPiece(env, request, id);
	if (!piece || piece.sold) return redirect(itemUrl);
	// Being auctioned (or waiting for the winner's payment): only the auction can sell it.
	if (await auctionBlocksSale(env, id)) return redirect(itemUrl);

	const code = normalizeCode(form?.get('code'));
	if (!code) return startCheckout({ env, request, lang, piece, price: piece.price, backUrl: itemUrl });

	if (code !== WELCOME.code) return redirect(`${itemUrl}#code-invalid`);
	const db = env.DB ? await database(env) : null;
	const user = db ? await currentUser(db, request) : null;
	if (!db || !user) return redirect(`${itemUrl}#code-login`);
	if (await welcomeUsed(db, user.id)) return redirect(`${itemUrl}#code-used`);
	return startCheckout({
		env,
		request,
		lang,
		piece,
		price: welcomePrice(piece.price),
		backUrl: itemUrl,
		// The webhook marks the code as used for this account once the payment arrives.
		metadata: { welcome_user: String(user.id), discount: WELCOME.code },
	});
};
