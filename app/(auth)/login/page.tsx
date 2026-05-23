import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in · Veridigits",
};

const NOTICES: Record<string, string> = {
  invalid_confirmation:
    "That confirmation link is invalid or expired. Sign in below or request a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string; email?: string }>;
}) {
  const { redirect, error, email } = await searchParams;
  const notice = error && NOTICES[error] ? NOTICES[error] : undefined;
  return (
    <LoginForm
      initialRedirect={redirect}
      initialNotice={notice}
      initialEmail={email}
    />
  );
}
