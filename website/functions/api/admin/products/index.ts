import { CATEGORIES, CONDITIONS, SITE, SIZES } from '../../../../src/config.ts';
import { json, type Handler } from '../../../_lib/auth.ts';
import { commit, listDir, PRODUCTS_DIR, readAllProducts } from '../../../_lib/github.ts';
import { database } from '../../../_lib/accounts.ts';
import { auctionsDb, createAuction, now } from '../../../_lib/auctions.ts';
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
	const body = (await request.json().catch(() => null)) as Record<string, any> | null;
	const product = parseNewProduct(body);
	if (typeof product === 'string') return json({ error: product }, 400);

	// An auction lot starts its auction right away (start price and end from the form), so check those before publishing.
	const startPrice = Math.round(Number(body?.auction?.startPrice));
	const endsAt = Math.floor(Number(body?.auction?.endsAt) / 1000);
	if (product.auctionOnly) {
		if (!env.DB) return json({ error: 'The D1 database (binding DB) is missing, so auctions can’t run.' }, 503);
		if (!(startPrice >= 1)) return json({ error: 'Enter a start price of at least CHF 1.' }, 400);
		if (!(endsAt > now() + 10 * 60)) return json({ error: 'Choose when the auction ends (at least 10 minutes from now).' }, 400);
	}

	const existing = await listDir(env, PRODUCTS_DIR);
	const id = folderName(nextNumber(existing.map((entry) => entry.name)), product);
	const dir = `${PRODUCTS_DIR}/${id}`;
	await commit(env, `Add piece: ${product.brand} ${product.title}`, [
		{ path: `${dir}/index.md`, mode: '100644', type: 'blob', content: toMarkdown(product, SITE.currentDrop) },
		...product.photos.map((sha, i) => ({ path: `${dir}/${i + 1}.jpg`, mode: '100644' as const, type: 'blob' as const, sha })),
	]);

	if (product.auctionOnly) {
		await database(env);
		const db = (await auctionsDb(env))!;
		const title = (lang: 'fr' | 'it' | 'en') => product.titleTranslations?.[lang] ?? product.title;
		const names = { de: `${product.brand} ${product.title}`, fr: `${product.brand} ${title('fr')}`, it: `${product.brand} ${title('it')}`, en: `${product.brand} ${title('en')}` };
		const error = await createAuction(db, id, names, startPrice, endsAt);
		if (error) return json({ id, warning: `Published, but the auction didn't start: ${error} Start it in the Auctions tab.` }, 201);
	}
	return json({ id }, 201);
};
