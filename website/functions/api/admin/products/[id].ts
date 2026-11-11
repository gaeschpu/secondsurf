import { notifyPriceDrop } from '../../../_lib/accounts.ts';
import { json, type Handler } from '../../../_lib/auth.ts';
import { commit, listDir, PRODUCTS_DIR, readText } from '../../../_lib/github.ts';
import { isValidPrice, PRODUCT_ID, setPrice, setSold } from '../../../_lib/product.ts';
import { parseEdit, readPiece, writePiece } from '../../../_lib/product-edit.ts';

const validId = (params: Record<string, string | string[]>) => {
	const id = params.id;
	return typeof id === 'string' && PRODUCT_ID.test(id) ? id : null;
};

/** All fields of a piece, for the edit form in the dashboard. */
export const onRequestGet: Handler = async ({ env, params }) => {
	const id = validId(params);
	if (!id) return json({ error: 'Not found.' }, 404);
	return json({ id, ...readPiece(await readText(env, `${PRODUCTS_DIR}/${id}/index.md`)) });
};

/** Edit everything ({ edit: {...} }), change the price, or mark as sold or available again. */
export const onRequestPatch: Handler = async ({ request, env, params, waitUntil }) => {
	const id = validId(params);
	if (!id) return json({ error: 'Not found.' }, 404);
	const body = (await request.json().catch(() => null)) as { sold?: unknown; price?: unknown; edit?: unknown } | null;
	const path = `${PRODUCTS_DIR}/${id}/index.md`;

	if (body?.edit !== undefined) {
		const edit = parseEdit(body.edit);
		if (typeof edit === 'string') return json({ error: edit }, 400);
		const before = await readText(env, path);
		const oldPrice = readPiece(before).price;
		const content = writePiece(before, edit);
		if (content === before) return json({ ok: true, unchanged: true });
		await commit(env, `Edit piece: ${id}`, [{ path, mode: '100644', type: 'blob', content }]);
		// A lower price tells the customers who saved the piece, as with "Save price".
		if (edit.price < oldPrice) {
			const alerts = notifyPriceDrop(env, id, content, edit.price).catch((error) => console.error('Price alerts failed', error));
			if (waitUntil) waitUntil(alerts);
			else await alerts;
		}
		return json({ ok: true });
	}

	if (body?.price !== undefined) {
		if (!isValidPrice(body.price)) return json({ error: 'Enter a price above 0.' }, 400);
		const content = setPrice(await readText(env, path), body.price);
		await commit(env, `Price ${body.price}: ${id}`, [{ path, mode: '100644', type: 'blob', content }]);
		// Customers who saved the piece hear about a lower price. A failure here never blocks the price change.
		const alerts = notifyPriceDrop(env, id, content, body.price).catch((error) => console.error('Price alerts failed', error));
		if (waitUntil) waitUntil(alerts);
		else await alerts;
		return json({ ok: true });
	}

	if (typeof body?.sold !== 'boolean') return json({ error: 'Say whether it is sold.' }, 400);
	const content = setSold(await readText(env, path), body.sold);
	await commit(env, `${body.sold ? 'Sold' : 'Available again'}: ${id}`, [{ path, mode: '100644', type: 'blob', content }]);
	return json({ ok: true });
};

/** Removes the piece from the shop. It stays recoverable in the Git history. */
export const onRequestDelete: Handler = async ({ env, params }) => {
	const id = validId(params);
	if (!id) return json({ error: 'Not found.' }, 404);
	const files = await listDir(env, `${PRODUCTS_DIR}/${id}`);
	await commit(
		env,
		`Remove piece: ${id}`,
		files.map((file) => ({ path: file.path, mode: '100644' as const, type: 'blob' as const, sha: null })),
	);
	return json({ ok: true });
};
