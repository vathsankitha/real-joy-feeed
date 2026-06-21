
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
      ('f+u+c+k',                                                                                                  'Explicit profanity',  'severe'),
      ('\mkill\s*(your|ur|him|her|them|my)?\s*self\M',                                                              'Suicide baiting',     'severe'),
      ('\mkys\M',                                                                                                   'Suicide baiting',     'severe'),
      ('\mgo\s*(die|kill yourself|end yourself|hang yourself)\M',                                                    'Suicide baiting',     'severe'),
      ('\m(drop\s*dead|hope\s*you\s*die|you\s*should\s*die|wish\s*you\s*were\s*dead)\M',                             'Death wish',          'severe'),
      ('\m(you|u|ur|they|he|she)\s*(deserve|deserves)\s*(to\s*)?(hate|die|death|pain|suffer|suffering|nothing|worst)\M', 'Hateful wish',      'severe'),
      ('\m(deserve|deserves)\s*(to\s*)?(die|death|hate|pain)\M',                                                     'Hateful wish',        'severe'),
      ('\m(i\s*)?hate\s*(you|u|ur|him|her|them|yall|y''all)\M',                                                       'Hate speech',         'severe'),
      ('\m(you|u|ur)\s*(are|r)?\s*(such\s*a\s*)?(hateful|hated|disgusting|repulsive|vile|evil)\M',                   'Hate speech',         'severe'),
      ('\mhate\M',                                                                                                   'Hateful language',    'moderate'),
      ('\m(kill|murder|stab|shoot|hang|strangle|behead|lynch)\M',                                                    'Violent language',    'severe'),
      ('\m(die|death)\M',                                                                                            'Violent language',    'moderate'),
      ('\msh[i1]t\M',                                                                                                'Profanity',           'moderate'),
      ('\ma[s$][s$](hole|hat|wipe|face|clown)?\M',                                                                  'Profanity',           'moderate'),
      ('\mb[i1]tch\M',                                                                                              'Slur',                'moderate'),
      ('\mwh?ore\M',                                                                                                'Sexual slur',         'severe'),
      ('\msl+u+t\M',                                                                                                'Sexual slur',         'severe'),
      ('\mcunt\M',                                                                                                  'Slur',                'severe'),
      ('\m(dick|prick)(head)?\M',                                                                                   'Insult',              'moderate'),
      ('\m(moron|imbecile|idiot|dumb(ass)?|retard(ed)?)\M',                                                         'Direct insult',       'moderate'),
      ('\mstupid\M',                                                                                                'Direct insult',       'mild'),
      ('\m(loser|pathetic|worthless|useless|nobody)\M',                                                             'Direct insult',       'moderate'),
      ('\mnobody\s*(likes|wants|cares|loves)\s*(you|u)\M',                                                          'Exclusion',           'severe'),
      ('\mno\s*one\s*(likes|wants|cares about|loves)\s*(you|u)\M',                                                  'Exclusion',           'severe'),
      ('\m(shut\s*up|shut\s*your\s*(mouth|face|trap)|stfu)\M',                                                      'Aggressive silencing','mild'),
      ('\m(ugly|hideous|fat|disgusting)\M',                                                                         'Appearance attack',   'moderate'),
      ('\m(hurt|harm|destroy|beat\s*up)\s*(you|u|ur)\M',                                                            'Violent threat',      'severe'),
      ('\m(freak|weirdo|creep|psycho)\M',                                                                           'Derogatory label',    'moderate'),
      ('\m(failure|trash|garbage|waste\s*of\s*(space|time|life))\M',                                                'Degrading insult',    'moderate'),
      ('बेकार|बेवकूफ|मूर्ख|गधा|कमीना|हरामी|कुत्त[ेा]|काबिल\s*नहीं',                                                    'Hindi insult',        'moderate'),
      ('मर\s*जा|भाड़\s*में\s*जा',                                                                                    'Hindi death wish',    'severe'),
      ('వెర్రివాడు|పిచ్చివాడు|పనికిమాలిన|మూర్ఖుడు',                                                                    'Telugu insult',       'moderate'),
      ('\m(imbécil|idiota|estúpido|inútil|cabrón|pendejo|puta|mierda)\M',                                           'Spanish insult',      'moderate'),
      ('\m(idiot|imbécile|connard|salope|merde)\M',                                                                  'French insult',       'moderate'),
      ('بیکار|بیوقوف|احمق',                                                                                          'Urdu/Arabic insult',  'moderate')
    ) AS t(pattern, label, sev)
  LOOP
    IF _content ~* rec.pattern THEN
      RETURN jsonb_build_object('hidden', true, 'category', rec.label, 'severity', rec.sev);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('hidden', false, 'category', NULL, 'severity', NULL);
END;
$$;
