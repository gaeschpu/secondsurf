// Dashboard for adding pieces from a phone. The server part is in /functions/api/admin.

const MAX_PHOTOS = 8;
const MAX_SIDE = 1600; // the site makes its own smaller versions from this
const AI_SIDE = 1024; // enough for the AI to read labels, small enough to send quickly
const AI_PHOTOS = 4;
const MODEL_LABELS = { '': 'No model', women: 'Woman', men: 'Man' };
const NEXT_MODEL = { '': 'women', women: 'men', men: '' };
const JPEG_QUALITY = 0.85;

/** What the AI wrote, so its translations are only used while the German text is unchanged. */
let aiTexts = null;

const $ = (id) => document.getElementById(id);
const form = $('add-form');

/** model: who wears it in the photo ('women', 'men' or '' for no model), for "models first" in the shop. */
/** @type {{ blob: Blob, url: string, model: string }[]} */
let photos = [];
/** The pieces from the last list load, for the auction form. */
let pieceList = [];

async function api(path, options = {}) {
	const res = await fetch(`/api/admin/${path}`, {
		method: options.method ?? 'GET',
		headers: options.body ? { 'Content-Type': 'application/json' } : {},
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (res.status === 401 && path !== 'login') showLogin();
	if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status}).`);
	return data;
}

function show(el, message) {
	el.textContent = message ?? '';
	el.hidden = !message;
}

function showLogin() {
	$('dashboard').hidden = true;
	$('login').hidden = false;
}

// ---------- Login ----------

$('login-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	const button = event.target.querySelector('button');
	button.disabled = true;
	show($('login-error'));
	try {
		await api('login', { method: 'POST', body: { password: $('password').value } });
		$('password').value = '';
		await loadDashboard();
	} catch (error) {
		show($('login-error'), error.message);
	} finally {
		button.disabled = false;
	}
});

$('logout').addEventListener('click', async () => {
	await api('logout', { method: 'POST' }).catch(() => {});
	showLogin();
});

// ---------- Photos ----------

/** Redraws the photo smaller. A redrawn JPEG has no metadata, so the GPS location is gone too. */
async function shrink(file, maxSide = MAX_SIDE) {
	const url = URL.createObjectURL(file);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(image.naturalWidth * scale);
		canvas.height = Math.round(image.naturalHeight * scale);
		canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
		if (!blob) throw new Error('encode failed');
		return blob;
	} finally {
		URL.revokeObjectURL(url);
	}
}

function renderPreviews() {
	$('ai-fill').hidden = photos.length === 0;
	$('previews').replaceChildren(
		...photos.map((photo, index) => {
			const item = document.createElement('li');
			const image = document.createElement('img');
			image.src = photo.url;
			image.alt = `Photo ${index + 1}`;
			item.append(image);
			if (index > 0) {
				item.append(
					iconButton('★', 'cover', `Make photo ${index + 1} the first`, () => {
						photos.unshift(...photos.splice(index, 1));
						renderPreviews();
					}),
				);
			}
			const model = document.createElement('button');
			model.type = 'button';
			model.className = `model${photo.model ? ' on' : ''}`;
			model.textContent = MODEL_LABELS[photo.model];
			model.setAttribute('aria-label', `Photo ${index + 1}: ${MODEL_LABELS[photo.model]}. Tap to change.`);
			model.addEventListener('click', () => {
				photo.model = NEXT_MODEL[photo.model];
				renderPreviews();
			});
			item.append(model);
			item.append(
				iconButton('✕', 'remove', `Remove photo ${index + 1}`, () => {
					URL.revokeObjectURL(photo.url);
					photos.splice(index, 1);
					renderPreviews();
				}),
			);
			return item;
		}),
	);
}

function iconButton(symbol, className, label, onClick) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = className;
	button.textContent = symbol;
	button.setAttribute('aria-label', label);
	button.addEventListener('click', onClick);
	return button;
}

for (const input of document.querySelectorAll('.file')) {
	input.addEventListener('change', async () => {
		const files = [...input.files];
		input.value = '';
		show($('add-error'));
		for (const file of files) {
			if (photos.length >= MAX_PHOTOS) {
				show($('add-error'), `A piece can have up to ${MAX_PHOTOS} photos.`);
				break;
			}
			try {
				const blob = await shrink(file);
				photos.push({ blob, url: URL.createObjectURL(blob), model: '' });
				renderPreviews();
			} catch {
				show($('add-error'), `Couldn't read ${file.name}. Try a JPEG or PNG.`);
			}
		}
	});
}

