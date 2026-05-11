export const metadata = { title: "Terms of Service · Veridigits" };

export default function TermsPage() {
  return (
    <article>
      <div className="meta-line">Last updated · Draft v0.1</div>
      <h1>Terms of Service</h1>
      <div className="draft-banner">
        <strong>Draft.</strong> This page is a working placeholder. Replace
        with lawyer-reviewed copy before public launch.
      </div>

      <p>
        These Terms govern your use of Veridigits (&quot;the Service&quot;).
        By creating an account or using any feature, you agree to be bound by
        them. If you do not agree, do not use the Service.
      </p>

      <h2>1. The Service</h2>
      <p>
        Veridigits provides access to temporary phone numbers from third-party
        OTP aggregators. We resell capacity — we do not own the underlying
        SIMs or carrier infrastructure. Numbers are intended for receiving
        SMS verification codes.
      </p>

      <h2>2. Account &amp; anonymity</h2>
      <p>
        We require only an email and a password. We do not request, collect,
        or verify government identification, real names, or physical
        addresses. You are responsible for safeguarding your credentials and
        wallet.
      </p>

      <h2>3. Wallet and payments</h2>
      <p>
        Funds are added to your wallet by sending supported cryptocurrency to
        a one-time deposit address. Once a deposit is confirmed by the
        network, it is irreversible. Wallet balances are non-refundable
        outside automatic refunds for cancelled or expired orders.
      </p>

      <h2>4. Your use of numbers</h2>
      <p>
        You agree that:
      </p>
      <ul>
        <li>
          You will not use the Service to commit fraud, harassment, money
          laundering, or any unlawful act.
        </li>
        <li>
          Many target services prohibit the use of temporary numbers in their
          terms. <strong>Compliance with those third-party terms is your
          responsibility</strong>; Veridigits is not a party to your
          relationship with them.
        </li>
        <li>
          You will not resell, redistribute, or proxy access to numbers
          purchased through the Service without our prior written agreement.
        </li>
      </ul>

      <h2>5. Cancellations &amp; refunds</h2>
      <p>
        Activation orders can be cancelled within two minutes of purchase
        provided no SMS has been received. Cancelled or expired orders
        receive an automatic full refund to your wallet. SMS-received orders
        are non-refundable.
      </p>

      <h2>6. No warranty</h2>
      <p>
        The Service is provided &quot;as is&quot;. We do not guarantee
        delivery of any specific SMS, the availability of any specific number
        or country, or the success of verification with any specific third
        party. Upstream inventory changes in real time.
      </p>

      <h2>7. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, our aggregate liability for
        any claim arising out of the Service is limited to the wallet balance
        held in your account at the time the claim arose.
      </p>

      <h2>8. Termination</h2>
      <p>
        We may suspend or terminate accounts that violate these Terms or the
        Acceptable Use Policy, that exhibit abusive automation patterns, or
        that put the platform at risk with upstream providers. On
        termination, we will refund any remaining wallet balance net of any
        chargebacks or fraud-related debits.
      </p>

      <h2>9. Changes</h2>
      <p>
        We may revise these Terms. Material changes will be announced in your
        dashboard. Continued use after a change constitutes acceptance.
      </p>
    </article>
  );
}
