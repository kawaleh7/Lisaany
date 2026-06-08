// POST /api/book-checkout
// Body: { tutorSlug, duration(30|60), slots:[{day,time}], recurring, studentId, studentName, studentEmail }
// Returns: { url } — Stripe-hosted checkout URL for a ONE-TIME tutoring payment.
//
// This is separate from the $14.99 subscription (create-checkout.js).
// On payment, webhook.js writes the paid booking to Supabase + emails everyone.
import Stripe from 'stripe';

export async function handleBookCheckout(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  try {
    const b = await request.json();
    if (!b.tutorSlug || !b.studentId || !b.studentEmail || !Array.isArray(b.slots) || !b.slots.length) {
      return json({ error: 'Missing booking details' }, 400);
    }

    // ---- Look up the tutor (price + who to pay) from Supabase ----
    const tRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tutors?slug=eq.${encodeURIComponent(b.tutorSlug)}&select=id,name,user_id,price_30,price_60&limit=1`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const tutors = await tRes.json();
    const tutor = Array.isArray(tutors) ? tutors[0] : null;
    if (!tutor) return json({ error: 'Tutor not found' }, 404);

    const duration = Number(b.duration) === 60 ? 60 : 30;
    const unit = duration === 60 ? (tutor.price_60 ?? 5) : (tutor.price_30 ?? 3); // dollars
    const count = b.slots.length;

    // ---- Resolve the tutor's email (to notify them on payment) ----
    let tutorEmail = '';
    if (tutor.user_id) {
      const uRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${tutor.user_id}`,
        { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
      if (uRes.ok) { const u = await uRes.json(); tutorEmail = u?.email || ''; }
    }

    // metadata travels with the payment and comes back in the webhook
    const meta = {
      kind: 'tutor_booking',
      tutor_id: String(tutor.id),
      tutor_name: tutor.name || '',
      tutor_email: tutorEmail,
      student_id: String(b.studentId),
      student_name: b.studentName || '',
      student_email: b.studentEmail,
      duration: String(duration),
      unit: String(unit),
      recurring: b.recurring ? '1' : '0',
      slots: JSON.stringify(b.slots).slice(0, 480), // Stripe metadata cap is 500 chars
    };

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: b.studentEmail,
      line_items: [{
        quantity: count,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(unit * 100),
          product_data: { name: `${duration}-min lesson with ${tutor.name || 'your tutor'}` },
        },
      }],
      success_url: 'https://lisaany.com/tutors.html?booked=1',
      cancel_url: 'https://lisaany.com/tutors.html?canceled=1',
      metadata: meta,
      payment_intent_data: { metadata: meta },
    });

    return json({ url: session.url });
  } catch (err) {
    console.error('book-checkout error:', err);
    return json({ error: err.message || 'Server error' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
