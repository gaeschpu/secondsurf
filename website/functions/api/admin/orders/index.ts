// GET /api/admin/orders: paid online orders, not yet shipped first. ?refs=a,b only those orders (for the label page).
// Each order has its pieces, the customer's name, shipping address, email and phone (functions/_lib/orders.ts).

import { json, type Handler } from '../../../_lib/auth.ts';
import { ordersDb, type Order } from '../../../_lib/orders.ts';
import { sellersDb } from '../../../_lib/sellers.ts';

export const onRequestGet: Handler = async ({ request, env }) => {
	const db = await ordersDb(env);
	if (!db) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	const refs = (new URL(request.url).searchParams.get('refs') ?? '').split(',').filter((r) => /^[0-9a-f]{24}$/.test(r)).slice(0, 100);
	const { results } = refs.length
		? await db
				.prepare(`SELECT * FROM orders WHERE ref IN (${refs.map(() => '?').join(',')}) AND status != 'pending'`)
				.bind(...refs)
				.all<Order>()
		: await db
				.prepare("SELECT * FROM orders WHERE status != 'pending' ORDER BY CASE status WHEN 'paid' THEN 0 ELSE 1 END, paid_at DESC LIMIT 300")
				.all<Order>();
	// Pieces that a seller ships themselves (functions/_lib/sellers.ts): marked in the list and left off the owner's label.
	const sellers = await sellersDb(env).catch(() => null);
	const bySeller = new Map<string, string[]>();
	if (sellers && results.length) {
		const { results: sales } = await sellers
			.prepare(`SELECT order_ref, product_id FROM seller_sales WHERE order_ref IN (${results.map(() => '?').join(',')})`)
			.bind(...results.map((o) => o.ref))
			.all<{ order_ref: string; product_id: string }>();
		for (const s of sales) bySeller.set(s.order_ref, [...(bySeller.get(s.order_ref) ?? []), s.product_id]);
	}
	return json({
		orders: results.map((o) => ({ ...o, ids: JSON.parse(o.ids) as string[], names: JSON.parse(o.names) as string[], seller_ids: bySeller.get(o.ref) ?? [] })),
	});
};
