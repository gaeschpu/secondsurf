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
/** Categories, sizes and conditions, for the edit form. */
let formOptions = null;

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
	// An auction lot has no fixed price: the start price stands in for it (it's never shown as a price to buy at).
	const lot = form.elements.auctionOnly.checked;
	const lotEnd = form.elements.lotEnd.value ? new Date(form.elements.lotEnd.value).getTime() : NaN;
	if (lot) {
		if (!(Number(form.elements.lotStart.value) >= 1)) return show($('add-error'), 'Enter the start price of the auction (at least CHF 1).');
		if (!lotEnd) return show($('add-error'), 'Choose when the auction ends (or tap 3, 5 or 7 days).');
		form.elements.price.value = form.elements.lotStart.value;
	}
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
		const result = await api('products', {
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
				staffPick: fields.get('staffPick') === 'on' && !lot,
				auctionOnly: lot,
				...(lot ? { auction: { startPrice: Number(fields.get('lotStart')), endsAt: lotEnd } } : {}),
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
		$('lot-auction').hidden = true;
		aiTexts = null;
		$('ai-note').hidden = true;
		show(
			$('add-status'),
			result.warning ??
				(lot
					? 'Published and the auction is running! The lot shows on the Auctions page after the site rebuilds, usually within 2 minutes.'
					: 'Published! It shows in the shop after the site rebuilds, usually within 2 minutes.'),
		);
		await loadProducts();
		if (lot) loadAuctions().catch(() => {});
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
	// Tap the photo or the name to edit the piece.
	for (const target of [thumb, name]) {
		target.classList.add('editable');
		target.title = 'Edit';
		target.addEventListener('click', () => openEdit(product));
	}
	for (const [active, label] of [
		[product.auctionOnly, 'Auction only'],
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
	const editButton = document.createElement('button');
	editButton.type = 'button';
	editButton.textContent = 'Edit';
	editButton.addEventListener('click', () => openEdit(product));
	actions.append(editButton, sold, remove);
	// Put a shop piece up for auction: opens the Auctions tab with this piece chosen.
	if (!product.sold) {
		const auction = document.createElement('button');
		auction.type = 'button';
		auction.textContent = 'Auction';
		auction.addEventListener('click', () => {
			location.hash = '#auctions';
			const select = auctionForm.elements.productId;
			if (![...select.options].some((o) => o.value === product.id)) select.append(new Option(`${product.brand} ${product.title} (CHF ${product.price})`, product.id));
			select.value = product.id;
			auctionForm.elements.startPrice.value = String(Math.max(1, Math.round(product.price / 2)));
			auctionForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
			show($('auction-status'), `${product.brand} ${product.title} is chosen. Check the start price, choose the end (3, 5 or 7 days) and tap Start auction.`);
		});
		actions.append(auction);
	}
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
	formOptions = options;
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
	loadOrders().catch((error) => show($('orders-error'), error.message));
	loadSubmissions().catch((error) => show($('submissions-error'), error.message));
}

loadDashboard().catch((error) => {
	showLogin();
	if (error.message !== 'Please log in.') show($('login-error'), error.message);
});

// ---------- Pages ----------

function showPage() {
	const page = { '#offers': 'offers', '#auctions': 'auctions', '#orders': 'orders', '#submissions': 'submissions' }[location.hash] ?? 'pieces';
	$('pieces-page').hidden = page !== 'pieces';
	$('offers-page').hidden = page !== 'offers';
	$('auctions-page').hidden = page !== 'auctions';
	$('orders-page').hidden = page !== 'orders';
	$('submissions-page').hidden = page !== 'submissions';
	if (page === 'submissions' && !$('dashboard').hidden) loadSubmissions().catch((error) => show($('submissions-error'), error.message));
	if (page === 'orders' && !$('dashboard').hidden) loadOrders().catch((error) => show($('orders-error'), error.message));
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

// ---------- Auction lots (Add a piece → "Auction only") ----------

form.elements.auctionOnly.addEventListener('change', () => {
	const lot = form.elements.auctionOnly.checked;
	$('lot-auction').hidden = !lot;
	// No fixed price for a lot: the price field is filled from the start price when publishing.
	form.elements.price.closest('label').hidden = lot;
	form.elements.price.required = !lot;
	if (lot && !form.elements.lotStart.value && form.elements.price.value) form.elements.lotStart.value = form.elements.price.value;
});

for (const button of document.querySelectorAll('[data-lot-days]')) {
	button.addEventListener('click', () => {
		const end = new Date(Date.now() + Number(button.dataset.lotDays) * 86400000);
		end.setMinutes(0, 0, 0);
		form.elements.lotEnd.value = localInput(end);
	});
}

form.addEventListener('reset', () => {
	form.elements.price.closest('label').hidden = false;
	form.elements.price.required = true;
});

// ---------- Edit a piece ----------

const editDialog = $('edit-dialog');
const editForm = $('edit-form');
let editing = null;

function fillOptions(select, list, value) {
	select.replaceChildren(...list.map((o) => new Option(o.label, o.id)));
	select.value = value;
}

async function openEdit(product) {
	show($('list-error'));
	try {
		const piece = await api(`products/${product.id}`);
		editing = piece;
		const f = editForm.elements;
		fillOptions(f.category, formOptions.categories, piece.category);
		fillOptions(f.size, formOptions.sizes.map((s) => ({ id: s, label: s })), piece.size);
		fillOptions(f.condition, formOptions.conditions, piece.condition);
		f.brand.value = piece.brand;
		f.price.value = String(piece.price);
		f.sizeNote.value = piece.sizeNote;
		f.measurements.value = piece.measurements;
		for (const lang of ['de', 'fr', 'it', 'en']) {
			f[`title_${lang}`].value = piece.title[lang];
			f[`description_${lang}`].value = piece.description[lang];
		}
		f.staffPick.checked = piece.staffPick;
		f.auctionOnly.checked = piece.auctionOnly;
		$('edit-id').textContent = `${piece.id} · ${piece.photos} photo${piece.photos === 1 ? '' : 's'}${piece.sold ? ' · sold' : ''}`;
		show($('edit-error'));
		editDialog.showModal();
	} catch (error) {
		show($('list-error'), error.message);
	}
}

$('edit-cancel').addEventListener('click', () => editDialog.close());

editForm.addEventListener('submit', async (event) => {
	event.preventDefault();
	if (!editing) return;
	if (!editForm.reportValidity()) return;
	const f = editForm.elements;
	const both = (name) => Object.fromEntries(['de', 'fr', 'it', 'en'].map((lang) => [lang, f[`${name}_${lang}`].value]));
	const button = $('edit-save');
	button.disabled = true;
	show($('edit-error'));
	try {
		const result = await api(`products/${editing.id}`, {
			method: 'PATCH',
			body: {
				edit: {
					brand: f.brand.value,
					title: both('title'),
					category: f.category.value,
					size: f.size.value,
					sizeNote: f.sizeNote.value,
					condition: f.condition.value,
					price: Number(f.price.value),
					measurements: f.measurements.value,
					description: both('description'),
					staffPick: f.staffPick.checked,
					auctionOnly: f.auctionOnly.checked,
				},
			},
		});
		editDialog.close();
		await loadProducts();
		show($('list-status'), result.unchanged ? 'Nothing changed.' : 'Saved! The shop updates after the site rebuilds, usually within 2 minutes.');
	} catch (error) {
		show($('edit-error'), error.message);
	} finally {
		button.disabled = false;
	}
});

// ---------- Orders (labels, shipped) ----------

let orderList = [];
const openLabels = (refs) => window.open(`/admin/label.html?refs=${refs.join(',')}`, '_blank');

$('orders-print-open').addEventListener('click', () => openLabels(orderList.filter((o) => o.status === 'paid').map((o) => o.ref)));

async function loadOrders() {
	const { orders } = await api('orders');
	orderList = orders;
	show($('orders-error'));
	const open = orders.filter((o) => o.status === 'paid');
	$('orders-count').textContent = String(open.length);
	$('orders-count').hidden = open.length === 0;
	$('orders-print-open').hidden = open.length < 2;
	$('orders').replaceChildren(...(orders.length ? orders.map(renderOrder) : [el('li', 'hint', 'No online orders yet.')]));
}

function renderOrder(o) {
	const item = el('li', o.status === 'paid' ? 'offer' : 'offer closed');
	item.append(el('span', `state ${o.status === 'paid' ? 'pending' : 'paid'}`, o.status === 'paid' ? 'To ship' : `Shipped ✓ ${o.shipped_at ? when(o.shipped_at) : ''}`));
	item.append(el('strong', '', `${o.name ?? '–'} · ${o.postal_code ?? ''} ${o.city ?? ''}`));
	const pieces = el('ul', 'order-pieces');
	o.ids.forEach((id, i) => {
		const li = el('li');
		const link = el('a', '', o.names[i] ?? id);
		link.href = `/item/${id}/`;
		link.target = '_blank';
		li.append(link);
		if (o.seller_ids?.includes(id)) li.append(el('span', 'tag', 'Seller ships'));
		pieces.append(li);
	});
	item.append(pieces);
	item.append(el('p', 'amounts', `${o.amount != null ? chf(o.amount) : '–'} incl. shipping${o.discount ? ` · code ${o.discount}` : ''}`));
	const who = el('p', 'who');
	who.append(`${[o.line1, o.line2, `${o.postal_code ?? ''} ${o.city ?? ''}`.trim()].filter(Boolean).join(', ')}`);
	if (o.email) {
		const mail = el('a', '', o.email);
		mail.href = `mailto:${o.email}`;
		who.append(' · ', mail);
	}
	if (o.phone) who.append(` · ${o.phone}`);
	item.append(who);
	item.append(el('p', 'when', `Paid ${o.paid_at ? when(o.paid_at) : '–'} · order ${o.ref.slice(0, 8).toUpperCase()}`));

	const actions = el('div', 'actions');
	const label = el('button', 'primary', 'Label (PDF)');
	label.type = 'button';
	label.addEventListener('click', () => openLabels([o.ref]));
	const shipped = el('button', '', o.status === 'paid' ? 'Mark shipped' : 'Not shipped yet');
	shipped.type = 'button';
	shipped.addEventListener('click', async () => {
		shipped.disabled = true;
		try {
			await api(`orders/${o.ref}`, { method: 'PATCH', body: { shipped: o.status === 'paid' } });
			await loadOrders();
		} catch (error) {
			show($('orders-error'), error.message);
			shipped.disabled = false;
		}
	});
	actions.append(label, shipped);
	item.append(actions);
	return item;
}

// ---------- Sellers: submissions and payouts ----------

const SUBMISSION_STATE = { pending: 'To check', approved: 'Approved ✓', rejected: 'Rejected' };

async function loadSubmissions() {
	const [{ submissions }, { payouts }] = await Promise.all([api('sellers/submissions'), api('sellers/payouts')]);
	show($('submissions-error'));
	const pending = submissions.filter((s) => s.status === 'pending').length;
	const due = payouts.filter((p) => p.status === 'shipped').length;
	$('submissions-count').textContent = String(pending + due);
	$('submissions-count').hidden = pending + due === 0;
	$('submissions').replaceChildren(...(submissions.length ? submissions.map(renderSubmission) : [el('li', 'hint', 'No pieces from sellers yet.')]));
	$('payouts').replaceChildren(...(payouts.length ? payouts.map(renderPayout) : [el('li', 'hint', 'No seller sales yet.')]));
}

function field(label, input) {
	const wrap = el('label', '', label);
	wrap.append(input);
	return wrap;
}

function renderSubmission(s) {
	const item = el('li', s.status === 'pending' ? 'offer' : 'offer closed');
	item.append(el('span', `state ${s.status === 'pending' ? 'pending' : s.status === 'approved' ? 'paid' : 'declined'}`, SUBMISSION_STATE[s.status] ?? s.status));
	const who = el('p', 'who');
	const mail = el('a', '', s.seller_email ?? '–');
	if (s.seller_email) mail.href = `mailto:${s.seller_email}`;
	who.append(`${s.seller_name ?? ''} · `, mail, ` · ${when(s.created_at)}`);
	item.append(who);

	if (s.status !== 'pending') {
		item.append(el('strong', '', `${s.brand} ${s.title} · ${chf(s.price)}`));
		if (s.status === 'approved' && s.product_id) {
			const link = el('a', '', ' → in the shop');
			link.href = `/item/${s.product_id}/`;
			link.target = '_blank';
			item.append(link);
		}
		if (s.reason) item.append(el('p', 'hint', `Reason: ${s.reason}`));
		return item;
	}

	const gallery = el('div', 'sub-photos');
	for (const id of s.photo_ids) {
		const img = el('img');
		img.src = `/api/admin/sellers/photo?id=${id}`;
		img.alt = '';
		img.loading = 'lazy';
		gallery.append(img);
	}
	item.append(gallery);

	// Every field can be changed before approving.
	const f = {};
	const input = (name, value, attrs = {}) => Object.assign(el(name === 'description' ? 'textarea' : 'input'), { name, value: value ?? '', ...attrs });
	const select = (name, options, value) => {
		const sel = el('select');
		sel.name = name;
		sel.replaceChildren(...options.map((o) => new Option(o.label, o.id)));
		sel.value = value;
		return sel;
	};
	f.brand = input('brand', s.brand, { maxLength: 80 });
	f.title = input('title', s.title, { maxLength: 120 });
	f.category = select('category', formOptions?.categories ?? [], s.category);
	f.size = select('size', (formOptions?.sizes ?? []).map((x) => ({ id: x, label: x })), s.size);
	f.condition = select('condition', formOptions?.conditions ?? [], s.condition);
	f.price = input('price', String(s.price), { type: 'number', min: '1', step: '1', inputMode: 'decimal' });
	f.measurements = input('measurements', s.measurements, { maxLength: 200 });
	f.description = input('description', s.description, { rows: 4, maxLength: 2000 });
	const form = el('div', 'sub-form');
	form.append(
		field('Brand', f.brand),
		field('Title (German)', f.title),
		field('Category', f.category),
		field('Size', f.size),
		field('Condition', f.condition),
		field('Price (CHF)', f.price),
		field('Measurements', f.measurements),
		field('Description', f.description),
	);
	item.append(form);

	const actions = el('div', 'actions');
	const approve = el('button', 'primary', 'Approve → shop');
	approve.type = 'button';
	approve.addEventListener('click', () =>
		submissionAction(approve, `sellers/submissions/${s.id}/approve`, {
			brand: f.brand.value,
			title: f.title.value,
			category: f.category.value,
			size: f.size.value,
			condition: f.condition.value,
			price: Number(f.price.value),
			measurements: f.measurements.value,
			description: f.description.value,
		}, 'Approved. The piece shows in the shop after the site rebuilds (about 2 minutes); the seller got an email.'),
	);
	const reject = el('button', 'danger', 'Reject');
	reject.type = 'button';
	reject.addEventListener('click', () => {
		const reason = prompt('Why? The seller sees this in the email (optional).');
		if (reason === null) return;
		submissionAction(reject, `sellers/submissions/${s.id}/reject`, { reason }, 'Rejected; the seller got an email.');
	});
	actions.append(approve, reject);
	item.append(actions);
	return item;
}

async function submissionAction(button, path, body, done) {
	button.disabled = true;
	show($('submissions-error'));
	show($('submissions-status'));
	try {
		await api(path, { method: 'POST', body });
		await loadSubmissions();
		show($('submissions-status'), done);
	} catch (error) {
		show($('submissions-error'), error.message);
		button.disabled = false;
	}
}

function renderPayout(p) {
	const item = el('li', p.status === 'paid_out' ? 'offer closed' : 'offer');
	const state = { to_ship: 'Seller still has to ship', shipped: p.due_at && p.due_at * 1000 <= Date.now() ? 'Due now' : 'Shipped – not due yet', paid_out: 'Paid out ✓' }[p.status];
	item.append(el('span', `state ${p.status === 'paid_out' ? 'paid' : p.status === 'shipped' ? 'accepted' : 'pending'}`, state));
	const title = el('strong');
	const link = el('a', '', p.product_name);
	link.href = `/item/${p.product_id}/`;
	link.target = '_blank';
	title.append(link);
	item.append(title);
	item.append(el('p', 'amounts', `Pay ${chf(p.payout)} = ${chf(p.price)} − ${Math.round(p.rate * 100)} % (${chf(p.commission)}) + shipping ${chf(p.shipping)}`));
	item.append(el('p', 'who', `${p.account_holder || p.seller_name || ''} · ${p.iban || 'IBAN missing'} · ${p.seller_email ?? ''}`));
	item.append(
		el('p', 'when', `Sold ${when(p.created_at)}${p.shipped_at ? ` · shipped ${when(p.shipped_at)} · due ${when(p.due_at)}` : ''}${p.paid_out_at ? ` · paid ${when(p.paid_out_at)}` : ''}`),
	);
	if (p.status === 'shipped') {
		const actions = el('div', 'actions');
		const paid = el('button', 'primary', 'Paid');
		paid.type = 'button';
		paid.addEventListener('click', async () => {
			if (!confirm(`Did you transfer ${chf(p.payout)} to ${p.iban || 'the seller'}?`)) return;
			paid.disabled = true;
			try {
				await api(`sellers/payouts/${p.id}/paid`, { method: 'POST', body: {} });
				await loadSubmissions();
			} catch (error) {
				show($('payouts-error'), error.message);
				paid.disabled = false;
			}
		});
		actions.append(paid);
		item.append(actions);
	}
	return item;
}
