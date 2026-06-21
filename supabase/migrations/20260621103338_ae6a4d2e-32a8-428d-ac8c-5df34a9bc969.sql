-- Lock down SECURITY DEFINER functions: revoke broad EXECUTE, grant only what's needed
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_moderated_comment(uuid, text, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_moderated_comment(uuid, text, boolean, text, text) TO authenticated;

-- moderation_log: explicit deny-all-reads policy. Admin reads happen via service role
-- in server functions, which bypasses RLS. This makes the intent explicit.
CREATE POLICY "no client reads of moderation log"
ON public.moderation_log
FOR SELECT
TO anon, authenticated
USING (false);
