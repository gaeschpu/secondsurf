// POST /api/stripe-webhook: Stripe tells us when a checkout is paid or has expired.
// Paid: every piece of the order (metadata product_ids, or product_id for one) is marked as sold in one commit, so the
// site rebuilds; the owner gets an email with the pieces and the shipping address,
// and the customer an order confirmation in their language (AGB 2.3).
// Paid through an auction (metadata auction_id): the auction is marked as paid. Every paid order is recorded (purchases),
// because accounts without one may only hold one auction at a time (functions/_lib/auctions.ts).
// Pieces from sellers (seller: in the piece file) are recorded as seller sales; the seller gets the address and ships.
// Expired or failed: the hold is released so someone else can buy the piece.
// In Stripe: Developers → Webhooks → add https://secondsurf.ch/api/stripe-webhook with the events listed in the README.

import { database, markWelcomeUsed, welcomePrice } from '../_lib/accounts.ts';
import { auctionsDb, now as nowSeconds, recordPurchase } from '../_lib/auctions.ts';
import { json, type Handler } from '../_lib/auth.ts';
import { markPaid, orderByRef, ordersDb } from '../_lib/orders.ts';
import { commit, PRODUCTS_DIR, readText } from '../_lib/github.ts';
import { sendMail } from '../_lib/mail.ts';
import { now, offersDb } from '../_lib/offers.ts';
import { PRODUCT_ID, setSold, summarize } from '../_lib/product.ts';
import { recordSellerSales } from '../_lib/sellers.ts';
import { firstTime, forgetDone, holdSold, holds, releaseHold, verifyWebhook } from '../_lib/stripe.ts';
import { SITE } from '../../src/config.ts';
import { url, type Lang } from '../../src/i18n/index.ts';

type Address = { line1?: string; line2?: string; postal_code?: string; city?: string; country?: string } | null;
type Session = {
	id: string;
	payment_status: string;
	payment_intent?: string | null;
	amount_total?: number | null;
	metadata?: { product_id?: string; product_ids?: string; order_ref?: string; offer_id?: string; auction_id?: string; auction_buyer?: string; welcome_user?: string; discount?: string; lang?: string; product_name?: string };
	customer_details?: { name?: string | null; email?: string | null; phone?: string | null } | null;
	collected_information?: { shipping_details?: { name?: string; address?: Address } | null } | null;
	shipping_details?: { name?: string; address?: Address } | null;
	livemode?: boolean;
	shipping_cost?: { amount_total?: number | null } | null;
};

const chf = (cents?: number | null) => `CHF ${((cents ?? 0) / 100).toFixed(2)}`;

/**
 * The pieces of an order: from the saved order (order_ref, any number of pieces), otherwise product_ids ("a,b,c") or the
 * single product_id (sessions from before orders were saved).
 */
async function pieceIds(env: Parameters<Handler>[0]['env'], session: Session) {
	const ref = session.metadata?.order_ref ?? '';
	const db = ref ? await ordersDb(env).catch(() => null) : null;
	const order = db ? await orderByRef(db, ref).catch(() => null) : null;
	const list: string[] = order ? JSON.parse(order.ids) : (session.metadata?.product_ids ?? session.metadata?.product_id ?? '').split(',');
	return [...new Set(list)].filter((id) => PRODUCT_ID.test(id));
}

