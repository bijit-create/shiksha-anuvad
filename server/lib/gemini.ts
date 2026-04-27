import { GoogleGenAI } from '@google/genai';

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (_client) return _client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set on the server');
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

export function getModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
}

const MATH_OPEN = '[MATH_START]';
const MATH_CLOSE = '[MATH_END]';

export function rewriteMathMarkers(text: string): string {
  if (!text) return text;
  return text
    .replace(/\[MATH_START\]\s*/g, '\\(')
    .replace(/\s*\[MATH_END\]/g, '\\)');
}

/**
 * Authoritative bodies / textbook traditions per target language. The model is
 * instructed to internally cross-reference terminology against these sources
 * before producing the translation. Update this table when adding languages.
 */
const LANGUAGE_AUTHORITIES: Record<string, string[]> = {
  Hindi: [
    'NCERT Hindi-medium textbooks (राष्ट्रीय शैक्षिक अनुसंधान और प्रशिक्षण परिषद्)',
    'Kendriya Hindi Sansthan, Agra (केन्द्रीय हिन्दी संस्थान)',
    'Central Hindi Directorate (केन्द्रीय हिन्दी निदेशालय)',
    'Commission for Scientific and Technical Terminology — CSTT (वैज्ञानिक तथा तकनीकी शब्दावली आयोग)',
  ],
  Marathi: [
    'Maharashtra State Bureau of Textbook Production — Balbharati (बालभारती)',
    'Maharashtra Rajya Marathi Vishwakosh Mandal (मराठी विश्वकोश)',
    'Maharashtra State Board of Secondary and Higher Secondary Education',
    'Sahitya Akademi (Marathi)',
  ],
  Gujarati: [
    'Gujarat State Board of School Textbooks — GSBST',
    'Gujarat Secondary and Higher Secondary Education Board (GSEB) Gujarati-medium textbooks',
    'Gujarat Sahitya Akademi (ગુજરાત સાહિત્ય અકાદમી)',
    'Gujarati Vishwakosh Trust (ગુજરાતી વિશ્વકોશ)',
  ],
  Odia: [
    'Board of Secondary Education, Odisha (BSE) Odia-medium textbooks',
    'Odisha SCERT',
    'Odia Bhasha Pratisthan',
    'Sahitya Akademi (Odia)',
  ],
  Telugu: [
    'Telugu Akademi, Hyderabad (తెలుగు అకాడమి)',
    'SCERT Andhra Pradesh / SCERT Telangana Telugu-medium textbooks',
    'Telugu Bhasha Mandali',
    'Sahitya Akademi (Telugu)',
  ],
  Bengali: [
    'West Bengal Board of Secondary Education (WBBSE) Bengali-medium textbooks',
    'Paschim Banga Bangla Akademi (পশ্চিমবঙ্গ বাংলা আকাদেমি)',
    'Bangiya Sahitya Parishad',
    'NCERT Bangla translations',
  ],
  Tamil: [
    'Tamil Nadu Textbook and Educational Services Corporation (TNTBESC)',
    'Tamil Virtual Academy (தமிழ் இணையக் கல்விக்கழகம்)',
    'Centre for Classical Tamil',
    'Sahitya Akademi (Tamil)',
  ],
  Kannada: [
    'Karnataka Textbook Society (KTBS) Kannada-medium textbooks',
    'Kannada Sahitya Parishat (ಕನ್ನಡ ಸಾಹಿತ್ಯ ಪರಿಷತ್ತು)',
    'Kuvempu Kannada Adhyayana Samsthe (Mysore University)',
    'Sahitya Akademi (Kannada)',
  ],
  Malayalam: [
    'SCERT Kerala Malayalam-medium textbooks',
    'Kerala Sahitya Akademi (കേരള സാഹിത്യ അക്കാദമി)',
    'Kerala Bhasha Institute (കേരള ഭാഷാ ഇൻസ്റ്റിറ്റ്യൂട്ട്)',
  ],
  Punjabi: [
    'Punjab School Education Board (PSEB) Punjabi-medium textbooks',
    'Punjabi University Patiala',
    'Punjab Languages Department',
    'Sahitya Akademi (Punjabi)',
  ],
  Urdu: [
    'National Council for Promotion of Urdu Language — NCPUL',
    'NCERT Urdu-medium textbooks',
    'Anjuman Taraqqi-e-Urdu Hind (انجمنِ ترقیِ اُردُو ہند)',
    'Sahitya Akademi (Urdu)',
  ],
  Assamese: [
    'Assam State Board (SEBA) and AHSEC Assamese-medium textbooks',
    'Asam Sahitya Sabha (অসম সাহিত্য সভা)',
    'Anundoram Borooah Institute of Language, Art and Culture (ABILAC)',
    'Sahitya Akademi (Assamese)',
  ],
  Sanskrit: [
    'Central Sanskrit University / Rashtriya Sanskrit Sansthan',
    'NCERT Sanskrit textbooks (रुचिरा series, etc.)',
    'Sampurnanand Sanskrit Vishwavidyalaya, Varanasi',
    'Sahitya Akademi (Sanskrit)',
  ],
};

