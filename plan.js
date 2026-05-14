// plan.js — Single source of truth for subscription plan checking
// Drop into any page: <script src="plan.js" defer></script>
// Then anywhere: await window.lisaanyPlan.getPlan()
//
// Returns one of: 'free' | 'basic' | 'premium_monthly' | 'premium_yearly'
// Plus helpers: hasLiveTutor(), hasFullCurriculum(), isPaid()
//
// Maps Supabase `subscriptions.plan` text values to our four-state model:
//   self_paced              → basic
//   anything with 'year'    → premium_yearly
//   anything else (tutor)   → premium_monthly
//   no row / not active     → free
(function () {
  const SUPABASE_URL = 'https://cfaxrzfqvoalwznkhwnx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_JzVuIvyj2OEP4o0zbURcQA_NhfBFPaa';

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

  function mapPlanString(rawPlan) {
    const p = String(rawPlan || '').toLowerCase().trim();
    if (!p) return 'free';
    if (p === 'self_paced' || p === 'basic') return 'basic';
    if (p.includes('year') || p.includes('annual') || p.includes('yearly')) return 'premium_yearly';
    // Default: any other active plan (with_tutor, premium, tutor, etc.) → monthly premium
    return 'premium_monthly';
  }

  async function getPlan() {
    if (cached && (Date.now() - cachedAt < CACHE_MS)) {
      return cached;
    }

    try {
      await loadSupabase();
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: { user } } = await sb.auth.getUser();

      if (!user) {
        cached = 'free';
        cachedAt = Date.now();
        return cached;
      }

      // Staff users (tutors, owners) bypass all paywalls — full access everywhere.
      // Activated via auth.html Tutor tab + staff code; sets app_metadata.role='staff'.
      if (user.app_metadata && user.app_metadata.role === 'staff') {
        cached = 'staff';
        cachedAt = Date.now();
        return cached;
      }

      const { data, error } = await sb
        .from('subscriptions')
        .select('status, plan, stripe_subscription_id')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing'])
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('plan.js query error:', error);
        cached = 'free';
        cachedAt = Date.now();
        return cached;
      }
      if (!data) {
        cached = 'free';
        cachedAt = Date.now();
        return cached;
      }

      cached = mapPlanString(data.plan);
      cachedAt = Date.now();
      return cached;
    } catch (err) {
      console.warn('getPlan() error:', err);
      cached = 'free';
      cachedAt = Date.now();
      return 'free';
    }
  }

  async function hasLiveTutor() {
    const p = await getPlan();
    return p === 'staff' || p === 'premium_monthly' || p === 'premium_yearly';
  }

  async function hasFullCurriculum() {
    const p = await getPlan();
    return p !== 'free';
  }

  async function isPaid() {
    const p = await getPlan();
    return p !== 'free';
  }

  async function isStaff() {
    const p = await getPlan();
    return p === 'staff';
  }

  function invalidateCache() {
    cached = null;
    cachedAt = 0;
  }

  const FREE_UNITS = ['1.1'];
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

  window.lisaanyPlan = {
    getPlan,
    hasLiveTutor,
    hasFullCurriculum,
    isPaid,
    isStaff,
    isUnitFree,
    isTajweedLessonFree,
    canAccessUnit,
    canAccessTajweedLesson,
    invalidateCache,
    FREE_UNITS,
    FREE_TAJWEED_LESSONS,
  };
})();
