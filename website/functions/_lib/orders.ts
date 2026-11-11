// Online orders in D1 (table orders). A row is written when the customer goes to the Stripe checkout (status 'pending', with
// the piece ids, so an order can hold any number of pieces: Stripe's metadata only fits about ten ids), and completed by
// the webhook when the payment arrives ('paid', with name, shipping address, email, phone, amount). The dashboard lists
// paid orders, prints address labels and packing slips (public/admin/label.html) and marks them as shipped.

import type { D1Database, Env } from './auth.ts';
import { sendMail } from './mail.ts';
import { SITE } from '../../src/config.ts';

export type OrderStatus = 'pending' | 'paid' | 'shipped';

export interface Order {
	ref: string;
	session_id: string | null;
	/** JSON list of piece ids. */
	ids: string;
	/** JSON list of "Brand title" (in the customer's language), same order as ids. */
	names: string;
	lang: string;
	status: OrderStatus;
	amount: number | null;
	discount: string | null;
	name: string | null;
	line1: string | null;
	line2: string | null;
	postal_code: string | null;
	city: string | null;
	country: string | null;
	email: string | null;
	phone: string | null;
	created_at: number;
	paid_at: number | null;
	shipped_at: number | null;
}

const now = () => Math.floor(Date.now() / 1000);
export const newOrderRef = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

let ready: Promise<unknown> | null = null;

export async function ordersDb(env: Env): Promise<D1Database | null> {
	if (!env.DB) return null;
	const db = env.DB;
	ready ??= db
		.batch([
			db.prepare(`CREATE TABLE IF NOT EXISTS orders (
				ref TEXT PRIMARY KEY,
				session_id TEXT,
				ids TEXT NOT NULL,
				names TEXT NOT NULL DEFAULT '[]',
				lang TEXT NOT NULL DEFAULT 'de',
				status TEXT NOT NULL,
				amount REAL,
				discount TEXT,
				name TEXT,
				line1 TEXT,
				line2 TEXT,
				postal_code TEXT,
				city TEXT,
				country TEXT,
				email TEXT,
				phone TEXT,
				created_at INTEGER NOT NULL,
				paid_at INTEGER,
				shipped_at INTEGER
			)`),
			db.prepare('CREATE INDEX IF NOT EXISTS orders_status ON orders (status, paid_at)'),
			/** Tracking numbers per order and sender: 'shop', or 'u<account id>' for a seller who ships their own pieces. */
			db.prepare('CREATE TABLE IF NOT EXISTS tracking (order_ref TEXT NOT NULL, shipper TEXT NOT NULL, number TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (order_ref, shipper))'),
			/**
			 * The buyer's check of each parcel (link in the parcel email, /parcel/?t=<token>): 'open', 'ok' (received and fine) or
			 * 'problem' (with a note). For a seller's parcel, 'ok' makes the payout due at once; 'problem' holds it (functions/_lib/sellers.ts).
			 */
			db.prepare(`CREATE TABLE IF NOT EXISTS parcel_checks (
				token TEXT PRIMARY KEY,
				order_ref TEXT NOT NULL,
				shipper TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'open',
				note TEXT NOT NULL DEFAULT '',
				updated_at INTEGER NOT NULL,
				UNIQUE (order_ref, shipper)
			)`),
		])
		.catch((error) => {
			ready = null;
			throw error;
		});
	await ready;
	return db;
}

/** A new order before the checkout. Old unpaid ones (checkout abandoned) are cleaned up on the way. */
export async function createOrder(db: D1Database, ids: string[], names: string[], lang: string) {
	const ref = newOrderRef();
	await db.batch([
		db.prepare("DELETE FROM orders WHERE status = 'pending' AND created_at < ?").bind(now() - 3 * 86400),
		db.prepare("INSERT INTO orders (ref, ids, names, lang, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").bind(ref, JSON.stringify(ids), JSON.stringify(names), lang, now()),
	]);
	return ref;
}

export const orderByRef = (db: D1Database, ref: string) =>
	/^[0-9a-f]{24}$/.test(ref) ? db.prepare('SELECT * FROM orders WHERE ref = ?').bind(ref).first<Order>() : Promise.resolve(null);

type Address = { line1?: string; line2?: string; postal_code?: string; city?: string; country?: string } | null | undefined;

/** The payment arrived: store who gets the parcel. */
export async function markPaid(
	db: D1Database,
	ref: string,
	data: { sessionId: string; amount: number | null; discount?: string; name?: string | null; address: Address; email?: string | null; phone?: string | null },
) {
	const a = data.address ?? {};
	await db
		.prepare(
			`UPDATE orders SET status = 'paid', session_id = ?, amount = ?, discount = ?, name = ?, line1 = ?, line2 = ?, postal_code = ?, city = ?, country = ?,
			 email = ?, phone = ?, paid_at = ? WHERE ref = ? AND status = 'pending'`,
		)
		.bind(
			data.sessionId,
			data.amount,
			data.discount ?? null,
			data.name ?? null,
			a.line1 ?? null,
			a.line2 ?? null,
			a.postal_code ?? null,
			a.city ?? null,
			a.country ?? null,
			data.email ?? null,
			data.phone ?? null,
			now(),
			ref,
		)
		.run();
}

// ---------------------------------------------------------------- tracking numbers

