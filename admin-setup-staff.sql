-- ════════════════════════════════════════════════════════════════
-- LISAANY STAFF SYSTEM SETUP
-- ════════════════════════════════════════════════════════════════
-- Run this ONCE in your Supabase SQL editor:
--   https://supabase.com/dashboard/project/cfaxrzfqvoalwznkhwnx/sql
--
-- Adds:
--   - app_settings table (stores the master staff code)
--   - redeem_staff_code() — anyone can call with the code to become staff
--   - admin_get_staff() — owner-only, lists current staff
--   - admin_demote_staff() — owner-only, removes staff role
--   - admin_get_staff_code() — owner-only, retrieves current code
--   - admin_rotate_staff_code() — owner-only, changes the code
--
-- Initial master code: ARABIC-1986
-- Owner email: ahmedstart163@gmail.com
-- ════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────
-- 1. App settings table (stores master staff code + other config)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

-- SECURITY: Enable RLS but add NO policies. This blocks direct API access.
-- Only SECURITY DEFINER functions (which run with elevated privileges) can read.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_settings (key, value)
VALUES ('staff_code', 'ARABIC-1986')
ON CONFLICT (key) DO NOTHING;


-- ──────────────────────────────────────────────────────────────
-- 2. Redeem staff code (any authenticated user can call)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION redeem_staff_code(code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $func$
DECLARE
  v_user_id uuid;
  v_stored_code text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT value INTO v_stored_code FROM public.app_settings WHERE key = 'staff_code';

  IF v_stored_code IS NULL OR upper(trim(v_stored_code)) != upper(trim(code)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid staff code');
  END IF;

  -- Update user's app_metadata to set role = 'staff'
  -- app_metadata can only be modified server-side, so this is secure
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) ||
      jsonb_build_object('role', 'staff', 'promoted_at', now()::text)
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'role', 'staff');
END;
$func$;

REVOKE ALL ON FUNCTION redeem_staff_code(text) FROM public;
GRANT EXECUTE ON FUNCTION redeem_staff_code(text) TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- 3. Get list of staff (owner only)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_staff()
RETURNS TABLE (
  user_id uuid,
  email text,
  name text,
  joined_at timestamptz,
  promoted_at text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $func$
BEGIN
  IF (auth.jwt() ->> 'email') NOT IN ('ahmedstart163@gmail.com') THEN
    RAISE EXCEPTION 'Not authorized: owner access required';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    COALESCE(u.raw_user_meta_data->>'name', '')::text,
    u.created_at,
    (u.raw_app_meta_data->>'promoted_at')::text
  FROM auth.users u
  WHERE u.raw_app_meta_data->>'role' = 'staff'
  ORDER BY u.created_at DESC;
END;
$func$;

REVOKE ALL ON FUNCTION admin_get_staff() FROM public;
GRANT EXECUTE ON FUNCTION admin_get_staff() TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- 4. Demote a staff member to student (owner only)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_demote_staff(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $func$
BEGIN
  IF (auth.jwt() ->> 'email') NOT IN ('ahmedstart163@gmail.com') THEN
    RAISE EXCEPTION 'Not authorized: owner access required';
  END IF;

  -- Remove the 'role' key from app_metadata (doesn't error if not present)
  UPDATE auth.users
  SET raw_app_meta_data = (COALESCE(raw_app_meta_data, '{}'::jsonb) - 'role') - 'promoted_at'
  WHERE id = target_user_id;

  RETURN jsonb_build_object('success', true);
END;
$func$;

REVOKE ALL ON FUNCTION admin_demote_staff(uuid) FROM public;
GRANT EXECUTE ON FUNCTION admin_demote_staff(uuid) TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- 5. Get master staff code (owner only)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_staff_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF (auth.jwt() ->> 'email') NOT IN ('ahmedstart163@gmail.com') THEN
    RAISE EXCEPTION 'Not authorized: owner access required';
  END IF;
  RETURN (SELECT value FROM public.app_settings WHERE key = 'staff_code');
END;
$func$;

REVOKE ALL ON FUNCTION admin_get_staff_code() FROM public;
GRANT EXECUTE ON FUNCTION admin_get_staff_code() TO authenticated;


-- ──────────────────────────────────────────────────────────────
-- 6. Rotate master staff code (owner only)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_rotate_staff_code(new_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF (auth.jwt() ->> 'email') NOT IN ('ahmedstart163@gmail.com') THEN
    RAISE EXCEPTION 'Not authorized: owner access required';
  END IF;

  IF new_code IS NULL OR length(trim(new_code)) < 4 THEN
    RAISE EXCEPTION 'Code must be at least 4 characters';
  END IF;

  UPDATE public.app_settings
  SET value = trim(new_code),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE key = 'staff_code';

  RETURN jsonb_build_object('success', true, 'new_code', trim(new_code));
END;
$func$;

REVOKE ALL ON FUNCTION admin_rotate_staff_code(text) FROM public;
GRANT EXECUTE ON FUNCTION admin_rotate_staff_code(text) TO authenticated;


-- ════════════════════════════════════════════════════════════════
-- SETUP COMPLETE — what to do next:
-- ════════════════════════════════════════════════════════════════
-- 1. Deploy the new auth.html, staff.html, and admin.html files
-- 2. Test redeem flow:
--    a. Sign up a test account (any email, e.g. test@example.com)
--    b. Sign in with that account, toggle "Staff member?", enter ARABIC-1986
--    c. Should redirect to staff.html
-- 3. Test owner view:
--    a. Sign in as ahmedstart163@gmail.com
--    b. Visit admin.html, scroll to "Staff Management"
--    c. Should see the test staff member, with Demote button
--    d. Click Demote → test account returns to student
-- ════════════════════════════════════════════════════════════════
