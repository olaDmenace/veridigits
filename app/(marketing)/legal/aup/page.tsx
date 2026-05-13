export const metadata = { title: "Acceptable Use Policy · Veridigits" };

export default function AcceptableUsePage() {
  return (
    <article>
      <div className="meta-line">Last updated · Draft v0.1</div>
      <h1>Acceptable Use Policy</h1>
      <div className="draft-banner">
        <strong>Draft.</strong> This page is a working placeholder. Replace
        with lawyer-reviewed copy before public launch.
      </div>

      <p>
        Veridigits is for legitimate, lawful use only. The behaviours below
        will result in account suspension, forfeiture of remaining balance,
        and where appropriate, report to the relevant authorities.
      </p>

      <h2>Strictly prohibited</h2>
      <ul>
        <li>
          <strong>Fraud or impersonation.</strong> Using a number to
          impersonate another person, to circumvent fraud detection, or to
          commit financial fraud.
        </li>
        <li>
          <strong>Illegal activity.</strong> Any use of the Service that
          violates the law of your jurisdiction or the jurisdiction of the
          target service.
        </li>
        <li>
          <strong>Harassment, doxing, stalking.</strong> Using a number to
          target an individual with intimidation or unwanted contact.
        </li>
        <li>
          <strong>Money laundering.</strong> Using the wallet as a layer in
          a money-laundering chain.
        </li>
        <li>
          <strong>Resale without agreement.</strong> Reselling, repackaging,
          or proxying access to numbers without a written reseller
          agreement.
        </li>
        <li>
          <strong>Attacks on our upstream network.</strong> Patterns that put
          our number-supply relationships at risk: rapid-fire cancels,
          ban-rate spikes, or coordinated abuse.
        </li>
      </ul>

      <h2>Automated abuse signals</h2>
      <p>
        Our platform watches for the following and may automatically
        rate-limit or suspend offending accounts:
      </p>
      <ul>
        <li>More than 50 number purchases per hour.</li>
        <li>More than 20 cancelled orders per hour.</li>
        <li>
          Single wallet address funding many accounts in a short window.
        </li>
        <li>
          Rapid repeat purchases of the same service + country
          (credential-stuffing pattern).
        </li>
      </ul>

      <h2>Target-service terms</h2>
      <p>
        Several third-party services (including, without limitation, Google,
        WhatsApp, and Meta products) prohibit the use of temporary numbers
        in their own terms of service. Veridigits does not police compliance
        with those third-party terms. Using a Veridigits number to interact
        with such a service is at your own risk and may result in your
        target-service account being suspended or banned. We bear no
        liability for those outcomes.
      </p>

      <h2>Reporting abuse</h2>
      <p>
        If you believe a Veridigits user is abusing the Service: email
        <strong> abuse@veridigits.example</strong> (replace before launch)
        with relevant evidence. We review every report; we do not
        retroactively log identifiable data, so investigations are
        forward-looking.
      </p>
    </article>
  );
}
