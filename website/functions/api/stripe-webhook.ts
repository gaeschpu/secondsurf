// POST /api/stripe-webhook: Stripe tells us when a checkout is paid or has expired.
// Paid: the piece is marked as sold (a commit, so the site rebuilds), the owner gets an email with the shipping address,
// and the customer an order confirmation in their language (AGB 2.3).
// Paid through an auction (metadata auction_id): the auction is marked as paid. Every paid order is recorded (purchases),
// because accounts without one may only hold one auction at a time (functions/_lib/auctions.ts).
// Expired or failed: the hold is released so someone else can buy the piece.
// In Stripe: Developers → Webhooks → add https://secondsurf.ch/api/stripe-webhook with the events listed in the README.

import { database, markWelcomeUsed } from '../_lib/accounts.ts';
import { auctionsDb, now as nowSeconds, recordPurchase } from '../_lib/auctions.ts';
import { json, type Handler } from '../_lib/auth.ts';
import { commit, PRODUCTS_DIR, readText } from '../_lib/github.ts';
import { sendMail } from '../_lib/mail.ts';
import { now, offersDb } from '../_lib/offers.ts';
import { PRODUCT_ID, setSold } from '../_lib/product.ts';
import { firstTime, forgetDone, holdSold, holds, releaseHold, verifyWebhook } from '../_lib/stripe.ts';
import { SITE } from '../../src/config.ts';
import { url, type Lang } from '../../src/i18n/index.ts';

type Address = { line1?: string; line2?: string; postal_code?: string; city?: string; country?: string } | null;
type Session = {
	id: string;
	payment_status: string;
	payment_intent?: string | null;
	amount_total?: number | null;
	metadata?: { product_id?: string; offer_id?: string; auction_id?: string; auction_buyer?: string; welcome_user?: string; discount?: string; lang?: string; product_name?: string };
	customer_details?: { name?: string | null; email?: string | null; phone?: string | null } | null;
	collected_information?: { shipping_details?: { name?: string; address?: Address } | null } | null;
	shipping_details?: { name?: string; address?: Address } | null;
	livemode?: boolean;
};

const chf = (cents?: number | null) => `CHF ${((cents ?? 0) / 100).toFixed(2)}`;

async function sell(env: Parameters<Handler>[0]['env'], session: Session) {
	const id = session.metadata?.product_id ?? '';
	if (!PRODUCT_ID.test(id)) return { alreadySold: false };
	const path = `${PRODUCTS_DIR}/${id}/index.md`;
	const markdown = await readText(env, path);
	const alreadySold = /^sold:\s*true\b/m.test(markdown);
	if (!alreadySold) await commit(env, `Sold online: ${id}`, [{ path, mode: '100644', type: 'blob', content: setSold(markdown, true) }]);

	const ship = session.collected_information?.shipping_details ?? session.shipping_details;
	const a = ship?.address;
	const customer = session.customer_details;
	const dashboard = `https://dashboard.stripe.com/${session.livemode ? '' : 'test/'}payments/${session.payment_intent ?? ''}`;
	await sendMail(env, {
		to: SITE.email,
		...(customer?.email ? { reply_to: customer.email } : {}),
		subject: `${alreadySold ? '⚠️ SCHON VERKAUFT, bitte rückerstatten: ' : 'Verkauft: '}${id} (${chf(session.amount_total)})`,
		text: [
			alreadySold
				? `Achtung: ${id} war schon als verkauft markiert. Bitte die Zahlung in Stripe rückerstatten und der Kundin / dem Kunden schreiben.\n`
				: `${id} wurde online bezahlt und ist jetzt als verkauft markiert. Bitte innert 48 Stunden verschicken.\n`,
			`Betrag (inkl. Versand): ${chf(session.amount_total)}${session.metadata?.discount ? ` (mit Rabattcode ${session.metadata.discount})` : ''}`,
			'',
			'Versand an:',
			ship?.name ?? customer?.name ?? '',
			a?.line1 ?? '',
			...(a?.line2 ? [a.line2] : []),
			`${a?.postal_code ?? ''} ${a?.city ?? ''}`.trim(),
			a?.country ?? '',
			'',
			`E-Mail: ${customer?.email ?? '–'}`,
			`Telefon: ${customer?.phone ?? '–'}`,
			'',
			`Zahlung in Stripe: ${dashboard}`,
		].join('\n'),
	});
	return { alreadySold };
}

