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

    // Look up the customer ID from Supabase (the source of truth)
    // instead of using Stripe customers.search (which has indexing lag).
    const supaRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=stripe_customer_id&limit=1`,
      {
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!supaRes.ok) {
      return json({ error: 'Failed to look up customer' }, 500);
    }

    const rows = await supaRes.json();
    if (!rows || rows.length === 0 || !rows[0].stripe_customer_id) {
      return json({ error: 'No subscription found for this user' }, 404);
    }

    const customerId = rows[0].stripe_customer_id;

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

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
