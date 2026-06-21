// Zero-tolerance moderation patterns (ported from CyberGuard prototype)
export type Severity = "mild" | "moderate" | "severe";

interface Pattern {
  r: RegExp;
  l: string;
  s: Severity;
}

export const PATTERNS: Pattern[] = [
  { r: /f+u+c+k/i, l: "Explicit profanity", s: "severe" },
  { r: /\bkill\s*(your|ur|him|her|them|my)?\s*self\b/i, l: "Suicide baiting", s: "severe" },
  { r: /\bkys\b/i, l: "Suicide baiting", s: "severe" },
  { r: /\bgo\s*(die|kill yourself|end yourself|hang yourself)\b/i, l: "Suicide baiting", s: "severe" },
  { r: /\b(drop\s*dead|hope\s*you\s*die|you\s*should\s*die|wish\s*you\s*were\s*dead)\b/i, l: "Death wish", s: "severe" },
  { r: /\b(you|u|ur|they|he|she)\s*(deserve|deserves)\s*(to\s*)?(hate|die|death|pain|suffer|suffering|nothing|worst)\b/i, l: "Hateful wish", s: "severe" },
  { r: /\b(deserve|deserves)\s*(to\s*)?(die|death|hate|pain)\b/i, l: "Hateful wish", s: "severe" },
  { r: /\bi?\s*hate\s*(you|u|ur|him|her|them|y'?all)\b/i, l: "Hate speech", s: "severe" },
  { r: /\b(you|u|ur)\s*(are|r)?\s*(such\s*a\s*)?(hate(ful|d)?|hated|disgusting|repulsive|vile|evil)\b/i, l: "Hate speech", s: "severe" },
  { r: /\bhate\b/i, l: "Hateful language", s: "moderate" },
  { r: /\b(kill|murder|stab|shoot|hang|strangle|behead|lynch)\b/i, l: "Violent language", s: "severe" },
  { r: /\b(die|death)\b/i, l: "Violent language", s: "moderate" },
  { r: /\msh[i1]t\b/i, l: "Profanity", s: "moderate" },
  { r: /\ba[s$][s$](hole|hat|wipe|face|clown)?\b/i, l: "Profanity", s: "moderate" },
  { r: /\bb[i1]tch\b/i, l: "Slur", s: "moderate" },
  { r: /\bwh?ore\b/i, l: "Sexual slur", s: "severe" },
  { r: /\bsl+u+t\b/i, l: "Sexual slur", s: "severe" },
  { r: /\bcunt\b/i, l: "Slur", s: "severe" },
  { r: /\b(dick|prick)(head)?\b/i, l: "Insult", s: "moderate" },
  { r: /\b(moron|imbecile|idiot|dumb(ass)?|retard(ed)?)\b/i, l: "Direct insult", s: "moderate" },
  { r: /\bstupid\b/i, l: "Direct insult", s: "mild" },
  { r: /\b(loser|pathetic|worthless|useless|nobody)\b/i, l: "Direct insult", s: "moderate" },
  { r: /\bnobody\s*(likes|wants|cares|loves)\s*(you|u)\b/i, l: "Exclusion", s: "severe" },
  { r: /\bno\s*one\s*(likes|wants|cares about|loves)\s*(you|u)\b/i, l: "Exclusion", s: "severe" },
  { r: /\b(shut\s*up|shut\s*your\s*(mouth|face|trap)|stfu)\b/i, l: "Aggressive silencing", s: "mild" },
  { r: /\b(ugly|hideous|fat|disgusting)\b/i, l: "Appearance attack", s: "moderate" },
  { r: /\b(hurt|harm|destroy|beat\s*up)\s*(you|u|ur)\b/i, l: "Violent threat", s: "severe" },
  { r: /\b(freak|weirdo|creep|psycho)\b/i, l: "Derogatory label", s: "moderate" },
  { r: /\b(failure|trash|garbage|waste\s*of\s*(space|time|life))\b/i, l: "Degrading insult", s: "moderate" },
  { r: /बेकार|बेवकूफ|मूर्ख|गधा|कमीना|हरामी|कुत्त[ेा]|काबिल\s*नहीं/u, l: "Hindi insult", s: "moderate" },
  { r: /मर\s*जा|भाड़\s*में\s*जा/u, l: "Hindi death wish", s: "severe" },
  { r: /వెర్రివాడు|పిచ్చివాడు|పనికిమాలిన|మూర్ఖుడు/u, l: "Telugu insult", s: "moderate" },
  { r: /\b(imbécil|idiota|estúpido|inútil|cabrón|pendejo|puta|mierda)\b/i, l: "Spanish insult", s: "moderate" },
  { r: /\b(idiot|imbécile|connard|salope|merde)\b/i, l: "French insult", s: "moderate" },
  { r: /بیکار|بیوقوف|احمق/u, l: "Urdu/Arabic insult", s: "moderate" },
];

export interface ScanResult {
  hidden: boolean;
  category: string | null;
  severity: Severity | null;
}

export function scanComment(text: string): ScanResult {
  for (const p of PATTERNS) {
    if (p.r.test(text)) {
      return { hidden: true, category: p.l, severity: p.s };
    }
  }
  return { hidden: false, category: null, severity: null };
}