const CONFIRMATION: Record<Lang, { subject: string; lines: (v: Record<string, string>) => string[]; countries: Record<string, string> }> = {
	de: {
		subject: 'Danke für deine Bestellung bei secondsurf',
		lines: (v) => [
			`Hallo ${v.name}`,
			'',
			'Danke für deine Bestellung! Deine Zahlung ist bei uns angekommen, das Piece gehört jetzt dir.',
			'',
			`${v.piece}`,
			`Bezahlt: ${v.amount} (inkl. Versand)`,
			'',
			'Wir schicken es in der Regel innert 2 Werktagen mit der Schweizerischen Post an:',
			v.address,
			'',
			`Fragen? Antworte einfach auf diese E-Mail oder schreib an ${v.email}.`,
			`Stimmt etwas nicht mit dem Piece, findest du alles zur Rückgabe hier: ${v.returns}`,
			'',
			'Viel Freude damit!',
			'secondsurf',
		],
		countries: { CH: 'Schweiz', LI: 'Liechtenstein' },
	},
	fr: {
		subject: 'Merci pour ta commande chez secondsurf',
		lines: (v) => [
			`Bonjour ${v.name}`,
			'',
			'Merci pour ta commande ! Ton paiement nous est bien parvenu, la pièce est maintenant à toi.',
			'',
			`${v.piece}`,
			`Payé : ${v.amount} (envoi compris)`,
			'',
			'Nous l’envoyons en général dans les 2 jours ouvrables par La Poste Suisse à :',
			v.address,
			'',
			`Des questions ? Réponds simplement à cet e-mail ou écris à ${v.email}.`,
			`Si quelque chose ne va pas avec la pièce, tout sur les retours se trouve ici : ${v.returns}`,
			'',
			'Profite bien !',
			'secondsurf',
		],
		countries: { CH: 'Suisse', LI: 'Liechtenstein' },
	},
	it: {
		subject: 'Grazie per il tuo ordine da secondsurf',
		lines: (v) => [
			`Ciao ${v.name}`,
			'',
			'Grazie per il tuo ordine! Abbiamo ricevuto il pagamento, il pezzo ora è tuo.',
			'',
			`${v.piece}`,
			`Pagato: ${v.amount} (spedizione inclusa)`,
			'',
			'Di regola lo spediamo entro 2 giorni lavorativi con la Posta Svizzera a:',
			v.address,
			'',
			`Domande? Rispondi semplicemente a questa e-mail o scrivi a ${v.email}.`,
			`Se qualcosa non va con il pezzo, trovi tutto sui resi qui: ${v.returns}`,
			'',
			'Goditelo!',
			'secondsurf',
		],
		countries: { CH: 'Svizzera', LI: 'Liechtenstein' },
	},
	en: {
		subject: 'Thanks for your order at secondsurf',
		lines: (v) => [
			`Hello ${v.name}`,
			'',
			'Thanks for your order! Your payment has arrived, so the piece is yours now.',
			'',
			`${v.piece}`,
			`Paid: ${v.amount} (shipping included)`,
			'',
			'We usually ship it within 2 working days with Swiss Post to:',
			v.address,
			'',
			`Questions? Just reply to this email or write to ${v.email}.`,
			`If something is wrong with the piece, everything about returns is here: ${v.returns}`,
			'',
			'Enjoy it!',
			'secondsurf',
		],
		countries: { CH: 'Switzerland', LI: 'Liechtenstein' },
	},
};

