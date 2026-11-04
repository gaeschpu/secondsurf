// Price offers ("Preis vorschlagen"): customers propose a price, the owner accepts, declines or counters in /admin.
// Stored in D1 (table offers). The customer follows their offer on /offer/?t=<token> and pays there once a price is agreed.
//
// Status: pending → accepted | declined | countered; countered → agreed | rejected; accepted | agreed → paid.

import type { D1Database, Env } from './auth.ts';
import type { Lang } from './checkout.ts';
import { sendMail } from './mail.ts';
import { SITE } from '../../src/config.ts';

/** Offers may be at most 35 % below the price, rounded up to whole francs. */
export const MAX_DISCOUNT = 0.35;
export const minimumOffer = (price: number) => Math.ceil(price * (1 - MAX_DISCOUNT));

/** How long an agreed price can be paid. */
export const PAY_DAYS = 3;

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'countered' | 'agreed' | 'rejected' | 'paid';

export interface Offer {
	id: number;
	token: string;
	product_id: string;
	product_name: string;
	list_price: number;
	amount: number;
	counter: number | null;
	status: OfferStatus;
	name: string;
	email: string;
	message: string;
	lang: Lang;
	created_at: number;
	updated_at: number;
}

let ready: Promise<unknown> | null = null;

export async function offersDb(env: Env): Promise<D1Database | null> {
	if (!env.DB) return null;
	const db = env.DB;
	ready ??= db
		.batch([
			db.prepare(`CREATE TABLE IF NOT EXISTS offers (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				token TEXT NOT NULL UNIQUE,
				product_id TEXT NOT NULL,
				product_name TEXT NOT NULL,
				list_price REAL NOT NULL,
				amount REAL NOT NULL,
				counter REAL,
				status TEXT NOT NULL,
				name TEXT NOT NULL,
				email TEXT NOT NULL,
				message TEXT NOT NULL DEFAULT '',
				lang TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)`),
			db.prepare('CREATE INDEX IF NOT EXISTS offers_status ON offers (status, created_at)'),
		])
		.catch((error) => {
			ready = null;
			throw error;
		});
	await ready;
	return db;
}

export const now = () => Math.floor(Date.now() / 1000);

/** The price both sides agreed on, or null if there is none (yet). */
export const agreedPrice = (offer: Offer) => (offer.status === 'accepted' ? offer.amount : offer.status === 'agreed' ? offer.counter : null);

export const payableUntil = (offer: Offer) => offer.updated_at + PAY_DAYS * 86400;

export const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const byToken = (db: D1Database, token: string) =>
	/^[0-9a-f]{48}$/.test(token) ? db.prepare('SELECT * FROM offers WHERE token = ?').bind(token).first<Offer>() : Promise.resolve(null);

const chf = (amount: number | null) => `CHF ${(amount ?? 0).toFixed(2).replace(/\.00$/, '.–')}`;
const prefix = (lang: Lang) => (lang === 'de' ? '' : `/${lang}`);
export const offerLink = (origin: string, offer: Pick<Offer, 'lang' | 'token'>) => `${origin}${prefix(offer.lang)}/offer/?t=${offer.token}`;
const itemLink = (origin: string, offer: Offer) => `${origin}${prefix(offer.lang)}/item/${offer.product_id}/`;

// ---------------------------------------------------------------- emails to the customer

type Mail = { subject: string; text: string };
type Kind = 'received' | 'accepted' | 'declined' | 'countered';