const toBase64 = (blob) =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(',')[1]);
		reader.onerror = () => reject(new Error('Could not read a photo.'));
		reader.readAsDataURL(blob);
	});

// ---------- AI ----------

$('ai-fill').addEventListener('click', async () => {
	const button = $('ai-fill');
	button.disabled = true;
	show($('add-error'));
	show($('add-status'), 'The AI is looking at your photos… (about 10 to 30 seconds)');
	try {
		const small = await Promise.all(photos.slice(0, AI_PHOTOS).map((photo) => shrink(photo.blob, AI_SIDE).then(toBase64)));
		const piece = await api('describe', { method: 'POST', body: { photos: small } });
		const set = (name, value) => {
			if (value) form.elements[name].value = value;
		};
		set('brand', piece.brand);
		set('title', piece.title.de);
		set('description', piece.description.de);
		set('category', piece.category);
		set('condition', piece.condition);
		if (piece.size !== 'unknown') set('size', piece.size);
		aiTexts = { title: piece.title, description: piece.description };
		$('more').open = true;
		$('ai-note').hidden = false;
		show($('add-status'));
		form.elements.price.focus();
	} catch (error) {
		show($('add-status'));
		show($('add-error'), error.message);
	} finally {
		button.disabled = false;
	}
});

/** The AI's French, Italian and English text, but only if the German text is still what the AI wrote. */
function translationsFor(field, german) {
	const ai = aiTexts?.[field];
	if (!ai || ai.de.trim() !== String(german).trim()) return undefined;
	return { fr: ai.fr, it: ai.it, en: ai.en };
}

// ---------- Publish ----------

form.addEventListener('submit', async (event) => {
	event.preventDefault();
	show($('add-error'));
	show($('add-status'));
	if (!photos.length) return show($('add-error'), 'Add at least one photo.');
	if (!form.reportValidity()) return;

	const fields = new FormData(form);
	const button = $('publish');
	button.disabled = true;
	try {
		const shas = [];
		for (const [index, photo] of photos.entries()) {
			show($('add-status'), `Uploading photo ${index + 1} of ${photos.length}…`);
			const { sha } = await api('photos', { method: 'POST', body: { base64: await toBase64(photo.blob) } });
			shas.push(sha);
		}
		show($('add-status'), 'Saving…');
		await api('products', {
			method: 'POST',
			body: {
				brand: fields.get('brand'),
				title: fields.get('title'),
				category: fields.get('category'),
				size: fields.get('size'),
				condition: fields.get('condition'),
				price: fields.get('price'),
				measurements: fields.get('measurements'),
				description: fields.get('description'),
				staffPick: fields.get('staffPick') === 'on',
				photos: shas,
				models: photos.map((photo) => photo.model),
				translations: {
					title: translationsFor('title', fields.get('title')),
					description: translationsFor('description', fields.get('description')),
				},
			},
		});
		for (const photo of photos) URL.revokeObjectURL(photo.url);
		photos = [];
		renderPreviews();
		form.reset();
		aiTexts = null;
		$('ai-note').hidden = true;
		show($('add-status'), 'Published! It shows in the shop after the site rebuilds, usually within 2 minutes.');
		await loadProducts();
	} catch (error) {
		show($('add-status'));
		show($('add-error'), error.message);
	} finally {
		button.disabled = false;
	}
});

// ---------- List ----------

function renderProducts(products) {
	const list = $('products');
	if (!products.length) {
		const empty = document.createElement('li');
		empty.className = 'hint';
		empty.textContent = 'Nothing here yet.';
		return list.replaceChildren(empty);
	}
	list.replaceChildren(...products.map(renderProduct));
}

