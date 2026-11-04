// /products.json: every published piece with price and photo. The account page builds the wishlist from it,
// and the account API reads the current price from it when a piece is saved.

import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { getProducts } from '../lib/products';

export const GET: APIRoute = async () => {
	const products = await getProducts();
	const list = await Promise.all(
		products.map(async (product) => {
			const p = product.data;
			const photo = p.photos[0] && (await getImage({ src: p.photos[0], width: 480, format: 'webp' })).src;
			// JPEG for Stripe Checkout, which doesn't show WebP.
			const image = p.photos[0] && (await getImage({ src: p.photos[0], width: 800, format: 'jpeg' })).src;
			return { id: product.id, brand: p.brand, title: p.title, category: p.category, size: p.size, price: p.price, sold: p.sold, photo: photo ?? null, image: image ?? null };
		}),
	);
	return new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } });
};
