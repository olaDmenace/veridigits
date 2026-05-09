import Link from "next/link";

export const metadata = { title: "Payment received · Veridigits" };

export default function TopupSuccessPage() {
  return (
    <div
      className="card flex flex-col items-center gap-5 text-center"
      style={{ padding: 56, maxWidth: 520 }}
    >
      <div className="eyebrow">Payment received</div>
      <h1 className="h3">Funds are on their way to your wallet.</h1>
      <p className="body" style={{ maxWidth: 380 }}>
        Confirmation depends on the network — your dashboard updates the
        moment the deposit clears.
      </p>
      <div className="flex gap-3">
        <Link href="/dashboard" className="btn btn-primary">
          <span className="dot"></span>
          Back to dashboard
        </Link>
        <Link href="/buy" className="btn btn-secondary">
          Buy a number
        </Link>
      </div>
    </div>
  );
}
