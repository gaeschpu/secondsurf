// PATCH /api/admin/orders/<ref> { shipped: true | false }: the parcel is (or isn't yet) on its way.

import { json, type Handler } from '../../../_lib/auth.ts';
import { ordersDb } from '../../../_lib/orders.ts';

export const onRequestPatch: Handler = async ({ request, env, params }) => {
	const db = await ordersDb(env);
	if (!db) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	const ref = String(params.ref);
	const body = (await request.json().catch(() => null)) as { shipped?: unknown } | null;
	if (!/^[0-9a-f]{24}$/.test(ref) || typeof body?.shipped !== 'boolean') return json({ error: 'Not found.' }, 404);
	const result = await db
		.prepare("UPDATE orders SET status = ?, shipped_at = ? WHERE ref = ? AND status IN ('paid', 'shipped')")
		.bind(body.shipped ? 'shipped' : 'paid', body.shipped ? Math.floor(Date.now() / 1000) : null, ref)
		.run();
	if (!result.meta.changes) return json({ error: 'Order not found.' }, 404);
	return json({ ok: true });
};
