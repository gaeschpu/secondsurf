// GET /api/admin/stats: everything the owner wants at a glance (Stats tab in /admin). Only for the logged-in admin
// (api/admin/_middleware.ts). Reads the D1 tables and the list of pieces the site publishes (products.json).
//
// shop:    customers, orders and revenue (all time, last 30 days, per month), pieces live / sold / stock value,
//          auctions, price offers, wishlists, drop reminders, commission from sellers
// sellers: per seller account: contact, IBAN set, submissions by status, pieces live, sales, revenue, commission,
//          payouts paid and open, and the lists of their pieces and sales

import { database } from '../../_lib/accounts.ts';
import { auctionsDb } from '../../_lib/auctions.ts';
import { json, type Handler } from '../../_lib/auth.ts';
import { offersDb } from '../../_lib/offers.ts';
import { ordersDb } from '../../_lib/orders.ts';
import { sellersDb } from '../../_lib/sellers.ts';

type Piece = { id: string; price: number; sold: boolean; auctionOnly?: boolean; brand?: string; title?: unknown };

const DAY = 86400;
const round = (n: number | null | undefined) => Math.round((n ?? 0) * 100) / 100;

export const onRequestGet: Handler = async ({ request, env }) => {
	if (!env.DB) return json({ error: 'The D1 database (binding DB) is missing.' }, 503);
	const now = Math.floor(Date.now() / 1000);
	const since30 = now - 30 * DAY;
	const accounts = await database(env);
	const [orders, sellers, auctions, offers] = await Promise.all([ordersDb(env), sellersDb(env), auctionsDb(env).catch(() => null), offersDb(env).catch(() => null)]);

	// The pieces as the site shows them.
	let pieces: Piece[] = [];
	try {
		const res = await (env.ASSETS ?? { fetch }).fetch(new URL('/products.json', request.url));
		if (res.ok) pieces = (await res.json()) as Piece[];
	} catch {
		// Without the list the piece numbers stay at 0.
	}
	const byId = new Map(pieces.map((p) => [p.id, p]));
	const live = pieces.filter((p) => !p.sold);

	const one = async <T>(db: typeof accounts | null, sql: string, ...bind: unknown[]) =>
		db ? ((await db.prepare(sql).bind(...bind).first<T>()) ?? null) : null;
	const all = async <T>(db: typeof accounts | null, sql: string, ...bind: unknown[]) => (db ? (await db.prepare(sql).bind(...bind).all<T>()).results : []);

	const paid = "status IN ('paid', 'shipped')";
	const [customers, customers30, verified, ordersAll, orders30, toShip, months, wishlist, reminders] = await Promise.all([
		one<{ n: number }>(accounts, 'SELECT COUNT(*) AS n FROM users'),
		one<{ n: number }>(accounts, 'SELECT COUNT(*) AS n FROM users WHERE created_at > ?', since30),
		one<{ n: number }>(accounts, 'SELECT COUNT(*) AS n FROM users WHERE verified = 1'),
		one<{ n: number; sum: number }>(orders, `SELECT COUNT(*) AS n, SUM(amount) AS sum FROM orders WHERE ${paid}`),
		one<{ n: number; sum: number }>(orders, `SELECT COUNT(*) AS n, SUM(amount) AS sum FROM orders WHERE ${paid} AND paid_at > ?`, since30),
		one<{ n: number }>(orders, "SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'"),
		all<{ month: string; n: number; sum: number }>(
			orders,
			`SELECT strftime('%Y-%m', paid_at, 'unixepoch') AS month, COUNT(*) AS n, SUM(amount) AS sum FROM orders
			 WHERE ${paid} AND paid_at > ? GROUP BY month ORDER BY month`,
			now - 365 * DAY,
		),
		one<{ n: number }>(accounts, 'SELECT COUNT(*) AS n FROM wishlist'),
		one<{ n: number }>(accounts, 'SELECT COUNT(*) AS n FROM drop_reminders').catch(() => null),
	]);

	const [auctionRunning, auctionPaid, offersOpen, offersPaid] = await Promise.all([
		one<{ n: number }>(auctions, "SELECT COUNT(*) AS n FROM auctions WHERE status = 'running' AND ends_at > ?", now),
		one<{ n: number; sum: number }>(auctions, "SELECT COUNT(*) AS n, SUM(buyer_price) AS sum FROM auctions WHERE status = 'paid'"),
		one<{ n: number }>(offers, "SELECT COUNT(*) AS n FROM offers WHERE status IN ('pending', 'countered', 'agreed', 'accepted')"),
		one<{ n: number }>(offers, "SELECT COUNT(*) AS n FROM offers WHERE status = 'paid'"),
	]);

	// ---------------------------------------------------------------- sellers
	type SellerRow = { user_id: number; iban: string; account_holder: string; accepted_at: number; name: string | null; email: string | null; phone: string | null };
	type Sub = { id: number; user_id: number; status: string; brand: string; title: string; price: number; product_id: string | null; created_at: number };
	type Sale = { id: number; user_id: number; order_ref: string; product_id: string; product_name: string; price: number; commission: number; payout: number; status: string; created_at: number; paid_out_at: number | null };
	const sellerRows = await all<SellerRow>(
		sellers,
		`SELECT s.user_id, s.iban, s.account_holder, s.accepted_at, u.name, u.email, p.phone
		 FROM sellers s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN phones p ON p.user_id = s.user_id ORDER BY s.accepted_at DESC`,
	);
	const subs = await all<Sub>(sellers, "SELECT id, user_id, status, brand, title, price, product_id, created_at FROM submissions WHERE status != 'withdrawn' ORDER BY created_at DESC");
	const sales = await all<Sale>(sellers, 'SELECT id, user_id, order_ref, product_id, product_name, price, commission, payout, status, created_at, paid_out_at FROM seller_sales ORDER BY created_at DESC');

	const sellerList = sellerRows.map((s) => {
		const mySubs = subs.filter((x) => x.user_id === s.user_id);
		const mySales = sales.filter((x) => x.user_id === s.user_id);
		const count = (status: string) => mySubs.filter((x) => x.status === status).length;
		const livePieces = mySubs.filter((x) => x.status === 'approved' && x.product_id && byId.has(x.product_id) && !byId.get(x.product_id)!.sold);
		const sum = (list: Sale[], key: 'price' | 'commission' | 'payout') => round(list.reduce((t, x) => t + x[key], 0));
		return {
			id: s.user_id,
			name: s.name ?? '(deleted account)',
			email: s.email ?? '',
			phone: s.phone ?? '',
			joined: s.accepted_at,
			iban: Boolean(s.iban),
			accountHolder: s.account_holder,
			submissions: { pending: count('pending'), approved: count('approved'), rejected: count('rejected') },
			live: livePieces.length,
			liveValue: round(livePieces.reduce((t, x) => t + (byId.get(x.product_id!)?.price ?? x.price), 0)),
			sales: mySales.length,
			revenue: sum(mySales, 'price'),
			commission: sum(mySales, 'commission'),
			paidOut: sum(mySales.filter((x) => x.status === 'paid_out'), 'payout'),
			open: sum(mySales.filter((x) => x.status !== 'paid_out'), 'payout'),
			lastSale: mySales[0]?.created_at ?? null,
			pieces: mySubs.map((x) => ({
				id: x.id,
				name: `${x.brand} ${x.title}`,
				price: x.product_id ? (byId.get(x.product_id)?.price ?? x.price) : x.price,
				status: x.status === 'approved' ? (x.product_id && byId.get(x.product_id)?.sold ? 'sold' : 'live') : x.status,
				productId: x.product_id,
				created: x.created_at,
			})),
			salesList: mySales.map((x) => ({ id: x.id, name: x.product_name, productId: x.product_id, price: x.price, commission: x.commission, payout: x.payout, status: x.status, created: x.created_at, paidOut: x.paid_out_at })),
		};
	});

	return json({
		generated: now,
		shop: {
			customers: customers?.n ?? 0,
			customers30: customers30?.n ?? 0,
			verified: verified?.n ?? 0,
			orders: ordersAll?.n ?? 0,
			revenue: round(ordersAll?.sum),
			orders30: orders30?.n ?? 0,
			revenue30: round(orders30?.sum),
			averageOrder: ordersAll?.n ? round((ordersAll.sum ?? 0) / ordersAll.n) : 0,
			toShip: toShip?.n ?? 0,
			months: months.map((m) => ({ month: m.month, orders: m.n, revenue: round(m.sum) })),
			piecesLive: live.filter((p) => !p.auctionOnly).length,
			piecesSold: pieces.filter((p) => p.sold).length,
			stockValue: round(live.reduce((t, p) => t + (p.price ?? 0), 0)),
			auctionLots: live.filter((p) => p.auctionOnly).length,
			auctionsRunning: auctionRunning?.n ?? 0,
			auctionsPaid: auctionPaid?.n ?? 0,
			auctionRevenue: round(auctionPaid?.sum),
			offersOpen: offersOpen?.n ?? 0,
			offersPaid: offersPaid?.n ?? 0,
			wishlist: wishlist?.n ?? 0,
			dropReminders: reminders?.n ?? 0,
			sellers: sellerRows.length,
			sellerRevenue: round(sales.reduce((t, x) => t + x.price, 0)),
			commission: round(sales.reduce((t, x) => t + x.commission, 0)),
			payoutsOpen: round(sales.filter((x) => x.status !== 'paid_out').reduce((t, x) => t + x.payout, 0)),
		},
		sellers: sellerList,
	});
};
