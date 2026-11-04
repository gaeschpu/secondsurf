// GET /api/offers/view?t=<token>: the customer's own offer, for the /offer/ page. Only what they already know.

import { json, type Handler } from '../../_lib/auth.ts';
import { checkoutReady, loadPiece } from '../../_lib/checkout.ts';
import { agreedPrice, byToken, offersDb, payableUntil } from '../../_lib/offers.ts';

export const onRequestGet: Handler = async ({ request, env }) => {
	const db = await offersDb(env);
	if (!db) return json({ error: 'unavailable' }, 503);
	const offer = await byToken(db, new URL(request.url).searchParams.get('t') ?? '');
	if (!offer) return json({ error: 'notFound' }, 404);

	const piece = await loadPiece(env, request, offer.product_id);
	const sold = !piece || piece.sold;
	const price = agreedPrice(offer);
	const expired = price !== null && Date.now() / 1000 > payableUntil(offer);
	return json({
		status: offer.status,
		productId: offer.product_id,
		productName: offer.product_name,
		listPrice: offer.list_price,
		amount: offer.amount,
		counter: offer.counter,
		agreed: price,
		sold: sold && offer.status !== 'paid',
		expired,
		canPay: price !== null && !sold && !expired && checkoutReady(env),
	});
};
