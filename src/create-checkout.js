// POST /api/create-checkout
// Body: { priceId, userId, userEmail }
// Returns: { url } — Stripe-hosted checkout URL to redirect to

import Stripe from 'stripe';

export async function handleCreateCheckout(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { priceId, userId, userEmail } = await request.json();

    // ---- Validation ----
    if (!priceId || !userId || !userEmail) {
      return json({ error: 'Missing priceId, userId, or userEmail' }, 400);
    }

    // Whitelist of price IDs — prevents anyone POSTing arbitrary price IDs
    const allowedPrices = new Set([
      env.PRICE_SELF_PACED_MONTHLY,
      env.PRICE_WITH_TUTOR_MONTHLY,
      env.PRICE_WITH_TUTOR_YEARLY,
    ]);

    if (!allowedPrices.has(priceId)) {
      return json({
        error: 'Invalid priceId',
        debug: {
          received: pric