function customerMail(kind: Kind, offer: Offer, origin: string, canPay: boolean): Mail {
	const item = offer.product_name;
	const link = offerLink(origin, offer);
	const amount = chf(offer.amount);
	const counter = chf(offer.counter);
	const price = chf(offer.list_price);
	const texts: Record<Lang, Record<Kind, Mail>> = {
		de: {
			received: {
				subject: `Dein Preisvorschlag für ${item}`,
				text: `Hallo\n\nDanke für deinen Vorschlag von ${amount} für ${item}. Wir melden uns meist innert 24 Stunden.\n\nHier siehst du jederzeit den Stand:\n${link}\n\nsecondsurf`,
			},
			accepted: {
				subject: `Angenommen: ${item} für ${amount}`,
				text: `Hallo\n\nGute Nachricht: Wir nehmen deinen Vorschlag von ${amount} für ${item} an.\n\n${
					canPay
						? `Bezahle hier innert ${PAY_DAYS} Tagen:\n${link}`
						: 'Antworte einfach auf diese E-Mail, wir schicken dir die Zahlungsangaben.'
				}\n\nBis zur Zahlung ist das Teil nicht reserviert. Wer zuerst bezahlt, bekommt es.\n\nsecondsurf`,
			},
			declined: {
				subject: `Dein Vorschlag für ${item}`,
				text: `Hallo\n\nDanke für deinen Vorschlag von ${amount}. Leider können wir ihn nicht annehmen. ${item} ist weiterhin für ${price} erhältlich:\n${itemLink(origin, offer)}\n\nsecondsurf`,
			},
			countered: {
				subject: `Gegenangebot: ${item} für ${counter}`,
				text: `Hallo\n\nDanke für deinen Vorschlag von ${amount} für ${item}. Wir können dir das Teil für ${counter} geben.\n\nHier kannst du das Gegenangebot annehmen oder ablehnen (${PAY_DAYS} Tage gültig):\n${link}\n\nsecondsurf`,
			},
		},
		fr: {
			received: {
				subject: `Ta proposition de prix pour ${item}`,
				text: `Bonjour\n\nMerci pour ta proposition de ${amount} pour ${item}. Nous répondons en général sous 24 heures.\n\nTu peux suivre l’état de ta proposition ici :\n${link}\n\nsecondsurf`,
			},
			accepted: {
				subject: `Acceptée : ${item} pour ${amount}`,
				text: `Bonjour\n\nBonne nouvelle : nous acceptons ta proposition de ${amount} pour ${item}.\n\n${
					canPay ? `Paie ici dans les ${PAY_DAYS} jours :\n${link}` : 'Réponds simplement à cet e-mail, nous t’envoyons les infos de paiement.'
				}\n\nJusqu’au paiement, la pièce n’est pas réservée : le premier qui paie l’obtient.\n\nsecondsurf`,
			},
			declined: {
				subject: `Ta proposition pour ${item}`,
				text: `Bonjour\n\nMerci pour ta proposition de ${amount}. Malheureusement, nous ne pouvons pas l’accepter. ${item} est toujours disponible pour ${price} :\n${itemLink(origin, offer)}\n\nsecondsurf`,
			},
			countered: {
				subject: `Contre-offre : ${item} pour ${counter}`,
				text: `Bonjour\n\nMerci pour ta proposition de ${amount} pour ${item}. Nous pouvons te la laisser pour ${counter}.\n\nAccepte ou refuse la contre-offre ici (valable ${PAY_DAYS} jours) :\n${link}\n\nsecondsurf`,
			},
		},
		it: {
			received: {
				subject: `La tua proposta di prezzo per ${item}`,
				text: `Ciao\n\nGrazie per la tua proposta di ${amount} per ${item}. Di solito rispondiamo entro 24 ore.\n\nQui vedi sempre lo stato:\n${link}\n\nsecondsurf`,
			},
			accepted: {
				subject: `Accettata: ${item} per ${amount}`,
				text: `Ciao\n\nBuone notizie: accettiamo la tua proposta di ${amount} per ${item}.\n\n${
					canPay ? `Paga qui entro ${PAY_DAYS} giorni:\n${link}` : 'Rispondi a questa e-mail e ti mandiamo i dati di pagamento.'
				}\n\nFino al pagamento il pezzo non è riservato: chi paga per primo lo ottiene.\n\nsecondsurf`,
			},
			declined: {
				subject: `La tua proposta per ${item}`,
				text: `Ciao\n\nGrazie per la tua proposta di ${amount}. Purtroppo non possiamo accettarla. ${item} è ancora disponibile a ${price}:\n${itemLink(origin, offer)}\n\nsecondsurf`,
			},
			countered: {
				subject: `Controproposta: ${item} per ${counter}`,
				text: `Ciao\n\nGrazie per la tua proposta di ${amount} per ${item}. Possiamo dartelo per ${counter}.\n\nAccetta o rifiuta la controproposta qui (valida ${PAY_DAYS} giorni):\n${link}\n\nsecondsurf`,
			},
		},
		en: {
			received: {
				subject: `Your price offer for ${item}`,
				text: `Hello\n\nThanks for your offer of ${amount} for ${item}. We usually answer within 24 hours.\n\nYou can check its status here at any time:\n${link}\n\nsecondsurf`,
			},
			accepted: {
				subject: `Accepted: ${item} for ${amount}`,
				text: `Hello\n\nGood news: we accept your offer of ${amount} for ${item}.\n\n${
					canPay ? `Pay here within ${PAY_DAYS} days:\n${link}` : 'Just reply to this email and we’ll send you the payment details.'
				}\n\nUntil it's paid, the piece isn't reserved: whoever pays first gets it.\n\nsecondsurf`,
			},
			declined: {
				subject: `Your offer for ${item}`,
				text: `Hello\n\nThanks for your offer of ${amount}. Unfortunately we can't accept it. ${item} is still available for ${price}:\n${itemLink(origin, offer)}\n\nsecondsurf`,
			},
			countered: {
				subject: `Counter-offer: ${item} for ${counter}`,
				text: `Hello\n\nThanks for your offer of ${amount} for ${item}. We can let it go for ${counter}.\n\nAccept or decline the counter-offer here (valid for ${PAY_DAYS} days):\n${link}\n\nsecondsurf`,
			},
		},
	};
	return (texts[offer.lang] ?? texts.de)[kind];
}

export const mailCustomer = (env: Env, kind: Kind, offer: Offer, origin: string, canPay: boolean) =>
	sendMail(env, { to: offer.email, reply_to: SITE.email, ...customerMail(kind, offer, origin, canPay) });

/** Short German notes to the owner. */
export function mailOwner(env: Env, offer: Offer, origin: string, what: 'new' | 'agreed' | 'rejected') {
	const head = {
		new: `Neuer Preisvorschlag: ${chf(offer.amount)} statt ${chf(offer.list_price)} (−${Math.round((1 - offer.amount / offer.list_price) * 100)} %)`,
		agreed: `Gegenangebot angenommen: ${chf(offer.counter)}`,
		rejected: `Gegenangebot abgelehnt (${chf(offer.counter)})`,
	}[what];
	return sendMail(env, {
		to: SITE.email,
		reply_to: offer.email,
		subject: `${head} – ${offer.product_name}`,
		text: [
			head,
			'',
			`Piece: ${offer.product_name} (${offer.product_id})`,
			`Von: ${offer.name} <${offer.email}>`,
			...(offer.message ? ['', 'Nachricht:', offer.message] : []),
			'',
			`Annehmen, ablehnen oder Gegenangebot: ${origin}/admin/#offers`,
		].join('\n'),
	});
}
