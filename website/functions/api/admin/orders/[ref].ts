// PATCH /api/admin/orders/<ref> { shipped: true, tracking } | { shipped: false }: the shop's parcel is on its way (or isn't yet).
// The tracking number (typed or scanned) is required when shipping; the buyer gets it by email (addTracking), for the
// pieces the shop ships itself (pieces from sellers have their own parcel and number).

import { json, type Handler } from '../../../_lib/auth.ts';
import { addTracking, cleanTracking, orderByRef, ordersDb } from '../../../_lib/orders.ts';
import { sellersDb } from '../../../_lib/sellers.ts';

export const onRequestPatch: Handler = async ({ request, env, params, waitUntil }) => {
	const db = await ordersDb(env);
	if (!db) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	const ref = String(params.ref);
	const body = (await request.json().catch(() => null)) as { shipped?: unknown; tracking?: unknown } | null;
	if (!/^[0-9a-f]{24}$/.test(ref) || typeof body?.shipped !== 'boolean') return json({ error: 'Not found.' }, 404);
	const order = await orderByRef(db, ref);
	if (!order || order.status === 'pending') return json({ error: 'Order not found.' }, 404);

	if (!body.shipped) {
		await db.prepare("UPDATE orders SET status = 'paid', shipped_at = NULL WHERE ref = ?").bind(ref).run();
		return json({ ok: true });
	}

	const number = cleanTracking(body.tracking);
	if (!number) return json({ error: 'Enter the Swiss Post tracking number (18 digits, e.g. 99.60.123456.12345678) or scan it.' }, 400);
	await db.prepare("UPDATE orders SET status = 'shipped', shipped_at = ? WHERE ref = ?").bind(Math.floor(Date.now() / 1000), ref).run();

	// Only the pieces the shop ships go into this parcel.
	const sellers = await sellersDb(env).catch(() => null);
	const bySeller = sellers
		? (await sellers.prepare('SELECT product_id FROM seller_sales WHERE order_ref = ?').bind(ref).all<{ product_id: string }>()).results.map((r) => r.product_id)
		: [];
	const ids: string[] = JSON.parse(order.ids);
	const names: string[] = JSON.parse(order.names);
	const pieces = ids.flatMap((id, i) => (bySeller.includes(id) ? [] : [names[i] ?? id]));
	const mail = addTracking(env, db, ref, 'shop', number, pieces, new URL(request.url).origin);
	if (waitUntil) waitUntil(mail);
	else await mail;
	return json({ ok: true, tracking: number });
};