function renderProduct(product) {
	const item = document.createElement('li');
	item.className = product.sold ? 'product sold' : 'product';

	const thumb = document.createElement(product.photo ? 'img' : 'div');
	thumb.className = 'thumb';
	if (product.photo) {
		thumb.src = `/api/admin/photos?id=${encodeURIComponent(product.id)}&file=${encodeURIComponent(product.photo)}`;
		thumb.alt = '';
		thumb.loading = 'lazy';
	}

	const meta = document.createElement('div');
	meta.className = 'meta';
	const name = document.createElement('strong');
	name.textContent = `${product.brand} ${product.title}`;
	const details = document.createElement('small');
	details.textContent = `CHF ${product.price} · ${product.size}`;
	meta.append(name, details);
	for (const [active, label] of [
		[product.sold, 'Sold'],
		[product.draft, 'Hidden draft'],
	]) {
		if (!active) continue;
		const tag = document.createElement('span');
		tag.className = 'tag';
		tag.textContent = label;
		meta.append(tag);
	}

	const actions = document.createElement('div');
	actions.className = 'actions';
	const sold = actionButton(product.sold ? 'Available again' : 'Mark sold', '', () =>
		api(`products/${product.id}`, { method: 'PATCH', body: { sold: !product.sold } }),
	);
	const remove = actionButton('Delete', 'danger', () => {
		if (!confirm(`Delete ${product.brand} ${product.title} from the shop?`)) return null;
		return api(`products/${product.id}`, { method: 'DELETE' });
	});
	actions.append(sold, remove);
	meta.append(priceEditor(product), actions);

	item.append(thumb, meta);
	return item;
}

function priceEditor(product) {
	const row = document.createElement('div');
	row.className = 'price-edit';
	const label = document.createElement('label');
	label.textContent = 'Price (CHF)';
	const input = document.createElement('input');
	input.type = 'number';
	input.inputMode = 'decimal';
	input.min = '1';
	input.step = '0.05';
	input.value = String(product.price);
	label.append(input);
	const save = actionButton('Save price', '', () => {
		const price = input.valueAsNumber;
		if (!input.checkValidity() || !price) throw new Error('Enter a price of at least CHF 1.');
		if (price === product.price) return null;
		return api(`products/${product.id}`, { method: 'PATCH', body: { price } });
	});
	row.append(label, save);
	return row;
}

function actionButton(label, className, run) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = className;
	button.textContent = label;
	button.addEventListener('click', async () => {
		button.disabled = true;
		show($('list-error'));
		show($('list-status'));
		try {
			const pending = run();
			if (pending) {
				await pending;
				await loadProducts();
				show($('list-status'), 'Saved! The shop updates after the site rebuilds, usually within 2 minutes.');
			}
		} catch (error) {
			show($('list-error'), error.message);
		} finally {
			button.disabled = false;
		}
	});
	return button;
}

function fillSelect(name, options) {
	const select = form.elements[name];
	const blank = new Option('Choose…', '');
	select.replaceChildren(blank, ...options.map((o) => new Option(o.label, o.id)));
}

async function loadProducts() {
	const { products, options } = await api('products');
	pieceList = products;
	if (!form.elements.category.options.length) {
		fillSelect('category', options.categories);
		fillSelect('size', options.sizes.map((size) => ({ id: size, label: size })));
		fillSelect('condition', options.conditions);
	}
	renderProducts(products);
}

async function loadDashboard() {
	await loadProducts();
	$('login').hidden = true;
	$('dashboard').hidden = false;
	showPage();
	loadOffers().catch((error) => show($('offers-error'), error.message));
	loadAuctions().catch((error) => show($('auctions-error'), error.message));
}

loadDashboard().catch((error) => {
	showLogin();
	if (error.message !== 'Please log in.') show($('login-error'), error.message);
});

// ---------- Pages ----------

