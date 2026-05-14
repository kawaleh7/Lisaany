// paywall.js — Unified upgrade modal for Lisaany
// Drop into any page: <script src="paywall.js" defer></script>
// Depends on plan.js for current-plan checks.
//
// Usage:
//   window.lisaanyPaywall.show({ context: 'live_tutor' });
//   window.lisaanyPaywall.show({ context: 'premium_unit', unitId: '1.3' });
//   window.lisaanyPaywall.show({ context: 'premium_module' });
//
// Behavior:
//   - Premium users → never see modal (caller should also check first)
//   - Free users → see all relevant plans
//   - Basic users → see only the plans that would upgrade them
//   - 'live_tutor' context → hides Basic plan (Basic doesn't include tutor)
(function () {
  const STRIPE_CHECKOUT_ENDPOINT = '/api/create-checkout';

  const PRICE_IDS = {
    basic_monthly:   'price_1TVwYmRpquEfxb9t1DQDAgRE',  // $12.99 Self-Paced
    premium_monthly: 'price_1TVwcgRpquEfxb9tuJYp47Ui',  // $29.99 With Tutor
    premium_yearly:  'price_1TVwcgRpquEfxb9tWbqNnwwP',  // $119.99 With Tutor yearly
  };

  const COPY = {
    live_tutor: {
      free:  { title: 'Live Tutor is a Premium feature', body: 'Join live group sessions with a real Arabic teacher. Get pronunciation feedback, ask questions, learn alongside classmates.' },
      basic: { title: 'Unlock Live Tutor sessions',      body: "You're a few dollars away from learning with a real teacher. Switch to Premium for live group classes and the recorded library." },
    },
    premium_unit: {
      free:  { title: "You've reached the end of the free preview", body: 'Unlock all 40 units across both Arabic platforms, full Tajweed curriculum, and Live Tutor sessions.' },
      basic: { title: 'This feature is Premium-only', body: 'Switch to Premium to unlock Live Tutor sessions on top of your full lesson access.' },
    },
    premium_module: {
      free:  { title: 'Continue your Arabic journey', body: 'Unlock all 40 units across both Arabic platforms, full Tajweed curriculum, and Live Tutor sessions.' },
      basic: { title: 'Premium-only feature', body: 'Switch to Premium to unlock everything beyond what Basic gives you.' },
    },
  };

  const ICON_SVG = {
    live_tutor:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    premium_unit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
    premium_module: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  };

  const CSS = `
.pw-overlay{position:fixed;inset:0;background:rgba(3,7,15,.78);backdrop-filter:blur(12px) saturate(140%);-webkit-backdrop-filter:blur(12px) saturate(140%);z-index:99999;display:none;align-items:center;justify-content:center;padding:16px;font-family:'Inter','Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;opacity:0;transition:opacity .25s ease;overflow-y:auto;}
.pw-overlay.open{display:flex;opacity:1;}
.pw-modal{position:relative;width:100%;max-width:480px;background:linear-gradient(165deg,#0e1a2e 0%,#070d18 100%);border:1px solid rgba(212,163,74,.28);border-radius:24px;padding:40px 28px 28px;box-shadow:0 30px 80px rgba(0,0,0,.7),0 0 100px rgba(212,163,74,.06),inset 0 1px 0 rgba(255,255,255,.04);color:#ede6d6;transform:translateY(20px) scale(.97);opacity:0;transition:transform .35s cubic-bezier(.2,.9,.3,1.1),opacity .25s ease;}
.pw-overlay.open .pw-modal{transform:translateY(0) scale(1);opacity:1;}
.pw-modal::before{content:'';position:absolute;top:0;left:30%;right:30%;height:1px;background:linear-gradient(90deg,transparent,rgba(242,190,98,.7),transparent);}
.pw-close{position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#b8ad95;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;line-height:1;padding:0;}
.pw-close:hover{background:rgba(255,255,255,.1);color:#fff;transform:scale(1.05);}
.pw-close:active{transform:scale(.95);}
.pw-header{text-align:center;margin-bottom:28px;}
.pw-icon{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:18px;background:linear-gradient(145deg,rgba(212,163,74,.18),rgba(212,163,74,.04));border:1.5px solid rgba(212,163,74,.4);margin-bottom:16px;color:#f2d080;}
.pw-icon svg{width:30px;height:30px;}
.pw-eyebrow{display:inline-block;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#d4a347;margin-bottom:10px;padding:4px 12px;border:1px solid rgba(212,163,74,.25);border-radius:999px;background:rgba(212,163,74,.04);}
.pw-title{font-family:'Cinzel','Playfair Display',serif;font-size:24px;font-weight:700;color:#f5ecd6;margin:0 0 10px;letter-spacing:-.3px;line-height:1.25;}
.pw-body{font-size:14px;color:#a09585;line-height:1.65;margin:0 auto;max-width:380px;}
.pw-plans{display:flex;flex-direction:column;gap:10px;margin-bottom:20px;}
.pw-plan{position:relative;background:rgba(255,255,255,.018);border:1.5px solid rgba(212,163,74,.18);border-radius:16px;padding:18px 20px;cursor:pointer;transition:all .25s cubic-bezier(.2,.9,.3,1.1);display:flex;flex-direction:column;gap:14px;font-family:inherit;color:inherit;text-align:left;width:100%;opacity:0;transform:translateY(8px);}
.pw-plan.show{opacity:1;transform:translateY(0);}
.pw-plan:hover{border-color:rgba(212,163,74,.5);background:rgba(212,163,74,.04);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.3);}
.pw-plan:active{transform:translateY(0);}
.pw-plan.featured{border-color:rgba(242,190,98,.55);background:linear-gradient(180deg,rgba(212,163,74,.08),rgba(212,163,74,.02));box-shadow:0 0 0 1px rgba(242,190,98,.15),0 8px 32px rgba(212,163,74,.08);}
.pw-plan.featured:hover{border-color:#f2be62;box-shadow:0 0 0 1px rgba(242,190,98,.3),0 12px 36px rgba(212,163,74,.18);}
.pw-plan-badge{position:absolute;top:-10px;left:18px;font-size:9px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;padding:4px 10px;border-radius:999px;line-height:1;display:inline-flex;align-items:center;gap:4px;}
.pw-plan-badge.popular{background:linear-gradient(135deg,#f2be62,#d4a347);color:#1a1000;box-shadow:0 4px 12px rgba(212,163,74,.4);}
.pw-plan-badge.savings{background:linear-gradient(135deg,#7bc89e,#4ca87a);color:#062416;box-shadow:0 4px 12px rgba(76,168,122,.35);}
.pw-plan-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;}
.pw-plan-name-wrap{display:flex;flex-direction:column;gap:2px;}
.pw-plan-name{font-family:'Cinzel',serif;font-size:16px;font-weight:700;color:#f5ecd6;letter-spacing:.4px;line-height:1;}
.pw-plan-tagline{font-size:11px;color:#7a7260;font-weight:500;letter-spacing:.2px;}
.pw-plan-price{display:flex;flex-direction:column;align-items:flex-end;line-height:1;}
.pw-plan-price-main{font-family:'Cinzel',serif;font-size:22px;font-weight:700;color:#f2d080;letter-spacing:-.5px;line-height:1;}
.pw-plan-price-sub{font-size:11px;color:#7a7260;margin-top:3px;letter-spacing:.2px;}
.pw-plan-features{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:7px;}
.pw-plan-features li{font-size:12.5px;color:#c7bba1;display:flex;align-items:flex-start;gap:8px;line-height:1.4;position:relative;padding-left:22px;}
.pw-plan-features li::before{content:'';position:absolute;left:0;top:1px;width:14px;height:14px;border-radius:50%;background:rgba(212,163,74,.12);border:1px solid rgba(212,163,74,.3);flex-shrink:0;}
.pw-plan-features li::after{content:'';position:absolute;left:4px;top:5px;width:6px;height:3px;border-left:1.5px solid #f2d080;border-bottom:1.5px solid #f2d080;transform:rotate(-45deg);}
.pw-plan-cta{display:flex;align-items:center;justify-content:center;gap:6px;padding:11px 16px;border-radius:11px;background:transparent;border:1.5px solid rgba(212,163,74,.4);color:#f2d080;font-family:'Cinzel',serif;font-size:12px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;transition:all .2s;cursor:pointer;}
.pw-plan:hover .pw-plan-cta{border-color:#f2be62;color:#fff;background:rgba(212,163,74,.08);}
.pw-plan.featured .pw-plan-cta{background:linear-gradient(135deg,#f2be62,#d4a347);color:#1a1000;border-color:transparent;box-shadow:0 4px 16px rgba(212,163,74,.25);}
.pw-plan.featured:hover .pw-plan-cta{background:linear-gradient(135deg,#f5cf83,#e2b04a);box-shadow:0 6px 22px rgba(212,163,74,.4);}
.pw-plan-cta .pw-arrow{transition:transform .2s;}
.pw-plan:hover .pw-plan-cta .pw-arrow{transform:translateX(3px);}
.pw-trust{display:flex;align-items:center;justify-content:center;gap:18px;padding:14px 0 4px;border-top:1px solid rgba(255,255,255,.05);margin-top:14px;flex-wrap:wrap;}
.pw-trust-item{display:flex;align-items:center;gap:5px;font-size:10.5px;color:#7a7260;font-weight:500;letter-spacing:.3px;}
.pw-trust-item::before{content:'';width:14px;height:14px;background:rgba(125,200,158,.12);border:1px solid rgba(125,200,158,.3);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8l3 3 5-6' fill='none' stroke='%237dc89e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-position:center;background-repeat:no-repeat;background-size:10px;}
.pw-footer{text-align:center;font-size:11.5px;color:#7a7260;padding-top:12px;}
.pw-footer a{color:#d4a347;text-decoration:none;font-weight:600;}
.pw-footer a:hover{color:#f2be62;text-decoration:underline;}
.pw-loading-overlay{position:absolute;inset:0;background:rgba(7,13,24,.92);backdrop-filter:blur(4px);border-radius:24px;display:none;align-items:center;justify-content:center;flex-direction:column;gap:14px;z-index:10;}
.pw-loading-overlay.show{display:flex;}
.pw-spinner{width:36px;height:36px;border:2.5px solid rgba(212,163,74,.2);border-top-color:#f2be62;border-radius:50%;animation:pw-spin .8s linear infinite;}
@keyframes pw-spin{to{transform:rotate(360deg);}}
.pw-loading-text{font-size:13px;color:#d4a347;font-weight:600;letter-spacing:.4px;}
.pw-error{background:rgba(224,112,112,.08);border:1px solid rgba(224,112,112,.3);color:#e07070;padding:10px 14px;border-radius:10px;font-size:12.5px;margin-bottom:14px;display:none;}
.pw-error.show{display:block;}
@media(max-width:520px){
  .pw-overlay{padding:12px;align-items:flex-start;padding-top:24px;}
  .pw-modal{padding:32px 22px 22px;border-radius:20px;}
  .pw-title{font-size:21px;}
  .pw-icon{width:56px;height:56px;}
  .pw-icon svg{width:26px;height:26px;}
  .pw-plan{padding:16px 18px;}
  .pw-plan-name{font-size:15px;}
  .pw-plan-price-main{font-size:20px;}
  .pw-trust{gap:12px;}
}
@media(max-width:380px){
  .pw-trust-item{font-size:10px;}
  .pw-plan-top{flex-direction:column;align-items:flex-start;gap:8px;}
  .pw-plan-price{align-items:flex-start;}
}
`;

  function injectStyle() {
    if (document.getElementById('pw-style')) return;
    const s = document.createElement('style');
    s.id = 'pw-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function buildPlanOptions(currentPlan, context) {
    const basic = {
      key: 'basic_monthly',
      name: 'Basic',
      tagline: 'Self-paced learning',
      price: '$12.99',
      sub: 'per month',
      features: ['Full Arabic curriculum', 'Tajweed lessons', 'Progress tracking'],
      cta: 'Choose Basic',
      featured: false,
      badge: null,
    };
    const premiumMo = {
      key: 'premium_monthly',
      name: 'Premium',
      tagline: 'Everything + Live Tutor',
      price: '$29.99',
      sub: 'per month',
      features: ['Everything in Basic', 'Live tutor sessions', 'Recorded library', 'Priority support'],
      cta: 'Start Premium',
      featured: true,
      badge: { text: '★ Most Popular', cls: 'popular' },
    };
    const premiumYr = {
      key: 'premium_yearly',
      name: 'Premium Yearly',
      tagline: 'Best value — just $9.99/mo',
      price: '$119.99',
      sub: 'per year',
      features: ['Everything in Premium', 'Save $239 vs monthly', 'Cancel anytime'],
      cta: 'Get Best Value',
      featured: false,
      badge: { text: 'Save 67%', cls: 'savings' },
    };

    let plans = [];
    // For live_tutor context, Basic doesn't unlock the feature — hide it
    if (context === 'live_tutor') {
      plans = [premiumMo, premiumYr];
    } else {
      plans = [basic, premiumMo, premiumYr];
    }
    // Basic users already have basic_monthly — hide it regardless of context
    if (currentPlan === 'basic') {
      plans = plans.filter(p => p.key !== 'basic_monthly');
    }
    return plans;
  }

  function getCopy(context, currentPlan) {
    const variant = currentPlan === 'basic' ? 'basic' : 'free';
    const ctx = COPY[context] || COPY.premium_unit;
    return ctx[variant];
  }

  function getIcon(context) {
    return ICON_SVG[context] || ICON_SVG.premium_unit;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function startCheckout(priceKey, planEl) {
    const priceId = PRICE_IDS[priceKey];
    if (!priceId) {
      showError('Plan not configured. Please refresh and try again.');
      return;
    }

    // Auth check — bounce if not signed in, saving intent
    let user = null;
    try {
      if (window.supabase && window.supabase.createClient) {
        const sb = window.supabase.createClient(
          'https://cfaxrzfqvoalwznkhwnx.supabase.co',
          'sb_publishable_JzVuIvyj2OEP4o0zbURcQA_NhfBFPaa'
        );
        const { data } = await sb.auth.getUser();
        user = data.user;
      }
    } catch (err) { console.warn('auth check failed', err); }

    if (!user) {
      sessionStorage.setItem('lisaany_pending_checkout', priceKey);
      window.location.href = 'auth.html?return=checkout';
      return;
    }

    setLoading(true, 'Opening checkout…');
    try {
      const res = await fetch(STRIPE_CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, userId: user.id, userEmail: user.email }),
      });
      if (!res.ok) throw new Error('Checkout failed (HTTP ' + res.status + ')');
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned from server.');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setLoading(false);
      showError('Could not start checkout. ' + (err.message || 'Please try again.'));
    }
  }

  function setLoading(on, text) {
    const overlay = document.querySelector('.pw-loading-overlay');
    const textEl = document.querySelector('.pw-loading-text');
    if (!overlay) return;
    if (on) {
      if (textEl && text) textEl.textContent = text;
      overlay.classList.add('show');
    } else {
      overlay.classList.remove('show');
    }
  }

  function showError(msg) {
    const err = document.querySelector('.pw-error');
    if (!err) return;
    err.textContent = msg;
    err.classList.add('show');
    setTimeout(() => err.classList.remove('show'), 6000);
  }

  function hide() {
    const overlay = document.getElementById('pw-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    document.removeEventListener('keydown', onKeyDown);
    setTimeout(() => overlay.remove(), 300);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') hide();
  }

  async function show(options) {
    options = options || {};
    const context = options.context || 'premium_unit';

    let currentPlan = 'free';
    if (window.lisaanyPlan) {
      currentPlan = await window.lisaanyPlan.getPlan();
    }
    // Don't show to premium users — paying customers shouldn't see paywalls
    if (currentPlan === 'premium_monthly' || currentPlan === 'premium_yearly') {
      console.warn('paywall.show() ignored for premium user');
      return;
    }

    injectStyle();
    const existing = document.getElementById('pw-overlay');
    if (existing) existing.remove();

    const copy = getCopy(context, currentPlan);
    const plans = buildPlanOptions(currentPlan, context);
    const icon = getIcon(context);

    const planHtml = plans.map((p, i) => `
      <button class="pw-plan ${p.featured ? 'featured' : ''}" data-plan="${p.key}" style="transition-delay:${80 + i * 60}ms" aria-label="Select ${escapeHtml(p.name)} plan, ${escapeHtml(p.price)} ${escapeHtml(p.sub)}">
        ${p.badge ? `<span class="pw-plan-badge ${p.badge.cls}">${escapeHtml(p.badge.text)}</span>` : ''}
        <div class="pw-plan-top">
          <div class="pw-plan-name-wrap">
            <span class="pw-plan-name">${escapeHtml(p.name)}</span>
            <span class="pw-plan-tagline">${escapeHtml(p.tagline)}</span>
          </div>
          <div class="pw-plan-price">
            <span class="pw-plan-price-main">${escapeHtml(p.price)}</span>
            <span class="pw-plan-price-sub">${escapeHtml(p.sub)}</span>
          </div>
        </div>
        <ul class="pw-plan-features">
          ${p.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
        </ul>
        <div class="pw-plan-cta">
          <span>${escapeHtml(p.cta)}</span>
          <svg class="pw-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></svg>
        </div>
      </button>
    `).join('');

    const html = `
      <div class="pw-overlay" id="pw-overlay" role="dialog" aria-modal="true" aria-labelledby="pw-title">
        <div class="pw-modal">
          <button class="pw-close" aria-label="Close" type="button">&times;</button>
          <div class="pw-header">
            <div class="pw-icon">${icon}</div>
            <div class="pw-eyebrow">${currentPlan === 'basic' ? 'Upgrade' : 'Choose a Plan'}</div>
            <h2 class="pw-title" id="pw-title">${escapeHtml(copy.title)}</h2>
            <p class="pw-body">${escapeHtml(copy.body)}</p>
          </div>
          <div class="pw-error"></div>
          <div class="pw-plans">${planHtml}</div>
          <div class="pw-trust">
            <span class="pw-trust-item">Cancel anytime</span>
            <span class="pw-trust-item">Secure checkout</span>
            <span class="pw-trust-item">SSL encrypted</span>
          </div>
          <div class="pw-footer">
            Already a member? <a href="auth.html">Sign in</a>
          </div>
          <div class="pw-loading-overlay">
            <div class="pw-spinner"></div>
            <div class="pw-loading-text">Opening checkout…</div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('pw-overlay');

    // Animate plans in after open
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      setTimeout(() => {
        overlay.querySelectorAll('.pw-plan').forEach(el => el.classList.add('show'));
      }, 100);
    });

    overlay.querySelector('.pw-close').addEventListener('click', hide);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hide();
    });
    overlay.querySelectorAll('.pw-plan').forEach(btn => {
      btn.addEventListener('click', () => startCheckout(btn.dataset.plan, btn));
    });
    document.addEventListener('keydown', onKeyDown);
  }

  window.lisaanyPaywall = { show, hide };
})();
