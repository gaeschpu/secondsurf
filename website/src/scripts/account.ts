// Shared by the wishlist hearts and the profile page. The login cookie is invisible to the page (HttpOnly),
// so the browser keeps a small hint that someone is logged in, and the saved pieces for quick hearts.

const HINT = 'account';
const WISHLIST = 'wishlist';

const store = {
	get: (key: string) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	},
	set: (key: string, value: string | null) => {
		try {
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		} catch {}
	},
};

export const seemsLoggedIn = () => store.get(HINT) === '1';

export function rememberLogin(wishlist: string[]) {
	store.set(HINT, '1');
	store.set(WISHLIST, JSON.stringify(wishlist));
}

export function forgetLogin() {
	store.set(HINT, null);
	store.set(WISHLIST, null);
}

export function savedPieces(): Set<string> {
	try {
		return new Set(JSON.parse(store.get(WISHLIST) ?? '[]'));
	} catch {
		return new Set();
	}
}

export function setSaved(id: string, saved: boolean) {
	const pieces = savedPieces();
	if (saved) pieces.add(id);
	else pieces.delete(id);
	store.set(WISHLIST, JSON.stringify([...pieces]));
}

export class ApiError extends Error {
	constructor(
		public code: string,
		public status: number,
	) {
		super(code);
	}
}

/** Calls /api/account/<path>. Throws ApiError with the server's code; a 401 also forgets the login. */
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`/api/account/${path}`, {
			method,
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch {
		throw new ApiError('generic', 0);
	}
	const data = await res.json().catch(() => ({}));
	if (res.status === 401 && data.error === 'login') forgetLogin();
	if (!res.ok) throw new ApiError(data.error ?? 'generic', res.status);
	return data;
}
