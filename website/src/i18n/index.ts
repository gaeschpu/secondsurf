// Tiny i18n helper. German lives at "/", French at "/fr/", Italian at "/it/", English at "/en/".
// Anything missing in a language falls back to German.
// Every page is a single file under src/pages/[...lang]/ that is built once per language.

import { ui, type UiKey } from './ui';

export const languages = { de: 'Deutsch', fr: 'Français', it: 'Italiano', en: 'English' } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = 'de';
export const htmlLang: Record<Lang, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en' };
export const langLabel: Record<Lang, string> = { de: 'DE', fr: 'FR', it: 'IT', en: 'EN' };
const langs = Object.keys(languages) as Lang[];

/** Text that is either the same in every language, or given per language (missing languages fall back to German). */
export type Localized = string | ({ de: string } & Partial<Record<Exclude<Lang, 'de'>, string>>);

/** getStaticPaths() for pages that exist in every language. */
export function langPaths() {
	return langs.map((lang) => ({
		params: { lang: lang === defaultLang ? undefined : lang },
		props: { lang },
	}));
}

/** Build an internal link for a language: url('fr', '/contact/') -> '/fr/contact/'. */
export function url(lang: Lang, path = '/'): string {
	const p = path.startsWith('/') ? path : `/${path}`;
	return lang === defaultLang ? p : `/${lang}${p}`;
}

/** Remove the language prefix from a pathname: '/fr/contact/' -> '/contact/'. */
export function stripLang(pathname: string): string {
	const stripped = pathname.replace(/^\/(fr|it|en)(?=\/|$)/, '');
	return stripped === '' ? '/' : stripped;
}

/** Translator for UI strings, falling back to German. */
export function useT(lang: Lang) {
	return (key: UiKey): string => ui[lang][key] ?? ui.de[key];
}

/** Pick the right language from a Localized value. */
export function l(value: Localized | undefined, lang: Lang): string {
	if (value === undefined) return '';
	if (typeof value === 'string') return value;
	return value[lang] || value.de;
}

/** Format a price in Swiss francs: 45 -> "CHF 45.–", 12.5 -> "CHF 12.50". */
export function chf(amount: number): string {
	return Number.isInteger(amount) ? `CHF ${amount}.–` : `CHF ${amount.toFixed(2)}`;
}
