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
          received: priceId,
          envHasSelfPaced: !!env.PRICE_SELF_PACED_MONTHLY,
          envHasTutorMonthly: !!env.PRICE_WITH_TUTOR_MONTHLY,
          envHasTutorYearly: !!env.PRICE_WITH_TUTOR_YEARLY,
          envSelfPacedFirst20: (env.PRICE_SELF_PACED_MONTHLY || '').slice(0, 20),
          envTutorMonthlyFirst20: (env.PRICE_WITH_TUTOR_MONTHLY || '').slice(0, 20),
          envTutorYearlyFirst20: (env.PRICE_WITH_TUTOR_YEARLY || '').slice(0, 20),
        }
      }, 400);
    }

    // Map each price to a plan name — stored in subscription metadata
    // so the webhook knows what to write to the `plan` column in Supabase
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

    // ---- Find or create a Stripe Customer for this Supabase user ----
    // Search by metadata.supabase_user_id so each user maps to exactly one
    // Stripe customer record, even across upgrades/cancellations.
    let customerId;
    const existing = await stripe.customers.search({
      query: `metadata['supabase_user_id']:'${userId}'`,
      limit: 1,
    });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const created = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      });
      customerId = created.id;
    }

    // ---- Create the Checkout Session ----
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://lisaany.com/arabic_platform.html?checkout=success',
      cancel_url: 'https://lisaany.com/pricing.html?checkout=cancelled',
      allow_promotion_codes: true,
      // Attach metadata to the subscription itself so the webhook can read it
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
