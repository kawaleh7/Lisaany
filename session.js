/* ═══════════════════════════════════════════════════════════════════
 * LISAANY — Single-device session enforcement
 * 
 * Behavior:
 *   - One paid account = one active device at a time
 *   - New login on Device B → Device A receives a realtime UPDATE
 *   - Device A signs out, redirects to /auth.html with notice
 *   - STAFF EXEMPT: app_metadata.role === 'staff' bypasses entirely
 * 
 * Requires:
 *   - <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *     loaded BEFORE this script
 *   - SQL setup (session-setup.sql) applied to Supabase
 * 
 * Include on all authenticated pages EXCEPT auth.html
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://cfaxrzfqvoalwznkhwnx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_JzVuIvyj2OEP4o0zbURcQA_NhfBFPaa';
  const DEVICE_ID_KEY = 'lisaany_device_id';
  const AUTH_PAGE = '/auth.html';

  function log(...args) { console.log('[session]', ...args); }

  function getOrCreateDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10)
                  + '_' + Date.now().toString(36);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function getClient() {
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.warn('[session] supabase-js not loaded — session enforcement disabled');
      return null;
    }
    return supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  async function handleKick(sb) {
    log('Kicked — another device signed in');
    try { await sb.auth.signOut(); } catch (_) {}
    try {
      alert("You've been signed out — your account is now active on another device.");
    } catch (_) {}
    window.location.href = AUTH_PAGE;
  }

  async function enforce() {
    const sb = getClient();
    if (!sb) return;

    let session;
    try {
      const { data } = await sb.auth.getSession();
      session = data.session;
    } catch (e) {
      log('getSession failed:', e);
      return;
    }
    if (!session) { log('Not logged in — skipping'); return; }

    const user = session.user;
    const role = user.app_metadata?.role;
    if (role === 'staff') {
      log('Staff user — exempt from single-device enforcement');
      return;
    }

    const deviceId = getOrCreateDeviceId();

    // Register this device as the active one (UPSERT replaces prior row)
    const { error: upsertErr } = await sb
      .from('active_sessions')
      .upsert({
        user_id:      user.id,
        device_id:    deviceId,
        user_agent:   (navigator.userAgent || '').slice(0, 200),
        signed_in_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertErr) {
      log('Failed to register session:', upsertErr.message);
      return;
    }
    log('Registered device:', deviceId);

    // Subscribe to UPDATEs on our session row
    const channel = sb
      .channel('lisaany_session_' + user.id)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'active_sessions',
        filter: 'user_id=eq.' + user.id,
      }, (payload) => {
        const newDeviceId = payload.new?.device_id;
        if (newDeviceId && newDeviceId !== deviceId) {
          handleKick(sb);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') log('Realtime subscribed');
      });

    window.addEventListener('beforeunload', () => {
      try { sb.removeChannel(channel); } catch (_) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enforce);
  } else {
    enforce();
  }

  // Expose for debugging
  window.lisaanySession = { enforce, getOrCreateDeviceId };
})();
