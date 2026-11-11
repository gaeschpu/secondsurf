// Login for /admin: password, plus a 6-digit code from an authenticator app once ADMIN_TOTP_SECRET is set (two-factor).
// The session is a signed, expiring cookie: issued.expires.signature. Logging out invalidates every cookie issued before
// (stored in D1), changing ADMIN_PASSWORD or SESSION_SECRET too. Payouts need a login from the last 10 minutes (re-auth).

export interface Env {
	ADMIN_PASSWORD?: string;
	SESSION_SECRET?: string;
	/** Base32 secret of the authenticator app (two-factor login for /admin). Without it, the password alone logs in. */
	ADMIN_TOTP_SECRET?: string;
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
	/** Stripe Checkout: the secret key (sk_live_… or sk_test_…) and the signing secret of the webhook (whsec_…). */
	STRIPE_SECRET_KEY?: string;
	STRIPE_WEBHOOK_SECRET?: string;
	/** Only for local testing against a fake Stripe. */
	STRIPE_API?: string;
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
/** Shorter than a customer login (60 days): 7 days on the phone, then password (and code) again. */
const MAX_AGE = 60 * 60 * 24 * 7;
/** Payouts and the payment file need a login (or re-confirmation) from the last 10 minutes. */
export const FRESH_SECONDS = 10 * 60;

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
	const issued = Math.floor(Date.now() / 1000);
	const value = `${issued}.${issued + MAX_AGE}`;
	const signature = toHex(await crypto.subtle.sign('HMAC', await hmacKey(env), encode(value)));
	return `${COOKIE}=${value}.${signature}; Path=/api/admin; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearedCookie = `${COOKIE}=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

/** When the current admin session was issued (seconds), or null if there is no valid session. */
export async function adminSession(env: Env, request: Request) {
	const cookies = request.headers.get('Cookie') ?? '';
	const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.(\\d+)\\.([0-9a-f]{64})(?:;|$)`));
	if (!match) return null;
	const [, issued, expires, signature] = match;
	if (Number(expires) < Date.now() / 1000) return null;
	if (!(await crypto.subtle.verify('HMAC', await hmacKey(env), fromHex(signature), encode(`${issued}.${expires}`)))) return null;
	if (Number(issued) < (await loggedOutAt(env))) return null;
	return Number(issued);
}

export const isLoggedIn = async (env: Env, request: Request) => (await adminSession(env, request)) !== null;

/** Whether the admin logged in (or confirmed the password again) within the last FRESH_SECONDS. */
export async function isFreshLogin(env: Env, request: Request) {
	const issued = await adminSession(env, request);
	return issued !== null && Date.now() / 1000 - issued <= FRESH_SECONDS;
}

/** The answer when an action needs a fresh login: the dashboard then asks for the password (and code) again. */
export const reauthNeeded = () => json({ error: 'Please confirm with your password again.', reauth: true }, 401);

// ---------------------------------------------------------------- logout everywhere (D1)

const adminDb = async (env: Env) => {
	if (!env.DB) return null;
	await env.DB.prepare('CREATE TABLE IF NOT EXISTS admin_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL)').run();
	return env.DB;
};

async function loggedOutAt(env: Env) {
	const db = await adminDb(env);
	const row = await db?.prepare("SELECT value FROM admin_state WHERE key = 'logged_out_at'").first<{ value: number }>();
	return row?.value ?? 0;
}

/** Every admin cookie issued up to now stops working (all devices). */
export async function logoutEverywhere(env: Env) {
	const db = await adminDb(env);
	await db
		?.prepare("INSERT INTO admin_state (key, value) VALUES ('logged_out_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
		.bind(Math.floor(Date.now() / 1000))
		.run();
}

// ---------------------------------------------------------------- two-factor (TOTP, RFC 6238)

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(text: string) {
	const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
	let bits = '';
	for (const char of clean) bits += BASE32.indexOf(char).toString(2).padStart(5, '0');
	return Uint8Array.from(bits.match(/.{8}/g) ?? [], (byte) => parseInt(byte, 2));
}

async function totpAt(secret: Uint8Array<ArrayBuffer>, step: number) {
	const counter = new Uint8Array(8);
	new DataView(counter.buffer).setBigUint64(0, BigInt(step));
	const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
	const offset = mac[mac.length - 1] & 0x0f;
	const number = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
	return String(number % 1_000_000).padStart(6, '0');
}

export const totpEnabled = (env: Env) => (env.ADMIN_TOTP_SECRET?.replace(/[^A-Za-z2-7]/g, '').length ?? 0) >= 16;

/** The step (30-second window) the code belongs to, allowing one step of clock drift either way; null if wrong. */
export async function checkTotp(env: Env, code: string) {
	if (!/^\d{6}$/.test(code)) return null;
	const secret = base32(env.ADMIN_TOTP_SECRET!);
	const now = Math.floor(Date.now() / 1000 / 30);
	for (const step of [now, now - 1, now + 1]) if ((await totpAt(secret, step)) === code) return step;
	return null;
}