/**
 * A Swiss Post tracking number as typed or scanned: 18 digits for Switzerland (99.60.123456.12345678), or the
 * international form (two letters, nine digits, two letters: RR123456789CH). Scans of 2D codes may carry more text;
 * the 18-digit number starting with 99 is taken out of it. Returns the bare number, or null.
 */
export function cleanTracking(value: unknown) {
	if (typeof value !== 'string') return null;
	const bare = value.toUpperCase().replace(/[\s.\-/]/g, '');
	if (/^\d{18}$/.test(bare) || /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(bare)) return bare;
	const inside = value.replace(/\D/g, ' ').match(/\b99\d{16}\b/)?.[0] ?? bare.match(/99\d{16}/)?.[0];
	return inside ?? null;
}

/** 996012345612345678 → 99.60.123456.12345678 (as printed on Swiss Post labels). */
export const formatTracking = (n: string) => (/^\d{18}$/.test(n) ? `${n.slice(0, 2)}.${n.slice(2, 4)}.${n.slice(4, 10)}.${n.slice(10)}` : n);
export const postTrackingLink = (n: string) => `https://www.post.ch/swisspost-tracking?formattedParcelCodes=${encodeURIComponent(n)}`;

const PARCEL_MAIL: Record<string, (v: Record<string, string>) => { subject: string; text: string }> = {
	de: (v) => ({
		subject: 'Dein Paket ist unterwegs',
		text: `Hallo${v.name ? ` ${v.name}` : ''}

Dein Paket von secondsurf ist unterwegs:
${v.pieces}

Sendungsnummer: ${v.number}
Verfolgen: ${v.post}

In die Post-App übernehmen (Strichcode zum Scannen): ${v.page}

Ist alles angekommen und in Ordnung? Bestätige es hier, oder melde ein Problem:
${v.check}

Viel Freude damit!
secondsurf`,
	}),
	fr: (v) => ({
		subject: 'Ton colis est en route',
		text: `Bonjour${v.name ? ` ${v.name}` : ''}

Ton colis secondsurf est en route :
${v.pieces}

Numéro d’envoi : ${v.number}
Suivre : ${v.post}

Ajouter à l’app de La Poste (code-barres à scanner) : ${v.page}

Tout est bien arrivé et en ordre ? Confirme-le ici, ou signale un problème :
${v.check}

Bonne réception !
secondsurf`,
	}),
	it: (v) => ({
		subject: 'Il tuo pacco è in viaggio',
		text: `Ciao${v.name ? ` ${v.name}` : ''}

Il tuo pacco secondsurf è in viaggio:
${v.pieces}

Numero d’invio: ${v.number}
Segui: ${v.post}

Aggiungilo all’app della Posta (codice a barre da scansionare): ${v.page}

È arrivato tutto ed è in ordine? Confermalo qui, oppure segnala un problema:
${v.check}

Buon divertimento!
secondsurf`,
	}),
	en: (v) => ({
		subject: 'Your parcel is on its way',
		text: `Hello${v.name ? ` ${v.name}` : ''}

Your secondsurf parcel is on its way:
${v.pieces}

Tracking number: ${v.number}
Track it: ${v.post}

Add it to the Swiss Post app (barcode to scan): ${v.page}

Did everything arrive in good order? Confirm it here, or report a problem:
${v.check}

Enjoy!
secondsurf`,
	}),
};

/**
 * Saves the tracking number of a parcel and emails the buyer once: the pieces in it, the number, the Swiss Post tracking
 * link and /tracking/?n=… (big barcode to scan into the Post-App). `pieces` are the names of what is in this parcel.
 */
export async function addTracking(env: Env, db: D1Database, ref: string, shipper: string, number: string, pieces: string[], origin: string) {
	const saved = await db
		.prepare('INSERT OR IGNORE INTO tracking (order_ref, shipper, number, created_at) VALUES (?, ?, ?, ?)')
		.bind(ref, shipper, number, now())
		.run();
	if (!saved.meta.changes) return;
	// The buyer's link to confirm this parcel or report a problem.
	const token = newOrderRef() + newOrderRef();
	await db
		.prepare("INSERT OR IGNORE INTO parcel_checks (token, order_ref, shipper, status, updated_at) VALUES (?, ?, ?, 'open', ?)")
		.bind(token, ref, shipper, now())
		.run();
	if (!env.RESEND_API_KEY) return;
	const order = await orderByRef(db, ref);
	if (!order?.email) return;
	const lang = ['de', 'fr', 'it', 'en'].includes(order.lang) ? order.lang : 'de';
	const prefix = lang === 'de' ? '' : `/${lang}`;
	const mail = PARCEL_MAIL[lang]({
		name: (order.name ?? '').split(' ')[0],
		pieces: pieces.map((p) => `- ${p}`).join('\n'),
		number: formatTracking(number),
		post: postTrackingLink(number),
		page: `${origin}${prefix}/tracking/?n=${number}`,
		check: `${origin}${prefix}/parcel/?t=${token}`,
	});
	await sendMail(env, { to: order.email, reply_to: SITE.email, ...mail }).catch((error) => console.error('Tracking email failed', error));
}

export const trackingFor = (db: D1Database, refs: string[]) =>
	refs.length
		? db
				.prepare(`SELECT order_ref, shipper, number FROM tracking WHERE order_ref IN (${refs.map(() => '?').join(',')})`)
				.bind(...refs)
				.all<{ order_ref: string; shipper: string; number: string }>()
				.then((r) => r.results)
		: Promise.resolve([]);
