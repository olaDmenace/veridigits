import { SignupForm } from "./signup-form";

export const metadata = {
  title: "Create account · Veridigits",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; redirect?: string }>;
}) {
  const { next, redirect } = await searchParams;
  // Accept either `next` (our convention) or `redirect` (login's convention) so
  // a deep link survives bouncing between the two auth screens.
  const target = next ?? redirect;
  return <SignupForm initialNext={target} />;
}
