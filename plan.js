// plan.js — Single source of truth for subscription plan checking
// Drop into any page: <script src="plan.js" defer></script>
// Then anywhere: await window.lisaanyPlan.getPlan()
//
// Returns one of: 'free' | 'basic' | 'premium_monthly' | 'premium_yearly'
// Plus helpers: hasLiveTutor(), hasFullCurriculum(), isPaid()
//
// Stripe price ID → plan mapping (matches Cloudflare Worker env vars)
(function () {
  const SUPABASE_URL = 'https://cfaxrzfqvoalwznkhwnx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_JzVuIvyj2OEP4o0zbURcQA_NhfBFPaa';

  // Map Stripe price IDs to plan tier names.
  // Update these if you rotate Stripe price IDs.
  const PRICE_TO_PLAN = {
    'price_1TVwYmRpquEfxb9t1DQDAgRE': 'basic',             // $12.99 Self-Paced
    'price_1TVwcgRpquEfxb9tuJYp47Ui': 'premium_monthly',   // $29.99 With Tutor monthly
    'price_1TVwcgRpquEfxb9tWbqNnwwP': 'premium_yearly',    // $119.99 With Tutor yearly
  };

  let cached = null;
  let cachedAt = 0;
  const CACHE_MS = 60 * 1000; // 60s cache per page load

  async function loadSupabase() {
    if (typeof window.supabase !== 'undefined' && window.supabase.createClient) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function getPlan() {
    // Use cache if fresh
    if (cached && (Date.now() - cachedAt < CACHE_MS)) {
      return cached;
    }

    try {
      await loadSupabase();
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: { user } } = await sb.auth.getUser();

      // Not signed in → free
      if (!user) {
        cached = 'free';
        cachedAt = Date.now();
        return cached;
      }

      // Query active subscription for this user
      const { data, error } = await sb
        .from('subscriptions')
        .select('status, price_id, plan')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        cached = 'free';
        cachedAt = Date.now();
        return cached;
      }

      // Prefer explicit plan column if it exists; otherwise map from price_id
      let plan = data.plan || PRICE_TO_PLAN[data.price_id] || 'free';
      cached = plan;
      cachedAt = Date.now();
      return plan;
    } catch (err) {
      console.warn('getPlan() error:', err);
      cached = 'free';
      cachedAt = Date.now();
      return 'free';
    }
  }

  async function hasLiveTutor() {
    const p = await getPlan();
    return p === 'premium_monthly' || p === 'premium_yearly';
  }

  async function hasFullCurriculum() {
    const p = await getPlan();
    return p !== 'free'; // basic and premium both have full lessons
  }

  async function isPaid() {
    const p = await getPlan();
    return p !== 'free';
  }

  function invalidateCache() {
    cached = null;
    cachedAt = 0;
  }

  // Free preview units (arabic_platform.html)
  const FREE_UNITS = ['1.1', '1.2'];
  // Free preview lessons (lisaany_new.html — Tajweed)
  const FREE_TAJWEED_LESSONS = [1, 2];

  function isUnitFree(unitId) {
    return FREE_UNITS.includes(String(unitId));
  }

  function isTajweedLessonFree(lessonId) {
    return FREE_TAJWEED_LESSONS.includes(Number(lessonId));
  }

  async function canAccessUnit(unitId) {
    return isUnitFree(unitId) || await isPaid();
  }

  async function canAccessTajweedLesson(lessonId) {
    return isTajweedLessonFree(lessonId) || await isPaid();
  }

  // Expose globally
  window.lisaanyPlan = {
    getPlan,
    hasLiveTutor,
    hasFullCurriculum,
    isPaid,
    isUnitFree,
    isTajweedLessonFree,
    canAccessUnit,
    canAccessTajweedLesson,
    invalidateCache,
    FREE_UNITS,
    FREE_TAJWEED_LESSONS,
  };
})();
