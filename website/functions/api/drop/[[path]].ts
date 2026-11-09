// Drop reminders under /api/drop/.
//
// POST remind      { email, lang, cf-turnstile-response }   saves the reminder and confirms it by email
// GET  unsubscribe?token=…                                  removes it again (link in the emails)
// POST notify                                               once the drop is live: emails everyone and deletes the addresses
//
// notify is safe to call by anyone and any number of times: it does nothing before the drop time (DROP.at, set at build),
// and each address is taken out of the table before its email is sent, so nobody gets it twice. The New Drop page calls it
// when the countdown ends; .github/workflows/drop-reminder.yml calls it every hour as a backup.

import { DROP, SITE } from '../../../src/config.ts';
import { url, type Lang } from '../../../src/i18n/index.ts';
import { asLang, database, tooMany } from '../../_lib/accounts.ts';
import { json, type Handler } from '../../_lib/auth.ts';
import { EMAIL, isHuman, sendMail, sendMailBatch } from '../../_lib/mail.ts';

const MAILS: Record<Lang, { confirm: [string, string]; live: [string, string] }> = {
	de: {
		confirm: [
			'Wir erinnern dich an den nächsten Drop',
			'Hallo\n\nAlles klar: Sobald der nächste Drop bei secondsurf live ist ({date}), schicken wir dir eine E-Mail.\n\nDanach löschen wir deine Adresse wieder.\n\nDoch keine Erinnerung? Hier abbestellen: {unsubscribe}\n\nsecondsurf',
		],
		live: [
			'Der Drop ist live ☆ secondsurf',
			'Hallo\n\nDer neue Drop ist jetzt live! Jedes Piece gibt es nur einmal, also sei schnell:\n{link}\n\nDeine Adresse haben wir jetzt gelöscht.\n\nsecondsurf',
		],
	},
	fr: {
		confirm: [
			'Nous te rappellerons le prochain drop',
			'Bonjour\n\nC’est noté : dès que le prochain drop de secondsurf est en ligne ({date}), nous t’envoyons un e-mail.\n\nEnsuite, nous supprimons ton adresse.\n\nPlus besoin de rappel ? Annule-le ici : {unsubscribe}\n\nsecondsurf',
		],
		live: [
			'Le drop est en ligne ☆ secondsurf',
			'Bonjour\n\nLe nouveau drop est en ligne ! Chaque pièce est unique, alors fais vite :\n{link}\n\nNous avons maintenant supprimé ton adresse.\n\nsecondsurf',
		],
	},
	it: {
		confirm: [
			'Ti ricorderemo il prossimo drop',
			'Ciao\n\nPerfetto: appena il prossimo drop di secondsurf è online ({date}), ti mandiamo un’e-mail.\n\nPoi cancelliamo il tuo indirizzo.\n\nNon vuoi più il promemoria? Annullalo qui: {unsubscribe}\n\nsecondsurf',
		],
		live: [
			'Il drop è online ☆ secondsurf',
			'Ciao\n\nIl nuovo drop è online! Ogni pezzo è unico, quindi fai presto:\n{link}\n\nAbbiamo ora cancellato il tuo indirizzo.\n\nsecondsurf',
		],
	},
	en: {
		confirm: [
			'We’ll remind you of the next drop',
			'Hello\n\nAll set: as soon as the next secondsurf drop is live ({date}), we’ll send you an email.\n\nAfter that we delete your address.\n\nDon’t want the reminder? Cancel it here: {unsubscribe}\n\nsecondsurf',
		],
		live: [
			'The drop is live ☆ secondsurf',
			'Hello\n\nThe new drop is live now! Every piece is one of a kind, so be quick:\n{link}\n\nWe have now deleted your address.\n\nsecondsurf',
		],
	},
};
const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
const dateIn = (lang: Lang) =>
	DROP.at
		? new Intl.DateTimeFormat({ de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-GB' }[lang], {
				timeZone: 'Europe/Zurich',
				weekday: 'long',
				day: 'numeric',
				month: 'long',
				hour: '2-digit',
				minute: '2-digit',
			}).format(DROP.at)
		: '';
const newToken = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Mails per notify call: one Resend batch request each, well within a function's request limit. */
const BATCH = 100;
const MAX_BATCHES = 5;

