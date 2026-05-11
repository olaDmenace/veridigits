export const metadata = { title: "Privacy · Veridigits" };

export default function PrivacyPage() {
  return (
    <article>
      <div className="meta-line">Last updated · Draft v0.1</div>
      <h1>Privacy Policy</h1>
      <div className="draft-banner">
        <strong>Draft.</strong> This page is a working placeholder. Replace
        with lawyer-reviewed copy before public launch.
      </div>

      <p>
        Anonymity is the product. This policy describes the minimal data we
        collect, why we collect it, and how long we keep it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Email address.</strong> Used for transactional email
          (receipts, password reset) and as your account identifier. You can
          use any email service, including disposable ones.
        </li>
        <li>
          <strong>Password hash.</strong> Stored using bcrypt via Supabase
          Auth. We never store, see, or log the plaintext password.
        </li>
        <li>
          <strong>Wallet ledger.</strong> Every deposit, purchase, refund,
          and adjustment. Required to operate the wallet.
        </li>
        <li>
          <strong>Order history.</strong> Service, country, phone number,
          status, and received SMS for each purchase you make. Required for
          you to receive the codes you paid for.
        </li>
        <li>
          <strong>IP and browser fingerprint at signup and during top-up
          flows.</strong> Held briefly for anti-fraud. See retention below.
        </li>
      </ul>

      <h2>What we do not collect</h2>
      <ul>
        <li>Government ID, photo ID, or any KYC document.</li>
        <li>Real names, physical addresses, or phone numbers belonging to you.</li>
        <li>
          Behavioural analytics tied to identity. Aggregate analytics, if
          any, are decoupled from your account.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        We set first-party session cookies for authentication. We do not use
        third-party advertising cookies, cross-site trackers, or fingerprint
        analytics.
      </p>

      <h2>Third parties</h2>
      <ul>
        <li>
          <strong>Supabase</strong> hosts our database and authentication.
        </li>
        <li>
          <strong>NOWPayments</strong> processes crypto deposits. Your wallet
          address and transaction hash are visible to them.
        </li>
        <li>
          <strong>5SIM</strong> (and other OTP aggregators) provide the phone
          numbers. They see the verification request from the target service;
          they do not see your identity or our user mapping.
        </li>
      </ul>

      <h2>Retention</h2>
      <ul>
        <li>
          <strong>Wallet ledger, order history, received SMS:</strong> kept
          for the life of your account.
        </li>
        <li>
          <strong>IP / fingerprint at signup and top-up:</strong> retained
          for 30 days, then deleted automatically.
        </li>
        <li>
          <strong>On account deletion:</strong> all personal data is purged
          within 14 days. Aggregate ledger sums are retained for accounting
          for 7 years.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can delete your account from <strong>Settings</strong>. We do not
        log the reason; the deletion is honoured regardless.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions: <strong>privacy@veridigits.example</strong> (replace before launch).
      </p>
    </article>
  );
}
