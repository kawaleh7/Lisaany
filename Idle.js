/* ═══════════════════════════════════════════════════════════════════
 * LISAANY — Idle auto-signout
 *
 * Signs out users after 30 minutes of inactivity.
 * Shows a "Still there?" warning modal at 28 minutes.
 * Activity = mouse, keyboard, scroll, touch, visibility change.
 * STAFF EXEMPT: app_metadata.role === 'staff' bypasses entirely.
 *
 * Requires:
 *   - <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *     loaded BEFORE this script
 *
 * Include on all authenticated pages EXCEPT auth.html
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SUPABASE_URL    = 'https://cfaxrzfqvoalwznkhwnx.supabase.co';
  const SUPABASE_KEY    = 'sb_publishable_JzVuIvyj2OEP4o0zbURcQA_NhfBFPaa';
  const AUTH_PAGE       = '/auth.html';

  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 min full timeout
  const WARN_AT_MS      = 28 * 60 * 1000;  // show warning at 28 min
  const ACTIVITY_EVENTS = ['mousemove','mousedown','keydown','scroll','touchstart','click','visibilitychange'];

  function log(...args) { console.log('[idle]', ...args); }

  function getClient() {
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.warn('[idle] supabase-js not loaded — idle timeout disabled');
      return null;
    }
    return supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  // ─── Warning modal ─────────────────────────────────────────────────
  let warnEl = null;
  function showWarning(remainingMs, onStayActive) {
    if (warnEl) return;
    warnEl = document.createElement('div');
    warnEl.id = 'lisaany-idle-warn';
    warnEl.innerHTML = `
      <div style="
        position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);
        z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;
        font-family:'Inter',sans-serif;
      ">
        <div style="
          background:#0d1322;border:1px solid rgba(212,163,74,.4);border-radius:18px;
          padding:32px 28px;max-width:380px;text-align:center;color:#e8dcc8;
          box-shadow:0 8px 40px rgba(0,0,0,.6),0 0 60px rgba(212,163,74,.08);
        ">
          <div style="font-family:'Cinzel',serif;font-size:20px;font-weight:700;color:#f2be62;margin-bottom:10px;letter-spacing:.5px;">
            Still there?
          </div>
          <div style="font-size:14px;line-height:1.6;color:#b8ad95;margin-bottom:22px;">
            You'll be signed out for inactivity in
            <span id="lisaany-idle-countdown" style="color:#f2be62;font-weight:700;">2:00</span>.
          </div>
          <button id="lisaany-idle-stay" style="
            background:linear-gradient(180deg,#ffd97a 0%,#f2be62 50%,#e0b252 100%);
            color:#1a1000;border:none;border-radius:10px;padding:12px 28px;
            font-family:'Inter',sans-serif;font-size:13px;font-weight:700;letter-spacing:.5px;
            cursor:pointer;text-transform:uppercase;box-shadow:0 4px 16px rgba(212,163,74,.3);
          ">I'm still here</button>
        </div>
      </div>
    `;
    document.body.appendChild(warnEl);
    document.getElementById('lisaany-idle-stay').addEventListener('click', () => {
      hideWarning();
      onStayActive();
    });
    startCountdown(remainingMs);
  }

  let countdownInterval = null;
  function startCountdown(remainingMs) {
    const endsAt = Date.now() + remainingMs;
    const tick = () => {
      const left = Math.max(0, endsAt - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      const el = document.getElementById('lisaany-idle-countdown');
      if (el) el.textContent = m + ':' + String(s).padStart(2,'0');
      if (left <= 0 && countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    };
    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  function hideWarning() {
    if (warnEl) { warnEl.remove(); warnEl = null; }
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  }

  // ─── Signout flow ──────────────────────────────────────────────────
  async function doSignOut(sb) {
    log('Idle timeout reached — signing out');
    hideWarning();
    try { await sb.auth.signOut(); } catch (_) {}
    try { alert("You've been signed out due to inactivity."); } catch (_) {}
    window.location.href = AUTH_PAGE;
  }

  // ─── Main ──────────────────────────────────────────────────────────
  async function init() {
    const sb = getClient();
    if (!sb) return;

    let session;
    try {
      const { data } = await sb.auth.getSession();
      session = data.session;
    } catch (e) { return; }
    if (!session) { log('Not logged in — skipping'); return; }

    const role = session.user.app_metadata?.role;
    if (role === 'staff') {
      log('Staff user — exempt from idle timeout');
      return;
    }

    let lastActivity = Date.now();
    let warnTimer  = null;
    let kickTimer  = null;

    function resetTimers() {
      lastActivity = Date.now();
      if (warnTimer) clearTimeout(warnTimer);
      if (kickTimer) clearTimeout(kickTimer);
      hideWarning();
      warnTimer = setTimeout(() => {
        showWarning(IDLE_TIMEOUT_MS - WARN_AT_MS, resetTimers);
      }, WARN_AT_MS);
      kickTimer = setTimeout(() => doSignOut(sb), IDLE_TIMEOUT_MS);
    }

    ACTIVITY_EVENTS.forEach(evt => {
      window.addEventListener(evt, resetTimers, { passive: true });
    });

    resetTimers();
    log('Idle tracker armed (30 min)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