export const onRequest: Handler = async ({ request, env, params }) => {
	const route = (Array.isArray(params.path) ? params.path : [params.path ?? '']).filter(Boolean).join('/');
	const { origin } = new URL(request.url);
	if (!env.DB) return json({ error: 'unavailable' }, 503);

	try {
		const db = await database(env);

		if (route === 'remind' && request.method === 'POST') {
			if (request.headers.get('Origin') !== origin) return json({ error: 'origin' }, 403);
			if (!env.RESEND_API_KEY || !DROP.at) return json({ error: 'unavailable' }, 503);
			if (DROP.at.getTime() <= Date.now()) return json({ error: 'live' }, 409);
			const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
			const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
			const lang = asLang(body.lang);
			if (!EMAIL.test(email)) return json({ error: 'invalid' }, 400);
			const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
			if (await tooMany(db, `drop-remind:${ip}`, 5, 60)) return json({ error: 'tooMany' }, 429);
			if (env.TURNSTILE_SECRET_KEY) {
				const token = typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : '';
				if (!token || !(await isHuman(env, token, ip))) return json({ error: 'captcha' }, 400);
			}
			// Signing up twice for the same drop keeps one reminder and sends no second email.
			const token = newToken();
			const saved = await db
				.prepare('INSERT OR IGNORE INTO drop_reminders (email, drop_no, lang, token, created_at) VALUES (?, ?, ?, ?, ?)')
				.bind(email, DROP.number, lang, token, Math.floor(Date.now() / 1000))
				.run();
			if (saved.meta.changes) {
				const [subject, text] = MAILS[lang].confirm;
				await sendMail(env, {
					to: email,
					subject,
					text: fill(text, { date: dateIn(lang), unsubscribe: `${origin}/api/drop/unsubscribe?token=${token}` }),
				}).catch((error) => console.error('Drop reminder confirmation failed', error));
			}
			return json({ ok: true });
		}

		if (route === 'unsubscribe' && request.method === 'GET') {
			const token = new URL(request.url).searchParams.get('token') ?? '';
			const row = await db.prepare('DELETE FROM drop_reminders WHERE token = ? RETURNING lang').bind(token.slice(0, 64)).first<{ lang: string }>();
			const target = `${url(asLang(row?.lang), '/new/')}?reminder=off`;
			return new Response(null, { status: 303, headers: { Location: target, 'Cache-Control': 'no-store' } });
		}

		if (route === 'notify' && request.method === 'POST') {
			if (!DROP.at || DROP.at.getTime() > Date.now()) return json({ ok: true, sent: 0, waiting: true });
			if (!env.RESEND_API_KEY) return json({ error: 'unavailable' }, 503);
			let sent = 0;
			for (let round = 0; round < MAX_BATCHES; round++) {
				// Taking the rows out first means two calls at the same moment never email the same person.
				const { results } = await db
					.prepare('DELETE FROM drop_reminders WHERE rowid IN (SELECT rowid FROM drop_reminders WHERE drop_no = ? LIMIT ?) RETURNING email, lang, token, created_at')
					.bind(DROP.number, BATCH)
					.all<{ email: string; lang: string; token: string; created_at: number }>();
				if (!results.length) break;
				try {
					await sendMailBatch(
						env,
						results.map((row) => {
							const lang = asLang(row.lang);
							const [subject, text] = MAILS[lang].live;
							return { to: row.email, subject, text: fill(text, { link: new URL(url(lang, '/new/'), SITE.url).href }) };
						}),
					);
				} catch (error) {
					// Put them back, so the next call (page or hourly backup) tries again.
					await db.batch(
						results.map((row) =>
							db
								.prepare('INSERT OR IGNORE INTO drop_reminders (email, drop_no, lang, token, created_at) VALUES (?, ?, ?, ?, ?)')
								.bind(row.email, DROP.number, row.lang, row.token, row.created_at),
						),
					);
					throw error;
				}
				sent += results.length;
			}
			return json({ ok: true, sent });
		}

		return json({ error: 'not-found' }, 404);
	} catch (error) {
		console.error(error);
		return json({ error: 'server' }, 500);
	}
};
