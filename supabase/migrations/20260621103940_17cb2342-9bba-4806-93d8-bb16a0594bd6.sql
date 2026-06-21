
-- 1. Lock down posts INSERT: enforce username matches caller's profile + not banned
DROP POLICY IF EXISTS "users create own posts" ON public.posts;
CREATE POLICY "users create own posts"
ON public.posts
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND username = (SELECT username FROM public.profiles WHERE id = auth.uid())
  AND NOT EXISTS (SELECT 1 FROM public.strikes WHERE user_id = auth.uid() AND banned = true)
);

-- 2. Remove direct comment INSERT — force everything through the moderated RPC
DROP POLICY IF EXISTS "users create own comments" ON public.comments;

-- 3. Server-side content scanner
CREATE OR REPLACE FUNCTION public.scan_comment_text(_content text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('f+u+c+k',                                                                              'Explicit profanity',  'severe'),
      ('\mkill\s*(your|ur|him|her|them|my)?\s*self\M',                                          'Suicide baiting',     'severe'),
      ('\mkys\M',                                                                               'Suicide baiting',     'severe'),
      ('\mgo\s*(die|kill yourself|end yourself|hang yourself)\M',                                'Suicide baiting',     'severe'),
      ('\m(drop\s*dead|hope\s*you\s*die|you\s*should\s*die|wish\s*you\s*were\s*dead)\M',         'Death wish',          'severe'),
      ('\msh[i1]t\M',                                                                           'Profanity',           'moderate'),
      ('\ma[s$][s$](hole|hat|wipe|face|clown)?\M',                                              'Profanity',           'moderate'),
      ('\mb[i1]tch\M',                                                                          'Slur',                'moderate'),
      ('\mwh?ore\M',                                                                            'Sexual slur',         'severe'),
      ('\msl+u+t\M',                                                                            'Sexual slur',         'severe'),
      ('\mcunt\M',                                                                              'Slur',                'severe'),
      ('\m(dick|prick)(head)?\M',                                                               'Insult',              'moderate'),
      ('\m(moron|imbecile|idiot)\M',                                                            'Direct insult',       'moderate'),
      ('\mstupid\M',                                                                            'Direct insult',       'mild'),
      ('\m(loser|pathetic|worthless|useless)\M',                                                'Direct insult',       'moderate'),
      ('\mnobody\s*(likes|wants|cares|loves)\s*(you|u)\M',                                      'Exclusion',           'severe'),
      ('\mno\s*one\s*(likes|wants|cares about|loves)\s*(you|u)\M',                              'Exclusion',           'severe'),
      ('\m(shut\s*up|shut\s*your\s*(mouth|face|trap)|stfu)\M',                                  'Aggressive silencing','mild'),
      ('\m(ugly|hideous)\M',                                                                    'Appearance attack',   'moderate'),
      ('\m(kill|hurt|harm|destroy|beat\s*up|stab|shoot)\s*(you|u|ur)\M',                        'Violent threat',      'severe'),
      ('\m(freak|weirdo|creep|psycho)\M',                                                       'Derogatory label',    'moderate'),
      ('\m(failure|trash|garbage|waste\s*of\s*(space|time|life))\M',                            'Degrading insult',    'moderate'),
      ('बेकार|बेवकूफ|मूर्ख|गधा|कमीना|हरामी|कुत्त[ेा]|काबिल\s*नहीं',                                'Hindi insult',        'moderate'),
      ('मर\s*जा|भाड़\s*में\s*जा',                                                                'Hindi death wish',    'severe'),
      ('వెర్రివాడు|పిచ్చివాడు|పనికిమాలిన|మూర్ఖుడు',                                                'Telugu insult',       'moderate'),
      ('\m(imbécil|idiota|estúpido|inútil|cabrón|pendejo|puta|mierda)\M',                       'Spanish insult',      'moderate'),
      ('\m(idiot|imbécile|connard|salope|merde)\M',                                              'French insult',       'moderate'),
      ('بیکار|بیوقوف|احمق',                                                                      'Urdu/Arabic insult',  'moderate')
    ) AS t(pattern, label, sev)
  LOOP
    IF _content ~* rec.pattern THEN
      RETURN jsonb_build_object('hidden', true, 'category', rec.label, 'severity', rec.sev);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('hidden', false, 'category', NULL, 'severity', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.scan_comment_text(text) FROM PUBLIC, anon, authenticated;

-- 4. New trusted entry point for comment submission. Scans server-side,
-- ignores client-supplied moderation fields, derives username from profiles,
-- enforces ban, writes log, and increments strikes.
CREATE OR REPLACE FUNCTION public.submit_comment(_post_id uuid, _content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _username text;
  _is_banned boolean := false;
  _scan jsonb;
  _hidden boolean;
  _category text;
  _severity text;
  _new_count int := 0;
  _new_banned boolean := false;
  _trimmed text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  _trimmed := btrim(coalesce(_content, ''));
  IF length(_trimmed) = 0 OR length(_trimmed) > 2000 THEN
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

  _scan := public.scan_comment_text(_trimmed);
  _hidden := (_scan->>'hidden')::boolean;
  _category := _scan->>'category';
  _severity := _scan->>'severity';

  INSERT INTO public.comments (post_id, user_id, username, content, hidden, category, severity)
  VALUES (_post_id, _uid, _username, _trimmed, _hidden, _category, _severity);

  INSERT INTO public.moderation_log (user_id, username, content, action, category, severity)
  VALUES (_uid, _username, _trimmed, CASE WHEN _hidden THEN 'hidden' ELSE 'safe' END, _category, _severity);

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

  RETURN jsonb_build_object(
    'hidden', _hidden,
    'category', _category,
    'severity', _severity,
    'count', _new_count,
    'banned', _new_banned
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_comment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_comment(uuid, text) TO authenticated;

-- 5. Belt and suspenders: ensure no client-side writes on strikes (only service_role).
-- (Current schema has no INSERT/UPDATE/DELETE policies, so authenticated cannot write —
-- this is asserted explicitly here for future maintainers.)
DO $$ BEGIN
  PERFORM 1 FROM pg_policies
   WHERE schemaname='public' AND tablename='strikes' AND cmd IN ('INSERT','UPDATE','DELETE');
  IF FOUND THEN
    RAISE EXCEPTION 'strikes must not have authenticated write policies';
  END IF;
END $$;