function showPage() {
	const page = location.hash === '#offers' ? 'offers' : location.hash === '#auctions' ? 'auctions' : 'pieces';
	$('pieces-page').hidden = page !== 'pieces';
	$('offers-page').hidden = page !== 'offers';
	$('auctions-page').hidden = page !== 'auctions';
	if (page === 'auctions' && !$('dashboard').hidden) loadAuctions().catch((error) => show($('auctions-error'), error.message));
	for (const tab of document.querySelectorAll('.tabs a')) {
		if (tab.dataset.page === page) tab.setAttribute('aria-current', 'page');
		else tab.removeAttribute('aria-current');
	}
	if (page === 'offers' && !$('dashboard').hidden) loadOffers().catch((error) => show($('offers-error'), error.message));
}
window.addEventListener('hashchange', showPage);

// ---------- Price offers ----------

const OPEN = ['pending', 'agreed', 'countered', 'accepted'];
const STATE = {
	pending: 'New – your answer',
	accepted: 'Accepted – waiting for payment',
	declined: 'Declined',
	countered: 'Counter-offer sent – waiting for the customer',
	agreed: 'Customer accepted your counter-offer',
	rejected: 'Customer declined your counter-offer',
	paid: 'Paid ✓',
};
let offerFilter = 'open';
let offerData = { offers: [], canPay: false };

const chf = (n) => `CHF ${Number(n).toFixed(2).replace(/\.00$/, '.–')}`;
const when = (seconds) => new Date(seconds * 1000).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

for (const button of document.querySelectorAll('.filter button')) {
	button.addEventListener('click', () => {
		offerFilter = button.dataset.filter;
		for (const b of document.querySelectorAll('.filter button')) b.setAttribute('aria-pressed', String(b === button));
		renderOffers();
	});
}

async function loadOffers() {
	offerData = await api('offers');
	const waiting = offerData.offers.filter((o) => o.status === 'pending' || o.status === 'agreed').length;
	$('offers-count').textContent = String(waiting);
	$('offers-count').hidden = waiting === 0;
	$('offers-pay-note').textContent = offerData.canPay
		? 'Once a price is agreed, the customer pays it online with Stripe.'
		: 'Stripe checkout is off: once a price is agreed, send the customer the payment details yourself (reply to the email).';
	renderOffers();
}

function renderOffers() {
	const list = offerFilter === 'open' ? offerData.offers.filter((o) => OPEN.includes(o.status)) : offerData.offers;
	if (!list.length) return $('offers').replaceChildren(el('li', 'hint', offerFilter === 'open' ? 'No open offers.' : 'No offers yet.'));
	$('offers').replaceChildren(...list.map(renderOffer));
}

function renderOffer(offer) {
	const item = el('li', OPEN.includes(offer.status) ? 'offer' : 'offer closed');
	item.append(el('span', `state ${offer.status}`, STATE[offer.status] ?? offer.status));

	const title = el('strong');
	const link = el('a', '', offer.product_name);
	link.href = `/item/${offer.product_id}/`;
	link.target = '_blank';
	title.append(link);
	item.append(title);

	const discount = Math.round((1 - offer.amount / offer.list_price) * 100);
	const amounts = el('p', 'amounts');
	amounts.append(el('strong', '', chf(offer.amount)), ' ', el('s', '', chf(offer.list_price)), ` (−${discount} %)`);
	if (offer.counter) amounts.append(` · your counter-offer: ${chf(offer.counter)}`);
	item.append(amounts);

	const who = el('p', 'who');
	const mail = el('a', '', offer.email);
	mail.href = `mailto:${offer.email}`;
	who.append(`${offer.name} · `, mail);
	item.append(who);
	if (offer.message) item.append(el('blockquote', '', offer.message));
	item.append(el('p', 'when', `Received ${when(offer.created_at)}${offer.updated_at !== offer.created_at ? ` · updated ${when(offer.updated_at)}` : ''}`));

	if (offer.status === 'pending') item.append(offerActions(offer));
	else if (offer.status === 'countered') {
		const actions = el('div', 'actions');
		actions.append(offerButton('Withdraw counter-offer', 'danger', offer, { action: 'decline' }));
		item.append(actions);
	}
	else if ((offer.status === 'accepted' || offer.status === 'agreed') && !offerData.canPay)
		item.append(el('p', 'hint', `Send ${offer.name} the payment details for ${chf(offer.status === 'agreed' ? offer.counter : offer.amount)}.`));
	return item;
}

