// Worker entry point — every request to lisaany.com hits this file.
//
// Routing logic:
//   /api/create-checkout  -> create-checkout.js
//   /api/billing-portal   -> billing-portal.js
//   /api/webhook          -> webhook.js
//   everything else       -> static HTML files (via the ASSETS binding)

import { handleCreateCheckout } from './create-checkout.js';
import { handleBillingPortal } from './billing-portal.js';
import { handleWebhook } from './webhook.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API routes
    if (url.pathname === '/api/create-checkout') {
      return handleCreateCheckout(request, env);
    }
    if (url.pathname === '/api/billing-portal') {
      return handleBillingPortal(request, env);
    }
    if (url.pathname === '/api/webhook') {
      return handleWebhook(request, env);
    }

    // Everything else: serve the static HTML files
    return env.ASSETS.fetch(request);
  },
};
