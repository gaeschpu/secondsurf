// The seller's side under /api/seller/ (logged in; rules in functions/_lib/sellers.ts). Errors are short codes.
//
// GET    me                       seller status, payout details, submissions, sales (with the buyer's address to ship to)
// POST   join { acceptTerms, iban?, accountHolder? }    become a seller (accepts /seller-terms/)
// PUT    payout { iban, accountHolder }                 bank details for payouts
// POST   photos { base64 }        one photo (JPEG) for a submission → { id }
// POST   submissions { brand, title, category, size, condition, price, measurements?, description?, photos: [ids] }
// DELETE submissions/<id>         withdraw a submission that hasn't been checked yet
// POST   sales/<id>/shipped { tracking }   the seller sent the parcel; the tracking number (typed or scanned) is required
//                                  and goes to the buyer by email
// GET    label?order=<ref>        the order's address and the seller's pieces, for /admin/label.html?seller=1

import { CATEGORIES, CONDITIONS, SIZES } from '../../../src/config.ts';
import { currentUser, database, tooMany } from '../../_lib/accounts.ts';
import { json, type Handler } from '../../_lib/auth.ts';
import { addTracking, cleanTracking, orderByRef, ordersDb, trackingFor } from '../../_lib/orders.ts';
import { cleanJpeg } from '../../_lib/images.ts';
import { cleanIban, FIRST_SALES, mailOwnerSubmission, MAX_PHOTOS, nextRate, now, sellerOf, sellersDb, type Sale, type Submission } from '../../_lib/sellers.ts';

const fail = (error: string, status = 400) => json({ error }, status);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const MAX_BASE64 = 1_500_000;

