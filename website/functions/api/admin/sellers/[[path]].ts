// The owner's side of selling through secondsurf (rules in functions/_lib/sellers.ts), under /api/admin/sellers/.
//
// GET  submissions                         submitted pieces, the ones to check first, with the seller and photo ids
// GET  photo?id=<photo id>                 one submitted photo
// POST submissions/<id>/approve { brand, title, category, size, condition, price, measurements, description }
//                                          the (possibly edited) piece goes into the shop with the seller's photos
// POST submissions/<id>/reject { reason }
// GET  payouts                             seller sales: to ship, shipped (due date), paid out; with IBAN
// POST payouts/<id>/paid                   the money was transferred

import { SITE } from '../../../../src/config.ts';
import { database } from '../../../_lib/accounts.ts';
import { json, type Handler } from '../../../_lib/auth.ts';
import { commit, createBlob, listDir, PRODUCTS_DIR } from '../../../_lib/github.ts';
import { folderName, nextNumber, parseNewProduct, toMarkdown } from '../../../_lib/product.ts';
import { mailSeller, now, PAYOUT_DAYS, sellersDb, type Sale, type Submission } from '../../../_lib/sellers.ts';

const chf = (n: number) => `CHF ${n.toFixed(2)}`;

export const onRequest: Handler = async ({ request, env, params }) => {
	const route = (Array.isArray(params.path) ? params.path : [params.path ?? '']).filter(Boolean).join('/');
	const url = new URL(request.url);
	const method = request.method;
	if (!env.DB) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	await database(env);
	const db = (await sellersDb(env))!;
	const body = method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, any>) : {};

	if (route === 'submissions' && method === 'GET') {
		const { results } = await db
			.prepare(
				`SELECT s.*, u.email AS seller_email, u.name AS seller_name,
				        (SELECT group_concat(id) FROM (SELECT id FROM submission_photos WHERE submission_id = s.id ORDER BY idx)) AS photo_ids
				 FROM submissions s LEFT JOIN users u ON u.id = s.user_id
				 WHERE s.status != 'withdrawn'
				 ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 200`,
			)
			.all<Submission & { seller_email: string | null; seller_name: string | null; photo_ids: string | null }>();
		return json({ submissions: results.map((s) => ({ ...s, photo_ids: s.photo_ids ? s.photo_ids.split(',').map(Number) : [] })) });
	}

	if (route === 'photo' && method === 'GET') {
		const row = await db.prepare('SELECT data FROM submission_photos WHERE id = ?').bind(Number(url.searchParams.get('id'))).first<{ data: string }>();
		if (!row) return json({ error: 'Not found.' }, 404);
		const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
		return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
	}

	const approve = route.match(/^submissions\/(\d+)\/approve$/);
	if (approve && method === 'POST') {
		const sub = await db.prepare("SELECT * FROM submissions WHERE id = ? AND status = 'pending'").bind(Number(approve[1])).first<Submission>();
		if (!sub) return json({ error: 'This submission has already been handled.' }, 409);
		const { results: photos } = await db.prepare('SELECT data FROM submission_photos WHERE submission_id = ? ORDER BY idx').bind(sub.id).all<{ data: string }>();
		if (!photos.length) return json({ error: 'The photos of this submission are missing.' }, 409);
		// The owner may have changed the texts or the price before approving.
		const shas = [];
		for (const photo of photos) shas.push(await createBlob(env, photo.data));
		const product = parseNewProduct({ ...sub, ...body, staffPick: false, photos: shas });
		if (typeof product === 'string') return json({ error: product }, 400);
		product.seller = sub.user_id;
		const existing = await listDir(env, PRODUCTS_DIR);
		const id = folderName(nextNumber(existing.map((entry) => entry.name)), product);
		const dir = `${PRODUCTS_DIR}/${id}`;
		await commit(env, `Add piece from a seller: ${product.brand} ${product.title}`, [
			{ path: `${dir}/index.md`, mode: '100644', type: 'blob', content: toMarkdown(product, SITE.currentDrop) },
			...shas.map((sha, i) => ({ path: `${dir}/${i + 1}.jpg`, mode: '100644' as const, type: 'blob' as const, sha })),
		]);
		await db.batch([
			db.prepare("UPDATE submissions SET status = 'approved', product_id = ?, price = ?, updated_at = ? WHERE id = ?").bind(id, product.price, now(), sub.id),
			db.prepare('DELETE FROM submission_photos WHERE submission_id = ?').bind(sub.id),
		]);
		await mailSeller(env, db, sub.user_id, 'approved', { piece: `${product.brand} ${product.title}`, price: chf(product.price), link: `${url.origin}/item/${id}/` });
		return json({ ok: true, id });
	}

	const reject = route.match(/^submissions\/(\d+)\/reject$/);
	if (reject && method === 'POST') {
		const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
		const sub = await db.prepare("SELECT * FROM submissions WHERE id = ? AND status = 'pending'").bind(Number(reject[1])).first<Submission>();
		if (!sub) return json({ error: 'This submission has already been handled.' }, 409);
		await db.batch([
			db.prepare("UPDATE submissions SET status = 'rejected', reason = ?, updated_at = ? WHERE id = ?").bind(reason, now(), sub.id),
			db.prepare('DELETE FROM submission_photos WHERE submission_id = ?').bind(sub.id),
		]);
		await mailSeller(env, db, sub.user_id, 'rejected', { piece: `${sub.brand} ${sub.title}`, reason, link: `${url.origin}/sell/new/` });
		return json({ ok: true });
	}

	if (route === 'payouts' && method === 'GET') {
		const { results } = await db
			.prepare(
				`SELECT s.*, u.email AS seller_email, u.name AS seller_name, sel.iban, sel.account_holder
				 FROM seller_sales s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN sellers sel ON sel.user_id = s.user_id
				 ORDER BY CASE s.status WHEN 'shipped' THEN 0 WHEN 'to_ship' THEN 1 ELSE 2 END, s.created_at DESC LIMIT 300`,
			)
			.all<Sale & { seller_email: string | null; seller_name: string | null; iban: string | null; account_holder: string | null }>();
		return json({
			payouts: results.map((s) => ({ ...s, due_at: s.shipped_at ? s.shipped_at + PAYOUT_DAYS * 86400 : null })),
			now: now(),
		});
	}

	const paid = route.match(/^payouts\/(\d+)\/paid$/);
	if (paid && method === 'POST') {
		const sale = await db.prepare("SELECT * FROM seller_sales WHERE id = ? AND status = 'shipped'").bind(Number(paid[1])).first<Sale>();
		if (!sale) return json({ error: 'Only shipped sales can be paid out.' }, 409);
		const seller = await db.prepare('SELECT iban FROM sellers WHERE user_id = ?').bind(sale.user_id).first<{ iban: string }>();
		await db.prepare("UPDATE seller_sales SET status = 'paid_out', paid_out_at = ? WHERE id = ?").bind(now(), sale.id).run();
		await mailSeller(env, db, sale.user_id, 'paid', { amount: chf(sale.payout), pieces: sale.product_name, iban: seller?.iban || '–' });
		return json({ ok: true });
	}

	return json({ error: 'Not found.' }, 404);
};
