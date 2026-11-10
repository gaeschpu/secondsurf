// DELETE /api/admin/auctions/<id>: cancels an auction, but only while nobody has bid (bids are binding).
// The piece is then back on normal sale straight away.

import { json, type Handler } from '../../../_lib/auth.ts';
import { auctionsDb, now } from '../../../_lib/auctions.ts';

export const onRequestDelete: Handler = async ({ env, params }) => {
	const db = await auctionsDb(env);
	if (!db) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) return json({ error: 'Not found.' }, 404);
	const result = await db
		.prepare("UPDATE auctions SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'running' AND bids = 0")
		.bind(now(), id)
		.run();
	if (result.meta.changes !== 1) return json({ error: 'This auction can’t be cancelled any more: someone has bid, or it has ended.' }, 409);
	return json({ ok: true });
};
