// Products come from src/content/products/ (see content.config.ts).

import { getCollection, type CollectionEntry } from 'astro:content';
import { CATEGORIES, SEASONS, SHOW_LABEL_PHOTOS, SHOW_MODEL_PHOTOS, SITE } from '../config';

export type Product = CollectionEntry<'products'>;

/**
 * Model photos ("models") and label close-ups ("labels") show only while showModelPhotos / showLabelPhotos are true in
 * src/settings/site.json. The files stay in the folders, so switching back is one setting.
 */
export function withVisiblePhotos(product: Product): Product {
	const hidden = new Set<number>([
		...(SHOW_MODEL_PHOTOS ? [] : [...product.data.models.women, ...product.data.models.men]),
		...(SHOW_LABEL_PHOTOS ? [] : product.data.labels),
	]);
	if (!hidden.size) return product;
	const keep = product.data.photos.map((_, i) => i + 1).filter((n) => !hidden.has(n));
	// A piece with nothing left keeps its photos (better than no photo at all).
	if (!keep.length) return product;
	// Photo numbers in models/labels refer to the original order: renumber them for the photos that stay.
	const renumber = (list: number[]) => list.filter((n) => keep.includes(n)).map((n) => keep.indexOf(n) + 1);
	return {
		...product,
		data: {
			...product.data,
			photos: keep.map((n) => product.data.photos[n - 1]),
			models: { women: renumber(product.data.models.women), men: renumber(product.data.models.men) },
			labels: renumber(product.data.labels),
		},
	};
}

/** Every published piece, auction lots included: drafts only show in `npm run dev`. Newest (highest folder number) first. */
export async function getAllProducts(): Promise<Product[]> {
	const all = await getCollection('products', (p) => import.meta.env.DEV || !p.data.draft);
	return all.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true })).map(withVisiblePhotos);
}

/** The shop's pieces: like getAllProducts, without the auction lots (auctionOnly), which only live on /auctions/. */
export async function getProducts(): Promise<Product[]> {
	return (await getAllProducts()).filter((p) => !p.data.auctionOnly);
}

/** Available first, sold pieces at the end. */
export const availableFirst = (list: Product[]) => [...list.filter((p) => !p.data.sold), ...list.filter((p) => p.data.sold)];

export async function getNewDrop() {
	return availableFirst((await getProducts()).filter((p) => p.data.drop === SITE.currentDrop));
}

/**
 * The categories that have at least one available (unsold) piece in the shop, in the order of CATEGORIES.
 * The footer and the filter panel only list these; an empty category comes back by itself once a piece is added.
 * The category pages themselves always exist (no 404 for old links).
 */
export async function categoriesInStock() {
	const stocked = new Set((await getProducts()).filter((p) => !p.data.sold).map((p) => p.data.category));
	return CATEGORIES.filter((c) => stocked.has(c.id));
}

/** The shop's pieces of one season (SEASONS in src/config.ts), available first. */
export async function seasonProducts(id: (typeof SEASONS)[number]['id']) {
	const season = SEASONS.find((s) => s.id === id)!;
	return availableFirst((await getProducts()).filter((p) => (season.categories as readonly string[]).includes(p.data.category)));
}