function authoritiesBlock(target: string): string {
  const list = LANGUAGE_AUTHORITIES[target];
  if (!list || list.length === 0) {
    return `   - Use the authoritative ${target} academic-translation tradition (state SCERT textbooks, Sahitya Akademi, and recognised language academies).`;
  }
  return list.map(s => `   - ${s}`).join('\n');
}

async function callGemini(systemInstruction: string, prompt: string, retries = 4, backoff = 3000): Promise<any> {
  try {
    const client = getClient();
    const response = await client.models.generateContent({
      model: getModel(),
      contents: [{ parts: [{ text: prompt }] }],
      config: { systemInstruction, responseMimeType: 'application/json' },
    });
    return JSON.parse(response.text || '{}');
  } catch (error: any) {
    const errorStr = typeof error === 'object'
      ? JSON.stringify(error, Object.getOwnPropertyNames(error))
      : String(error);
    const isRateLimit = errorStr.includes('429')
      || errorStr.includes('RESOURCE_EXHAUSTED')
      || errorStr.includes('quota')
      || error?.status === 429;
    if (isRateLimit && retries > 0) {
      console.warn(`[gemini] rate-limited, retrying in ${backoff}ms (${retries} attempts left)`);
      await new Promise(r => setTimeout(r, backoff));
      return callGemini(systemInstruction, prompt, retries - 1, backoff * 1.5);
    }
    throw error;
  }
}

export interface TranslateInput {
  content: string;
  grade?: string;
  subject?: string;
  contentType?: string;
  additionalContext?: string;
  targetLanguage?: string;
}

export interface TranslateOutput {
  translatedText: string;
  explanation: string;
}

export interface AnalyzeInput {
  content: string;
  grade?: string;
  subject?: string;
  targetLanguage?: string;
}

export interface AnalyzeOutput {
  keyConcepts?: string[];
  vocabulary?: { english: string; hindi: string; definition: string }[];
  ncertAlignment?: string;
  suggestedActivities?: string[];
}

