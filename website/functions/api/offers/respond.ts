// POST /api/offers/respond { t, action: 'accept' | 'decline' }: the customer answers the owner's counter-offer.

import { json, type Handler } from '../../_lib/auth.ts';
import { byToken, mailOwner, now, offersDb, payableUntil } from '../../_lib/offers.ts';

export const onRequestPost: Handler = async ({ request, env, waitUntil }) => {
	const origin = new URL(request.url).origin;
	if (request.headers.get('Origin') !== origin) return json({ error: 'origin' }, 403);
	const db = await offersDb(env);
	if (!db) return json({ error: 'unavailable' }, 503);

	const body = (await request.json().catch(() => null)) as { t?: unknown; action?: unknown } | null;
	const offer = await byToken(db, typeof body?.t === 'string' ? body.t : '');
	if (!offer) return json({ error: 'notFound' }, 404);
	if (offer.status !== 'countered') return json({ error: 'notOpen' }, 409);
	// The counter-offer is valid for a few days, like an agreed price.
	if (Date.now() / 1000 > payableUntil(offer)) return json({ error: 'expired' }, 409);

	const accept = body?.action === 'accept';
	if (!accept && body?.action !== 'decline') return json({ error: 'invalid' }, 400);
	offer.status = accept ? 'agreed' : 'rejected';
	offer.updated_at = now();
	await db.prepare('UPDATE offers SET status = ?, updated_at = ? WHERE id = ?').bind(offer.status, offer.updated_at, offer.id).run();

	const mail = mailOwner(env, offer, origin, accept ? 'agreed' : 'rejected').catch((error) => console.error('Offer email failed', error));
	if (waitUntil) waitUntil(mail);
	else await mail;
	return json({ ok: true, status: offer.status });
};
