// Dashboard for adding pieces from a phone. The server part is in /functions/api/admin.

const MAX_PHOTOS = 8;
const MAX_SIDE = 1600; // the site makes its own smaller versions from this
const JPEG_QUALITY = 0.85;

const $ = (id) => document.getElementById(id);
const form = $('add-form');

/** @type {{ blob: Blob, url: string }[]} */
let photos = [];

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
async function shrink(file) {
	const url = URL.createObjectURL(file);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
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
				photos.push({ blob, url: URL.createObjectURL(blob) });
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
			},
		});
		for (const photo of photos) URL.revokeObjectURL(photo.url);
		photos = [];
		renderPreviews();
		form.reset();
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
}

loadDashboard().catch((error) => {
	showLogin();
	if (error.message !== 'Please log in.') show($('login-error'), error.message);
});
