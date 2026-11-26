// /sw.js: the service worker of the shop (installable app, offline page). Built with every deploy: the version below
// changes each time, so phones pick up a new deploy at once (skipWaiting + clients.claim, and a "new version" toast).
//
// Rules (stock must never look available when it is not):
//   - never touched (straight to the network): other sites (Stripe, Turnstile, fonts …), every non-GET request,
//     /admin/, /api/ (checkout, offers, auctions, account, Stripe webhook …), /products.json (stock), /sw.js itself
//   - cache-first: hashed build files under /_astro/ except images (CSS, JS, fonts), icons, logo, manifest
//   - network-first: HTML pages and images (product photos); pages that show stock or a purchase are never answered from
//     the cache: if the network fails, the offline page shows instead (no old "available" piece)
//   - offline: /offline/ in the visitor's language
//
// Push notifications (later): add a 'push' and a 'notificationclick' listener at the end (Web Push with VAPID keys,
// sent from a Cloudflare Worker). Nothing else here needs to change for that.

import type { APIRoute } from 'astro';

export const prerender = true;

const VERSION = new Date().toISOString();

const source = `/* secondsurf service worker · ${VERSION} */
const VERSION = ${JSON.stringify(VERSION)};
const STATIC = 'static-' + VERSION;
const PAGES = 'pages-v1';
const IMAGES = 'images-v1';
const OFFLINE = ['/offline/', '/fr/offline/', '/it/offline/', '/en/offline/'];
const PAGE_TIMEOUT = 3000;
const IMAGE_TIMEOUT = 4000;
const MAX_PAGES = 60;
const MAX_IMAGES = 150;

const LANG = /^\\/(fr|it|en)(?=\\/)/;
/** Never handled by the service worker: always the network, never stored. */
const BYPASS = /^\\/(admin|api)(\\/|$)|^\\/products\\.json$|^\\/sw\\.js$|^\\/drop\\.ics$/;
/** Pages that show stock, prices or a purchase: never shown from the cache (path without the language prefix). */
const LIVE = /^\\/($|new\\/|shop\\/|item\\/|season\\/|auctions?\\/|cart\\/|thanks\\/|offer\\/|parcel\\/|account\\/|sell\\/new\\/|tracking\\/)/;
/** Pages that are never stored at all (personal or part of a purchase). */
const PRIVATE = /^\\/(cart|thanks|offer|auction|parcel|account|tracking)\\//;

const strip = (path) => path.replace(LANG, '');
const offlineFor = (path) => {
	const lang = path.match(LANG)?.[1];
	return lang ? '/' + lang + '/offline/' : '/offline/';
};

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(STATIC)
			.then((cache) => cache.addAll([...OFFLINE, '/manifest.webmanifest', '/icons/icon-192.png', '/logo.svg']))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key.startsWith('static-') && key !== STATIC).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

/** Keeps a cache from growing without end: drops the oldest entries. */
async function trim(name, max) {
	const cache = await caches.open(name);
	const keys = await cache.keys();
	for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

async function cacheFirst(request) {
	const cached = await caches.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok) (await caches.open(STATIC)).put(request, response.clone());
	return response;
}

async function page(request, path) {
	const live = LIVE.test(strip(path));
	const store = !PRIVATE.test(strip(path));
	try {
		// Stock pages wait for the network as long as it takes; other pages fall back to the cache after a few seconds.
		const response = await (live ? fetch(request) : Promise.race([fetch(request), timeout(PAGE_TIMEOUT)]));
		if (response.ok && store && !live) {
			(await caches.open(PAGES)).put(request, response.clone());
			trim(PAGES, MAX_PAGES);
		}
		return response;
	} catch {
		if (!live) {
			const cached = await caches.match(request);
			if (cached) return cached;
		}
		return (await caches.match(offlineFor(path))) ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
	}
}

async function image(request) {
	try {
		const response = await Promise.race([fetch(request), timeout(IMAGE_TIMEOUT)]);
		if (response.ok) {
			(await caches.open(IMAGES)).put(request, response.clone());
			trim(IMAGES, MAX_IMAGES);
		}
		return response;
	} catch {
		const cached = await caches.match(request);
		if (cached) return cached;
		throw new Error('offline');
	}
}

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (BYPASS.test(url.pathname)) return;

	if (request.mode === 'navigate') return event.respondWith(page(request, url.pathname));
	if (request.destination === 'image' || /\\.(jpe?g|png|webp|avif|gif)$/i.test(url.pathname)) {
		if (/^\\/(icons\\/|favicon|apple-touch-icon)/.test(url.pathname)) return event.respondWith(cacheFirst(request));
		return event.respondWith(image(request));
	}
	if (url.pathname.startsWith('/_astro/') || /\\.(woff2?|css)$/.test(url.pathname) || url.pathname === '/manifest.webmanifest' || url.pathname === '/logo.svg') {
		return event.respondWith(cacheFirst(request));
	}
	// Everything else (e.g. /scanner.js, other files): the network, no caching.
});

// ---------------------------------------------------------------- push notifications (later)
// self.addEventListener('push', (event) => { … self.registration.showNotification(…) … });
// self.addEventListener('notificationclick', (event) => { … clients.openWindow(…) … });
`;

export const GET: APIRoute = () =>
	new Response(source, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
