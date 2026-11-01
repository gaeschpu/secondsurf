import { CATEGORIES, CONDITIONS, SITE, SIZES } from '../../../../src/config.ts';
import { json, type Handler } from '../../../_lib/auth.ts';
import { commit, listDir, PRODUCTS_DIR, readAllProducts } from '../../../_lib/github.ts';
import { folderName, nextNumber, parseNewProduct, summarize, toMarkdown } from '../../../_lib/product.ts';

/** The list, newest first, plus the choices for the form (always the same ones the shop uses). */
export const onRequestGet: Handler = async ({ env }) => {
	const products = (await readAllProducts(env))
		.filter((p) => p.markdown !== null)
		.map((p) => summarize(p.id, p.markdown!))
		.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
	return json({
		products,
		options: {
			categories: CATEGORIES.map((c) => ({ id: c.id, label: c.label.en })),
			sizes: SIZES,
			conditions: Object.entries(CONDITIONS).map(([id, label]) => ({ id, label: label.en })),
		},
	});
};

export const onRequestPost: Handler = async ({ request, env }) => {
	const product = parseNewProduct(await request.json().catch(() => null));
	if (typeof product === 'string') return json({ error: product }, 400);

	const existing = await listDir(env, PRODUCTS_DIR);
	const id = folderName(nextNumber(existing.map((entry) => entry.name)), product);
	const dir = `${PRODUCTS_DIR}/${id}`;
	await commit(env, `Add piece: ${product.brand} ${product.title}`, [
		{ path: `${dir}/index.md`, mode: '100644', type: 'blob', content: toMarkdown(product, SITE.currentDrop) },
		...product.photos.map((sha, i) => ({ path: `${dir}/${i + 1}.jpg`, mode: '100644' as const, type: 'blob' as const, sha })),
	]);
	return json({ id }, 201);
};
