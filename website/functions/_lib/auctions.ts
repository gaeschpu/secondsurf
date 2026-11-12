// Auctions, Ricardo style. The owner starts one in /admin (start price + end time). Logged-in customers with a confirmed
// email bid by setting a limit: the site bids for them automatically in CHF 1 steps, up to that limit. Everything lives in
// D1; no commit is needed until the piece is paid (then the Stripe webhook marks it as sold, as with any order).
//
// Status: running → unsold (no bids) | cancelled (owner, no bids) | payment → paid | failed
// payment: the buyer (round 1 = winner, round 2 = second-highest bidder) pays within PAY_HOURS on /auction/?t=<token>
// or in their profile. Not paid: round 1 → the winner is blocked from bidding and the next bidder gets the offer at their
// own limit; round 2 (or nobody left) → failed, the piece is back on normal sale.
//
// Ending, reminders and deadlines happen in settle(): on every view and bid, and every 10 minutes from
// .github/workflows/auction-tick.yml (POST /api/auctions/tick), so it never depends on one of them alone.

import type { D1Database, Env } from './auth.ts';
import type { User } from './accounts.ts';
import { sendMail } from './mail.ts';
import { SITE } from '../../src/config.ts';

type Lang = 'de' | 'fr' | 'it' | 'en';

/** Smallest step between two bids. */
export const STEP = 1;
/** A bid in the last minute (EXTEND_WINDOW) extends the auction by 5 minutes (EXTEND_BY). */
export const EXTEND_WINDOW = 60;
export const EXTEND_BY = 300;
/** Calendar reminders ring this long before the end. */
export const REMIND_BEFORE_MINUTES = 15;
export const PAY_HOURS = 48;
export const REMIND_AFTER_HOURS = 24;

export type AuctionStatus = 'running' | 'unsold' | 'cancelled' | 'payment' | 'paid' | 'failed';

export interface Auction {
	id: number;
	product_id: string;
	/** "Brand title" in German, for the owner. */
	product_name: string;
	/** The same per language, as JSON, for the customer emails. */
	names: string;
	start_price: number;
	/** The current price everyone sees. */
	price: number;
	bids: number;
	leader_id: number | null;
	/** The leader's limit: never shown to anyone else. */
	leader_max: number | null;
	ends_at: number;
	status: AuctionStatus;
	buyer_id: number | null;
	buyer_price: number | null;
	pay_token: string | null;
	pay_until: number | null;
	reminded: number;
	round: number;
	version: number;
	created_at: number;
	updated_at: number;
}

export const now = () => Math.floor(Date.now() / 1000);
export const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');

let ready: Promise<unknown> | null = null;

export async function auctionsDb(env: Env): Promise<D1Database | null> {
	if (!env.DB) return null;
	const db = env.DB;
	ready ??= db
		.batch([
			db.prepare(`CREATE TABLE IF NOT EXISTS auctions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				product_id TEXT NOT NULL,
				product_name TEXT NOT NULL,
				names TEXT NOT NULL DEFAULT '{}',
				start_price REAL NOT NULL,
				price REAL NOT NULL,
				bids INTEGER NOT NULL DEFAULT 0,
				leader_id INTEGER,
				leader_max REAL,
				ends_at INTEGER NOT NULL,
				status TEXT NOT NULL,
				buyer_id INTEGER,
				buyer_price REAL,
				pay_token TEXT UNIQUE,
				pay_until INTEGER,
				reminded INTEGER NOT NULL DEFAULT 0,
				round INTEGER NOT NULL DEFAULT 0,
				version INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)`),
			// At most one running or unpaid auction per piece.
			db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS auctions_open ON auctions (product_id) WHERE status IN ('running', 'payment')"),
			db.prepare('CREATE INDEX IF NOT EXISTS auctions_status ON auctions (status, ends_at)'),
			/** Every limit a customer set (private). */
			db.prepare(`CREATE TABLE IF NOT EXISTS auction_bids (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				auction_id INTEGER NOT NULL,
				user_id INTEGER NOT NULL,
				max REAL NOT NULL,
				created_at INTEGER NOT NULL
			)`),
			db.prepare('CREATE INDEX IF NOT EXISTS auction_bids_auction ON auction_bids (auction_id, user_id)'),
			db.prepare('CREATE INDEX IF NOT EXISTS auction_bids_user ON auction_bids (user_id)'),
			/** The public bid history: amounts with anonymised bidders; auto = placed by someone's limit. */
			db.prepare(`CREATE TABLE IF NOT EXISTS auction_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				auction_id INTEGER NOT NULL,
				user_id INTEGER NOT NULL,
				amount REAL NOT NULL,
				auto INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL
			)`),
			db.prepare('CREATE INDEX IF NOT EXISTS auction_history_auction ON auction_history (auction_id, id)'),
			/** When a customer accepted the auction terms. */
			db.prepare('CREATE TABLE IF NOT EXISTS auction_terms (user_id INTEGER PRIMARY KEY, accepted_at INTEGER NOT NULL)'),
			/** Emails that may not bid any more (an auction won and not paid). By email, so a new account doesn't help. */
			db.prepare('CREATE TABLE IF NOT EXISTS auction_blocks (email TEXT PRIMARY KEY, auction_id INTEGER NOT NULL, at INTEGER NOT NULL)'),
			/** Paid orders, from the Stripe webhook: accounts without one may only hold one unpaid auction at a time. */
			db.prepare('CREATE TABLE IF NOT EXISTS purchases (session_id TEXT PRIMARY KEY, email TEXT NOT NULL, at INTEGER NOT NULL)'),
			db.prepare('CREATE INDEX IF NOT EXISTS purchases_email ON purchases (email)'),
		])
		.catch((error) => {
			ready = null;
			throw error;
		});
	await ready;
	return db;
}

