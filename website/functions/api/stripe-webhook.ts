// POST /api/stripe-webhook: Stripe tells us when a checkout is paid or has expired.
// Paid: the piece is marked as sold (a commit, so the site rebuilds) and the owner gets an email with the shipping address.
// Expired or failed: the hold is released so someone else can buy the piece.
// In Stripe: Developers → Webhooks → add https://secondsurf.ch/api/stripe-webhook with the events listed in the README.

import { json, type Handler } from '../_lib/auth.ts';
import { commit, PRODUCTS_DIR, readText } from '../_lib/github.ts';
import { sendMail } from '../_lib/mail.ts';
import { PRODUCT_ID, setSold } from '../_lib/product.ts';
import { firstTime, forgetDone, holdSold, holds, releaseHold, verifyWebhook } from '../_lib/stripe.ts';
import { SITE } from '../../src/config.ts';

type Address = { line1?: string; line2?: string; postal_code?: string; city?: string; country?: string } | null;
type Session = {
	id: string;
	payment_status: string;
	payment_intent?: string | null;
	amount_total?: number | null;
	metadata?: { product_id?: string };
	customer_details?: { name?: string | null; email?: string | null; phone?: string | null } | null;
	collected_information?: { shipping_details?: { name?: string; address?: Address } | null } | null;
	shipping_details?: { name?: string; address?: Address } | null;
	livemode?: boolean;
};

const chf = (cents?: number | null) => `CHF ${((cents ?? 0) / 100).toFixed(2)}`;

async function sell(env: Parameters<Handler>[0]['env'], session: Session) {
	const id = session.metadata?.product_id ?? '';
	if (!PRODUCT_ID.test(id)) return;
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
			`Betrag (inkl. Versand): ${chf(session.amount_total)}`,
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
		try {
			await sell(env, session);
		} catch (error) {
			// Let Stripe retry later (it does for up to 3 days).
			console.error('Marking as sold failed', error);
			await forgetDone(db, session.id).catch(() => {});
			return json({ error: 'Try again.' }, 500);
		}
		if (db && PRODUCT_ID.test(id)) await holdSold(db, id).catch(() => {});
		return json({ ok: true });
	}

	if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
		if (db && PRODUCT_ID.test(id)) await releaseHold(db, id, session.id).catch(() => {});
	}
	return json({ ok: true });
};
