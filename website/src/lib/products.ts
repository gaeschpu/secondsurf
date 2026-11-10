// Products come from src/content/products/ (see content.config.ts).

import { getCollection, type CollectionEntry } from 'astro:content';
import { SITE } from '../config';

export type Product = CollectionEntry<'products'>;

/** Every published piece, auction lots included: drafts only show in `npm run dev`. Newest (highest folder number) first. */
export async function getAllProducts(): Promise<Product[]> {
	const all = await getCollection('products', (p) => import.meta.env.DEV || !p.data.draft);
	return all.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
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