// ---------------------------------------------------------------- starting

export const MAX_DAYS = 30;

/**
 * Starts an auction. names = "Brand title" per language. endsAt in seconds. Returns an error message for the dashboard,
 * or null when it runs. Used by /api/admin/auctions (an existing piece) and /api/admin/products (a new auction lot).
 */
export async function createAuction(db: D1Database, productId: string, names: Record<Lang, string>, startPrice: number, endsAt: number) {
	if (!(startPrice >= 1)) return 'Enter a start price of at least CHF 1.';
	if (!(endsAt > now() + 10 * 60) || endsAt > now() + MAX_DAYS * 86400) return `Choose an end between 10 minutes and ${MAX_DAYS} days from now.`;
	const t = now();
	try {
		await db
			.prepare(
				`INSERT INTO auctions (product_id, product_name, names, start_price, price, ends_at, status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
			)
			.bind(productId, names.de, JSON.stringify(names), startPrice, startPrice, endsAt, t, t)
			.run();
	} catch {
		// The unique index: this piece already has a running auction or one waiting for payment.
		return 'This piece already has an auction.';
	}
	return null;
}

// ---------------------------------------------------------------- reading

/** The open auction of a piece (running or waiting for payment), or null. */
export const openAuction = (db: D1Database, productId: string) =>
	db.prepare("SELECT * FROM auctions WHERE product_id = ? AND status IN ('running', 'payment')").bind(productId).first<Auction>();

/** The open auction, otherwise the latest one, of a piece. */
export const latestAuction = (db: D1Database, productId: string) =>
	db
		.prepare(
			"SELECT * FROM auctions WHERE product_id = ? ORDER BY CASE WHEN status IN ('running', 'payment') THEN 0 ELSE 1 END, id DESC LIMIT 1",
		)
		.bind(productId)
		.first<Auction>();

export const byPayToken = (db: D1Database, token: string) =>
	/^[0-9a-f]{48}$/.test(token) ? db.prepare('SELECT * FROM auctions WHERE pay_token = ?').bind(token).first<Auction>() : Promise.resolve(null);

/** True while a piece is being auctioned, waits for the winner's payment, or was paid through an auction (sold, even before
 *  the rebuild marks it sold): then it can't be bought or offered for. */
export async function auctionBlocksSale(env: Env, productId: string) {
	const db = await auctionsDb(env).catch(() => null);
	if (!db) return false;
	if (await openAuction(db, productId)) return true;
	return Boolean(await db.prepare("SELECT 1 FROM auctions WHERE product_id = ? AND status = 'paid' LIMIT 1").bind(productId).first());
}

/**
 * What the shop shows on a piece because of an auction: 'auction' (running), 'reserved' (ended with a winner who hasn't paid
 * yet) or 'sold' (paid through the auction). Pieces without any of these aren't listed.
 */
export async function auctionStates(db: D1Database) {
	const t = Math.floor(Date.now() / 1000);
	const { results } = await db
		.prepare("SELECT product_id, status, ends_at, bids FROM auctions WHERE status IN ('running', 'payment', 'paid')")
		.all<{ product_id: string; status: AuctionStatus; ends_at: number; bids: number }>();
	const rank = { auction: 1, reserved: 2, sold: 3 } as const;
	const states = new Map<string, keyof typeof rank>();
	for (const a of results) {
		// A running auction past its end is settled within minutes (tick): with bids it is already as good as reserved.
		const state = a.status === 'paid' ? 'sold' : a.status === 'payment' ? 'reserved' : a.ends_at > t ? 'auction' : a.bids > 0 ? 'reserved' : null;
		const before = states.get(a.product_id);
		// Several auctions for one piece (an old paid one, a new one): the strongest state counts.
		if (state && (!before || rank[state] > rank[before])) states.set(a.product_id, state);
	}
	return [...states].map(([id, state]) => ({ id, state }));
}

/** "K***3": first letter of the name and the last digit of the account number. */
export const anonymous = (userId: number, name?: string | null) => `${(name?.trim()[0] ?? 'B').toUpperCase()}***${userId % 10}`;

export function nameIn(auction: Pick<Auction, 'names' | 'product_name'>, lang: Lang) {
	try {
		return (JSON.parse(auction.names) as Record<string, string>)[lang] || auction.product_name;
	} catch {
		return auction.product_name;
	}
}

/** The smallest limit this customer can enter now. */
export function minimumFor(auction: Auction, userId?: number) {
	if (userId && auction.leader_id === userId) return (auction.leader_max ?? auction.price) + STEP;
	return auction.bids === 0 ? auction.start_price : auction.price + STEP;
}

const emailOf = (email: string) => email.trim().toLowerCase();
export const isBlocked = async (db: D1Database, email: string) =>
	Boolean(await db.prepare('SELECT 1 FROM auction_blocks WHERE email = ?').bind(emailOf(email)).first());
export const hasPurchase = async (db: D1Database, email: string) =>
	Boolean(await db.prepare('SELECT 1 FROM purchases WHERE email = ? LIMIT 1').bind(emailOf(email)).first());
export const acceptedTerms = async (db: D1Database, userId: number) =>
	Boolean(await db.prepare('SELECT 1 FROM auction_terms WHERE user_id = ?').bind(userId).first());

/** Recorded by the Stripe webhook for every paid order. */
export const recordPurchase = (db: D1Database, sessionId: string, email: string) =>
	db.prepare('INSERT OR IGNORE INTO purchases (session_id, email, at) VALUES (?, ?, ?)').bind(sessionId, emailOf(email), now()).run();

/**
 * Why this customer can't bid right now, or null. New accounts (no paid order yet) may hold only one auction at a time:
 * not while they have an unpaid win, and not while they lead another running auction.
 */
export async function cannotBid(db: D1Database, user: User, auction: Auction): Promise<string | null> {
	if (user.verified !== 1) return 'verify';
	if (await isBlocked(db, user.email)) return 'blocked';
	if (await hasPurchase(db, user.email)) return null;
	const unpaid = await db.prepare("SELECT 1 FROM auctions WHERE status = 'payment' AND buyer_id = ? LIMIT 1").bind(user.id).first();
	if (unpaid) return 'unpaidWin';
	const leading = await db
		.prepare("SELECT 1 FROM auctions WHERE status = 'running' AND leader_id = ? AND id != ? LIMIT 1")
		.bind(user.id, auction.id)
		.first();
	return leading ? 'oneAtATime' : null;
}

// ---------------------------------------------------------------- bidding

type BidResult =
	| { ok: true; leading: boolean; auction: Auction }
	| { ok: false; error: string; minimum?: number; auction?: Auction | null };

/**
 * Places a limit. Several customers can bid at the same moment: the new state is written with a conditional UPDATE on
 * the auction's version, in one transaction with the bid rows, so only one of two simultaneous bids gets through; the
 * other is recalculated from the new state (up to a few times).
 */
export async function placeBid(env: Env, user: User, productId: string, max: number, origin: string, background: (p: Promise<unknown>) => void): Promise<BidResult> {
	const db = (await auctionsDb(env))!;
	for (let attempt = 0; attempt < 5; attempt++) {
		let a = await openAuction(db, productId);
		if (a) a = await settle(env, db, a, origin, background);
		if (!a || a.status !== 'running') return { ok: false, error: 'ended', auction: a };
		const reason = await cannotBid(db, user, a);
		if (reason) return { ok: false, error: reason };

		const t = now();
		const minimum = minimumFor(a, user.id);
		if (!(max >= minimum)) return { ok: false, error: 'tooLow', minimum };

		let leader = a.leader_id;
		let leaderMax = a.leader_max;
		let price = a.price;
		let outbid: number | null = null;
		const history: [userId: number, amount: number, auto: 0 | 1][] = [];

		if (a.leader_id === user.id) {
			// The leader raises their own limit: the price stays.
			leaderMax = max;
		} else if (a.leader_id === null || a.leader_max === null) {
			leader = user.id;
			leaderMax = max;
			price = a.start_price;
			history.push([user.id, price, 0]);
		} else if (max > a.leader_max) {
			// The new limit is higher: the new bidder leads, one step above the old limit (at most their own limit).
			outbid = a.leader_id;
			if (a.leader_max > a.price) history.push([a.leader_id, a.leader_max, 1]);
			leader = user.id;
			leaderMax = max;
			price = Math.min(max, a.leader_max + STEP);
			history.push([user.id, price, 0]);
		} else {
			// The leader's limit is higher (or the same and earlier): they stay ahead, one step above the new bid.
			price = Math.min(a.leader_max, max + STEP);
			history.push([user.id, max, 0], [a.leader_id, price, 1]);
		}

		const endsAt = a.ends_at - t <= EXTEND_WINDOW ? a.ends_at + EXTEND_BY : a.ends_at;
		// Raising one's own limit changes nothing anyone sees, so it doesn't count as a bid (nor extend the end).
		const raise = a.leader_id === user.id;
		const counted = raise ? 0 : 1;
		const statements = [
			db
				.prepare(
					`UPDATE auctions SET price = ?, bids = bids + ?, leader_id = ?, leader_max = ?, ends_at = ?, version = version + 1, updated_at = ?
					 WHERE id = ? AND version = ? AND status = 'running' AND ends_at > ?`,
				)
				.bind(price, counted, leader, leaderMax, raise ? a.ends_at : endsAt, t, a.id, a.version, t),
			// Each row is only written when the one before was (changes() = 1), so a lost race leaves no trace.
			db.prepare('INSERT INTO auction_bids (auction_id, user_id, max, created_at) SELECT ?, ?, ?, ? WHERE changes() = 1').bind(a.id, user.id, max, t),
			...history.map(([userId, amount, auto]) =>
				db
					.prepare('INSERT INTO auction_history (auction_id, user_id, amount, auto, created_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1')
					.bind(a!.id, userId, amount, auto, t),
			),
		];
		const results = (await db.batch(statements)) as { meta: { changes: number } }[];
		if (results[0].meta.changes !== 1) continue;

		const updated = { ...a, price, bids: a.bids + counted, leader_id: leader, leader_max: leaderMax, ends_at: raise ? a.ends_at : endsAt, version: a.version + 1, updated_at: t };
		if (outbid !== null) background(mailUser(env, db, outbid, 'outbid', updated, origin).catch((e) => console.error('Outbid email failed', e)));
		return { ok: true, leading: leader === user.id, auction: updated };
	}
	return { ok: false, error: 'busy' };
}

// ---------------------------------------------------------------- ending and deadlines

/** Someone is at the Stripe checkout for this piece right now: don't move the auction on under their feet. */
async function checkoutOpen(db: D1Database, productId: string) {
	const row = await db
		.prepare("SELECT 1 FROM checkout_holds WHERE product_id = ? AND session_id NOT IN ('', 'sold') AND expires_at > ?")
		.bind(productId, now())
		.first()
		.catch(() => null);
	return Boolean(row);
}

/**
 * Moves an auction on if its time has come: end it, remind the buyer, or pass it on after the payment deadline.
 * Every step is a conditional UPDATE, so it happens exactly once even when several requests arrive together.
 * Returns the auction as it is now. Emails go out through `background`.
 */
export async function settle(env: Env, db: D1Database, a: Auction, origin: string, background: (p: Promise<unknown>) => void): Promise<Auction> {
	const t = now();
	const reload = async () => (await db.prepare('SELECT * FROM auctions WHERE id = ?').bind(a.id).first<Auction>()) ?? a;
	const later = (p: Promise<unknown>) => background(p.catch((error) => console.error('Auction email failed', error)));

	if (a.status === 'running' && a.ends_at <= t) {
		if (a.bids === 0) {
			const r = await db.prepare("UPDATE auctions SET status = 'unsold', updated_at = ? WHERE id = ? AND status = 'running'").bind(t, a.id).run();
			if (r.meta.changes === 1) later(mailOwner(env, { ...a, status: 'unsold' }, 'unsold', origin));
			return reload();
		}
		const token = newToken();
		const r = await db
			.prepare(
				`UPDATE auctions SET status = 'payment', round = 1, buyer_id = leader_id, buyer_price = price, pay_token = ?, pay_until = ?, reminded = 0, updated_at = ?
				 WHERE id = ? AND status = 'running' AND ends_at <= ?`,
			)
			.bind(token, t + PAY_HOURS * 3600, t, a.id, t)
			.run();
		const now_ = await reload();
		if (r.meta.changes === 1) later(Promise.all([mailUser(env, db, now_.buyer_id!, 'won', now_, origin), mailOwner(env, now_, 'won', origin)]));
		return now_;
	}

	if (a.status === 'payment' && a.pay_until && a.pay_token) {
		if (!a.reminded && t >= a.pay_until - (PAY_HOURS - REMIND_AFTER_HOURS) * 3600 && t < a.pay_until) {
			const r = await db.prepare('UPDATE auctions SET reminded = 1 WHERE id = ? AND pay_token = ? AND reminded = 0').bind(a.id, a.pay_token).run();
			if (r.meta.changes === 1) later(mailUser(env, db, a.buyer_id!, 'reminder', a, origin));
			return reload();
		}
		if (t > a.pay_until && !(await checkoutOpen(db, a.product_id))) return passOn(env, db, a, origin, later, reload);
	}
	return a;
}

/** The buyer didn't pay in time: block the winner and offer the piece to the next bidder, or give up. */
async function passOn(
	env: Env,
	db: D1Database,
	a: Auction,
	origin: string,
	later: (p: Promise<unknown>) => void,
	reload: () => Promise<Auction>,
) {
	const t = now();
	const late = a.buyer_id!;
	const next =
		a.round === 1
			? await db
					.prepare(
						`SELECT b.user_id AS user_id, MAX(b.max) AS max FROM auction_bids b JOIN users u ON u.id = b.user_id
						 WHERE b.auction_id = ? AND b.user_id != ? AND lower(u.email) NOT IN (SELECT email FROM auction_blocks)
						 GROUP BY b.user_id ORDER BY max DESC, MIN(b.created_at) LIMIT 1`,
					)
					.bind(a.id, late)
					.first<{ user_id: number; max: number }>()
			: null;

	const r = next
		? await db
				.prepare(
					`UPDATE auctions SET round = 2, buyer_id = ?, buyer_price = ?, pay_token = ?, pay_until = ?, reminded = 0, updated_at = ?
					 WHERE id = ? AND status = 'payment' AND pay_token = ?`,
				)
				.bind(next.user_id, next.max, newToken(), t + PAY_HOURS * 3600, t, a.id, a.pay_token)
				.run()
		: await db.prepare("UPDATE auctions SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'payment' AND pay_token = ?").bind(t, a.id, a.pay_token).run();
	if (r.meta.changes !== 1) return reload();

	const now_ = await reload();
	const mails: Promise<unknown>[] = [];
	if (a.round === 1) {
		// Only the winner is blocked: the second bidder's offer is a second chance they may let go.
		const winner = await db.prepare('SELECT email FROM users WHERE id = ?').bind(late).first<{ email: string }>();
		if (winner) await db.prepare('INSERT OR IGNORE INTO auction_blocks (email, auction_id, at) VALUES (?, ?, ?)').bind(emailOf(winner.email), a.id, t).run();
		mails.push(mailUser(env, db, late, 'blocked', a, origin));
	} else mails.push(mailUser(env, db, late, 'expired', a, origin));
	if (next) mails.push(mailUser(env, db, next.user_id, 'second', now_, origin), mailOwner(env, now_, 'second', origin));
	else mails.push(mailOwner(env, now_, 'failed', origin));
	later(Promise.all(mails));
	return now_;
}

/** Every auction that may need to move on: ended ones still marked running, and all waiting for payment. */
export async function settleAll(env: Env, origin: string, background: (p: Promise<unknown>) => void) {
	const db = await auctionsDb(env);
	if (!db) return 0;
	const { results } = await db
		.prepare("SELECT * FROM auctions WHERE (status = 'running' AND ends_at <= ?) OR status = 'payment' ORDER BY ends_at LIMIT 25")
		.bind(now())
		.all<Auction>();
	for (const a of results) await settle(env, db, a, origin, background);
	return results.length;
}

// ---------------------------------------------------------------- emails

const chf = (amount: number | null) => `CHF ${(amount ?? 0).toFixed(2).replace(/\.00$/, '.–')}`;
const prefix = (lang: Lang) => (lang === 'de' ? '' : `/${lang}`);
const asLang = (value: unknown): Lang => (['de', 'fr', 'it', 'en'].includes(value as string) ? (value as Lang) : 'de');
export const payLink = (origin: string, lang: Lang, token: string) => `${origin}${prefix(lang)}/auction/?t=${token}`;
const when = (seconds: number, lang: Lang) =>
	new Intl.DateTimeFormat({ de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-GB' }[lang], {
		timeZone: 'Europe/Zurich',
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		hour: '2-digit',
		minute: '2-digit',
	}).format(seconds * 1000);

type Kind = 'outbid' | 'won' | 'reminder' | 'second' | 'blocked' | 'expired';
type V = { item: string; price: string; link: string; pay: string; until: string; account: string };

const MAILS: Record<Lang, Record<Kind, (v: V) => { subject: string; text: string }>> = {
	de: {
		outbid: (v) => ({
			subject: `Du wurdest überboten: ${v.item}`,
			text: `Hallo\n\nJemand hat bei ${v.item} mehr geboten als dein Limit. Das aktuelle Gebot ist ${v.price}.\n\nWillst du das Piece noch? Biete hier weiter:\n${v.link}\n\nsecondsurf`,
		}),
		won: (v) => ({
			subject: `Gewonnen: ${v.item} für ${v.price}`,
			text: `Hallo\n\nGratuliere, du hast die Auktion gewonnen: ${v.item} für ${v.price} (plus Versand).\n\nBitte bezahle bis ${v.until}:\n${v.pay}\n\nDu findest die Zahlung auch in deinem Profil: ${v.account}\n\nWichtig: Dein Gebot ist verbindlich. Bezahlst du nicht rechtzeitig, wird dein Konto für Auktionen gesperrt.\n\nsecondsurf`,
		}),
		reminder: (v) => ({
			subject: `Erinnerung: ${v.item} bezahlen`,
			text: `Hallo\n\nDu hast ${v.item} für ${v.price} ersteigert, die Zahlung fehlt noch. Bitte bezahle bis ${v.until}:\n${v.pay}\n\nOhne Zahlung bis dann wird dein Konto für Auktionen gesperrt und das Piece geht an die nächste Person.\n\nsecondsurf`,
		}),
		second: (v) => ({
			subject: `Zweite Chance: ${v.item} für ${v.price}`,
			text: `Hallo\n\nDie Person mit dem höchsten Gebot hat ${v.item} nicht bezahlt. Du kannst das Piece jetzt zu deinem Höchstgebot von ${v.price} (plus Versand) haben.\n\nDas ist freiwillig. Willst du es, bezahle bis ${v.until}:\n${v.pay}\n\nsecondsurf`,
		}),
		blocked: (v) => ({
			subject: `Auktion nicht bezahlt: ${v.item}`,
			text: `Hallo\n\nDu hast ${v.item} ersteigert, aber nicht innert ${PAY_HOURS} Stunden bezahlt. Deshalb kannst du mit diesem Konto nicht mehr an Auktionen teilnehmen, und das Piece geht an die nächste Person.\n\nIst etwas schiefgelaufen? Antworte einfach auf diese E-Mail.\n\nsecondsurf`,
		}),
		expired: (v) => ({
			subject: `Angebot abgelaufen: ${v.item}`,
			text: `Hallo\n\nDein Angebot für ${v.item} ist abgelaufen. Das ist in Ordnung, du musst nichts tun.\n\nsecondsurf`,
		}),
	},
	fr: {
		outbid: (v) => ({
			subject: `Ton offre a été dépassée : ${v.item}`,
			text: `Bonjour\n\nQuelqu’un a offert plus que ta limite pour ${v.item}. L’offre actuelle est de ${v.price}.\n\nTu veux toujours la pièce ? Continue à enchérir ici :\n${v.link}\n\nsecondsurf`,
		}),
		won: (v) => ({
			subject: `Gagné : ${v.item} pour ${v.price}`,
			text: `Bonjour\n\nBravo, tu as gagné l’enchère : ${v.item} pour ${v.price} (plus l’envoi).\n\nMerci de payer d’ici ${v.until} :\n${v.pay}\n\nTu trouves aussi le paiement dans ton profil : ${v.account}\n\nImportant : ton offre est ferme. Si tu ne paies pas à temps, ton compte est bloqué pour les enchères.\n\nsecondsurf`,
		}),
		reminder: (v) => ({
			subject: `Rappel : payer ${v.item}`,
			text: `Bonjour\n\nTu as remporté ${v.item} pour ${v.price}, le paiement manque encore. Merci de payer d’ici ${v.until} :\n${v.pay}\n\nSans paiement d’ici là, ton compte est bloqué pour les enchères et la pièce va à la personne suivante.\n\nsecondsurf`,
		}),
		second: (v) => ({
			subject: `Deuxième chance : ${v.item} pour ${v.price}`,
			text: `Bonjour\n\nLa personne avec l’offre la plus haute n’a pas payé ${v.item}. Tu peux maintenant avoir la pièce à ton offre maximale de ${v.price} (plus l’envoi).\n\nC’est facultatif. Si tu la veux, paie d’ici ${v.until} :\n${v.pay}\n\nsecondsurf`,
		}),
		blocked: (v) => ({
			subject: `Enchère non payée : ${v.item}`,
			text: `Bonjour\n\nTu as remporté ${v.item}, mais tu ne l’as pas payée dans les ${PAY_HOURS} heures. Tu ne peux donc plus participer aux enchères avec ce compte, et la pièce va à la personne suivante.\n\nUn problème ? Réponds simplement à cet e-mail.\n\nsecondsurf`,
		}),
		expired: (v) => ({
			subject: `Offre expirée : ${v.item}`,
			text: `Bonjour\n\nTon offre pour ${v.item} a expiré. Pas de souci, tu n’as rien à faire.\n\nsecondsurf`,
		}),
	},
	it: {
		outbid: (v) => ({
			subject: `La tua offerta è stata superata: ${v.item}`,
			text: `Ciao\n\nQualcuno ha offerto più del tuo limite per ${v.item}. L’offerta attuale è di ${v.price}.\n\nVuoi ancora il pezzo? Continua a fare offerte qui:\n${v.link}\n\nsecondsurf`,
		}),
		won: (v) => ({
			subject: `Vinto: ${v.item} per ${v.price}`,
			text: `Ciao\n\nComplimenti, hai vinto l’asta: ${v.item} per ${v.price} (più la spedizione).\n\nPaga entro ${v.until}:\n${v.pay}\n\nTrovi il pagamento anche nel tuo profilo: ${v.account}\n\nImportante: la tua offerta è vincolante. Se non paghi in tempo, il tuo account viene bloccato per le aste.\n\nsecondsurf`,
		}),
		reminder: (v) => ({
			subject: `Promemoria: pagare ${v.item}`,
			text: `Ciao\n\nHai vinto ${v.item} per ${v.price}, ma il pagamento manca ancora. Paga entro ${v.until}:\n${v.pay}\n\nSenza pagamento entro allora, il tuo account viene bloccato per le aste e il pezzo va alla persona successiva.\n\nsecondsurf`,
		}),
		second: (v) => ({
			subject: `Seconda possibilità: ${v.item} per ${v.price}`,
			text: `Ciao\n\nLa persona con l’offerta più alta non ha pagato ${v.item}. Ora puoi avere il pezzo alla tua offerta massima di ${v.price} (più la spedizione).\n\nÈ facoltativo. Se lo vuoi, paga entro ${v.until}:\n${v.pay}\n\nsecondsurf`,
		}),
		blocked: (v) => ({
			subject: `Asta non pagata: ${v.item}`,
			text: `Ciao\n\nHai vinto ${v.item}, ma non l’hai pagato entro ${PAY_HOURS} ore. Per questo non puoi più partecipare alle aste con questo account, e il pezzo va alla persona successiva.\n\nQualcosa è andato storto? Rispondi semplicemente a questa e-mail.\n\nsecondsurf`,
		}),
		expired: (v) => ({
			subject: `Offerta scaduta: ${v.item}`,
			text: `Ciao\n\nLa tua offerta per ${v.item} è scaduta. Va bene così, non devi fare nulla.\n\nsecondsurf`,
		}),
	},
	en: {
		outbid: (v) => ({
			subject: `You've been outbid: ${v.item}`,
			text: `Hello\n\nSomeone bid more than your limit for ${v.item}. The current bid is ${v.price}.\n\nStill want the piece? Bid again here:\n${v.link}\n\nsecondsurf`,
		}),
		won: (v) => ({
			subject: `You won: ${v.item} for ${v.price}`,
			text: `Hello\n\nCongratulations, you won the auction: ${v.item} for ${v.price} (plus shipping).\n\nPlease pay by ${v.until}:\n${v.pay}\n\nYou'll also find the payment in your profile: ${v.account}\n\nImportant: your bid is binding. If you don't pay in time, your account is blocked from auctions.\n\nsecondsurf`,
		}),
		reminder: (v) => ({
			subject: `Reminder: pay for ${v.item}`,
			text: `Hello\n\nYou won ${v.item} for ${v.price}, but the payment is still missing. Please pay by ${v.until}:\n${v.pay}\n\nWithout payment by then, your account is blocked from auctions and the piece goes to the next person.\n\nsecondsurf`,
		}),
		second: (v) => ({
			subject: `Second chance: ${v.item} for ${v.price}`,
			text: `Hello\n\nThe highest bidder didn't pay for ${v.item}. You can now have the piece at your highest bid of ${v.price} (plus shipping).\n\nThis is optional. If you want it, pay by ${v.until}:\n${v.pay}\n\nsecondsurf`,
		}),
		blocked: (v) => ({
			subject: `Auction not paid: ${v.item}`,
			text: `Hello\n\nYou won ${v.item} but didn't pay within ${PAY_HOURS} hours. So you can't take part in auctions with this account any more, and the piece goes to the next person.\n\nDid something go wrong? Just reply to this email.\n\nsecondsurf`,
		}),
		expired: (v) => ({
			subject: `Offer expired: ${v.item}`,
			text: `Hello\n\nYour offer for ${v.item} has expired. That's fine, you don't need to do anything.\n\nsecondsurf`,
		}),
	},
};

