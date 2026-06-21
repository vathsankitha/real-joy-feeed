
-- 1. Comments: hide moderated comments from non-owners
DROP POLICY IF EXISTS "comments readable by authed" ON public.comments;
CREATE POLICY "comments readable by authed"
  ON public.comments FOR SELECT TO authenticated
  USING (hidden = false OR auth.uid() = user_id);

-- 2. Comments: prevent users from self-assigning moderation fields
DROP POLICY IF EXISTS "users create own comments" ON public.comments;
CREATE POLICY "users create own comments"
  ON public.comments FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND hidden = false
    AND severity IS NULL
    AND category IS NULL
  );

-- 3. Strikes: remove self-insert/self-update (server manages exclusively)
DROP POLICY IF EXISTS "users upsert own strikes" ON public.strikes;
DROP POLICY IF EXISTS "users update own strikes" ON public.strikes;

-- 4. Moderation log: remove user inserts (server manages exclusively)
DROP POLICY IF EXISTS "users insert own log" ON public.moderation_log;

-- 5. SECURITY DEFINER function for server-side moderation pipeline.
--    Called from an authenticated server function with the user's bearer token,
--    so auth.uid() is the acting user. Inserts the comment with moderation
--    fields set, writes the audit log, and bumps strike count atomically.
CREATE OR REPLACE FUNCTION public.submit_moderated_comment(
  _post_id uuid,
  _content text,
  _hidden boolean,
  _category text,
  _severity text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _username text;
  _is_banned boolean := false;
  _new_count int := 0;
  _new_banned boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF length(coalesce(_content, '')) = 0 OR length(_content) > 2000 THEN
    RAISE EXCEPTION 'Invalid content length';
  END IF;

  SELECT username INTO _username FROM public.profiles WHERE id = _uid;
  IF _username IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT banned INTO _is_banned FROM public.strikes WHERE user_id = _uid;
  IF coalesce(_is_banned, false) THEN
    RAISE EXCEPTION 'User is banned';
  END IF;

  INSERT INTO public.comments (post_id, user_id, username, content, hidden, category, severity)
  VALUES (_post_id, _uid, _username, _content, _hidden, _category, _severity);

  INSERT INTO public.moderation_log (user_id, username, content, action, category, severity)
  VALUES (_uid, _username, _content, CASE WHEN _hidden THEN 'hidden' ELSE 'safe' END, _category, _severity);

  IF _hidden THEN
    INSERT INTO public.strikes (user_id, username, count, banned)
    VALUES (_uid, _username, 1, false)
    ON CONFLICT (user_id) DO UPDATE
      SET count = public.strikes.count + 1,
          banned = (public.strikes.count + 1) >= 3,
          username = EXCLUDED.username,
          updated_at = now()
    RETURNING count, banned INTO _new_count, _new_banned;
  END IF;

  RETURN jsonb_build_object('hidden', _hidden, 'count', _new_count, 'banned', _new_banned);
END;
$$;

-- Need unique constraint for ON CONFLICT
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'strikes_user_id_key'
  ) THEN
    ALTER TABLE public.strikes ADD CONSTRAINT strikes_user_id_key UNIQUE (user_id);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_moderated_comment(uuid, text, boolean, text, text) TO authenticated;

-- 6. Realtime: restrict subscriptions to authenticated users only
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated can receive realtime" ON realtime.messages;
CREATE POLICY "authenticated can receive realtime"
  ON realtime.messages FOR SELECT TO authenticated
  USING (true);