function offerActions(offer) {
	const box = el('div');
	const actions = el('div', 'actions');
	actions.append(
		offerButton(`Accept ${chf(offer.amount)}`, 'primary', offer, { action: 'accept' }),
		offerButton('Decline', 'danger', offer, { action: 'decline' }),
	);

	const row = el('div', 'counter-row');
	const label = el('label', '', 'Counter-offer (CHF)');
	const input = el('input');
	input.type = 'number';
	input.inputMode = 'decimal';
	input.step = '0.05';
	input.min = String(offer.amount + 0.05);
	input.max = String(offer.list_price);
	input.value = String(Math.round((offer.amount + offer.list_price) / 2));
	label.append(input);
	row.append(
		label,
		offerButton('Send counter-offer', '', offer, () => {
			const amount = input.valueAsNumber;
			if (!amount || amount <= offer.amount || amount > offer.list_price)
				throw new Error(`Enter an amount above ${chf(offer.amount)} and at most ${chf(offer.list_price)}.`);
			return { action: 'counter', amount };
		}),
	);
	box.append(actions, row);
	return box;
}

function offerButton(label, className, offer, body) {
	const button = el('button', className, label);
	button.type = 'button';
	button.addEventListener('click', async () => {
		show($('offers-error'));
		show($('offers-status'));
		try {
			const payload = typeof body === 'function' ? body() : body;
			if (payload.action === 'decline' && !confirm(`Decline the offer from ${offer.name}?`)) return;
			button.disabled = true;
			const result = await api(`offers/${offer.id}`, { method: 'PATCH', body: payload });
			await loadOffers();
			show($('offers-status'), result.warning ?? `Done. ${offer.name} got an email.`);
		} catch (error) {
			show($('offers-error'), error.message);
		} finally {
			button.disabled = false;
		}
	});
	return button;
}

// ---------- Auctions ----------

const AUCTION_GROUPS = [
	['running', 'Running'],
	['payment', 'Waiting for payment'],
	['paid', 'Paid'],
	['ended', 'Ended without sale (unsold, cancelled or not paid)'],
];
const auctionForm = $('auction-form');

/** "2026-11-20T18:00" for a datetime-local input, in the browser's (Swiss) time. */
const localInput = (date) => {
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

for (const button of auctionForm.querySelectorAll('[data-days]')) {
	button.addEventListener('click', () => {
		// n days from now, on the full hour: easy to remember for bidders.
		const end = new Date(Date.now() + Number(button.dataset.days) * 86400000);
		end.setMinutes(0, 0, 0);
		auctionForm.elements.endsAt.value = localInput(end);
	});
}

function fillAuctionPieces(auctions) {
	const busy = new Set(auctions.filter((a) => a.status === 'running' || a.status === 'payment').map((a) => a.product_id));
	const select = auctionForm.elements.productId;
	const chosen = select.value;
	const options = pieceList
		.filter((p) => !p.sold && !p.draft && !busy.has(p.id))
		.map((p) => new Option(`${p.brand} ${p.title} (CHF ${p.price})`, p.id));
	select.replaceChildren(new Option('Choose…', ''), ...options);
	select.value = chosen;
}

auctionForm.elements.productId.addEventListener('change', () => {
	// Suggest a start price: half the normal price, at least CHF 1.
	const piece = pieceList.find((p) => p.id === auctionForm.elements.productId.value);
	if (piece && !auctionForm.elements.startPrice.value) auctionForm.elements.startPrice.value = String(Math.max(1, Math.round(piece.price / 2)));
});

auctionForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	show($('auction-error'));
	show($('auction-status'));
	const f = auctionForm.elements;
	const endsAt = f.endsAt.value ? new Date(f.endsAt.value).getTime() : NaN;
	if (!f.productId.value) return show($('auction-error'), 'Choose a piece.');
	if (!(Number(f.startPrice.value) >= 1)) return show($('auction-error'), 'Enter a start price of at least CHF 1.');
	if (!endsAt) return show($('auction-error'), 'Choose when it ends (or tap 3, 5 or 7 days).');
	const button = auctionForm.querySelector('button[type=submit]');
	button.disabled = true;
	try {
		await api('auctions', { method: 'POST', body: { productId: f.productId.value, startPrice: Number(f.startPrice.value), endsAt } });
		auctionForm.reset();
		show($('auction-status'), 'The auction is running. It shows on the piece page right away.');
		await loadAuctions();
	} catch (error) {
		show($('auction-error'), error.message);
	} finally {
		button.disabled = false;
	}
});