/** An email to a customer in the language of their account. */
export async function mailUser(env: Env, db: D1Database, userId: number, kind: Kind, a: Auction, origin: string) {
	const user = await db.prepare('SELECT email, lang FROM users WHERE id = ?').bind(userId).first<{ email: string; lang: string }>();
	if (!user || !env.RESEND_API_KEY) return;
	const lang = asLang(user.lang);
	const v: V = {
		item: nameIn(a, lang),
		price: chf(kind === 'outbid' ? a.price : (a.buyer_price ?? a.price)),
		link: `${origin}${prefix(lang)}/item/${a.product_id}/`,
		pay: a.pay_token ? payLink(origin, lang, a.pay_token) : '',
		until: a.pay_until ? when(a.pay_until, lang) : '',
		account: `${origin}${prefix(lang)}/account/`,
	};
	await sendMail(env, { to: user.email, reply_to: SITE.email, ...MAILS[lang][kind](v) });
}

/** Short German notes to the owner. */
export async function mailOwner(env: Env, a: Auction, what: 'won' | 'unsold' | 'second' | 'failed', origin: string) {
	if (!env.RESEND_API_KEY) return;
	const head = {
		won: `Auktion beendet: ${chf(a.buyer_price)}, wartet auf Zahlung`,
		unsold: 'Auktion ohne Gebote beendet, wieder normal im Verkauf',
		second: `Nicht bezahlt: zweite Chance für ${chf(a.buyer_price)} an die nächste Person`,
		failed: 'Auktion nicht bezahlt, wieder normal im Verkauf',
	}[what];
	await sendMail(env, {
		to: SITE.email,
		subject: `${head} – ${a.product_name}`,
		text: [
			head,
			'',
			`Piece: ${a.product_name} (${a.product_id})`,
			`Startpreis: ${chf(a.start_price)} · Gebote: ${a.bids}`,
			...(a.pay_until && (what === 'won' || what === 'second') ? [`Zahlbar bis: ${when(a.pay_until, 'de')}`] : []),
			'',
			`Übersicht: ${origin}/admin/#auctions`,
		].join('\n'),
	});
}
