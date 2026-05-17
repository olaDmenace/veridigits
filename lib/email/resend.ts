/**
 * Thin wrapper around Resend's REST API.
 *
 * We don't pull in the @resend/node SDK because the API is one POST and
 * the SDK adds dependency weight + bundling overhead. fetch is enough.
 *
 * Env: RESEND_API_KEY must be set. From-address defaults to Resend's
 * sandbox sender; once veridigits.com is verified on Resend, callers
 * can pass a `from` override or we bump the default.
 */

const RESEND_API_URL = "https://api.resend.com/emails";

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not set" };
  }

  const recipients = Array.isArray(params.to) ? params.to : [params.to];
  if (recipients.length === 0) {
    return { ok: false, error: "no recipients" };
  }

  // Default sender: Resend's sandbox address. Swap once veridigits.com
  // DKIM/SPF clear in Resend → "Veridigits <noreply@veridigits.com>".
  const from = params.from ?? "Veridigits <onboarding@resend.dev>";

  const body: Record<string, unknown> = {
    from,
    to: recipients,
    subject: params.subject,
    html: params.html,
  };
  if (params.text) body.text = params.text;
  if (params.replyTo) body.reply_to = params.replyTo;
  if (params.tags) {
    body.tags = Object.entries(params.tags).map(([name, value]) => ({
      name,
      value,
    }));
  }

  let res: Response;
  try {
    res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network error",
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Resend ${res.status}: ${text.slice(0, 300)}`,
    };
  }

  const parsed = (await res.json().catch(() => ({}))) as { id?: string };
  return { ok: true, id: parsed.id };
}

/**
 * Comma-separated list of admin email addresses from ADMIN_EMAILS env.
 * Empty array if unset — callers should branch on that.
 */
export function getAdminRecipients(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes("@"));
}
