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
}

export interface TranslateOutput {
  translatedText: string;
  explanation: string;
}

export interface AnalyzeInput {
  content: string;
  grade?: string;
  subject?: string;
}

export interface AnalyzeOutput {
  keyConcepts?: string[];
  vocabulary?: { english: string; hindi: string; definition: string }[];
  ncertAlignment?: string;
  suggestedActivities?: string[];
}

export async function translate(input: TranslateInput): Promise<TranslateOutput> {
  const { content, grade, subject, contentType, additionalContext } = input;

  const systemInstruction = `You are an expert educational content developer and translator specializing in the Indian NCERT curriculum.
Your task is to translate educational content from English to Hindi.

CRITICAL GUIDELINES:
1. CONTEXTUAL TRANSLATION: Do not perform word-to-word translation. Focus on conveying the exact pedagogical intent and concept in natural, academic Hindi.
2. GRADE APPROPRIATENESS: Use vocabulary and sentence structures suitable for the target grade. If the grade is provided in the context, adapt to it intelligently.
   - For lower grades (KG-5), use simpler, more descriptive Hindi.
   - For middle grades (6-8), introduce standard academic terminology used in NCERT textbooks.
   - For secondary grades (9-12), use precise technical and formal Hindi as per official curriculum standards.
3. SUBJECT SPECIFICITY: Use correct terminology for the target subject. For example, in Maths, use 'गुणनफल' for product, 'त्रिभुज' for triangle, etc.
4. CONTENT TYPE: Adapt the translation based on the content type (e.g., Question, Explanation, Option).
   - If it's a 'Question', ensure the interrogative tone is maintained.
   - If it's an 'MCQ' or 'Option', translate clearly and concisely.
   - If it's a 'Paragraph' or 'Explanation', maintain the flow of information.
5. NCERT ALIGNMENT: Follow the linguistic style and terminology defined in NCERT Hindi medium textbooks for the respective grade and subject.
6. FORMATTING: Return the translation in Markdown format.
7. MATHEMATICAL EXPRESSIONS (CRITICAL):
   - Wrap EVERY mathematical expression, equation, variable, number-with-unit, or symbolic term in the exact tags ${MATH_OPEN} and ${MATH_CLOSE}.
   - Example: ${MATH_OPEN}125{t^3} + 8 + 150{t^2} + 60t${MATH_CLOSE}
   - These tags will be automatically converted to proper LaTeX delimiters and rendered as typeset math.
   - Do NOT use backslash-parenthesis (\\( \\)) or dollar signs ($ $$) directly — only the tags above.
   - Use standard LaTeX commands inside the tags: \\frac{a}{b}, \\sqrt{x}, x^{n}, x_{i}, \\times, \\div, \\pi, \\theta, \\sum, \\int, \\leq, \\geq, \\neq, \\approx, \\infty, \\text{...}.
   - Do NOT translate variable names, LaTeX commands, or mathematical symbols into Hindi — only the surrounding narrative prose should be in Hindi.

Provide the response in the following JSON format:
{
  "translatedText": "The translated content in Hindi, with every math expression wrapped in ${MATH_OPEN} and ${MATH_CLOSE}",
  "explanation": "Briefly explain any specific terminology choices made to align with the grade level (optional)"
}`;

  let prompt = `Translate the following content.`;
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
  const { content, grade, subject } = input;

  const systemInstruction = `You are an educational consultant specializing in the NCERT curriculum.
Analyze the provided educational content for ${grade || 'the given grade'} ${subject || ''}.

Provide:
1. Key Concepts: 3-5 core concepts covered (short plain-text phrases).
2. Vocabulary: 3-5 important terms with their English word, Hindi translation, and a simple definition.
3. NCERT Alignment: A brief note on how this aligns with NCERT standards for this grade.
4. Suggested Activities: 1-2 classroom activities related to this content.

Keep these analysis fields as plain text (no LaTeX markers, no markdown). Return JSON only.

Return the response in JSON format:
{
  "keyConcepts": ["concept1", "concept2"],
  "vocabulary": [{"english": "word", "hindi": "शब्द", "definition": "meaning"}],
  "ncertAlignment": "alignment note",
  "suggestedActivities": ["activity1"]
}`;

  return callGemini(systemInstruction, content);
}
