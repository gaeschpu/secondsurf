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

// A login without "stay logged in" ends when the browser closes. The hint then says 'session', and a browser-session
// cookie (gone after closing, like the login cookie) shows whether it still holds.
const SESSION_COOKIE = 'login-open';
const sessionCookie = (on: boolean) => {
	document.cookie = `${SESSION_COOKIE}=${on ? '1' : ''}; Path=/; SameSite=Strict${on ? '' : '; Max-Age=0'}${location.protocol === 'https:' ? '; Secure' : ''}`;
};

export function seemsLoggedIn() {
	const hint = store.get(HINT);
	if (hint === '1') return true;
	if (hint !== 'session') return false;
	if (document.cookie.split(/;\s*/).includes(`${SESSION_COOKIE}=1`)) return true;
	forgetLogin();
	return false;
}

/** remember: true = stay logged in, false = until the browser closes, undefined = keep what it is. */
export function rememberLogin(wishlist: string[], remember?: boolean) {
	if (remember !== undefined || !store.get(HINT)) {
		store.set(HINT, remember === false ? 'session' : '1');
		sessionCookie(remember === false);
	}
	store.set(WISHLIST, JSON.stringify(wishlist));
}

export function forgetLogin() {
	sessionCookie(false);
	store.set(HINT, null);
	store.set(WISHLIST, null);
	// "Models first" (src/scripts/models.ts) is only for logged-in customers.
	store.set('models', null);
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
