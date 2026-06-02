import Link from "next/link";
import { Topbar } from "@/components/topbar";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="theme-dark">
      <Topbar
        links={[
          { href: "/legal/terms", label: "Terms" },
          { href: "/legal/privacy", label: "Privacy" },
          { href: "/legal/aup", label: "Acceptable use" },
        ]}
        primary={
          <Link href="/login" className="btn btn-secondary btn-sm">
            Sign in
          </Link>
        }
      />

      <main className="page section legal-prose">{children}</main>
    </div>
  );
}
