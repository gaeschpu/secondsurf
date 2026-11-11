// Sellers: anyone with an account can sell pieces through secondsurf (after accepting the seller terms, /seller-terms/).
// A seller submits a piece with their own photos; the owner approves it in /admin (it then becomes a normal piece with
// `seller: <account id>`) or rejects it with a reason. When such a piece is paid, the seller gets the buyer's address and
// ships it directly; secondsurf pays the seller out by bank transfer after the return period.
//
// Commission: COMMISSION_FIRST (5 %) on a seller's first FIRST_SALES (3) sales, then COMMISSION (10 %), on the price the
// buyer paid for the piece. Each order a seller ships adds SHIPPING.price as a shipping refund to the payout.
// Payout is due PAYOUT_DAYS after the seller marked the parcel as shipped.
//
// Tables (D1): sellers, submissions, submission_photos (until approval), seller_sales.

import type { D1Database, Env } from './auth.ts';
import { sendMail } from './mail.ts';
import { SHIPPING, SITE } from '../../src/config.ts';

export const COMMISSION = 0.1;
export const COMMISSION_FIRST = 0.05;
export const FIRST_SALES = 3;
export const PAYOUT_DAYS = 14;
export const MAX_PHOTOS = 8;

export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type SaleStatus = 'to_ship' | 'shipped' | 'paid_out';

export interface Seller {
	user_id: number;
	iban: string;
	account_holder: string;
	accepted_at: number;
}

export interface Submission {
	id: number;
	user_id: number;
	status: SubmissionStatus;
	brand: string;
	title: string;
	category: string;
	size: string;
	condition: string;
	price: number;
	measurements: string;
	description: string;
	reason: string;
	product_id: string | null;
	created_at: number;
	updated_at: number;
}

export interface Sale {
	id: number;
	order_ref: string;
	product_id: string;
	product_name: string;
	user_id: number;
	price: number;
	rate: number;
	commission: number;
	shipping: number;
	payout: number;
	status: SaleStatus;
	created_at: number;
	shipped_at: number | null;
	paid_out_at: number | null;
}

export const now = () => Math.floor(Date.now() / 1000);
const round = (n: number) => Math.round(n * 100) / 100;

let ready: Promise<unknown> | null = null;

export async function sellersDb(env: Env): Promise<D1Database | null> {
	if (!env.DB) return null;
	const db = env.DB;
	ready ??= db
		.batch([
			db.prepare(`CREATE TABLE IF NOT EXISTS sellers (
				user_id INTEGER PRIMARY KEY,
				iban TEXT NOT NULL DEFAULT '',
				account_holder TEXT NOT NULL DEFAULT '',
				accepted_at INTEGER NOT NULL
			)`),
			db.prepare(`CREATE TABLE IF NOT EXISTS submissions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				status TEXT NOT NULL,
				brand TEXT NOT NULL,
				title TEXT NOT NULL,
				category TEXT NOT NULL,
				size TEXT NOT NULL,
				condition TEXT NOT NULL,
				price REAL NOT NULL,
				measurements TEXT NOT NULL DEFAULT '',
				description TEXT NOT NULL DEFAULT '',
				reason TEXT NOT NULL DEFAULT '',
				product_id TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)`),
			db.prepare('CREATE INDEX IF NOT EXISTS submissions_status ON submissions (status, created_at)'),
			db.prepare('CREATE INDEX IF NOT EXISTS submissions_user ON submissions (user_id)'),
			/** Photos (JPEG, base64) until the piece is approved; then they move into the repository. */
			db.prepare(`CREATE TABLE IF NOT EXISTS submission_photos (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				submission_id INTEGER,
				idx INTEGER NOT NULL DEFAULT 0,
				data TEXT NOT NULL,
				created_at INTEGER NOT NULL
			)`),
			db.prepare('CREATE INDEX IF NOT EXISTS submission_photos_submission ON submission_photos (submission_id, idx)'),
			db.prepare(`CREATE TABLE IF NOT EXISTS seller_sales (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				order_ref TEXT NOT NULL,
				product_id TEXT NOT NULL,
				product_name TEXT NOT NULL,
				user_id INTEGER NOT NULL,
				price REAL NOT NULL,
				rate REAL NOT NULL,
				commission REAL NOT NULL,
				shipping REAL NOT NULL,
				payout REAL NOT NULL,
				status TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				shipped_at INTEGER,
				paid_out_at INTEGER,
				UNIQUE (order_ref, product_id)
			)`),
			db.prepare('CREATE INDEX IF NOT EXISTS seller_sales_user ON seller_sales (user_id, status)'),
		])
		.catch((error) => {
			ready = null;
			throw error;
		});
	await ready;
	return db;
}

export const sellerOf = (db: D1Database, userId: number) => db.prepare('SELECT * FROM sellers WHERE user_id = ?').bind(userId).first<Seller>();

/** The commission rate for this seller's next sale: 5 % for the first three sales, then 10 %. */
export async function nextRate(db: D1Database, userId: number) {
	const row = await db.prepare('SELECT COUNT(*) AS n FROM seller_sales WHERE user_id = ?').bind(userId).first<{ n: number }>();
	return (row?.n ?? 0) < FIRST_SALES ? COMMISSION_FIRST : COMMISSION;
}

