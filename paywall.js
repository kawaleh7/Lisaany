// paywall.js — Reusable upgrade modal for Lisaany
// Depends on plan.js being loaded first.
// Usage:
//   await window.lisaanyPaywall.show({ context: 'live_tutor' });
//   await window.lisaanyPaywall.show({ context: 'premium_unit', unitId: '1.3' });
//
// Picks the right copy + plan options based on user's current plan:
//   - Free user → sees all 3 plans (Basic / Premium Monthly / Premium Yearly)
//   - Basic user → sees only 2 upgrade options (Premium Monthly / Premium Yearly)
//   - Premium user → never gets shown (caller should check plan first)
//
// Context-specific copy:
//   - 'live_tutor'    → "Live Tutor is a Premium feature..."
//   - 'premium_unit'  → "You've completed the free preview..."
//   - 'premium_module'→ "This module is part of the full curriculum..."

(function () {
  const STRIPE_CHECKOUT_ENDPOINT = '/api/create-checkout';

  const PRICE_IDS = {
    basic_monthly: 'price_1TVwYmRpquEfxb9t1DQDAgRE',
    premium_monthly: 'price_1TVwcgRpquEfxb9tuJYp47Ui',
    premium_yearly: 'price_1TVwcgRpquEfxb9tWbqNnwwP',
  };

  const COPY = {
    live_tutor: {
      free: {
        title: 'Live Tutor is a Premium feature',
        body: 'Join live group sessions with a real Arabic teacher. Get pronunciation feedback, ask questions, learn alongside classmates.',
      },
      basic: {
        title: 'Unlock Live Tutor',
        body: "You're a few dollars away from joining live sessions with a real teacher. Switch to Premium to unlock group classes, recorded library, and Google Meet access.",
      },
    },
    premium_unit: {
      free: {
        title: "You've completed the free preview",
        body: 'Unlock all 40 units across both Arabic platforms, full Tajweed curriculum, and Live Tutor sessions. Cancel anytime.',
      },
      basic: {
        title: 'This is a Premium-only feature',
        body: 'Switch to Premium to unlock Live Tutor sessions on top of your current full lesson access.',
      },
    },
    premium_module: {
      free: {
        title: 'This module is part of the full curriculum',
        body: 'Unlock all 40 units across both Arabic platforms, full Tajweed curriculum, and Live Tutor sessions. Cancel anytime.',
      },
      basic: {
        title: 'Premium feature',
        body: 'Switch to Premium to unlock everything beyond what Basic gives you.',
      },
    },
  };

  const css = `
.pw-overlay{position:fixed;inset:0;background:rgba(7,11,20,.85);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:9999;display:none;align-items:center;justify-content:center;padding:20px;font-family:'Inter','Plus Jakarta Sans',sans-serif;}
.pw-overlay.open{display:flex;}
.pw-modal{background:linear-gradient(180deg,#0f1a2e 0%,#0d0507 100%);border:1.5px solid rgba(196,164,98,.4);border-radius:24px;padding:36px 32px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 80px rgba(196,164,98,.08);color:#ede6d6;}
.pw-close{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#b8ad95;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;}
.pw-close:hover{background:rgba(255,255,255,.12);color:#ede6d6;}
.pw-icon{width:64px;height:64px;border-radius:18px;background:linear-gradient(145deg,rgba(196,164,98,.18),rgba(196,164,98,.06));border:1.5px solid rgba(196,164,98,.4);display:flex;align-items:center;justify-content:center;margin-bottom:18px;font-size:32px;}
.pw-title{font-family:'Cinzel','Playfair Display',serif;font-size:24px;font-weight:700;color:#f5ecd6;margin-bottom:10px;letter-spacing:-.3px;line-height:1.2;}
.pw-body{font-size:14px;color:#b8ad95;line-height:1.65;margin-bottom:24px;}
.pw-plans{display:flex;flex-direction:column;gap:10px;margin-bottom:18px;}
.pw-plan{background:rgba(255,255,255,.02);border:1.5px solid rgba(196,164,98,.2);border-radius:14px;padding:16px 18px;cursor:pointer;transition:all .25s;display:flex;align-items:center;justify-content:space-between;gap:12px;font-family:inherit;width:100%;text-align:left;color:inherit;}
.pw-plan:hover{border-color:rgba(196,164,98,.5);background:rgba(196,164,98,.06);transform:translateY(-1px);}
.pw-plan.featured{border-color:#c4a462;background:linear-gradient(145deg,rgba(196,164,98,.12),rgba(196,164,98,.03));position:relative;}
.pw-plan.featured::before{content:'BEST VALUE';position:absolute;top:-9px;left:18px;background:#c4a462;color:#0d0507;font-size:9px;font-weight:800;letter-spacing:1px;padding:3px 10px;border-radius:999px;}
.pw-plan-info{flex:1;}
.pw-plan-name{font-weight:700;font-size:14px;color:#f5ecd6;margin-bottom:3px;letter-spacing:.2px;}
.pw-plan-desc{font-size:12px;color:#9a8e78;}
.pw-plan-price{font-family:'Cinzel',serif;font-size:18px;font-weight:700;color:#e2b04a;white-space:nowrap;}
.pw-plan-price small{font-size:11px;color:#b8ad95;font-weight:400;display:block;margin-top:2px;}
.pw-footer{text-align:center;font-size:12px;color:#7a7260;margin-top:6px;}
.pw-footer a{color:#c4a462;text-decoration:none;}
.pw-footer a:hover{text-decoration:underline;}
.pw-cancel-anytime{display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;color:#7a7260;margin-top:14px;letter-spacing:.3px;}
.pw-cancel-anytime::before{content:'✓';color:#8cc995;font-weight:700;}
.pw-loading{display:none;align-items:center;justify-content:center;padding:14px;color:#c4a462;font-size:13px;font-weight:600;}
.pw-loading.show{display:flex;}
@media(max-width:480px){.pw-modal{padding:28px 22px;border-radius:20px;}.pw-title{font-size:21px;}.pw-icon{width:54px;height:54px;font-size:26px;}}
`;

  function injectStyle() {
    if (document.getElementById('pw-style')) return;
    const s = document.createElement('style');
    s.id = 'pw-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function buildPlanOptions(currentPlan) {
    const all = [
      {
        key: 'basic_monthly',
        name: 'Basic',
        desc: 'All lessons, self-study only',
        price: '$12.99',
        sub: '/month',
        featured: false,
      },
      {
        key: 'premium_monthly',
        name: 'Premium · Monthly',
        desc: 'All lessons + Live Tutor',
        price: '$29.99',
        sub: '/month',
        featured: false,
      },
      {
        key: 'premium_yearly',
        name: 'Premium · Yearly',
        desc: 'All lessons + Live Tutor',
        price: '$119.99',
        sub: '/year · save $239',
        featured: true,
      },
    ];

    // Basic users: hide the Basic plan (they already have it)
    if (currentPlan === 'basic') {
      return all.filter(p => p.key !== 'basic_monthly');
    }
    return all;
  }

  function getCopy(context, currentPlan) {
    const variant = currentPlan === 'basic' ? 'basic' : 'free';
    const ctx = COPY[context] || COPY.premium_unit;
    return ctx[variant];
  }

  async function startCheckout(priceKey, button) {
    const priceId = PRICE_IDS[priceKey];
    if (!priceId) {
      alert('Plan not available. Please try again.');
      return;
    }

    // Make sure user is signed in
    let user = null;
    try {
      const sb = window.supabase.createClient(
        'https://cfaxrzfqvoalwznkhwnx.supabase.co',
        'sb_publishable_JzVuIvyj2OEP4o0zbURcQA_NhfBFPaa'
      );
      const { data } = await sb.auth.getUser();
      user = data.user;
    } catch (err) {
      console.warn('auth check failed', err);
    }

    if (!user) {
      // Save intent and bounce to auth
      sessionStorage.setItem('lisaany_pending_checkout', priceKey);
      window.location.href = 'auth.html';
      return;
    }

    // Show loading
    const loading = document.querySelector('.pw-loading');
    const plans = document.querySelector('.pw-plans');
    if (loading) loading.classList.add('show');
    if (plans) plans.style.opacity = '0.4';
    if (button) button.style.pointerEvents = 'none';

    try {
      const res = await fetch(STRIPE_CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, userId: user.id }),
      });
      if (!res.ok) {
        throw new Error('Checkout failed (' + res.status + ')');
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      console.error(err);
      alert('Could not start checkout: ' + err.message);
      if (loading) loading.classList.remove('show');
      if (plans) plans.style.opacity = '1';
      if (button) button.style.pointerEvents = 'auto';
    }
  }

  async function show(options) {
    options = options || {};
    const context = options.context || 'premium_unit';

    // Need plan.js
    if (!window.lisaanyPlan) {
      console.warn('paywall: plan.js not loaded, defaulting to free variant');
    }
    const currentPlan = window.lisaanyPlan ? await window.lisaanyPlan.getPlan() : 'free';

    // Premium users shouldn't see this — bail
    if (currentPlan === 'premium_monthly' || currentPlan === 'premium_yearly') {
      console.warn('paywall.show called for premium user, ignoring');
      return;
    }

    injectStyle();

    // Remove any existing
    const existing = document.getElementById('pw-overlay');
    if (existing) existing.remove();

    const copy = getCopy(context, currentPlan);
    const plans = buildPlanOptions(currentPlan);

    const iconMap = {
      live_tutor: '🎓',
      premium_unit: '✨',
      premium_module: '📚',
    };
    const icon = iconMap[context] || '✨';

    const planHtml = plans.map(p => `
      <button class="pw-plan ${p.featured ? 'featured' : ''}" data-plan="${p.key}">
        <span class="pw-plan-info">
          <span class="pw-plan-name">${p.name}</span>
          <span class="pw-plan-desc">${p.desc}</span>
        </span>
        <span class="pw-plan-price">${p.price}<small>${p.sub}</small></span>
      </button>
    `).join('');

    const html = `
      <div class="pw-overlay open" id="pw-overlay" role="dialog" aria-modal="true">
        <div class="pw-modal">
          <button class="pw-close" aria-label="Close">×</button>
          <div class="pw-icon">${icon}</div>
          <div class="pw-title">${copy.title}</div>
          <div class="pw-body">${copy.body}</div>
          <div class="pw-plans">${planHtml}</div>
          <div class="pw-loading">Opening checkout…</div>
          <div class="pw-cancel-anytime">Cancel anytime</div>
          <div class="pw-footer">
            Already a member? <a href="auth.html">Sign in</a>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const overlay = document.getElementById('pw-overlay');
    overlay.querySelector('.pw-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelectorAll('.pw-plan').forEach(btn => {
      btn.addEventListener('click', () => {
        startCheckout(btn.dataset.plan, btn);
      });
    });
  }

  function hide() {
    const overlay = document.getElementById('pw-overlay');
    if (overlay) overlay.remove();
  }

  window.lisaanyPaywall = { show, hide };
})();
