// Auctions under /api/auctions/ (rules and states: functions/_lib/auctions.ts).
//
// GET  view?id=<piece>          the auction of a piece for its page: price, bids, end, history; plus "you" when logged in
// POST bid { id, max, acceptTerms? }   bid with a limit (logged in, confirmed email). acceptTerms once, before the first bid
// GET  calendar?id=<piece>&lang= the end as a calendar file (iPhone / Android / Outlook), alarm 15 min before
// GET  active                   running auctions, for the "Auktion" badge on the shop cards
// GET  mine?lang=               the logged-in customer's auctions, for "Meine Auktionen" in the profile
// GET  pay?t=<token>&lang=      what the buyer sees on /auction/?t=<token>
// POST checkout (form t, lang)  the buyer pays with Stripe Checkout (normal shipping, no welcome discount)
// POST tick                     ends auctions and handles payment deadlines; called every 10 minutes by GitHub Actions
//
// Errors are short codes; the pages show them in the customer's language (src/i18n/auction.ts).

import { currentUser, database, tooMany } from '../../_lib/accounts.ts';
import { json, type Handler } from '../../_lib/auth.ts';
import {
	acceptedTerms,
	anonymous,
	auctionsDb,
	byPayToken,
	cannotBid,
	latestAuction,
	minimumFor,
	REMIND_BEFORE_MINUTES,
	nameIn,
	now,
	payLink,
	placeBid,
	settle,
	settleAll,
	type Auction,
} from '../../_lib/auctions.ts';
import { asLang, checkoutReady, langPrefix, loadPiece, redirect, startCheckout } from '../../_lib/checkout.ts';
import { PRODUCT_ID } from '../../_lib/product.ts';

const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

