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

  const systemInstruction = `You are an expert educational content developer and translator specializing in the Indian NCERT curriculum.
Your task is to translate educational content from English into ${target}.

CRITICAL GUIDELINES:
1. SEARCH-FIRST APPROACH (do this BEFORE you write the translation):
   - Identify every key technical / subject-specific term, named entity, and idiomatic phrase in the source text.
   - For each, recall the canonical NCERT-equivalent term used in ${target}-medium textbooks of the target grade and subject. Prefer the established academic term over a literal transliteration.
   - If multiple variants exist (regional, classical, colloquial), pick the one used in ${target} NCERT/SCERT textbooks at the target grade.
   - Only after this internal terminology lookup, produce the translation.
2. CONTEXTUAL TRANSLATION: Do not perform word-to-word translation. Convey the pedagogical intent in natural, academic ${target}.
3. GRADE APPROPRIATENESS:
   - Lower grades (KG-5): simpler, more descriptive ${target}.
   - Middle grades (6-8): standard academic terminology used in NCERT textbooks for ${target}.
   - Secondary grades (9-12): precise technical and formal ${target} per official curriculum standards.
4. SUBJECT SPECIFICITY: Use the correct subject-specific terminology in ${target} (Mathematics, Science, History, etc.). Do not invent words; use the established term used in the ${target}-medium NCERT textbook for the subject.
5. CONTENT TYPE: Adapt to the content type:
   - 'Question': preserve the interrogative tone.
   - 'MCQ' / 'Option': translate clearly and concisely.
   - 'Paragraph' / 'Explanation': maintain flow of information.
6. NCERT ALIGNMENT: Mirror the linguistic style of NCERT ${target}-medium textbooks for the specified grade and subject.
7. SCRIPT: Write the translation in the native script of ${target} (e.g., Hindi/Marathi/Sanskrit → Devanagari, Bengali/Assamese → Bangla script, Tamil → Tamil script, Urdu → Perso-Arabic, etc.). Do not transliterate into Latin unless the target language itself is Latin-script.
8. FORMATTING: Return the translation in Markdown format.
9. MATHEMATICAL EXPRESSIONS (CRITICAL — language-independent):
   - Wrap EVERY mathematical expression, equation, variable, number-with-unit, or symbolic term in the exact tags ${MATH_OPEN} and ${MATH_CLOSE}.
   - Example: ${MATH_OPEN}125{t^3} + 8 + 150{t^2} + 60t${MATH_CLOSE}
   - These tags are automatically rewritten to LaTeX \\( ... \\) delimiters and rendered as typeset math by the client.
   - Do NOT emit backslash-parenthesis (\\( \\)) or dollar signs ($ $$) directly — only the tags above.
   - Use standard LaTeX commands inside the tags: \\frac{a}{b}, \\sqrt{x}, x^{n}, x_{i}, \\times, \\div, \\pi, \\theta, \\sum, \\int, \\leq, \\geq, \\neq, \\approx, \\infty, \\text{...}.
   - Do NOT translate variable names, LaTeX commands, or mathematical symbols into ${target}. Only the surrounding narrative prose should be in ${target}.

Provide the response in the following JSON format:
{
  "translatedText": "The translated content in ${target}, with every math expression wrapped in ${MATH_OPEN} and ${MATH_CLOSE}",
  "explanation": "Briefly note any non-obvious terminology choices you made (canonical NCERT term, regional variant picked, etc.) — optional"
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

  const systemInstruction = `You are an educational consultant specializing in the NCERT curriculum.
Analyze the provided educational content for ${grade || 'the given grade'} ${subject || ''}.

Provide:
1. Key Concepts: 3-5 core concepts covered (short plain-text phrases, in English).
2. Vocabulary: 3-5 important terms. For each, give the English word, the canonical NCERT-equivalent term in ${target} (in the native script of ${target}), and a one-line definition in English. Look up the established term used in ${target}-medium NCERT textbooks rather than transliterating.
3. NCERT Alignment: A brief note on how this aligns with NCERT standards for this grade.
4. Suggested Activities: 1-2 classroom activities related to this content.

Keep these analysis fields as plain text (no LaTeX markers, no markdown). Return JSON only.

Return the response in JSON format:
{
  "keyConcepts": ["concept1", "concept2"],
  "vocabulary": [{"english": "word", "hindi": "term in ${target} script", "definition": "meaning"}],
  "ncertAlignment": "alignment note",
  "suggestedActivities": ["activity1"]
}
Note: the JSON key "hindi" is kept as-is for compatibility, but the value should be the term in ${target}.`;

  return callGemini(systemInstruction, content);
}