export const onRequest: Handler = async ({ request, env, params, waitUntil }) => {
	const route = (Array.isArray(params.path) ? params.path : [params.path ?? '']).filter(Boolean).join('/');
	const url = new URL(request.url);
	const method = request.method;
	if (method !== 'GET' && request.headers.get('Origin') !== url.origin) return fail('origin', 403);
	if (!env.DB) return fail('unavailable', 503);
	const accounts = await database(env);
	const db = (await sellersDb(env))!;
	const user = await currentUser(accounts, request);
	if (!user) return fail('login', 401);
	const body = method === 'GET' || method === 'DELETE' ? {} : ((await request.json().catch(() => ({}))) as Record<string, any>);
	const seller = await sellerOf(db, user.id);

	if (route === 'me' && method === 'GET') {
		const [subs, sales, count] = await Promise.all([
			db.prepare('SELECT * FROM submissions WHERE user_id = ? AND status != ? ORDER BY created_at DESC LIMIT 100').bind(user.id, 'withdrawn').all<Submission>(),
			db.prepare('SELECT * FROM seller_sales WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(user.id).all<Sale>(),
			db.prepare('SELECT COUNT(*) AS n FROM seller_sales WHERE user_id = ?').bind(user.id).first<{ n: number }>(),
		]);
		// The buyer's address, only for parcels still to send; the tracking numbers of sent ones.
		const orders = await ordersDb(env);
		const refs = [...new Set(sales.results.map((s) => s.order_ref))];
		const numbers = orders ? await trackingFor(orders, refs) : [];
		// The buyer's answer per parcel: 'ok' (payout due), 'problem' (held) or 'open'.
		const checks = orders && refs.length
			? (await orders.prepare(`SELECT order_ref, status FROM parcel_checks WHERE shipper = ? AND order_ref IN (${refs.map(() => '?').join(',')})`).bind(`u${user.id}`, ...refs).all<{ order_ref: string; status: string }>()).results
			: [];
		const withAddress = await Promise.all(
			sales.results.map(async (sale) => {
				if (sale.status !== 'to_ship' || !orders) return { ...sale, buyer: null };
				const o = await orderByRef(orders, sale.order_ref);
				return { ...sale, buyer: o ? { name: o.name, line1: o.line1, line2: o.line2, postalCode: o.postal_code, city: o.city, phone: o.phone } : null };
			}),
		);
		return json({
			seller: seller ? { iban: seller.iban, accountHolder: seller.account_holder, acceptedAt: seller.accepted_at * 1000 } : null,
			nextRate: await nextRate(db, user.id),
			salesCount: count?.n ?? 0,
			firstSales: FIRST_SALES,
			submissions: subs.results.map((s) => ({ id: s.id, status: s.status, brand: s.brand, title: s.title, price: s.price, reason: s.reason, productId: s.product_id, createdAt: s.created_at * 1000 })),
			sales: withAddress.map((s) => ({
				id: s.id,
				orderRef: s.order_ref,
				productId: s.product_id,
				name: s.product_name,
				price: s.price,
				rate: s.rate,
				commission: s.commission,
				shipping: s.shipping,
				payout: s.payout,
				status: s.status,
				soldAt: s.created_at * 1000,
				shippedAt: s.shipped_at ? s.shipped_at * 1000 : null,
				paidOutAt: s.paid_out_at ? s.paid_out_at * 1000 : null,
				buyer: s.buyer,
				tracking: numbers.find((n) => n.order_ref === s.order_ref && n.shipper === `u${user.id}`)?.number ?? null,
				check: checks.find((c) => c.order_ref === s.order_ref)?.status ?? null,
			})),
		});
	}

	if (route === 'join' && method === 'POST') {
		if (body.acceptTerms !== true) return fail('terms');
		const iban = body.iban ? cleanIban(body.iban) : '';
		if (iban === null) return fail('iban');
		await db
			.prepare('INSERT INTO sellers (user_id, iban, account_holder, accepted_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO NOTHING')
			.bind(user.id, iban, text(body.accountHolder, 120) || (iban ? user.name : ''), now())
			.run();
		return json({ ok: true });
	}

	if (!seller) return fail('notSeller', 403);

	if (route === 'payout' && method === 'PUT') {
		const iban = cleanIban(body.iban);
		const holder = text(body.accountHolder, 120);
		if (!iban) return fail('iban');
		if (!holder) return fail('invalid');
		await db.prepare('UPDATE sellers SET iban = ?, account_holder = ? WHERE user_id = ?').bind(iban, holder, user.id).run();
		return json({ ok: true, iban });
	}

	if (route === 'photos' && method === 'POST') {
		// Only a well-formed JPEG, without EXIF/GPS and other metadata (functions/_lib/images.ts).
		const base64 = cleanJpeg(body.base64, MAX_BASE64);
		if (!base64) return fail('photo');
		if (await tooMany(accounts, `seller-photo:${user.id}`, 60, 60)) return fail('tooMany', 429);
		// Photos never used in a submission go away after a day.
		await db.prepare('DELETE FROM submission_photos WHERE submission_id IS NULL AND created_at < ?').bind(now() - 86400).run();
		const saved = await db.prepare('INSERT INTO submission_photos (user_id, data, created_at) VALUES (?, ?, ?)').bind(user.id, base64, now()).run();
		return json({ id: saved.meta.last_row_id });
	}

	if (route === 'submissions' && method === 'POST') {
		const sub = {
			brand: text(body.brand, 80),
			title: text(body.title, 120),
			category: text(body.category, 40),
			size: text(body.size, 20),
			condition: text(body.condition, 20),
			price: Math.round(Number(body.price) * 100) / 100,
			measurements: text(body.measurements, 200),
			description: text(body.description, 2000),
		};
		const photos = Array.isArray(body.photos) ? body.photos.map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, MAX_PHOTOS) : [];
		if (!sub.brand || !sub.title || !sub.description) return fail('invalid');
		if (!CATEGORIES.some((c) => c.id === sub.category) || !(SIZES as readonly string[]).includes(sub.size) || !(sub.condition in CONDITIONS)) return fail('invalid');
		if (!(sub.price >= 1 && sub.price <= 10000)) return fail('price');
		if (!photos.length) return fail('photos');
		if (await tooMany(accounts, `seller-submit:${user.id}`, 20, 60 * 24)) return fail('tooMany', 429);
		const t = now();
		const saved = await db
			.prepare(
				`INSERT INTO submissions (user_id, status, brand, title, category, size, condition, price, measurements, description, created_at, updated_at)
				 VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(user.id, sub.brand, sub.title, sub.category, sub.size, sub.condition, sub.price, sub.measurements, sub.description, t, t)
			.run();
		const id = saved.meta.last_row_id;
		// Attach the seller's own photos, in the order they chose.
		await db.batch(
			photos.map((photoId: number, idx: number) =>
				db.prepare('UPDATE submission_photos SET submission_id = ?, idx = ? WHERE id = ? AND user_id = ? AND submission_id IS NULL').bind(id, idx, photoId, user.id),
			),
		);
		const mail = mailOwnerSubmission(env, sub, user.email, url.origin);
		if (waitUntil) waitUntil(mail);
		else await mail;
		return json({ ok: true, id }, 201);
	}

	const withdraw = route.match(/^submissions\/(\d+)$/);
	if (withdraw && method === 'DELETE') {
		const id = Number(withdraw[1]);
		const result = await db.prepare("UPDATE submissions SET status = 'withdrawn', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'").bind(now(), id, user.id).run();
		if (!result.meta.changes) return fail('notFound', 404);
		await db.prepare('DELETE FROM submission_photos WHERE submission_id = ?').bind(id).run();
		return json({ ok: true });
	}

	const shipped = route.match(/^sales\/(\d+)\/shipped$/);
	if (shipped && method === 'POST') {
		// The tracking number is required: the buyer gets it by email (functions/_lib/orders.ts, addTracking).
		const number = cleanTracking(body.tracking);
		if (!number) return fail('tracking');
		const sale = await db.prepare("SELECT * FROM seller_sales WHERE id = ? AND user_id = ? AND status = 'to_ship'").bind(Number(shipped[1]), user.id).first<Sale>();
		if (!sale) return fail('notFound', 404);
		// Everything this seller sells in the same order goes in the same parcel.
		const { results: parcel } = await db
			.prepare("SELECT product_name FROM seller_sales WHERE order_ref = ? AND user_id = ? AND status = 'to_ship'")
			.bind(sale.order_ref, user.id)
			.all<{ product_name: string }>();
		await db.prepare("UPDATE seller_sales SET status = 'shipped', shipped_at = ? WHERE order_ref = ? AND user_id = ? AND status = 'to_ship'").bind(now(), sale.order_ref, user.id).run();
		const orders = await ordersDb(env);
		if (orders) {
			const mail = addTracking(env, orders, sale.order_ref, `u${user.id}`, number, parcel.map((p) => p.product_name), url.origin);
			if (waitUntil) waitUntil(mail);
			else await mail;
		}
		return json({ ok: true, tracking: number });
	}

	if (route === 'label' && method === 'GET') {
		const ref = url.searchParams.get('order') ?? '';
		const { results } = await db.prepare('SELECT * FROM seller_sales WHERE order_ref = ? AND user_id = ?').bind(ref, user.id).all<Sale>();
		const orders = await ordersDb(env);
		const o = results.length && orders ? await orderByRef(orders, ref) : null;
		if (!o) return fail('notFound', 404);
		// Only this seller's pieces, with the price the buyer paid for them.
		return json({
			orders: [
				{
					...o,
					email: null,
					ids: results.map((s) => s.product_id),
					names: results.map((s) => s.product_name),
					amount: results.reduce((sum, s) => sum + s.price, 0),
					discount: null,
				},
			],
		});
	}

	return fail('notFound', 404);
};
