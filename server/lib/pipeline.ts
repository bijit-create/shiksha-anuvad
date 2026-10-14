import { translate, TranslateInput, TranslateOutput } from './gemini.js';
import { AuthUser } from './auth.js';
import { userClient } from './supabase.js';
import {
  getGlossary, gradeNumber, bandOf, r1Tokens, matchTerms, buildGlossaryBlock, checkOutput, GlossaryReport,
} from './glossary.js';

export interface TranslateForUserOutput extends TranslateOutput {
  glossary?: GlossaryReport;
}

/**
 * One translation request: look up glossary terms in the source, translate with them locked in,
 * check the output for those terms and for Latin tokens R1 does not allow, and log what was applied.
 */
export async function translateForUser(user: AuthUser, input: TranslateInput): Promise<TranslateForUserOutput> {
  const language = (input.targetLanguage || 'Hindi').trim();
  const g = await getGlossary(user.token, language);
  const grade = gradeNumber(input.grade);
  const band = bandOf(grade);

  let out: TranslateOutput;
  let report: GlossaryReport | undefined;
  if (g) {
    const allowed = r1Tokens(g, band);
    const matches = matchTerms(input.content, g, grade, input.subject, allowed);
    out = await translate(input, buildGlossaryBlock(language, g, matches, band, allowed));
    report = checkOutput(out.translatedText, matches, allowed, g.version, band);
  } else {
    out = await translate(input);
  }

  // Awaited, because a serverless function may stop once it responds; a logging failure never fails the request.
  await userClient(user.token)
    .from('translation_log')
    .insert({
      user_email: user.email,
      language,
      grade: input.grade || null,
      subject: input.subject || null,
      content_type: input.contentType || null,
      source_chars: input.content.length,
      terms_applied: report ? report.terms : [],
      model: out.usage ? `${out.usage.model} in=${out.usage.inputTokens} out=${out.usage.outputTokens}` : null,
    })
    .then(({ error }) => { if (error) console.warn('[log]', error.message); }, (e: any) => console.warn('[log]', e?.message || e));

  return { ...out, glossary: report };
}
