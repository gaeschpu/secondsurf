// Customer accounts: email + password, wishlist, shipping addresses and price-drop alerts.
// Everything lives in the Cloudflare D1 database bound as DB. The tables create themselves on first use.

import { SITE } from '../../src/config.ts';
import { url, type Lang } from '../../src/i18n/index.ts';
import type { D1Database, Env } from './auth.ts';
import { sendMail } from './mail.ts';

export const LANGS = ['de', 'fr', 'it', 'en'] as const;
export const asLang = (value: unknown): Lang => (LANGS.includes(value as Lang) ? (value as Lang) : 'de');
const now = () => Math.floor(Date.now() / 1000);

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY,
		email TEXT NOT NULL UNIQUE,
		password TEXT NOT NULL,
		name TEXT NOT NULL DEFAULT '',
		lang TEXT NOT NULL DEFAULT 'de',
		verified INTEGER NOT NULL DEFAULT 0,
		price_alerts INTEGER NOT NULL DEFAULT 1,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
	/** One-time links: email verification and password reset. */
	`CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS wishlist (
		user_id INTEGER NOT NULL,
		product_id TEXT NOT NULL,
		saved_price REAL NOT NULL,
		notified_price REAL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (user_id, product_id)
	)`,
	`CREATE INDEX IF NOT EXISTS wishlist_product ON wishlist (product_id)`,
	/** The addresses of one customer, as a JSON list. */
	`CREATE TABLE IF NOT EXISTS addresses (user_id INTEGER PRIMARY KEY, list TEXT NOT NULL)`,
	/** Login and email attempts, to slow down guessing and spam. */
	`CREATE TABLE IF NOT EXISTS attempts (key TEXT NOT NULL, at INTEGER NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS attempts_key ON attempts (key, at)`,
];

let schemaReady: Promise<unknown> | null = null;

/** The database, with its tables created on the first call (once per server instance). */
export async function database(env: Env): Promise<D1Database> {
	const db = env.DB!;
	schemaReady ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((error) => {
		schemaReady = null;
		throw error;
	});
	await schemaReady;
	return db;
}

// ---------------------------------------------------------------- passwords

/**
 * PBKDF2-SHA256. 50,000 rounds keep a login within the 10 ms CPU limit of Cloudflare's free plan.
 * The rounds are stored with each hash, so raising this later upgrades passwords at the next login.
 */
export const ROUNDS = 50_000;
const encoder = new TextEncoder();
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number) {
	const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
	return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
}

export async function hashPassword(password: string) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return `pbkdf2$${ROUNDS}$${b64(salt)}$${b64(await derive(password, salt, ROUNDS))}`;
}

export async function checkPassword(password: string, stored: string) {
	const [, rounds, salt, hash] = stored.split('$');
	const actual = new Uint8Array(await derive(password, unb64(salt), Number(rounds)));
	const expected = unb64(hash);
	let diff = actual.length ^ expected.length;
	for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ (expected[i] ?? 0);
	return { ok: diff === 0, outdated: Number(rounds) < ROUNDS };
}

export const PASSWORD_MIN = 10;
export const isValidPassword = (password: unknown): password is string =>
	typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= 200;

// ---------------------------------------------------------------- sessions and one-time links

const COOKIE = 'secondsurf_session';
const SESSION_DAYS = 60;

