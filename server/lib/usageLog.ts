import { GeminiUsage } from './gemini.js';
import { PluginUser } from './pluginAuth.js';

// One row per model call in the team's central Gemini usage sheet, through the Apps Script gateway's
// log-only mode (GATEWAY_LOG_URL = its /exec address). Awaited, because a serverless function may stop
// once it responds; a logging failure never fails the request.

export async function logPluginUsage(
  user: PluginUser, usage: GeminiUsage[], extra: { purpose: string; lesson?: string; status: number; seconds: number },
): Promise<void> {
  const url = (process.env.GATEWAY_LOG_URL || '').trim();
  const code = (process.env.PLUGIN_CODE || '').trim();
  if (!url || !code) return;
  for (const u of usage.length ? usage : [null]) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          user: { email: user.email, name: user.name, org_id: user.orgId, org_name: user.orgName, source: user.source },
          log: {
            model: u?.model || '',
            purpose: extra.purpose,
            lesson: extra.lesson || '',
            status: extra.status,
            seconds: extra.seconds,
            input_tokens: u?.inputTokens ?? '',
            output_tokens: u?.outputTokens ?? '',
            total_tokens: u?.totalTokens ?? '',
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const t = await r.text();
      if (!t.includes('"status":200')) console.warn('[usage-log] refused:', t.slice(0, 160));
    } catch (err: any) {
      console.warn('[usage-log] failed:', err?.message || err);
    }
  }
}
