// The products live in the Git repository, so the dashboard saves by committing.
// Every commit to main makes Cloudflare Pages rebuild the site.

import type { Env } from './auth';

export const PRODUCTS_DIR = 'website/src/content/products';

export class GitHubError extends Error {
	constructor(public status: number) {
		super(`GitHub answered ${status}`);
	}
}

export type TreeEntry = { path: string; mode: '100644'; type: 'blob' } & ({ sha: string | null } | { content: string });

const repo = (env: Env) => env.GITHUB_REPO ?? 'gaeschpu/secondsurf';
const branch = (env: Env) => env.GITHUB_BRANCH ?? 'main';

async function request(env: Env, path: string, init: RequestInit = {}, accept = 'application/vnd.github+json') {
	const res = await fetch(`${env.GITHUB_API ?? 'https://api.github.com'}${path}`, {
		...init,
		headers: {
			Accept: accept,
			Authorization: `Bearer ${env.GITHUB_TOKEN}`,
			'User-Agent': 'secondsurf-admin',
			'X-GitHub-Api-Version': '2022-11-28',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
		},
	});
	if (!res.ok) throw new GitHubError(res.status);
	return res;
}

const post = (env: Env, path: string, body: unknown, method = 'POST') =>
	request(env, `/repos/${repo(env)}${path}`, { method, body: JSON.stringify(body) }).then((res) => res.json() as Promise<any>);

const contentsPath = (env: Env, path: string) =>
	`/repos/${repo(env)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch(env))}`;

export const createBlob = (env: Env, base64: string) => post(env, '/git/blobs', { content: base64, encoding: 'base64' }).then((b) => b.sha as string);

/** All files of the given change land in one commit, so a piece is never half-saved. */
export async function commit(env: Env, message: string, tree: TreeEntry[]) {
	const ref = await request(env, `/repos/${repo(env)}/git/ref/heads/${encodeURIComponent(branch(env))}`).then((r) => r.json() as Promise<any>);
	const parent = ref.object.sha as string;
	const base = await request(env, `/repos/${repo(env)}/git/commits/${parent}`).then((r) => r.json() as Promise<any>);
	const newTree = await post(env, '/git/trees', { base_tree: base.tree.sha, tree });
	const created = await post(env, '/git/commits', { message, tree: newTree.sha, parents: [parent] });
	await post(env, `/git/refs/heads/${encodeURIComponent(branch(env))}`, { sha: created.sha }, 'PATCH');
}

export const readText = (env: Env, path: string) =>
	request(env, contentsPath(env, path), {}, 'application/vnd.github.raw+json').then((r) => r.text());

export const readRaw = (env: Env, path: string) => request(env, contentsPath(env, path), {}, 'application/vnd.github.raw+json');

export const listDir = (env: Env, path: string) =>
	request(env, contentsPath(env, path)).then((r) => r.json() as Promise<{ name: string; path: string; type: string }[]>);

/** Every product's index.md in one request, so a long list doesn't hit Cloudflare's subrequest limit. */
export async function readAllProducts(env: Env) {
	const [owner, name] = repo(env).split('/');
	const res = await request(env, '/graphql', {
		method: 'POST',
		body: JSON.stringify({
			query: `query($owner: String!, $name: String!, $expression: String!) {
				repository(owner: $owner, name: $name) {
					object(expression: $expression) {
						... on Tree {
							entries {
								name
								object { ... on Tree { entries { name object { ... on Blob { text } } } } }
							}
						}
					}
				}
			}`,
			variables: { owner, name, expression: `${branch(env)}:${PRODUCTS_DIR}` },
		}),
	});
	const data = (await res.json()) as any;
	if (data.errors) throw new GitHubError(502);
	const folders = (data.data.repository.object?.entries ?? []) as {
		name: string;
		object: { entries?: { name: string; object: { text?: string | null } }[] };
	}[];
	return folders.map((folder) => ({
		id: folder.name,
		markdown: folder.object.entries?.find((file) => file.name === 'index.md')?.object.text ?? null,
	}));
}