/** A Swiss / Liechtenstein IBAN (CH or LI, 21 characters) with a valid check number, as typed (spaces allowed). */
export function cleanIban(value: unknown) {
	if (typeof value !== 'string') return null;
	const iban = value.replace(/\s+/g, '').toUpperCase();
	if (!/^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(iban)) return null;
	const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
	let rest = 0;
	for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
	return rest === 1 ? iban.replace(/(.{4})/g, '$1 ').trim() : null;
}

/**
 * Called by the Stripe webhook for every paid piece that came from a seller: records the sale with its commission and
 * tells the seller to ship. One shipping refund per seller and order. Safe to call twice (unique order + piece).
 */
export async function recordSellerSales(
	env: Env,
	orderRef: string,
	pieces: { id: string; name: string; price: number; seller: number }[],
	buyer: { name: string; address: string },
	origin: string,
) {
	const db = await sellersDb(env);
	if (!db || !pieces.length) return;
	const bySeller = new Map<number, typeof pieces>();
	for (const piece of pieces) bySeller.set(piece.seller, [...(bySeller.get(piece.seller) ?? []), piece]);

	for (const [userId, list] of bySeller) {
		const sold: string[] = [];
		for (const [i, piece] of list.entries()) {
			const rate = await nextRate(db, userId);
			const commission = round(piece.price * rate);
			const shipping = i === 0 ? SHIPPING.price : 0;
			const result = await db
				.prepare(
					`INSERT OR IGNORE INTO seller_sales (order_ref, product_id, product_name, user_id, price, rate, commission, shipping, payout, status, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'to_ship', ?)`,
				)
				.bind(orderRef, piece.id, piece.name, userId, piece.price, rate, commission, shipping, round(piece.price - commission + shipping), now())
				.run();
			if (result.meta.changes) sold.push(piece.name);
		}
		if (sold.length) await mailSeller(env, db, userId, 'sold', { pieces: sold.join(', '), buyer: `${buyer.name}\n${buyer.address}`, link: `${origin}/account/#selling` });
	}
}

// ---------------------------------------------------------------- emails (German; the seller's language when known)

