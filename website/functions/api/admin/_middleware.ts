// Guards everything under /api/admin. Only the login itself is reachable without a session.

import { isConfigured, isLoggedIn, json, type Handler } from '../../_lib/auth.ts';
import { GitHubError } from '../../_lib/github.ts';

export const onRequest: Handler = async ({ request, env, next }) => {
	if (!isConfigured(env)) return json({ error: 'The dashboard is not set up yet (secrets are missing or too short).' }, 503);

	const url = new URL(request.url);
	if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) return json({ error: 'Wrong origin.' }, 403);
	if (url.pathname !== '/api/admin/login' && !(await isLoggedIn(env, request))) return json({ error: 'Please log in.' }, 401);

	try {
		return await next();
	} catch (error) {
		if (error instanceof GitHubError) {
			// 409/422 on a commit: something else changed the branch at the same moment.
			const message = error.status === 409 || error.status === 422 ? 'The shop changed at the same moment. Please try again.' : `${error.message}. Check the GITHUB_TOKEN secret.`;
			return json({ error: message }, 502);
		}
		console.error(error);
		return json({ error: 'Could not reach GitHub. Nothing was changed, please try again.' }, 502);
	}
};
