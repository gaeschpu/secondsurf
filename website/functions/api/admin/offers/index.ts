// GET /api/admin/offers: price offers for the dashboard, open ones first.

import { json, type Handler } from '../../../_lib/auth.ts';
import { checkoutReady } from '../../../_lib/checkout.ts';
import { offersDb, type Offer } from '../../../_lib/offers.ts';

export const onRequestGet: Handler = async ({ env }) => {
	const db = await offersDb(env);
	if (!db) return json({ error: 'The D1 database (binding DB) is missing, so offers can’t be stored.' }, 503);
	const { results } = await db
		.prepare(
			`SELECT id, product_id, product_name, list_price, amount, counter, status, name, email, message, created_at, updated_at FROM offers
			 ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'agreed' THEN 1 WHEN 'countered' THEN 2 WHEN 'accepted' THEN 3 ELSE 4 END, created_at DESC
			 LIMIT 200`,
		)
		.all<Omit<Offer, 'token' | 'lang'>>();
	return json({ offers: results, canPay: checkoutReady(env) });
};
