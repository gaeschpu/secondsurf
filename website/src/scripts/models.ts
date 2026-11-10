// "Models first": a logged-in customer gives their gender in the profile (src/pages/[...lang]/account.astro).
// Product photos carry data-model="women" or "men" (the models field of a piece), and the photo strips put that
// gender's photos first, then the other model photos, then the rest. "other": women or men first, picked at random
// once per browser session (so the order doesn't jump between pages). Not logged in or no gender given: nothing moves.

import { seemsLoggedIn } from './account';

const KEY = 'models';
export type Models = 'women' | 'men' | 'other' | '';
const RANDOM = 'models-random';

export function preferredModels(): Models {
	if (!seemsLoggedIn()) return '';
	try {
		const value = localStorage.getItem(KEY);
		if (value === 'women' || value === 'men') return value;
		if (value !== 'other') return '';
		let pick = sessionStorage.getItem(RANDOM);
		if (pick !== 'women' && pick !== 'men') {
			pick = Math.random() < 0.5 ? 'women' : 'men';
			sessionStorage.setItem(RANDOM, pick);
		}
		return pick as Models;
	} catch {
		return '';
	}
}

export function rememberModels(value: Models | undefined) {
	try {
		if (value) localStorage.setItem(KEY, value);
		else localStorage.removeItem(KEY);
	} catch {}
}

/** The new order of the photos as indices, or null when nothing should move. */
export function modelOrder(tags: (string | undefined)[]): number[] | null {
	const chosen = preferredModels();
	if (!chosen || !tags.includes(chosen)) return null;
	const rank = (tag?: string) => (tag === chosen ? 0 : tag ? 1 : 2);
	const order = tags.map((_, i) => i).sort((a, b) => rank(tags[a]) - rank(tags[b]) || a - b);
	return order.every((value, i) => value === i) ? null : order;
}

/** Moves the children of each container into the given order. */
export function applyOrder(order: number[], ...containers: (Element | null | undefined)[]) {
	for (const container of containers) {
		if (!container) continue;
		const children = [...container.children];
		if (children.length !== order.length) continue;
		container.append(...order.map((i) => children[i]));
		// Scroll snapping would otherwise keep showing the photo that used to be first.
		container.scrollLeft = 0;
	}
}

/** The model tag of photo i (0-based) of a piece. */
export function modelTag(models: { women: number[]; men: number[] } | undefined, i: number) {
	if (models?.women.includes(i + 1)) return 'women';
	if (models?.men.includes(i + 1)) return 'men';
	return undefined;
}