/** Order confirmation to the customer, in the language they paid in. Replies go to the shop's address. */
async function confirm(env: Parameters<Handler>[0]['env'], session: Session) {
	const to = session.customer_details?.email;
	if (!to || !env.RESEND_API_KEY) return;
	const lang = (['de', 'fr', 'it', 'en'].includes(session.metadata?.lang ?? '') ? session.metadata!.lang : 'de') as Lang;
	const text = CONFIRMATION[lang];
	const ship = session.collected_information?.shipping_details ?? session.shipping_details;
	const a = ship?.address;
	const address = [
		ship?.name ?? session.customer_details?.name ?? '',
		a?.line1 ?? '',
		a?.line2 ?? '',
		`${a?.postal_code ?? ''} ${a?.city ?? ''}`.trim(),
		a?.country ? (text.countries[a.country] ?? a.country) : '',
	]
		.filter(Boolean)
		.join('\n');
	const lines = text.lines({
		name: (ship?.name ?? session.customer_details?.name ?? '').split(' ')[0] || '',
		piece: session.metadata?.product_name ?? session.metadata?.product_id ?? '',
		amount: chf(session.amount_total),
		address,
		email: SITE.email,
		returns: new URL(url(lang, '/returns/'), SITE.url).href,
	});
	await sendMail(env, { to, reply_to: SITE.email, subject: text.subject, text: lines.join('\n').replace(/^(Hallo|Bonjour|Ciao|Hello) $/m, '$1') });
}

export const onRequestPost: Handler = async ({ request, env }) => {
	const body = await request.text();
	if (!env.STRIPE_WEBHOOK_SECRET || !(await verifyWebhook(env.STRIPE_WEBHOOK_SECRET, request.headers.get('Stripe-Signature'), body)))
		return json({ error: 'Bad signature.' }, 400);

	const event = JSON.parse(body) as { type: string; data: { object: Session } };
	const session = event.data.object;
	const id = session.metadata?.product_id ?? '';
	const db = await holds(env).catch(() => null);

	const paid =
		(event.type === 'checkout.session.completed' && session.payment_status === 'paid') ||
		event.type === 'checkout.session.async_payment_succeeded';
	if (paid) {
		if (!(await firstTime(db, session.id))) return json({ ok: true, duplicate: true });
		let alreadySold = false;
		try {
			({ alreadySold } = await sell(env, session));
		} catch (error) {
			// Let Stripe retry later (it does for up to 3 days).
			console.error('Marking as sold failed', error);
			await forgetDone(db, session.id).catch(() => {});
			return json({ error: 'Try again.' }, 500);
		}
		if (db && PRODUCT_ID.test(id)) await holdSold(db, id).catch(() => {});
		// A double sale gets no confirmation: the owner refunds that customer (see the owner's email).
		if (!alreadySold) await confirm(env, session).catch((error) => console.error('Order confirmation failed', error));
		// Paid through an accepted price offer: close the offer.
		const offerId = Number(session.metadata?.offer_id);
		if (offerId > 0) {
			const offers = await offersDb(env).catch(() => null);
			await offers?.prepare("UPDATE offers SET status = 'paid', updated_at = ? WHERE id = ?").bind(now(), offerId).run().catch(() => {});
		}
		// Paid through an auction: close it, but only for the buyer it was waiting for.
		const auctionId = Number(session.metadata?.auction_id);
		const auctions = env.DB ? await auctionsDb(env).catch(() => null) : null;
		if (auctionId > 0 && auctions) {
			const result = await auctions
				.prepare("UPDATE auctions SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'payment' AND buyer_id = ?")
				.bind(nowSeconds(), auctionId, Number(session.metadata?.auction_buyer))
				.run()
				.catch(() => null);
			if (!result?.meta.changes) console.error('Auction payment arrived for an auction that had moved on', auctionId);
			// The buyer's account counts as having bought, even if they gave Stripe another email.
			const buyer = await auctions.prepare('SELECT email FROM users WHERE id = ?').bind(Number(session.metadata?.auction_buyer)).first<{ email: string }>().catch(() => null);
			if (buyer) await recordPurchase(auctions, `${session.id}:account`, buyer.email).catch(() => {});
		}
		if (auctions && session.customer_details?.email) await recordPurchase(auctions, session.id, session.customer_details.email).catch(() => {});
		// Paid with the welcome code: it can't be used again on this account.
		const welcomeUser = Number(session.metadata?.welcome_user);
		if (welcomeUser > 0 && env.DB) {
			await markWelcomeUsed(await database(env), welcomeUser, session.id).catch((error) => console.error('Marking the welcome code failed', error));
		}
		return json({ ok: true });
	}

	if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
		if (db && PRODUCT_ID.test(id)) await releaseHold(db, id, session.id).catch(() => {});
	}
	return json({ ok: true });
};
