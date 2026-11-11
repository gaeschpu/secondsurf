// The buyer's check of a parcel: /parcel/?t=<token> (link in "Dein Paket ist unterwegs", functions/_lib/orders.ts).
// GET  /api/parcel?t=<token>                         what is in the parcel, the tracking number, the current answer
// POST /api/parcel { t, action: 'ok' | 'problem', note? }
// 'ok' makes a seller's payout due at once; 'problem' holds it and emails the owner. The buyer can change the answer
// until the seller has been paid out.

import { json, type Handler } from '../_lib/auth.ts';
import { sendMail } from '../_lib/mail.ts';
import { formatTracking, orderByRef, ordersDb } from '../_lib/orders.ts';
import { sellersDb } from '../_lib/sellers.ts';
import { SITE } from '../../src/config.ts';

type Check = { token: string; order_ref: string; shipper: string; status: string; note: string };

async function load(env: Parameters<Handler>[0]['env'], token: string) {
	const db = await ordersDb(env);
	if (!db || !/^[0-9a-f]{48}$/.test(token)) return null;
	const check = await db.prepare('SELECT * FROM parcel_checks WHERE token = ?').bind(token).first<Check>();
	if (!check) return null;
	const order = await orderByRef(db, check.order_ref);
	if (!order) return null;
	const number = await db.prepare('SELECT number FROM tracking WHERE order_ref = ? AND shipper = ?').bind(check.order_ref, check.shipper).first<{ number: string }>();
	// What is in this parcel: a seller's own pieces, or the rest of the order for the shop's parcel.
	const sellers = await sellersDb(env);
	const sales = sellers
		? (await sellers.prepare('SELECT product_id, product_name, user_id, status FROM seller_sales WHERE order_ref = ?').bind(check.order_ref).all<{ product_id: string; product_name: string; user_id: number; status: string }>()).results
		: [];
	const ids: string[] = JSON.parse(order.ids);
	const names: string[] = JSON.parse(order.names);
	const pieces =
		check.shipper === 'shop'
			? ids.flatMap((id, i) => (sales.some((s) => s.product_id === id) ? [] : [names[i] ?? id]))
			: sales.filter((s) => `u${s.user_id}` === check.shipper).map((s) => s.product_name);
	const paidOut = sales.some((s) => `u${s.user_id}` === check.shipper && s.status === 'paid_out');
	return { db, check, order, number: number?.number ?? null, pieces, paidOut };
}

export const onRequestGet: Handler = async ({ request, env }) => {
	const data = await load(env, new URL(request.url).searchParams.get('t') ?? '');
	if (!data) return json({ error: 'notFound' }, 404);
	return json({
		status: data.check.status,
		note: data.check.note,
		pieces: data.pieces,
		number: data.number ? formatTracking(data.number) : null,
		rawNumber: data.number,
		locked: data.paidOut,
	});
};

export const onRequestPost: Handler = async ({ request, env, waitUntil }) => {
	const url = new URL(request.url);
	if (request.headers.get('Origin') !== url.origin) return json({ error: 'origin' }, 403);
	const body = (await request.json().catch(() => ({}))) as { t?: unknown; action?: unknown; note?: unknown };
	const data = await load(env, typeof body.t === 'string' ? body.t : '');
	if (!data) return json({ error: 'notFound' }, 404);
	if (data.paidOut) return json({ error: 'locked' }, 409);
	const action = body.action === 'ok' ? 'ok' : body.action === 'problem' ? 'problem' : null;
	const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
	if (!action || (action === 'problem' && !note)) return json({ error: 'invalid' }, 400);
	await data.db.prepare('UPDATE parcel_checks SET status = ?, note = ?, updated_at = ? WHERE token = ?').bind(action, action === 'problem' ? note : '', Math.floor(Date.now() / 1000), data.check.token).run();

	if (action === 'problem' && env.RESEND_API_KEY) {
		const o = data.order;
		const mail = sendMail(env, {
			to: SITE.email,
			...(o.email ? { reply_to: o.email } : {}),
			subject: `Problem mit einer Lieferung: ${data.pieces.join(', ')}`,
			text: [
				`${o.name ?? 'Eine Kundin / ein Kunde'} meldet ein Problem mit einem Paket${data.check.shipper === 'shop' ? ' von dir' : ' einer Verkäuferin / eines Verkäufers (Auszahlung angehalten)'}.`,
				'',
				`Pieces: ${data.pieces.join(', ')}`,
				`Sendungsnummer: ${data.number ? formatTracking(data.number) : '–'}`,
				'',
				'Nachricht:',
				note,
				'',
				`E-Mail: ${o.email ?? '–'} · Telefon: ${o.phone ?? '–'}`,
				`Dashboard: ${url.origin}/admin/#submissions`,
			].join('\n'),
		}).catch((error) => console.error('Problem email failed', error));
		if (waitUntil) waitUntil(mail);
		else await mail;
	}
	return json({ ok: true, status: action });
};
