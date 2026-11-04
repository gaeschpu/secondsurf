// POST /api/checkout (form with id and lang): holds the piece and sends the customer to Stripe Checkout at the full price.
// Shipping is chosen and paid there. Payment methods (card, TWINT, Apple Pay …) are switched on in the Stripe dashboard.
// When the payment arrives, functions/api/stripe-webhook.ts marks the piece as sold. The work is in _lib/checkout.ts.

import type { Handler } from '../_lib/auth.ts';
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
	return startCheckout({ env, request, lang, piece, price: piece.price, backUrl: itemUrl });
};
