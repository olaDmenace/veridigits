import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="theme-dark min-h-dvh flex flex-col">
      {/* main element gets the global gutter from globals.css; just need
          vertical breathing room + centering here. */}
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="w-full max-w-[420px] flex flex-col items-stretch gap-8">
          <Link href="/" className="logo self-center">
            <span className="mark">v.</span>
            <span>
              veridigits<span className="dot">.</span>
            </span>
          </Link>
          {children}
        </div>
      </div>
    </main>
  );
}
