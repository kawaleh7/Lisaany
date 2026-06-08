// POST /api/webhook
// Stripe POSTs subscription/payment events here.
// We verify the signature, then mirror the relevant data into Supabase.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TUTOR_SHARE = 0.60;     // tutor keeps 60%
const PLATFORM_SHARE = 0.40;  // platform keeps 40%

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

      case 'checkout.session.completed':
        // Only acts on tutoring bookings; subscription checkouts are ignored here
        // (they're handled by the customer.subscription.* events above).
        await handleBookingPaid(supabase, event.data.object, env);
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

// ---- Subscription helpers (unchanged) ----

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

// ---- Tutoring booking (new) ----
// Fires on checkout.session.completed. Writes one paid booking row per slot,
// then emails the student, the tutor, and the admin via Resend.
async function handleBookingPaid(supabase, session, env) {
  const m = session.metadata || {};
  if (m.kind !== 'tutor_booking') return; // not a booking — leave it alone

  const unit = Number(m.unit) || 0;
  const duration = Number(m.duration) || 30;
  let slots = [];
  try { slots = JSON.parse(m.slots) || []; } catch { slots = []; }
  const paid = session.payment_status === 'paid' || session.status === 'complete';

  const rows = slots.map((sl) => ({
    tutor_id: m.tutor_id,
    student_id: m.student_id,
    student_name: m.student_name,
    student_email: m.student_email,
    weekday: DAYS.indexOf(sl.day),
    slot_time: sl.time,
    duration_min: duration,
    price: unit,
    recurring: m.recurring === '1',
    status: paid ? 'paid' : 'requested',
  }));

  if (rows.length) {
    const { error } = await supabase.from('bookings').insert(rows);
    if (error) console.error('booking insert error:', error);
  }

  // ---- emails ----
  const count = rows.length;
  const total = unit * count;
  const tutorCut = (total * TUTOR_SHARE).toFixed(2);
  const platformCut = (total * PLATFORM_SHARE).toFixed(2);
  const when = slots.map((sl) => `${sl.day} ${sl.time}`).join(', ');

  await sendEmail(env, m.student_email,
    `Your ${duration}-min lesson${count > 1 ? 's are' : ' is'} booked — Lisaany`,
    `<p>As-salāmu ʿalaykum ${esc(m.student_name)},</p>
     <p>Your booking with <b>${esc(m.tutor_name)}</b> is confirmed and paid.</p>
     <p><b>Sessions:</b> ${count} × ${duration} min<br><b>When:</b> ${esc(when)}<br><b>Total:</b> $${total.toFixed(2)}</p>
     <p>Your tutor will be in touch. — Lisaany</p>`);

  if (m.tutor_email) await sendEmail(env, m.tutor_email,
    `New paid booking from ${m.student_name || 'a student'} — Lisaany`,
    `<p>You have a new <b>paid</b> booking:</p>
     <p><b>Student:</b> ${esc(m.student_name)} (${esc(m.student_email)})<br>
        <b>Sessions:</b> ${count} × ${duration} min<br>
        <b>When:</b> ${esc(when)}<br>
        <b>Your earnings (60%):</b> $${tutorCut}</p>
     <p>See it in your tutor portal under Bookings.</p>`);

  const adminEmail = env.ADMIN_EMAIL || 'admin@lisaany.com';
  await sendEmail(env, adminEmail,
    `Booking $${total.toFixed(2)} — your cut $${platformCut}`,
    `<p><b>${esc(m.student_name)}</b> booked <b>${esc(m.tutor_name)}</b>.</p>
     <p>${count} × ${duration} min · ${esc(when)}<br>
        Total $${total.toFixed(2)} — tutor $${tutorCut} / platform $${platformCut}</p>`);
}

async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !to) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.FROM_EMAIL || 'Lisaany <noreply@lisaany.com>', to, subject, html }),
    });
  } catch (err) {
    console.error('resend error:', err);
  }
}

function esc(s) {
  return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
