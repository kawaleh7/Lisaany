export async function onRequest(context) {
  // This uses the Secret Key you saved in your Cloudflare settings
  const stripe = require('stripe')(context.env.STRIPE_SECRET_KEY);
  
  try {
    // This receives the data we send from the "Buy" button
    const { plan, isAnnual } = await context.request.json();
    
    // REPLACE THESE WITH YOUR ACTUAL PRICE IDs FROM STRIPE
    let priceId = "";
    
    if (plan === 'basic') {
      priceId = "PASTE_YOUR_BASIC_MONTHLY_ID_HERE"; 
    } else if (plan === 'pro' && isAnnual) {
      priceId = "PASTE_YOUR_PRO_ANNUAL_ID_HERE"; 
    } else if (plan === 'pro') {
      priceId = "PASTE_YOUR_PRO_MONTHLY_ID_HERE"; 
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${new URL(context.request.url).origin}/index.html`,
      cancel_url: `${new URL(context.request.url).origin}/pricing.html`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
