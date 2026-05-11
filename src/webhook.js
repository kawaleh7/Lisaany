// POST /api/webhook
// Stripe POSTs subscription/payment events here.
// We verify the signature, then mirror the relevant data into Supabase.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export async function handleWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  // ---- Verify the request really came from Stripe ----
  // Without this, anyone could POST to this endpoint and mark themselves paid.
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const rawBody = await request.text(); // must be raw text, not parsed JSON
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // ---- Supabase admin client (service_role bypasses RLS) ----
  const supabase = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // ---- Handle the events we care about ----
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.resumed':
        await upsertSubscription(supabase, event.data.object);
        break;

      case 'customer.subscription.deleted':
        await markCancelled(supabase, event.data.object);
        break;

      case 'customer.subscription.paused':
        await markStatus(supabase, event.data.object, 'paused');
        break;

      default:
        // Acknowledge other events so Stripe doesn't retry them
        break;
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return new Response(`Handler error: ${err.message}`, { status: 500 });
  }
}

// ---- Helpers ----

async function upsertSubscription(supabase, sub) {
  const userId = sub.metadata?.supabase_user_id;
  const plan = sub.metadata?.plan;

  if (!userId) {
    console.error('Subscription has no supabase_user_id:', sub.id);
    throw new Error('Missing supabase_user_id in subscription metadata');
  }
  if (!plan) {
    console.error('Subscription has no plan:', sub.id);
    throw new Error('Missing plan in subscription metadata');
  }

  const periodEndIso = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  const row = {
    user_id: userId,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    plan: plan,
    status: sub.status,
    current_period_end: periodEndIso,
    cancel_at_period_end: sub.cancel_at_period_end || false,
  };

  const { error } = await supabase
    .from('subscriptions')
    .upsert(row, { onConflict: 'user_id' });

  if (error) {
    console.error('Supabase upsert error:', error);
    throw error;
  }
}

async function markCancelled(supabase, sub) {
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'canceled', cancel_at_period_end: false })
    .eq('stripe_subscription_id', sub.id);

  if (error) throw error;
}

async function markStatus(supabase, sub, status) {
  const { error } = await supabase
    .from('subscriptions')
    .update({ status })
    .eq('stripe_subscription_id', sub.id);

  if (error) throw error;
}
