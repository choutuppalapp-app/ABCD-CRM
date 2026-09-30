-- ============================================================
-- 041_backfill_existing_auth_users.sql
-- Backfill existing auth.users into accounts and profiles
-- Ensures users created before migration run get their owner profile
-- ============================================================

DO $$
DECLARE
  u RECORD;
  v_account_id UUID;
  v_full_name TEXT;
BEGIN
  FOR u IN 
    SELECT id, email, raw_user_meta_data 
    FROM auth.users 
    WHERE id NOT IN (SELECT user_id FROM public.profiles WHERE user_id IS NOT NULL)
  LOOP
    v_full_name := COALESCE(u.raw_user_meta_data->>'full_name', '');
    
    INSERT INTO public.accounts (name, owner_user_id)
    VALUES (COALESCE(NULLIF(v_full_name, ''), u.email, 'My account'), u.id)
    RETURNING id INTO v_account_id;

    INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
    VALUES (u.id, v_full_name, COALESCE(u.email, ''), v_account_id, 'owner')
    ON CONFLICT (user_id) DO UPDATE
      SET account_id = COALESCE(profiles.account_id, EXCLUDED.account_id),
          account_role = COALESCE(profiles.account_role, EXCLUDED.account_role);
  END LOOP;
END $$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
