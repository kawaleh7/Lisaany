// nav-role.js — Adapts nav links for staff users (tutors).
// Drop into any page after supabase is loaded: <script src="nav-role.js" defer></script>
//
// Behavior:
//   - Detects users where app_metadata.role === 'staff'
//   - Rewrites any nav link with text "Live Tutor" / "Tutors" / "Sessions" → "Portal"
//     pointing to tutor_portal.html
//   - Hides any nav link with text "Pricing" (staff don't pay)
//   - Skips active page so we don't break the current page link
//
// Staff still see student pages normally — they just navigate via Portal.
(function () {
  const SUPABASE_URL = 'https://cfaxrzfqvoalwznkhwnx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_JzVuIvyj2OEP4o0zbURcQA_NhfBFPaa';

  async function isStaffUser() {
    try {
      if (typeof window.supabase === 'undefined') return false;
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return false;
      return user.app_metadata && user.app_metadata.role === 'staff';
    } catch (e) {
      console.warn('nav-role isStaffUser error:', e);
      return false;
    }
  }

  function setLinkText(a, newText) {
    // Replace just the visible text without nuking child elements (icon spans)
    const textNodes = Array.from(a.childNodes).filter(n => n.nodeType === 3);
    let replaced = false;
    textNodes.forEach(n => {
      if (n.textContent.trim()) {
        n.textContent = ' ' + newText + ' ';
        replaced = true;
      }
    });
    if (replaced) return;
    // Fallback: find inner span/div with the text
    a.querySelectorAll('span, div').forEach(s => {
      const t = (s.textContent || '').trim().toLowerCase();
      if (s.classList && s.classList.contains('ms')) return; // skip icon spans
      if (t === 'live tutor' || t === 'tutors' || t === 'sessions' || t === 'tutor portal') {
        s.textContent = newText;
        replaced = true;
      }
    });
    if (replaced) return;
    // Last resort: replace entire textContent (will nuke icon)
    a.textContent = newText;
  }

  function rewriteNav() {
    const portalUrl = 'tutor_portal.html';
    const tutorPattern = /^(live tutor|tutors|sessions|tutor portal)$/i;
    const pricingPattern = /^pricing$/i;

    const links = document.querySelectorAll('a, button');
    links.forEach(el => {
      // Get visible text, ignoring icon-only children
      const cloneText = (el.textContent || '').trim();
      const href = el.getAttribute('href') || '';

      // Rewrite tutor-related links to Portal
      if (
        tutorPattern.test(cloneText) ||
        href === 'tutors.html' ||
        href.endsWith('/tutors.html')
      ) {
        if (el.tagName === 'A') el.setAttribute('href', portalUrl);
        setLinkText(el, 'Portal');
      }

      // Hide Pricing links
      if (pricingPattern.test(cloneText) || href === 'pricing.html' || href.endsWith('/pricing.html')) {
        el.style.display = 'none';
      }
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  async function init() {
    const isStaff = await isStaffUser();
    if (!isStaff) return;
    rewriteNav();
    // Re-run after a short delay in case nav is injected asynchronously
    setTimeout(rewriteNav, 500);
  }
})();
