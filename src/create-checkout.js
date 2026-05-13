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

    if (!priceId || !userId || !userEmail) {
      return json({ error: 'Missing priceId, userId, or userEmail' }, 400);
    }

    const allowedPrices = new Set([
      env.PRICE_SELF_PACED_MONTHLY,
      env.PRICE_WITH_TUTOR_MONTHLY,
      env.PRICE_WITH_TUTOR_YEARLY,
    ]);

    if (!allowedPrices.has(priceId)) {
      return json({ error: 'Invalid priceId' }, 400);
    }

    const priceToPlan = {
      [env.PRICE_SELF_PACED_MONTHLY]: 'self_paced',
      [env.PRICE_WITH_TUTOR_MONTHLY]: 'with_tutor',
      [env.PRICE_WITH_TUTOR_YEARLY]: 'with_tutor',
    };
    const plan = priceToPlan[priceId];

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Use customers.list with email (immediately consistent) instead of
    // customers.search (30+ sec indexing delay caused duplicate customers)
    let customerId;
    const existing = await stripe.customers.list({
      email: userEmail,
      limit: 1,
    });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
      if (!existing.data[0].metadata?.supabase_user_id) {
        await stripe.customers.update(customerId, {
          metadata: { supabase_user_id: userId },
        });
      }
    } else {
      const created = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      });
      customerId = created.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://lisaany.com/arabic_platform.html?checkout=success',
      cancel_url: 'https://lisaany.com/pricing.html?checkout=cancelled',
      allow_promotion_codes: true,
      subscription_data: {
        metadata: {
          supabase_user_id: userId,
          plan: plan,
        },
      },
    });

    return json({ url: session.url });
  } catch (err) {
    console.error('create-checkout error:', err);
    return json({ error: err.message || 'Server error' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
