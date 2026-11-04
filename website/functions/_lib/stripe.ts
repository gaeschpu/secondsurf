// Stripe Checkout without the Stripe SDK: a few form-encoded requests and the webhook signature check.
// While someone is at the checkout, the piece is held for them in D1 (table checkout_holds), so it can't be sold twice.

import type { D1Database, Env } from './auth.ts';

/** Stripe needs at least 30 minutes; a little more so a slow request doesn't fall under the limit. */
export const HOLD_SECONDS = 31 * 60;

export class StripeError extends Error {
	constructor(public status: number, message: string) {
		super(`Stripe answered ${status}: ${message}`);
	}
}

/** Turns { a: { b: [1] } } into a[b][0]=1, the format the Stripe API expects. */
function encode(value: unknown, prefix: string, out: URLSearchParams) {
	if (value === undefined || value === null) return;
	if (Array.isArray(value)) value.forEach((item, i) => encode(item, `${prefix}[${i}]`, out));
	else if (typeof value === 'object')
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) encode(item, prefix ? `${prefix}[${key}]` : key, out);
	else out.append(prefix, String(value));
}

export async function stripe<T = any>(env: Env, path: string, body?: Record<string, unknown>): Promise<T> {
	const form = new URLSearchParams();
	if (body) encode(body, '', form);
	const res = await fetch(`${env.STRIPE_API ?? 'https://api.stripe.com'}/v1${path}`, {
		method: body ? 'POST' : 'GET',
		headers: {
			Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'Stripe-Version': '2025-03-31.basil',
		},
		body: body ? form : undefined,
	});
	const data = (await res.json().catch(() => ({}))) as any;
	if (!res.ok) throw new StripeError(res.status, data?.error?.message ?? 'unknown error');
	return data as T;
}

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Checks the Stripe-Signature header (HMAC-SHA256 of "timestamp.body"), and that it is at most 5 minutes old. */
export async function verifyWebhook(secret: string, header: string | null, body: string) {
	if (!header) return false;
	const parts = header.split(',').map((part) => part.split('=', 2) as [string, string]);
	const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
	const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
	if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const expected = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
	// Compare without stopping at the first different character.
	return signatures.some((sig) => {
		if (sig.length !== expected.length) return false;
		let diff = 0;
		for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
		return diff === 0;
	});
}

// ---------------------------------------------------------------- holds

let holdsReady: Promise<unknown> | null = null;

export async function holds(env: Env): Promise<D1Database | null> {
	if (!env.DB) return null;
	const db = env.DB;
	holdsReady ??= db
		.batch([
			db.prepare(
				'CREATE TABLE IF NOT EXISTS checkout_holds (product_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, owner TEXT NOT NULL, expires_at INTEGER NOT NULL)',
			),
			db.prepare('CREATE TABLE IF NOT EXISTS checkout_done (session_id TEXT PRIMARY KEY, at INTEGER NOT NULL)'),
		])
		.catch((error) => {
			holdsReady = null;
			throw error;
		});
	await holdsReady;
	return db;
}

const now = () => Math.floor(Date.now() / 1000);

/**
 * Tries to hold the piece for this browser. Returns 'ok', or 'taken' when someone else is at the checkout with it.
 * The same browser may start again: its old checkout session is returned so it can be closed.
 */
export async function takeHold(db: D1Database, productId: string, owner: string) {
	await db.prepare('DELETE FROM checkout_holds WHERE expires_at < ?').bind(now()).run();
	const existing = await db
		.prepare('SELECT session_id, owner FROM checkout_holds WHERE product_id = ?')
		.bind(productId)
		.first<{ session_id: string; owner: string }>();
	if (existing && existing.owner !== owner) return { result: 'taken' as const };
	if (existing) {
		await db.prepare('UPDATE checkout_holds SET session_id = ?, expires_at = ? WHERE product_id = ?').bind('', now() + HOLD_SECONDS, productId).run();
		return { result: 'ok' as const, previousSession: existing.session_id || null };
	}
	const inserted = await db
		.prepare('INSERT INTO checkout_holds (product_id, session_id, owner, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(product_id) DO NOTHING')
		.bind(productId, '', owner, now() + HOLD_SECONDS)
		.run();
	return inserted.meta.changes === 1 ? { result: 'ok' as const, previousSession: null } : { result: 'taken' as const };
}

export const setHoldSession = (db: D1Database, productId: string, sessionId: string) =>
	db.prepare('UPDATE checkout_holds SET session_id = ? WHERE product_id = ?').bind(sessionId, productId).run();

/** Releases the hold of exactly this checkout session (never someone else's, never a sold piece's). */
export const releaseHold = (db: D1Database, productId: string, sessionId: string) =>
	db.prepare("DELETE FROM checkout_holds WHERE product_id = ? AND session_id = ? AND session_id NOT IN ('', 'sold')").bind(productId, sessionId).run();

/** Undo a hold that was just taken when creating the Stripe session failed. */
export const dropNewHold = (db: D1Database, productId: string, owner: string) =>
	db.prepare("DELETE FROM checkout_holds WHERE product_id = ? AND owner = ? AND session_id = ''").bind(productId, owner).run();

/** True the first time a session is handled, so Stripe's retries don't sell or email twice. */
export async function firstTime(db: D1Database | null, sessionId: string) {
	if (!db) return true;
	const res = await db.prepare('INSERT INTO checkout_done (session_id, at) VALUES (?, ?) ON CONFLICT(session_id) DO NOTHING').bind(sessionId, now()).run();
	return res.meta.changes === 1;
}

export const forgetDone = (db: D1Database | null, sessionId: string) =>
	db ? db.prepare('DELETE FROM checkout_done WHERE session_id = ?').bind(sessionId).run() : Promise.resolve();

/** After a sale, keep the piece blocked for a day: the site needs a few minutes to rebuild and show it as sold. */
export const holdSold = (db: D1Database, productId: string) =>
	db
		.prepare(
			`INSERT INTO checkout_holds (product_id, session_id, owner, expires_at) VALUES (?, 'sold', 'sold', ?)
			 ON CONFLICT(product_id) DO UPDATE SET session_id = 'sold', owner = 'sold', expires_at = excluded.expires_at`,
		)
		.bind(productId, now() + 86400)
		.run();
