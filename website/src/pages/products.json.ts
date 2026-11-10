// /products.json: every published piece with price and photo. The account page builds the wishlist from it,
// and the account API reads the current price from it when a piece is saved. `real` is the first photo without a model
// (the piece itself, see the models field), for the auctions page.

import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { getAllProducts } from '../lib/products';

export const GET: APIRoute = async () => {
	// Auction lots too: the auction page, the profile and the auction checkout need them.
	const products = await getAllProducts();
	const list = await Promise.all(
		products.map(async (product) => {
			const p = product.data;
			const photo = p.photos[0] && (await getImage({ src: p.photos[0], width: 480, format: 'webp' })).src;
			// JPEG for Stripe Checkout, which doesn't show WebP.
			const image = p.photos[0] && (await getImage({ src: p.photos[0], width: 800, format: 'jpeg' })).src;
			const modelPhotos = new Set([...p.models.women, ...p.models.men]);
			const realIndex = p.photos.findIndex((_, i) => !modelPhotos.has(i + 1));
			const real = realIndex > 0 ? (await getImage({ src: p.photos[realIndex], width: 480, format: 'webp' })).src : photo;
			return { id: product.id, brand: p.brand, title: p.title, category: p.category, size: p.size, price: p.price, sold: p.sold, auctionOnly: p.auctionOnly, photo: photo ?? null, real: real ?? null, image: image ?? null };
		}),
	);
	return new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } });
};
