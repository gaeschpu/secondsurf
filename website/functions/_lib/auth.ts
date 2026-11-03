// Password login for /admin: a signed, expiring cookie. No database needed.
// Changing ADMIN_PASSWORD or SESSION_SECRET logs out every device.

export interface Env {
	ADMIN_PASSWORD?: string;
	SESSION_SECRET?: string;
	GITHUB_TOKEN?: string;
	/** Defaults to gaeschpu/secondsurf and main. */
	GITHUB_REPO?: string;
	GITHUB_BRANCH?: string;
	/** Only for local testing against a fake GitHub. */
	GITHUB_API?: string;
	/** Forms: Resend sends the emails, Turnstile stops bots. */
	RESEND_API_KEY?: string;
	TURNSTILE_SECRET_KEY?: string;
	/** Defaults to secondsurf <noreply@secondsurf.ch>. The domain must be verified in Resend. */
	MAIL_FROM?: string;
	/** Only for local testing against fake Resend and Turnstile. */
	FORMS_TEST_API?: string;
	/** Workers AI binding (free daily allowance): writes the listing from the photos. */
	AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
	/** D1 database binding for customer accounts. */
	DB?: D1Database;
	/** The built site, provided by Cloudflare Pages. */
	ASSETS?: { fetch: (input: URL | string) => Promise<Response> };
}

/** The part of Cloudflare's D1 API we use. */
export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
}
export interface D1Database {
	prepare(query: string): D1PreparedStatement;
	batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export type Handler = (context: {
	request: Request;
	env: Env;
	params: Record<string, string | string[]>;
	next: () => Promise<Response>;
	/** Keeps the function running for work after the response, e.g. sending emails. */
	waitUntil?: (promise: Promise<unknown>) => void;
}) => Response | Promise<Response>;

const COOKIE = 'secondsurf_admin';
const MAX_AGE = 60 * 60 * 24 * 30; // stay logged in on the phone for 30 days

const encode = (text: string) => new TextEncoder().encode(text);
const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
	});

/** Refuse to run with missing or weak secrets rather than leave the dashboard open. */
export const isConfigured = (env: Env) =>
	(env.ADMIN_PASSWORD?.length ?? 0) >= 12 && (env.SESSION_SECRET?.length ?? 0) >= 32 && Boolean(env.GITHUB_TOKEN);

const hmacKey = (env: Env) =>
	crypto.subtle.importKey('raw', encode(`${env.SESSION_SECRET}\0${env.ADMIN_PASSWORD}`), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
		'verify',
	]);

/** Constant-time, because crypto.subtle.verify is. */
export async function checkPassword(env: Env, password: string) {
	const key = await hmacKey(env);
	const expected = await crypto.subtle.sign('HMAC', key, encode(env.ADMIN_PASSWORD!));
	return crypto.subtle.verify('HMAC', key, expected, encode(password));
}

export async function sessionCookie(env: Env) {
	const expires = String(Math.floor(Date.now() / 1000) + MAX_AGE);
	const signature = toHex(await crypto.subtle.sign('HMAC', await hmacKey(env), encode(expires)));
	return `${COOKIE}=${expires}.${signature}; Path=/api/admin; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearedCookie = `${COOKIE}=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export async function isLoggedIn(env: Env, request: Request) {
	const cookies = request.headers.get('Cookie') ?? '';
	const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]{64})(?:;|$)`));
	if (!match) return false;
	const [, expires, signature] = match;
	if (Number(expires) < Date.now() / 1000) return false;
	return crypto.subtle.verify('HMAC', await hmacKey(env), fromHex(signature), encode(expires));
}
