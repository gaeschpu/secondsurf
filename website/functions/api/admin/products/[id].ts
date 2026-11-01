import { json, type Handler } from '../../../_lib/auth.ts';
import { commit, listDir, PRODUCTS_DIR, readText } from '../../../_lib/github.ts';
import { PRODUCT_ID, setSold } from '../../../_lib/product.ts';

const validId = (params: Record<string, string | string[]>) => {
	const id = params.id;
	return typeof id === 'string' && PRODUCT_ID.test(id) ? id : null;
};

/** Mark as sold or available again. */
export const onRequestPatch: Handler = async ({ request, env, params }) => {
	const id = validId(params);
	if (!id) return json({ error: 'Not found.' }, 404);
	const body = (await request.json().catch(() => null)) as { sold?: unknown } | null;
	if (typeof body?.sold !== 'boolean') return json({ error: 'Say whether it is sold.' }, 400);

	const path = `${PRODUCTS_DIR}/${id}/index.md`;
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