export const onRequest: Handler = async ({ request, env, params, waitUntil }) => {
	const route = (Array.isArray(params.path) ? params.path : [params.path ?? '']).filter(Boolean).join('/');
	const url = new URL(request.url);
	const origin = url.origin;
	const method = request.method;
	const background = (p: Promise<unknown>) => (waitUntil ? waitUntil(p) : void p);

	if (method === 'POST' && route !== 'tick' && request.headers.get('Origin') !== origin) return fail('origin', 403);
	if (!env.DB) return fail('unavailable', 503);
	// The account tables first: auctions read names and emails from them.
	const accounts = await database(env);
	const db = (await auctionsDb(env))!;

	// ------------------------------------------------ the piece page

	if (route === 'view' && method === 'GET') {
		const id = url.searchParams.get('id') ?? '';
		if (!PRODUCT_ID.test(id)) return fail('invalid');
		let a = await latestAuction(db, id);
		if (a) a = await settle(env, db, a, origin, background);
		if (!a || (a.status !== 'running' && a.status !== 'payment')) return json({ auction: null });

		const { results: history } = await db
			.prepare(
				`SELECT h.user_id, h.amount, h.auto, h.created_at, u.name FROM auction_history h LEFT JOIN users u ON u.id = h.user_id
				 WHERE h.auction_id = ? ORDER BY h.id DESC LIMIT 30`,
			)
			.bind(a.id)
			.all<{ user_id: number; amount: number; auto: number; created_at: number; name: string | null }>();

		const user = await currentUser(accounts, request);
		let you = null;
		if (user) {
			const mine = await db.prepare('SELECT MAX(max) AS max FROM auction_bids WHERE auction_id = ? AND user_id = ?').bind(a.id, user.id).first<{ max: number | null }>();
			const buyer = a.status === 'payment' && a.buyer_id === user.id;
			you = {
				verified: user.verified === 1,
				acceptedTerms: await acceptedTerms(db, user.id),
				reason: a.status === 'running' ? await cannotBid(db, user, a) : null,
				leading: a.leader_id === user.id,
				yourMax: mine?.max ?? null,
				minimum: minimumFor(a, user.id),
				buyer,
				payToken: buyer ? a.pay_token : null,
				payUntil: buyer && a.pay_until ? a.pay_until * 1000 : null,
			};
		}
		return json({
			auction: {
				status: a.status,
				startPrice: a.start_price,
				price: a.price,
				bids: a.bids,
				endsAt: a.ends_at * 1000,
				serverNow: Date.now(),
				minimum: minimumFor(a),
				history: history.map((h) => ({ bidder: anonymous(h.user_id, h.name), amount: h.amount, auto: h.auto === 1, at: h.created_at * 1000 })),
			},
			you,
		});
	}

	if (route === 'bid' && method === 'POST') {
		const user = await currentUser(accounts, request);
		if (!user) return fail('login', 401);
		const body = (await request.json().catch(() => ({}))) as { id?: unknown; max?: unknown; acceptTerms?: unknown };
		const id = typeof body.id === 'string' ? body.id : '';
		const max = Number(body.max);
		if (!PRODUCT_ID.test(id) || !Number.isFinite(max) || max <= 0 || max > 100000) return fail('invalid');
		// Whole francs only, never rounded: steps are CHF 1 (STEP in functions/_lib/auctions.ts).
		if (!Number.isInteger(max)) return fail('wholeFrancs');
		if (user.verified !== 1) return fail('verify', 403);
		if (await tooMany(accounts, `bid:${user.id}`, 30, 10)) return fail('tooMany', 429);
		if (!(await acceptedTerms(db, user.id))) {
			if (body.acceptTerms !== true) return fail('terms');
			await db.prepare('INSERT OR IGNORE INTO auction_terms (user_id, accepted_at) VALUES (?, ?)').bind(user.id, now()).run();
		}
		const result = await placeBid(env, user, id, max, origin, background);
		if (!result.ok) return fail(result.error, result.error === 'busy' ? 503 : 409, result.minimum ? { minimum: result.minimum } : {});
		return json({ ok: true, leading: result.leading, price: result.auction.price, endsAt: result.auction.ends_at * 1000 });
	}

	if (route === 'calendar' && method === 'GET') {
		const id = url.searchParams.get('id') ?? '';
		const lang = asLang(url.searchParams.get('lang'));
		const a = PRODUCT_ID.test(id) ? await latestAuction(db, id) : null;
		if (!a || a.status !== 'running') return new Response('No running auction.', { status: 404 });
		const stamp = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
		// Calendar text: commas, semicolons and backslashes escaped, as the format wants.
		const esc = (text: string) => text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
		const name = nameIn(a, lang);
		const link = `${origin}${langPrefix(lang)}/item/${a.product_id}/`;
		const title = { de: 'Auktion endet', fr: 'Fin de l’enchère', it: 'L’asta finisce', en: 'Auction ends' }[lang];
		const note = {
			de: 'Jetzt mitbieten. Kommt in der letzten Minute ein Gebot, verlängert sich die Auktion um 5 Minuten.',
			fr: 'Enchéris maintenant. Une offre dans la dernière minute prolonge l’enchère de 5 minutes.',
			it: 'Offri adesso. Un’offerta nell’ultimo minuto prolunga l’asta di 5 minuti.',
			en: 'Bid now. A bid in the last minute extends the auction by 5 minutes.',
		}[lang];
		const ics = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//secondsurf//Auctions//DE',
			'CALSCALE:GREGORIAN',
			'METHOD:PUBLISH',
			'BEGIN:VEVENT',
			`UID:auction-${a.id}@secondsurf.ch`,
			`DTSTAMP:${stamp(now())}`,
			`DTSTART:${stamp(a.ends_at - REMIND_BEFORE_MINUTES * 60)}`,
			`DTEND:${stamp(a.ends_at)}`,
			`SUMMARY:${esc(`secondsurf: ${title} – ${name}`)}`,
			`DESCRIPTION:${esc(`${note}\n${link}`)}`,
			`URL:${link}`,
			'BEGIN:VALARM',
			'ACTION:DISPLAY',
			`DESCRIPTION:${esc(`${title}: ${name}`)}`,
			'TRIGGER:PT0M',
			'END:VALARM',
			'END:VEVENT',
			'END:VCALENDAR',
		].join('\r\n');
		return new Response(ics, {
			headers: {
				'Content-Type': 'text/calendar; charset=utf-8',
				'Content-Disposition': `inline; filename="auktion-${a.product_id}.ics"`,
				'Cache-Control': 'no-store',
			},
		});
	}

	if (route === 'active' && method === 'GET') {
		const { results } = await db
			.prepare("SELECT product_id, price, bids, ends_at FROM auctions WHERE status = 'running' AND ends_at > ?")
			.bind(now())
			.all<{ product_id: string; price: number; bids: number; ends_at: number }>();
		return json(results.map((a) => ({ id: a.product_id, price: a.price, bids: a.bids, endsAt: a.ends_at * 1000 })));
	}

	// ------------------------------------------------ the profile

	if (route === 'mine' && method === 'GET') {
		const user = await currentUser(accounts, request);
		if (!user) return fail('login', 401);
		const lang = asLang(url.searchParams.get('lang'));
		const { results } = await db
			.prepare(
				`SELECT a.*, (SELECT MAX(max) FROM auction_bids WHERE auction_id = a.id AND user_id = ?1) AS your_max FROM auctions a
				 WHERE a.id IN (SELECT auction_id FROM auction_bids WHERE user_id = ?1) ORDER BY a.updated_at DESC LIMIT 30`,
			)
			.bind(user.id)
			.all<Auction & { your_max: number }>();
		const list = [];
		for (const row of results) {
			const a = { ...(await settle(env, db, row, origin, background)), your_max: row.your_max };
			const buyer = a.buyer_id === user.id && (a.status === 'payment' || a.status === 'paid');
			list.push({
				productId: a.product_id,
				name: nameIn(a, lang),
				status: a.status,
				price: buyer ? a.buyer_price : a.price,
				bids: a.bids,
				endsAt: a.ends_at * 1000,
				yourMax: a.your_max,
				leading: a.status === 'running' && a.leader_id === user.id,
				// 'pay' = won and waiting for the payment, 'paid', 'lost' (ended, someone else) or 'running'.
				outcome: a.status === 'running' ? 'running' : buyer ? (a.status === 'paid' ? 'paid' : 'pay') : 'lost',
				payUntil: buyer && a.pay_until ? a.pay_until * 1000 : null,
				payLink: buyer && a.status === 'payment' && a.pay_token ? payLink('', lang, a.pay_token) : null,
			});
		}
		return json({ auctions: list });
	}

	// ------------------------------------------------ paying

	if (route === 'pay' && method === 'GET') {
		let a = await byPayToken(db, url.searchParams.get('t') ?? '');
		if (a) a = await settle(env, db, a, origin, background);
		if (!a || !a.pay_token || a.pay_token !== url.searchParams.get('t')) return fail('notFound', 404);
		const lang = asLang(url.searchParams.get('lang'));
		const expired = a.status !== 'paid' && (a.status !== 'payment' || (a.pay_until ?? 0) < now());
		return json({
			status: a.status,
			productId: a.product_id,
			name: nameIn(a, lang),
			price: a.buyer_price,
			payUntil: (a.pay_until ?? 0) * 1000,
			round: a.round,
			paid: a.status === 'paid',
			expired,
			canPay: a.status === 'payment' && !expired && checkoutReady(env),
		});
	}

	if (route === 'checkout' && method === 'POST') {
		const form = await request.formData().catch(() => null);
		const token = String(form?.get('t') ?? '');
		const lang = asLang(form?.get('lang'));
		const a = await byPayToken(db, token);
		if (!a) return redirect(`${origin}${langPrefix(lang)}/shop/`);
		const back = payLink(origin, lang, token);
		if (a.status !== 'payment' || (a.pay_until ?? 0) < now() || !checkoutReady(env) || !a.buyer_price) return redirect(`${back}#checkout-error`);
		const piece = await loadPiece(env, request, a.product_id);
		if (!piece || piece.sold) return redirect(`${back}#checkout-error`);
		return startCheckout({
			env,
			request,
			lang,
			piece,
			price: a.buyer_price,
			backUrl: back,
			// The webhook marks the auction as paid, but only for this buyer (functions/api/stripe-webhook.ts).
			metadata: { auction_id: String(a.id), auction_buyer: String(a.buyer_id) },
		});
	}

	// ------------------------------------------------ the clock

	if (route === 'tick' && (method === 'POST' || method === 'GET')) {
		const checked = await settleAll(env, origin, background);
		return json({ ok: true, checked });
	}

	return fail('notFound', 404);
};