const randomToken = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = async (text: string) => b64(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

export async function startSession(db: D1Database, userId: number) {
	const token = randomToken();
	await db
		.prepare('INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)')
		.bind(await sha256(token), userId, now() + SESSION_DAYS * 86400)
		.run();
	return `${COOKIE}=${token}; Path=/api/account; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
}

export const endSessionCookie = `${COOKIE}=; Path=/api/account; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

const sessionToken = (request: Request) =>
	(request.headers.get('Cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{43})(?:;|$)`))?.[1];

export interface User {
	id: number;
	email: string;
	password: string;
	name: string;
	lang: Lang;
	verified: number;
	price_alerts: number;
}

export async function currentUser(db: D1Database, request: Request) {
	const token = sessionToken(request);
	if (!token) return null;
	return db
		.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.hash = ? AND sessions.expires_at > ?')
		.bind(await sha256(token), now())
		.first<User>();
}

export async function endSession(db: D1Database, request: Request) {
	const token = sessionToken(request);
	if (token) await db.prepare('DELETE FROM sessions WHERE hash = ?').bind(await sha256(token)).run();
}

export async function createLink(db: D1Database, userId: number, kind: 'verify' | 'reset') {
	const token = randomToken();
	const hours = kind === 'verify' ? 7 * 24 : 1;
	await db.batch([
		db.prepare('DELETE FROM tokens WHERE user_id = ? AND kind = ?').bind(userId, kind),
		db.prepare('INSERT INTO tokens (hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), userId, kind, now() + hours * 3600),
	]);
	return token;
}

/** Returns the user id and removes the link, so it only works once. */
export async function useLink(db: D1Database, token: string, kind: 'verify' | 'reset') {
	const hash = await sha256(token);
	const row = await db.prepare('SELECT user_id FROM tokens WHERE hash = ? AND kind = ? AND expires_at > ?').bind(hash, kind, now()).first<{ user_id: number }>();
	if (row) await db.prepare('DELETE FROM tokens WHERE hash = ?').bind(hash).run();
	return row?.user_id ?? null;
}

// ---------------------------------------------------------------- rate limits

/** Records an attempt and says whether there were already `max` within `minutes`. */
export async function tooMany(db: D1Database, key: string, max: number, minutes: number) {
	const since = now() - minutes * 60;
	const row = await db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?').bind(key, since).first<{ n: number }>();
	if ((row?.n ?? 0) >= max) return true;
	await db.batch([
		db.prepare('INSERT INTO attempts (key, at) VALUES (?, ?)').bind(key, now()),
		db.prepare('DELETE FROM attempts WHERE at < ?').bind(now() - 86400),
	]);
	return false;
}

// ---------------------------------------------------------------- addresses

export const MAX_ADDRESSES = 5;
const ADDRESS_FIELDS = { name: 120, street: 200, extra: 200, zip: 20, city: 120, country: 80, phone: 40 } as const;
export type Address = Record<keyof typeof ADDRESS_FIELDS, string>;

/** Cleans a list of addresses from the browser. Returns null if a required field is missing. */
export function parseAddresses(value: unknown): Address[] | null {
	if (!Array.isArray(value) || value.length > MAX_ADDRESSES) return null;
	const list: Address[] = [];
	for (const item of value) {
		const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
		const address = Object.fromEntries(
			Object.entries(ADDRESS_FIELDS).map(([key, max]) => [key, typeof raw[key] === 'string' ? raw[key].trim().replace(/\s+/g, ' ').slice(0, max) : '']),
		) as Address;
		if (!address.name || !address.street || !address.zip || !address.city || !address.country) return null;
		list.push(address);
	}
	return list;
}

// ---------------------------------------------------------------- emails

const MAILS = {
	verify: {
		de: ['Bestätige deine E-Mail-Adresse für secondsurf', 'Hallo\n\nWillkommen bei secondsurf! Bitte bestätige deine E-Mail-Adresse mit diesem Link (7 Tage gültig):\n\n{link}\n\nErst danach bekommst du Preisalarme für deine Wunschliste.\n\nDu hast kein Konto erstellt? Dann ignoriere diese E-Mail einfach.\n\nsecondsurf'],
		fr: ['Confirme ton adresse e-mail pour secondsurf', 'Bonjour\n\nBienvenue chez secondsurf ! Confirme ton adresse e-mail avec ce lien (valable 7 jours) :\n\n{link}\n\nEnsuite seulement, tu recevras les alertes de prix de ta liste d’envies.\n\nTu n’as pas créé de compte ? Ignore simplement cet e-mail.\n\nsecondsurf'],
		it: ['Conferma il tuo indirizzo e-mail per secondsurf', 'Ciao\n\nBenvenuto/a su secondsurf! Conferma il tuo indirizzo e-mail con questo link (valido 7 giorni):\n\n{link}\n\nSolo dopo riceverai gli avvisi di prezzo per la tua lista dei desideri.\n\nNon hai creato un account? Ignora semplicemente questa e-mail.\n\nsecondsurf'],
		en: ['Confirm your email address for secondsurf', 'Hello\n\nWelcome to secondsurf! Please confirm your email address with this link (valid for 7 days):\n\n{link}\n\nOnly then will you get price alerts for your wishlist.\n\nDidn’t create an account? Just ignore this email.\n\nsecondsurf'],
	},
	reset: {
		de: ['Neues Passwort für secondsurf', 'Hallo\n\nMit diesem Link setzt du ein neues Passwort (1 Stunde gültig):\n\n{link}\n\nDu hast das nicht verlangt? Dann ignoriere diese E-Mail, dein Passwort bleibt gleich.\n\nsecondsurf'],
		fr: ['Nouveau mot de passe pour secondsurf', 'Bonjour\n\nCe lien te permet de choisir un nouveau mot de passe (valable 1 heure) :\n\n{link}\n\nTu n’as rien demandé ? Ignore cet e-mail, ton mot de passe ne change pas.\n\nsecondsurf'],
		it: ['Nuova password per secondsurf', 'Ciao\n\nCon questo link imposti una nuova password (valido 1 ora):\n\n{link}\n\nNon l’hai chiesto tu? Ignora questa e-mail, la tua password resta invariata.\n\nsecondsurf'],
		en: ['New password for secondsurf', 'Hello\n\nUse this link to set a new password (valid for 1 hour):\n\n{link}\n\nDidn’t ask for this? Ignore this email and your password stays the same.\n\nsecondsurf'],
	},
	priceDrop: {
		de: ['Preis gesenkt: {title}', 'Hallo\n\nGute Nachricht: «{title}» auf deiner Wunschliste kostet jetzt {new} statt {old}.\n\nJedes Piece gibt es nur einmal, also sei schnell:\n{link}\n\nKeine Preisalarme mehr? Schalte sie in deinem Profil aus: {profile}\n\nsecondsurf'],
		fr: ['Prix baissé : {title}', 'Bonjour\n\nBonne nouvelle : « {title} » de ta liste d’envies coûte maintenant {new} au lieu de {old}.\n\nChaque pièce est unique, alors fais vite :\n{link}\n\nTu ne veux plus d’alertes de prix ? Désactive-les dans ton profil : {profile}\n\nsecondsurf'],
		it: ['Prezzo ribassato: {title}', 'Ciao\n\nBuone notizie: «{title}» nella tua lista dei desideri ora costa {new} invece di {old}.\n\nOgni pezzo è unico, quindi fai presto:\n{link}\n\nNon vuoi più avvisi di prezzo? Disattivali nel tuo profilo: {profile}\n\nsecondsurf'],
		en: ['Price drop: {title}', 'Hello\n\nGood news: “{title}” on your wishlist now costs {new} instead of {old}.\n\nEvery piece is one of a kind, so be quick:\n{link}\n\nNo more price alerts? Turn them off in your profile: {profile}\n\nsecondsurf'],
	},
} satisfies Record<string, Record<Lang, [string, string]>>;

const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
const site = (lang: Lang, path: string) => new URL(url(lang, path), SITE.url).href;
const chf = (amount: number) => (Number.isInteger(amount) ? `CHF ${amount}.–` : `CHF ${amount.toFixed(2)}`);

export const canEmail = (env: Env) => Boolean(env.RESEND_API_KEY);

export async function sendAccountMail(env: Env, kind: 'verify' | 'reset', to: string, lang: Lang, token: string, origin: string) {
	const [subject, text] = MAILS[kind][lang];
	// The verification link goes to the API, which confirms and then opens the profile.
	const link = kind === 'verify' ? `${origin}/api/account/verify?token=${token}&lang=${lang}` : `${origin}${url(lang, '/account/')}?reset=${token}`;
	await sendMail(env, { to, subject, text: fill(text, { link }) });
}

/** The title in one language, from the index.md of a piece (dashboard JSON or hand-written YAML). */
export function titleIn(markdown: string, lang: Lang) {
	const line = markdown.match(/^title:[ \t]*(.+)$/m)?.[1]?.trim() ?? '';
	if (!line.startsWith('{')) return line.replace(/^["']|["']$/g, '');
	const pick = (l: Lang) => line.match(new RegExp(`"?${l}"?:\\s*("(?:[^"\\\\]|\\\\.)*"|[^,}\\n]+)`))?.[1]?.trim();
	const value = pick(lang) || pick('de') || '';
	try {
		return value.startsWith('"') ? JSON.parse(value) : value;
	} catch {
		return value.replace(/^"|"$/g, '');
	}
}

/**
 * After the owner lowers a price: emails everyone who saved the piece, has a confirmed email and alerts on,
 * once per lower price. Raising the price again and lowering it to the same amount doesn't email twice.
 */
export async function notifyPriceDrop(env: Env, productId: string, markdown: string, price: number) {
	if (!env.DB || !canEmail(env) || /^(sold|draft):\s*true\b/m.test(markdown)) return 0;
	const db = await database(env);
	const brand = markdown.match(/^brand:[ \t]*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
	const { results } = await db
		.prepare(
			`SELECT wishlist.user_id, wishlist.saved_price, wishlist.notified_price, users.email, users.lang
			FROM wishlist JOIN users ON users.id = wishlist.user_id
			WHERE wishlist.product_id = ? AND users.verified = 1 AND users.price_alerts = 1
			AND ? < COALESCE(wishlist.notified_price, wishlist.saved_price)`,
		)
		.bind(productId, price)
		.all<{ user_id: number; saved_price: number; notified_price: number | null; email: string; lang: string }>();

	let sent = 0;
	for (const row of results) {
		const lang = asLang(row.lang);
		const title = `${brand} ${titleIn(markdown, lang)}`.trim();
		const [subject, text] = MAILS.priceDrop[lang];
		const values = {
			title,
			new: chf(price),
			old: chf(row.notified_price ?? row.saved_price),
			link: site(lang, `/item/${productId}/`),
			profile: site(lang, '/account/'),
		};
		try {
			await sendMail(env, { to: row.email, subject: fill(subject, values), text: fill(text, values) });
			await db.prepare('UPDATE wishlist SET notified_price = ? WHERE user_id = ? AND product_id = ?').bind(price, row.user_id, productId).run();
			sent++;
		} catch (error) {
			console.error('Price alert failed', error);
		}
	}
	return sent;
}
