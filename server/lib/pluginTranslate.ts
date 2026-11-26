import { pluginUser, pluginRefusal } from './pluginAuth.js';
import { validate, translateLessonText, pluginGlossary } from './lessonText.js';
import { logPluginUsage } from './usageLog.js';

// POST /api/plugin-translate — shared by the Vercel function and the Express server.
// Body: { code, user: {email, name, org_id, org_name, source}, lesson?, targetLanguage, grade?, subject?,
//         context?, strings: { key: English } }
// Reply: LessonTextResult (translated strings, findings, glossary report, usage), or { error }.

export async function handlePluginTranslate(body: any): Promise<{ status: number; json: any }> {
  const started = Date.now();
  const user = pluginUser(body);
  const refusal = pluginRefusal(body, user);
  if (refusal) return { status: refusal.status, json: { error: refusal.error } };

  let req;
  try {
    req = validate(body);
  } catch (err: any) {
    return { status: err.status || 400, json: { error: err.message } };
  }
  const lesson = String(body?.lesson || '').replace(/[^\w .\-()/]/g, '').slice(0, 80);
  const purpose = `translate lesson text to ${req.targetLanguage}`;
  try {
    const g = await pluginGlossary(req.targetLanguage);
    const result = await translateLessonText(req, g);
    await logPluginUsage(user, result.usage, { purpose, lesson, status: 200, seconds: (Date.now() - started) / 1000 });
    return { status: 200, json: result };
  } catch (err: any) {
    console.error('[plugin-translate]', err?.message || err);
    await logPluginUsage(user, [], { purpose, lesson, status: 500, seconds: (Date.now() - started) / 1000 });
    return { status: 500, json: { error: 'Failed to translate the lesson text. Please try again.' } };
  }
}
