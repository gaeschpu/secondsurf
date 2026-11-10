// POST /api/offers/checkout (form with t): pays an agreed offer price with Stripe Checkout.
// The webhook marks the piece as sold and the offer as paid (metadata offer_id).

import { auctionBlocksSale } from '../../_lib/auctions.ts';
import type { Handler } from '../../_lib/auth.ts';
import { checkoutReady, langPrefix, loadPiece, redirect, startCheckout } from '../../_lib/checkout.ts';
import { agreedPrice, byToken, offerLink, offersDb, payableUntil } from '../../_lib/offers.ts';

export const onRequestPost: Handler = async ({ request, env }) => {
	const origin = new URL(request.url).origin;
	const form = await request.formData().catch(() => null);
	const db = await offersDb(env);
	const offer = db ? await byToken(db, String(form?.get('t') ?? '')) : null;
	if (!offer) return redirect(`${origin}/shop/`);
	const back = offerLink(origin, offer);

	const price = agreedPrice(offer);
	if (price === null || Date.now() / 1000 > payableUntil(offer) || !checkoutReady(env)) return redirect(`${back}#checkout-error`);
	const piece = await loadPiece(env, request, offer.product_id);
	if (!piece || piece.sold || piece.auctionOnly || (await auctionBlocksSale(env, offer.product_id))) return redirect(`${origin}${langPrefix(offer.lang)}/item/${offer.product_id}/`);

	return startCheckout({ env, request, lang: offer.lang, piece, price, backUrl: back, metadata: { offer_id: String(offer.id) } });
};
