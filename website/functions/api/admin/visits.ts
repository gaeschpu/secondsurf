// GET /api/admin/visits: visitor numbers for the "Visits" tab in /admin, from Cloudflare's own analytics of the zone
// secondsurf.ch (GraphQL Analytics API). Nothing extra runs on the shop: no script, no cookies. Only for the logged-in
// admin (api/admin/_middleware.ts).
//
// Needs two settings in Cloudflare Pages (Settings → Variables and Secrets), set by the owner:
//   CF_ANALYTICS_TOKEN  an API token with only "Zone → Analytics → Read" for secondsurf.ch (secret)
//   CF_ZONE_ID          the zone ID of secondsurf.ch (Overview page of the domain, right-hand column)
// Without them the answer is { configured: false } and the tab shows how to set them up.
//
// last 30 days, per day: visitors (unique IPs per day), page views, requests, threats blocked, data, cached share,
// countries and browsers. Last 24 hours: most viewed pages and where visitors came from (left out if the plan or the
// token doesn't allow it).

import { json, type Handler } from '../../_lib/auth.ts';

type Day = {
	dimensions: { date: string };
	sum: {
		requests: number;
		pageViews: number;
		bytes: number;
		threats: number;
		cachedRequests: number;
		countryMap: { clientCountryName: string; requests: number }[];
		browserMap: { uaBrowserFamily: string; pageViews: number }[];
	};
	uniq: { uniques: number };
};
type Group = { count: number; dimensions: Record<string, string> };

const DAILY = `query ($zone: String!, $since: Date!, $until: Date!) {
	viewer { zones(filter: { zoneTag: $zone }) {
		days: httpRequests1dGroups(limit: 40, filter: { date_geq: $since, date_leq: $until }, orderBy: [date_ASC]) {
			dimensions { date }
			sum { requests pageViews bytes threats cachedRequests countryMap { clientCountryName requests } browserMap { uaBrowserFamily pageViews } }
			uniq { uniques }
		}
	} }
}`;

// Pages (HTML only) and referrers of the last 24 hours. The free plan keeps this detail for about a day.
const RECENT = `query ($zone: String!, $since: Time!, $until: Time!) {
	viewer { zones(filter: { zoneTag: $zone }) {
		pages: httpRequestsAdaptiveGroups(limit: 15, orderBy: [count_DESC],
			filter: { datetime_geq: $since, datetime_lt: $until, requestSource: "eyeball", edgeResponseContentTypeName: "html", edgeResponseStatus: 200 }) {
			count dimensions { clientRequestPath }
		}
		referrers: httpRequestsAdaptiveGroups(limit: 15, orderBy: [count_DESC],
			filter: { datetime_geq: $since, datetime_lt: $until, requestSource: "eyeball", edgeResponseContentTypeName: "html", clientRefererHost_neq: "" }) {
			count dimensions { clientRefererHost }
		}
	} }
}`;

export const onRequestGet: Handler = async ({ env }) => {
	const token = env.CF_ANALYTICS_TOKEN;
	const zone = env.CF_ZONE_ID;
	if (!token || !zone) return json({ configured: false });
	const api = env.CF_API ?? 'https://api.cloudflare.com/client/v4';

	const query = async <T>(text: string, variables: Record<string, string>) => {
		const res = await fetch(`${api}/graphql`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: text, variables: { zone, ...variables } }),
		});
		const body = (await res.json().catch(() => null)) as { data?: { viewer?: { zones?: T[] } }; errors?: { message: string }[] | null } | null;
		if (!res.ok || body?.errors?.length || !body?.data?.viewer?.zones?.[0]) {
			throw new Error(body?.errors?.[0]?.message ?? `Cloudflare answered ${res.status}`);
		}
		return body.data.viewer.zones[0];
	};

	const now = new Date();
	const date = (d: Date) => d.toISOString().slice(0, 10);
	let days: Day[];
	try {
		({ days } = await query<{ days: Day[] }>(DAILY, { since: date(new Date(now.getTime() - 29 * 86400_000)), until: date(now) }));
	} catch (error) {
		console.error('Cloudflare analytics', error);
		return json({ configured: true, error: `Cloudflare didn't give the numbers: ${(error as Error).message}. Check the token (Zone → Analytics → Read for secondsurf.ch) and the zone ID.` }, 502);
	}

	// The last 24 hours in detail; optional.
	let pages: { path: string; views: number }[] | null = null;
	let referrers: { host: string; visits: number }[] | null = null;
	try {
		const recent = await query<{ pages: Group[]; referrers: Group[] }>(RECENT, { since: new Date(now.getTime() - 86400_000).toISOString(), until: now.toISOString() });
		pages = recent.pages.map((g) => ({ path: g.dimensions.clientRequestPath, views: g.count }));
		referrers = recent.referrers
			.filter((g) => !/(^|\.)secondsurf\.(ch|pages\.dev)$/.test(g.dimensions.clientRefererHost))
			.map((g) => ({ host: g.dimensions.clientRefererHost, visits: g.count }));
	} catch (error) {
		console.warn('Cloudflare analytics, last 24 hours not available', (error as Error).message);
	}

	const sum = (list: Day[], pick: (d: Day) => number) => list.reduce((total, d) => total + pick(d), 0);
	const period = (n: number) => {
		const list = days.slice(-n);
		const requests = sum(list, (d) => d.sum.requests);
		return {
			visitors: sum(list, (d) => d.uniq.uniques),
			pageViews: sum(list, (d) => d.sum.pageViews),
			requests,
			threats: sum(list, (d) => d.sum.threats),
			bytes: sum(list, (d) => d.sum.bytes),
			cached: requests ? Math.round((sum(list, (d) => d.sum.cachedRequests) / requests) * 100) : 0,
		};
	};
	const top = (entries: [string, number][], n: number) =>
		[...entries.reduce((map, [key, value]) => map.set(key, (map.get(key) ?? 0) + value), new Map<string, number>())]
			.filter(([key]) => key)
			.sort((a, b) => b[1] - a[1])
			.slice(0, n)
			.map(([name, count]) => ({ name, count }));

	return json({
		configured: true,
		generated: Math.floor(now.getTime() / 1000),
		today: period(1),
		week: period(7),
		month: period(30),
		days: days.map((d) => ({ date: d.dimensions.date, visitors: d.uniq.uniques, pageViews: d.sum.pageViews })),
		countries: top(days.flatMap((d) => d.sum.countryMap.map((c) => [c.clientCountryName, c.requests] as [string, number])), 10),
		browsers: top(days.flatMap((d) => d.sum.browserMap.map((b) => [b.uaBrowserFamily, b.pageViews] as [string, number])), 8),
		pages,
		referrers,
	});
};
