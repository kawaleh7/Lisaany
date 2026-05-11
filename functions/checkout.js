export async function onRequest(context) {
  // This uses the Secret Key you saved in your Cloudflare settings
  const stripe = require('stripe')(context.env.STRIPE_SECRET_KEY);
  
  try {
    // This receives the data we send from the "Buy" button
    const { plan, isAnnual } = await context.request.json();
    
    let priceId = "";
    
    if (plan === 'basic') {
      // Basic Monthly ($12.99)
      priceId = "price_1TVi45RpquEfxb9tIliL04RO"; 
    } else if (plan === 'pro' && isAnnual) {
      // Pro Annual ($99.00)
      priceId = "price_1TVi83RpquEfxb9t3bS6fTmK"; 
    } else if (plan === 'pro') {
      // Pro Monthly ($15.00)
      priceId = "price_1TVi7DRpquEfxb9tcHViOZ8S"; 
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      // Sends users back to your homepage after success/cancel
      success_url: `${new URL(context.request.url).origin}/index.html`,
      cancel_url: `${new URL(context.request.url).origin}/index.html`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