async function sell(env: Parameters<Handler>[0]['env'], session: Session, ids: string[]) {
	if (!ids.length) return { alreadySold: false, fromSellers: [] };
	const files = [];
	const doubles: string[] = [];
	/** Pieces that a seller ships (seller: in the file), with what the buyer paid for each. */
	const fromSellers: { id: string; name: string; price: number; seller: number }[] = [];
	const single = ids.length === 1 ? ((session.amount_total ?? 0) - (session.shipping_cost?.amount_total ?? 0)) / 100 : null;
	for (const id of ids) {
		const path = `${PRODUCTS_DIR}/${id}/index.md`;
		const markdown = await readText(env, path);
		if (/^sold:\s*true\b/m.test(markdown)) doubles.push(id);
		else files.push({ path, mode: '100644' as const, type: 'blob' as const, content: setSold(markdown, true) });
		const seller = Number(markdown.match(/^seller:\s*(\d+)/m)?.[1]);
		if (seller > 0) {
			const info = summarize(id, markdown);
			// One piece: what was paid without shipping (an offer or auction price too); several: list price, less the welcome code.
			const price = single ?? (session.metadata?.discount ? welcomePrice(info.price) : info.price);
			fromSellers.push({ id, name: `${info.brand} ${info.title}`, price, seller });
		}
	}
	if (files.length) await commit(env, `Sold online: ${ids.join(', ')}`, files);
	const alreadySold = doubles.length > 0;
	const id = ids.join(', ');

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
				? `Achtung: ${doubles.join(', ')} war schon als verkauft markiert. Bitte diesen Betrag in Stripe rückerstatten und der Kundin / dem Kunden schreiben.\n`
				: `Online bezahlt und jetzt als verkauft markiert. Bitte innert 48 Stunden verschicken.\n`,
			`Pieces (${ids.length}):`,
			...ids.map((piece) => `- ${piece}${fromSellers.some((p) => p.id === piece) ? ' (verschickt die Verkäuferin / der Verkäufer)' : ''}`),
			'',
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
	return { alreadySold, fromSellers };
}

const CONFIRMATION: Record<Lang, { subject: string; lines: (v: Record<string, string>) => string[]; countries: Record<string, string> }> = {
	de: {
		subject: 'Danke für deine Bestellung bei secondsurf',
		lines: (v) => [
			`Hallo ${v.name}`,
			'',
			'Danke für deine Bestellung! Deine Zahlung ist bei uns angekommen, alles gehört jetzt dir.',
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
			'Merci pour ta commande ! Ton paiement nous est bien parvenu, tout est maintenant à toi.',
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
			'Grazie per il tuo ordine! Abbiamo ricevuto il pagamento, ora è tutto tuo.',
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
			'Thanks for your order! Your payment has arrived, so it is all yours now.',
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
	const ids = await pieceIds(env, session);
	const db = await holds(env).catch(() => null);

	const paid =
		(event.type === 'checkout.session.completed' && session.payment_status === 'paid') ||
		event.type === 'checkout.session.async_payment_succeeded';
	if (paid) {
		if (!(await firstTime(db, session.id))) return json({ ok: true, duplicate: true });
		let alreadySold = false;
		let fromSellers: { id: string; name: string; price: number; seller: number }[] = [];
		try {
			({ alreadySold, fromSellers } = await sell(env, session, ids));
		} catch (error) {
			// Let Stripe retry later (it does for up to 3 days).
			console.error('Marking as sold failed', error);
			await forgetDone(db, session.id).catch(() => {});
			return json({ error: 'Try again.' }, 500);
		}
		if (db) for (const id of ids) await holdSold(db, id).catch(() => {});
		// The order with the shipping address, for the dashboard (labels, shipped).
		const ref = session.metadata?.order_ref;
		const orders = ref ? await ordersDb(env).catch(() => null) : null;
		if (orders && ref) {
			const ship = session.collected_information?.shipping_details ?? session.shipping_details;
			await markPaid(orders, ref, {
				sessionId: session.id,
				amount: session.amount_total != null ? session.amount_total / 100 : null,
				discount: session.metadata?.discount,
				name: ship?.name ?? session.customer_details?.name,
				address: ship?.address,
				email: session.customer_details?.email,
				phone: session.customer_details?.phone,
			}).catch((error) => console.error('Saving the order failed', error));
			// Sellers ship their own pieces: record the sales (commission, payout) and send them the address.
			if (fromSellers.length && !alreadySold) {
				const a = ship?.address;
				const address = [a?.line1, a?.line2, `${a?.postal_code ?? ''} ${a?.city ?? ''}`.trim()].filter(Boolean).join('\n');
				await recordSellerSales(env, ref, fromSellers, { name: ship?.name ?? session.customer_details?.name ?? '', address }, new URL(request.url).origin).catch((error) =>
					console.error('Recording seller sales failed', error),
				);
			}
		}
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
		if (db) for (const id of ids) await releaseHold(db, id, session.id).catch(() => {});
	}
	return json({ ok: true });
};