async function loadAuctions() {
	const { auctions } = await api('auctions');
	show($('auctions-error'));
	fillAuctionPieces(auctions);
	const open = auctions.filter((a) => a.status === 'running' || a.status === 'payment').length;
	$('auctions-count').textContent = String(open);
	$('auctions-count').hidden = open === 0;
	const groups = AUCTION_GROUPS.map(([key, title]) => {
		const list = auctions.filter((a) => (key === 'ended' ? ['unsold', 'cancelled', 'failed'].includes(a.status) : a.status === key));
		if (!list.length) return null;
		const section = el('div', 'auction-group');
		const ul = el('ul', 'offers');
		ul.append(...list.map(renderAuction));
		section.append(el('h3', '', `${title} (${list.length})`), ul);
		return section;
	}).filter(Boolean);
	$('auctions').replaceChildren(...(groups.length ? groups : [el('p', 'hint', 'No auctions yet.')]));
}

function renderAuction(a) {
	const item = el('li', a.status === 'running' || a.status === 'payment' ? 'offer' : 'offer closed');
	const label = {
		running: 'Running',
		payment: a.round === 2 ? 'Second chance – waiting for payment' : 'Won – waiting for payment',
		paid: 'Paid ✓ – ship it',
		unsold: 'Ended without bids',
		cancelled: 'Cancelled',
		failed: 'Not paid – back on normal sale',
	}[a.status];
	const tone = { running: 'pending', payment: 'accepted', paid: 'paid' }[a.status] ?? 'declined';
	item.append(el('span', `state ${tone}`, label));
	const title = el('strong');
	const link = el('a', '', a.product_name);
	link.href = `/item/${a.product_id}/`;
	link.target = '_blank';
	title.append(link);
	item.append(title);
	const amounts = el('p', 'amounts');
	const shown = a.status === 'payment' || a.status === 'paid' ? a.buyer_price : a.price;
	amounts.append(el('strong', '', chf(shown)), ` · start ${chf(a.start_price)} · ${a.bids} bid${a.bids === 1 ? '' : 's'}`);
	item.append(amounts);
	if (a.status === 'running') {
		item.append(el('p', 'when', `Ends ${when(a.ends_at)}${a.leader_email ? ` · ahead: ${a.leader_email}` : ''}`));
		if (a.bids === 0) {
			const actions = el('div', 'actions');
			const cancel = el('button', 'danger', 'Cancel auction');
			cancel.type = 'button';
			cancel.addEventListener('click', async () => {
				if (!confirm(`Cancel the auction for ${a.product_name}?`)) return;
				cancel.disabled = true;
				show($('auctions-error'));
				try {
					await api(`auctions/${a.id}`, { method: 'DELETE' });
					await loadAuctions();
				} catch (error) {
					show($('auctions-error'), error.message);
					cancel.disabled = false;
				}
			});
			actions.append(cancel);
			item.append(actions);
		}
	} else if (a.status === 'payment' || a.status === 'paid') {
		const who = el('p', 'who');
		const mail = el('a', '', a.buyer_email ?? '–');
		if (a.buyer_email) mail.href = `mailto:${a.buyer_email}`;
		who.append('Buyer: ', mail);
		item.append(who);
		if (a.status === 'payment') item.append(el('p', 'when', `Pays by ${when(a.pay_until)}`));
	} else item.append(el('p', 'when', `Ended ${when(a.ends_at)}`));
	return item;
}