type Kind = 'sold' | 'approved' | 'rejected' | 'paid';
const TEXTS: Record<string, Record<Kind, (v: Record<string, string>) => { subject: string; text: string }>> = {
	de: {
		sold: (v) => ({
			subject: `Verkauft: ${v.pieces}`,
			text: `Hallo\n\nGute Nachricht: ${v.pieces} wurde auf secondsurf verkauft.\n\nBitte verschicke es innert 2 Werktagen mit der Post an:\n\n${v.buyer}\n\nIn deinem Profil findest du die Adressetikette und den Lieferschein zum Drucken. Markiere die Sendung dort als verschickt:\n${v.link}\n\nDie Auszahlung (Verkaufspreis minus Kommission, plus Versand) machen wir ${PAYOUT_DAYS} Tage nach dem Versand.\n\nsecondsurf`,
		}),
		approved: (v) => ({
			subject: `Freigegeben: ${v.piece}`,
			text: `Hallo\n\n${v.piece} ist jetzt im Shop für ${v.price}:\n${v.link}\n\nWir melden uns, sobald es verkauft ist.\n\nsecondsurf`,
		}),
		rejected: (v) => ({
			subject: `Nicht freigegeben: ${v.piece}`,
			text: `Hallo\n\nDanke für dein Piece. Leider können wir ${v.piece} nicht in den Shop nehmen.${v.reason ? `\n\nGrund: ${v.reason}` : ''}\n\nDu kannst es mit besseren Fotos oder einem anderen Preis gerne nochmals einreichen:\n${v.link}\n\nsecondsurf`,
		}),
		paid: (v) => ({
			subject: `Auszahlung: ${v.amount}`,
			text: `Hallo\n\nWir haben dir ${v.amount} für ${v.pieces} überwiesen (auf ${v.iban}). Danke fürs Verkaufen mit secondsurf!\n\nsecondsurf`,
		}),
	},
	fr: {
		sold: (v) => ({
			subject: `Vendu : ${v.pieces}`,
			text: `Bonjour\n\nBonne nouvelle : ${v.pieces} a été vendu sur secondsurf.\n\nMerci de l’envoyer dans les 2 jours ouvrables par La Poste à :\n\n${v.buyer}\n\nDans ton profil, tu trouves l’étiquette d’adresse et le bon de livraison à imprimer. Indique-y que l’envoi est parti :\n${v.link}\n\nNous te versons le montant (prix de vente moins la commission, plus l’envoi) ${PAYOUT_DAYS} jours après l’envoi.\n\nsecondsurf`,
		}),
		approved: (v) => ({ subject: `Validé : ${v.piece}`, text: `Bonjour\n\n${v.piece} est maintenant dans la boutique pour ${v.price} :\n${v.link}\n\nNous te prévenons dès qu’il est vendu.\n\nsecondsurf` }),
		rejected: (v) => ({
			subject: `Non validé : ${v.piece}`,
			text: `Bonjour\n\nMerci pour ta pièce. Malheureusement, nous ne pouvons pas prendre ${v.piece} dans la boutique.${v.reason ? `\n\nRaison : ${v.reason}` : ''}\n\nTu peux la proposer à nouveau avec de meilleures photos ou un autre prix :\n${v.link}\n\nsecondsurf`,
		}),
		paid: (v) => ({ subject: `Versement : ${v.amount}`, text: `Bonjour\n\nNous t’avons versé ${v.amount} pour ${v.pieces} (sur ${v.iban}). Merci de vendre avec secondsurf !\n\nsecondsurf` }),
	},
	it: {
		sold: (v) => ({
			subject: `Venduto: ${v.pieces}`,
			text: `Ciao\n\nBuone notizie: ${v.pieces} è stato venduto su secondsurf.\n\nSpediscilo entro 2 giorni lavorativi con la Posta a:\n\n${v.buyer}\n\nNel tuo profilo trovi l’etichetta con l’indirizzo e la bolla di consegna da stampare. Segna lì la spedizione come inviata:\n${v.link}\n\nTi versiamo l’importo (prezzo di vendita meno la commissione, più la spedizione) ${PAYOUT_DAYS} giorni dopo la spedizione.\n\nsecondsurf`,
		}),
		approved: (v) => ({ subject: `Approvato: ${v.piece}`, text: `Ciao\n\n${v.piece} è ora nel negozio a ${v.price}:\n${v.link}\n\nTi avvisiamo appena è venduto.\n\nsecondsurf` }),
		rejected: (v) => ({
			subject: `Non approvato: ${v.piece}`,
			text: `Ciao\n\nGrazie per il tuo pezzo. Purtroppo non possiamo prendere ${v.piece} nel negozio.${v.reason ? `\n\nMotivo: ${v.reason}` : ''}\n\nPuoi riproporlo con foto migliori o un altro prezzo:\n${v.link}\n\nsecondsurf`,
		}),
		paid: (v) => ({ subject: `Pagamento: ${v.amount}`, text: `Ciao\n\nTi abbiamo versato ${v.amount} per ${v.pieces} (su ${v.iban}). Grazie per vendere con secondsurf!\n\nsecondsurf` }),
	},
	en: {
		sold: (v) => ({
			subject: `Sold: ${v.pieces}`,
			text: `Hello\n\nGood news: ${v.pieces} was sold on secondsurf.\n\nPlease send it within 2 working days with Swiss Post to:\n\n${v.buyer}\n\nIn your profile you'll find the address label and packing slip to print. Mark the parcel as shipped there:\n${v.link}\n\nWe pay you (sale price minus commission, plus shipping) ${PAYOUT_DAYS} days after shipping.\n\nsecondsurf`,
		}),
		approved: (v) => ({ subject: `Approved: ${v.piece}`, text: `Hello\n\n${v.piece} is now in the shop for ${v.price}:\n${v.link}\n\nWe'll let you know as soon as it sells.\n\nsecondsurf` }),
		rejected: (v) => ({
			subject: `Not approved: ${v.piece}`,
			text: `Hello\n\nThanks for your piece. Unfortunately we can't take ${v.piece} into the shop.${v.reason ? `\n\nReason: ${v.reason}` : ''}\n\nYou're welcome to submit it again with better photos or another price:\n${v.link}\n\nsecondsurf`,
		}),
		paid: (v) => ({ subject: `Payout: ${v.amount}`, text: `Hello\n\nWe've transferred ${v.amount} for ${v.pieces} (to ${v.iban}). Thanks for selling with secondsurf!\n\nsecondsurf` }),
	},
};

export async function mailSeller(env: Env, db: D1Database, userId: number, kind: Kind, v: Record<string, string>) {
	if (!env.RESEND_API_KEY) return;
	const user = await db.prepare('SELECT email, lang FROM users WHERE id = ?').bind(userId).first<{ email: string; lang: string }>();
	if (!user) return;
	const texts = TEXTS[user.lang] ?? TEXTS.de;
	await sendMail(env, { to: user.email, reply_to: SITE.email, ...texts[kind](v) }).catch((error) => console.error('Seller email failed', error));
}

/** Short German note to the owner. */
export async function mailOwnerSubmission(env: Env, submission: Pick<Submission, 'brand' | 'title' | 'price'>, sellerEmail: string, origin: string) {
	if (!env.RESEND_API_KEY) return;
	await sendMail(env, {
		to: SITE.email,
		reply_to: sellerEmail,
		subject: `Neues Piece zum Freigeben: ${submission.brand} ${submission.title} (CHF ${submission.price})`,
		text: `Eine Verkäuferin / ein Verkäufer (${sellerEmail}) hat ein Piece eingereicht.\n\nPrüfen, anpassen und freigeben oder ablehnen: ${origin}/admin/#submissions`,
	}).catch((error) => console.error('Owner email failed', error));
}
