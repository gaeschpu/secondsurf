// PATCH /api/admin/offers/<id> { action: 'accept' | 'decline' | 'counter', amount? }: answer a price offer.
// The customer gets an email in their language with a link to /offer/, where they can pay or answer the counter-offer.

import { json, type Handler } from '../../../_lib/auth.ts';
import { checkoutReady } from '../../../_lib/checkout.ts';
import { mailCustomer, now, offersDb, type Offer } from '../../../_lib/offers.ts';

export const onRequestPatch: Handler = async ({ request, env, params }) => {
	const db = await offersDb(env);
	if (!db) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	const id = Number(params.id);
	const offer = Number.isInteger(id) && id > 0 ? await db.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first<Offer>() : null;
	if (!offer) return json({ error: 'Offer not found.' }, 404);

	const body = (await request.json().catch(() => null)) as { action?: unknown; amount?: unknown } | null;
	const action = body?.action;
	const open = offer.status === 'pending';
	if (action === 'accept' && open) offer.status = 'accepted';
	else if (action === 'decline' && (open || offer.status === 'countered')) offer.status = 'declined';
	else if (action === 'counter' && open) {
		const counter = Math.round(Number(body?.amount) * 100) / 100;
		if (!Number.isFinite(counter) || counter <= offer.amount || counter > offer.list_price)
			return json({ error: `Enter a counter-offer above CHF ${offer.amount} and at most CHF ${offer.list_price}.` }, 400);
		offer.status = 'countered';
		offer.counter = counter;
	} else return json({ error: 'This offer has already been answered.' }, 409);

	offer.updated_at = now();
	await db.prepare('UPDATE offers SET status = ?, counter = ?, updated_at = ? WHERE id = ?').bind(offer.status, offer.counter, offer.updated_at, offer.id).run();

	const kind = offer.status === 'accepted' ? 'accepted' : offer.status === 'countered' ? 'countered' : 'declined';
	try {
		await mailCustomer(env, kind, offer, new URL(request.url).origin, checkoutReady(env));
	} catch (error) {
		console.error('Offer email failed', error);
		return json({ ok: true, warning: `Saved, but the email to ${offer.email} failed. Please write to them yourself.` });
	}
	return json({ ok: true });
};
