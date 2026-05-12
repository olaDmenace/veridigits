# Veridigits email templates

Source-of-truth copy of the auth emails Supabase sends on our behalf. Paste
these into the Supabase dashboard at:

https://supabase.com/dashboard/project/asttwswjqffuwupdmrqr/auth/templates

Each template has a `subject` line and an HTML body. Supabase exposes
Go-template-style variables — the ones we use:

| Variable | What it is |
|---|---|
| `{{ .ConfirmationURL }}` | The verification link (signup confirm, magic link, reset) |
| `{{ .Email }}` | The recipient's email |
| `{{ .SiteURL }}` | Whatever you set as "Site URL" in URL config |
| `{{ .Token }}` | The 6-digit OTP, if you use it instead of the link |

## Files

| File | Map to template |
|---|---|
| `confirm-signup.html` | **Confirm signup** |
| `magic-link.html` | **Magic Link** (we don't use magic links, but Supabase requires a template) |
| `reset-password.html` | **Reset Password** |
| `change-email.html` | **Change Email Address** |
| `invite-user.html` | **Invite user** (admin invitation; not exposed to end users yet) |

## Subjects

Set these on each template's "Subject" field in the Supabase UI:

- Confirm signup → `Confirm your Veridigits account`
- Reset Password → `Reset your Veridigits password`
- Change Email → `Confirm your new Veridigits email`
- Magic Link → `Your Veridigits sign-in link` (unused)
- Invite user → `You've been invited to Veridigits`

## Sender (via Resend SMTP)

In the dashboard, **Project Settings → Auth → SMTP Settings**:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | `<your RESEND_API_KEY>` |
| Sender name | `Veridigits` |
| Sender email | `onboarding@resend.dev` (testing) or `noreply@<your-verified-domain>` |

Without a verified domain on Resend, you're limited to sending from
`onboarding@resend.dev`. The email body still uses Veridigits branding,
but the From address won't match. Once you have a real domain:

1. Add it to Resend at https://resend.com/domains
2. Add the DNS records they give you
3. Wait for verification (minutes)
4. Update Supabase SMTP `Sender email` to `noreply@<your-domain>`

## When you change copy

Re-paste from these files. Don't edit in the Supabase UI directly — drift
is hard to track. Treat the files in this directory as canonical.
