// Online orders in D1 (table orders). A row is written when the customer goes to the Stripe checkout (status 'pending', with
// the piece ids, so an order can hold any number of pieces: Stripe's metadata only fits about ten ids), and completed by
// the webhook when the payment arrives ('paid', with name, shipping address, email, phone, amount). The dashboard lists
// paid orders, prints address labels and packing slips (public/admin/label.html) and marks them as shipped.

import type { D1Database, Env } from './auth.ts';

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
