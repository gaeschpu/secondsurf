// One request per photo: keeps each request small enough for the Workers CPU limit.

import { json, type Handler } from '../../_lib/auth.ts';
import { createBlob, PRODUCTS_DIR, readRaw } from '../../_lib/github.ts';
import { PRODUCT_ID } from '../../_lib/product.ts';

const MAX_BASE64 = 8 * 1024 * 1024; // the browser sends photos of well under 1 MB
const PHOTO_FILE = /^[a-z0-9_-]+\.(jpe?g|png|webp)$/i;

/** Stores a JPEG (base64) in the repository, not yet attached to a commit. */
export const onRequestPost: Handler = async ({ request, env }) => {
	if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BASE64) return json({ error: 'Photo is too big.' }, 413);
	const body = (await request.json().catch(() => null)) as { base64?: unknown } | null;
	const base64 = body?.base64;
	// "/9j/" is how every JPEG starts once base64-encoded.
	if (typeof base64 !== 'string' || !base64.startsWith('/9j/') || base64.length > MAX_BASE64) return json({ error: 'Not a JPEG photo.' }, 400);
	return json({ sha: await createBlob(env, base64) });
};

/** Thumbnails for the dashboard list; works while the piece isn't built yet and for private repositories. */
export const onRequestGet: Handler = async ({ request, env }) => {
	const params = new URL(request.url).searchParams;
	const id = params.get('id') ?? '';
	const file = params.get('file') ?? '';
	if (!PRODUCT_ID.test(id) || !PHOTO_FILE.test(file)) return json({ error: 'Not found.' }, 404);
	const res = await readRaw(env, `${PRODUCTS_DIR}/${id}/${file}`);
	const type = file.toLowerCase().endsWith('.png') ? 'image/png' : file.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
	return new Response(res.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } });
};
