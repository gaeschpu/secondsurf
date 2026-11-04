// Offers now need a customer account: they go to POST /api/account/offer (functions/_lib/offer-create.ts).
// This answer tells product pages still open from before to send the customer to the login.

import { json, type Handler } from '../../_lib/auth.ts';

export const onRequestPost: Handler = () => json({ error: 'login' }, 401);
