// Fills /admin/label.html: one A4 page per order (address label + packing slip) from GET /api/admin/orders?refs=…

const $ = (id) => document.getElementById(id);
const SENDER_KEY = 'label-sender';
const COUNTRIES = { CH: '', LI: '' }; // Swiss Post: no country name for domestic parcels (Liechtenstein included).
let orders = [];

const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};
const chf = (n) => `CHF ${Number(n).toFixed(2)}`;
const date = (s) => new Date(s * 1000).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
const number = (o) => o.ref.slice(0, 8).toUpperCase();

/** The recipient's lines, Swiss Post style: name, street + number, (extra line), postcode + town, country only abroad. */
function addressLines(o) {
	const country = o.country && !(o.country in COUNTRIES) ? o.country : '';
	return [o.name, o.line1, o.line2, `${o.postal_code ?? ''} ${o.city ?? ''}`.trim(), country].filter((line) => line && line.trim());
}

function senderText() {
	try {
		return localStorage.getItem(SENDER_KEY) ?? '';
	} catch {
		return '';
	}
}

function render() {
	const sender = senderText().trim();
	$('pages').replaceChildren(
		...orders.map((o) => {
			const page = el('section', 'page');

			const label = el('div', 'label');
			label.append(el('span', 'cut', '✂ ausschneiden'));
			const from = el('div', 'sender');
			from.append(el('div', 'small', 'Absender'));
			from.append(sender ? sender : el('span', 'missing', 'Absender oben eintragen'));
			label.append(from);
			const to = el('div', 'recipient');
			for (const line of addressLines(o)) to.append(el('p', '', line));
			label.append(to);
			label.append(el('span', 'ref', `Bestellung ${number(o)}`));
			page.append(label);

			const slip = el('div', 'slip');
			slip.append(el('h2', '', 'Lieferschein'));
			slip.append(el('p', 'meta', `Bestellung ${number(o)} · bezahlt am ${o.paid_at ? date(o.paid_at) : '–'}`));
			const who = el('p');
			who.append(...addressLines(o).flatMap((line, i) => (i ? [el('br'), line] : [line])));
			if (o.email) who.append(el('br'), o.email);
			if (o.phone) who.append(el('br'), o.phone);
			slip.append(who);
			const table = el('table');
			const head = el('tr');
			head.append(el('th', '', 'Piece'), el('th', '', 'Nr.'));
			table.append(head);
			o.ids.forEach((id, i) => {
				const row = el('tr');
				row.append(el('td', '', o.names[i] ?? id), el('td', 'id', id));
				table.append(row);
			});
			const total = el('tr', 'total');
			total.append(el('td', '', `Bezahlt (inkl. Versand${o.discount ? `, Rabattcode ${o.discount}` : ''})`), el('td', '', o.amount != null ? chf(o.amount) : '–'));
			table.append(total);
			slip.append(table);
			slip.append(
				el(
					'p',
					'note',
					'Danke für deine Bestellung bei secondsurf! Stimmt etwas nicht mit einem Piece, findest du alles zur Rückgabe auf secondsurf.ch/returns. Fragen: info.secondsurf@gmail.com',
				),
			);
			page.append(slip);
			return page;
		}),
	);
}

async function load() {
	const refs = new URLSearchParams(location.search).get('refs') ?? '';
	const res = await fetch(`/api/admin/orders?refs=${encodeURIComponent(refs)}`);
	const data = await res.json().catch(() => ({}));
	if (res.status === 401) throw new Error('Bitte zuerst im Dashboard anmelden (/admin/).');
	if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
	orders = data.orders;
	if (!orders.length) throw new Error('Keine Bestellung gefunden.');
	render();
}

$('sender').value = senderText();
$('sender').addEventListener('input', () => {
	try {
		localStorage.setItem(SENDER_KEY, $('sender').value);
	} catch {}
	render();
});
$('print').addEventListener('click', () => window.print());
$('copy').addEventListener('click', async () => {
	const text = orders.map((o) => addressLines(o).join('\n')).join('\n\n');
	try {
		await navigator.clipboard.writeText(text);
		$('status').textContent = 'Adresse kopiert. In der Post-App beim Empfänger einfügen.';
	} catch {
		$('status').textContent = text;
	}
	$('status').hidden = false;
});

load().catch((error) => {
	$('error').textContent = error.message;
	$('error').hidden = false;
});
