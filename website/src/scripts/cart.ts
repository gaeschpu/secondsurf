// The cart (Warenkorb) lives in this browser: a list of piece ids in localStorage. Nothing is reserved until the customer
// is at the Stripe checkout (functions/api/checkout.ts holds the pieces then). Used by the piece page ("In den Warenkorb"),
// the cart icon in the header and the cart page.

const KEY = 'cart';
/** Same limit as MAX_CART in functions/_lib/checkout.ts. */
export const MAX_CART = 8;

export function cartIds(): string[] {
	try {
		const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

function save(ids: string[]) {
	try {
		if (ids.length) localStorage.setItem(KEY, JSON.stringify(ids));
		else localStorage.removeItem(KEY);
	} catch {}
	// The header badge and other parts of the page listen for this.
	window.dispatchEvent(new CustomEvent('cart-change', { detail: ids }));
}

/** Adds a piece; false when the cart is full. */
export function addToCart(id: string) {
	const ids = cartIds();
	if (ids.includes(id)) return true;
	if (ids.length >= MAX_CART) return false;
	save([...ids, id]);
	return true;
}

export const removeFromCart = (id: string) => save(cartIds().filter((x) => x !== id));
export const clearCart = () => save([]);
export const inCart = (id: string) => cartIds().includes(id);
