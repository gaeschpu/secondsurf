import { CATEGORIES, CONDITIONS, SITE, SIZES } from '../../../../src/config.ts';
import { json, type Handler } from '../../../_lib/auth.ts';
import { commit, listDir, PRODUCTS_DIR, readAllProducts } from '../../../_lib/github.ts';
import { database } from '../../../_lib/accounts.ts';
import { auctionsDb, createAuction, now } from '../../../_lib/auctions.ts';
import { sellersDb } from '../../../_lib/sellers.ts';
import { folderName, nextNumber, parseNewProduct, summarize, toMarkdown } from '../../../_lib/product.ts';

/** The list, newest first, plus the choices for the form (always the same ones the shop uses). */
export const onRequestGet: Handler = async ({ env }) => {
	const products = (await readAllProducts(env))
		.filter((p) => p.markdown !== null)
		.map((p) => summarize(p.id, p.markdown!))
		.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
	// Pieces from sellers: who sells each one, and the submissions still waiting for a check (handled in the Sellers tab).
	type Waiting = { id: number; brand: string; title: string; price: number; size: string; seller: string; photo: number | null };
	const sellers: Record<number, string> = {};
	let waiting: Waiting[] = [];
	if (env.DB) {
		try {
			await database(env);
			const db = (await sellersDb(env))!;
			const ids = [...new Set(products.map((p) => p.seller).filter((id): id is number => Boolean(id)))];
			if (ids.length) {
				const { results } = await db
					.prepare(`SELECT id, name, email FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
					.bind(...ids)
					.all<{ id: number; name: string; email: string }>();
				for (const u of results) sellers[u.id] = u.name || u.email;
			}
			const { results } = await db
				.prepare(
					`SELECT s.id, s.brand, s.title, s.price, s.size, COALESCE(NULLIF(u.name, ''), u.email, '?') AS seller,
					        (SELECT id FROM submission_photos WHERE submission_id = s.id ORDER BY idx LIMIT 1) AS photo
					 FROM submissions s LEFT JOIN users u ON u.id = s.user_id
					 WHERE s.status = 'pending' ORDER BY s.created_at DESC LIMIT 100`,
				)
				.all<Waiting>();
			waiting = results;
		} catch (error) {
			console.error('seller info for the piece list', error);
		}
	}
	return json({
		products,
		sellers,
		waiting,
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
