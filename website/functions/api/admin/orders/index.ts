// GET /api/admin/orders: paid online orders, not yet shipped first. ?refs=a,b only those orders (for the label page).
// Each order has its pieces, the customer's name, shipping address, email and phone (functions/_lib/orders.ts).

import { json, type Handler } from '../../../_lib/auth.ts';
import { ordersDb, type Order } from '../../../_lib/orders.ts';

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
	return json({
		orders: results.map((o) => ({ ...o, ids: JSON.parse(o.ids) as string[], names: JSON.parse(o.names) as string[] })),
	});
};
