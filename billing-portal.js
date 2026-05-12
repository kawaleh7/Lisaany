// POST /api/billing-portal
// Body: { userId }
// Returns: { url } — Stripe-hosted customer portal URL to redirect to

import Stripe from 'stripe';

export async function handleBillingPortal(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { userId } = await request.json();

    if (!userId) {
      return json({ error: 'Missing userId' }, 400);
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Find the Stripe customer for this Supabase user
    const customers = await stripe.customers.search({
      query: `metadata['supabase_user_id']:'${userId}'`,
      limit: 1,
    });

    if (customers.data.length === 0) {
      return json({ error: 'No Stripe customer found for this user' }, 404);
    }

    const customerId = customers.data[0].id;

    // Create a portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://lisaany.com/profile.html',
    });

    return json({ url: session.url });
  } catch (err) {
    console.error('billing-portal error:', err);
    return json({ error: err.message || 'Server error' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