export async function translate(input: TranslateInput): Promise<TranslateOutput> {
  const { content, grade, subject, contentType, additionalContext, targetLanguage } = input;
  const target = (targetLanguage || 'Hindi').trim();

  const systemInstruction = `You are an expert educational content developer and translator specializing in the Indian NCERT curriculum and Indian-language pedagogy.
Your task is to translate educational content from English into ${target}.

============================================================
PHASE 1 — INTERNAL RESEARCH (do this silently BEFORE writing)
============================================================
Before producing any translation, mentally consult and align with:

A. NATIONAL POLICY FRAMEWORK
   - National Education Policy 2020 (NEP 2020), particularly Chapter 4 (curriculum & pedagogy) §4.11–§4.22 on the use of mother tongue / home language / regional language as medium of instruction, and the three-language formula. Honour the spirit of strengthening Indian languages and using their authentic terminology.
   - National Curriculum Framework for School Education (NCF-SE 2023) and the Foundational Stage NCF 2022 — follow their guidance on age-appropriate language and discipline-specific terminology.
   - Right of Children to Free and Compulsory Education Act (RTE) — keep language inclusive and learner-friendly.

B. NCERT / SCERT TEXTBOOK CONVENTIONS
   - Use the exact terms that appear in official NCERT and state SCERT ${target}-medium textbooks for the given grade and subject.
   - For Mathematics, Science, and Social Science, prefer the canonical ${target} term used in NCERT translated editions over an English transliteration.

C. AUTHORITATIVE LANGUAGE BODIES FOR ${target}
${authoritiesBlock(target)}

D. ESTABLISHED-TERM RULE
   - Identify every key technical / subject-specific term, named entity, and idiom in the source.
   - For each, recall the canonical equivalent used in the sources above. Prefer the established native term over Latin transliteration.
   - If multiple variants exist (regional, classical, colloquial), pick the one used in NCERT/SCERT ${target}-medium textbooks at the target grade.
   - When a concept is genuinely new and no native term has been standardised, you may transliterate the English term phonetically into the ${target} script, but flag this in the explanation.

============================================================
PHASE 2 — TRANSLATION RULES
============================================================
1. CONTEXTUAL TRANSLATION: Do not translate word-for-word. Convey the pedagogical intent in natural, academic ${target}.
2. GRADE APPROPRIATENESS:
   - Lower grades (KG–5): simpler, more descriptive ${target}.
   - Middle grades (6–8): standard NCERT/SCERT academic terminology in ${target}.
   - Secondary (9–12): precise technical/formal ${target} per official curriculum standards.
3. SUBJECT SPECIFICITY: Use the established subject-specific term as it appears in the ${target}-medium NCERT/SCERT textbook for the subject. Do not invent words.
4. CONTENT TYPE adaptation:
   - 'Question': preserve interrogative tone.
   - 'MCQ' / 'Option': translate clearly and concisely.
   - 'Paragraph' / 'Explanation' / 'Learning Outcome' / 'LO': maintain flow and pedagogical sequencing.
5. SCRIPT: Write in the native script of ${target} (Devanagari for Hindi/Marathi/Sanskrit, Bangla script for Bengali/Assamese, Tamil for Tamil, Telugu for Telugu, Gujarati for Gujarati, Kannada for Kannada, Malayalam for Malayalam, Gurmukhi for Punjabi, Perso-Arabic for Urdu, Odia for Odia). Do NOT romanise into Latin.
6. FORMATTING: Return the translation in Markdown.
7. MATHEMATICAL EXPRESSIONS (language-independent, CRITICAL):
   - Wrap EVERY mathematical expression, equation, variable, number-with-unit, or symbolic term in the exact tags ${MATH_OPEN} and ${MATH_CLOSE}.
   - Example: ${MATH_OPEN}125{t^3} + 8 + 150{t^2} + 60t${MATH_CLOSE}
   - Tags are auto-rewritten to LaTeX \\( ... \\) and rendered as typeset math.
   - Do NOT emit backslash-parenthesis (\\( \\)) or dollar signs ($ $$) directly — only the tags above.
   - Use standard LaTeX commands: \\frac{a}{b}, \\sqrt{x}, x^{n}, x_{i}, \\times, \\div, \\pi, \\theta, \\sum, \\int, \\leq, \\geq, \\neq, \\approx, \\infty, \\text{...}.
   - Do NOT translate variable names, LaTeX commands, or mathematical symbols. Only surrounding prose is in ${target}.

============================================================
OUTPUT FORMAT
============================================================
Provide the response in the following JSON format:
{
  "translatedText": "The translated content in ${target}, with every math expression wrapped in ${MATH_OPEN} and ${MATH_CLOSE}",
  "explanation": "Briefly note any non-obvious terminology choices: which canonical NCERT/SCERT term was picked, which regional variant, or which transliteration was needed. Optional."
}`;

  let prompt = `Translate the following content into ${target}.`;
  if (grade) prompt += `\nTarget Grade: ${grade}`;
  if (subject) prompt += `\nTarget Subject: ${subject}`;
  if (contentType) prompt += `\nContent Type / Column Name: ${contentType}`;
  if (additionalContext) {
    prompt += `\n\nAdditional Context (Row Data):\n${additionalContext}\nUse this context to intelligently infer the exact grade, subject, and content type if not explicitly clear.`;
  }
  prompt += `\n\nContent to Translate:\n${content}`;

  const result = await callGemini(systemInstruction, prompt);
  return {
    translatedText: rewriteMathMarkers(result.translatedText || 'Translation failed.'),
    explanation: rewriteMathMarkers(result.explanation || ''),
  };
}

export async function analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
  const { content, grade, subject, targetLanguage } = input;
  const target = (targetLanguage || 'Hindi').trim();

  const systemInstruction = `You are an educational consultant specializing in the NCERT curriculum and Indian-language pedagogy.
Analyze the provided educational content for ${grade || 'the given grade'} ${subject || ''}.

Before answering, internally consult:
- NEP 2020 (especially §4.11–§4.22) and NCF-SE 2023 for age- and language-appropriate framing.
- NCERT and state SCERT ${target}-medium textbooks for canonical subject terminology.
- Authoritative ${target} academic bodies:
${authoritiesBlock(target)}

Then produce:
1. Key Concepts: 3-5 core concepts covered (short plain-text phrases, in English).
2. Vocabulary: 3-5 important terms. For each, give the English word, the canonical equivalent in ${target} (in its native script — taken from the sources above, not transliterated), and a one-line definition in English.
3. NCERT Alignment: how this aligns with NCERT standards for this grade.
4. Suggested Activities: 1-2 classroom activities related to this content.

Keep these analysis fields as plain text (no LaTeX markers, no markdown). Return JSON only.

Return the response in JSON format:
{
  "keyConcepts": ["concept1", "concept2"],
  "vocabulary": [{"english": "word", "hindi": "term in ${target} script", "definition": "meaning"}],
  "ncertAlignment": "alignment note",
  "suggestedActivities": ["activity1"]
}
Note: the JSON key "hindi" is kept as-is for backward compatibility, but its value MUST be the term in ${target}.`;

  return callGemini(systemInstruction, content);
}
