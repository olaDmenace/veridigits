// Provision MTN MoMo SANDBOX credentials (API user + API key) from a
// Collections subscription key. Run once, then paste the printed values into
// .env.local.
//
//   1. Sign up at https://momodeveloper.mtn.com, subscribe to "Collections",
//      copy the Primary Key.
//   2. Put it in .env.local as MTN_MOMO_SUBSCRIPTION_KEY=...
//   3. node scripts/momo-provision.mjs
//
// This only works against the sandbox. Production keys are issued by MTN
// through the Partner portal after Go-Live (KYC).

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BASE = process.env.MTN_MOMO_BASE_URL || "https://sandbox.momodeveloper.mtn.com";

function fromEnvLocal(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = readFileSync(".env.local", "utf8");
    const line = env
      .split(/\r?\n/)
      .filter((l) => l.startsWith(key + "="))
      .map((l) => l.slice(key.length + 1).trim())
      .filter(Boolean)
      .pop();
    return line || "";
  } catch {
    return "";
  }
}

const subKey = fromEnvLocal("MTN_MOMO_SUBSCRIPTION_KEY");
if (!subKey) {
  console.error(
    "Missing MTN_MOMO_SUBSCRIPTION_KEY (the Collections Primary Key from momodeveloper.mtn.com).",
  );
  process.exit(1);
}

const appUrl = fromEnvLocal("NEXT_PUBLIC_APP_URL") || "https://veridigits.com";
let callbackHost = "veridigits.com";
try {
  callbackHost = new URL(appUrl).host || callbackHost;
} catch {
  /* keep default */
}

const apiUserId = randomUUID();

async function main() {
  // 1) Create API user.
  const createRes = await fetch(`${BASE}/v1_0/apiuser`, {
    method: "POST",
    headers: {
      "X-Reference-Id": apiUserId,
      "Ocp-Apim-Subscription-Key": subKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ providerCallbackHost: callbackHost }),
  });
  if (createRes.status !== 201) {
    const t = await createRes.text();
    console.error(`create apiuser failed ${createRes.status}: ${t.slice(0, 200)}`);
    process.exit(1);
  }

  // 2) Create API key for that user.
  const keyRes = await fetch(`${BASE}/v1_0/apiuser/${apiUserId}/apikey`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": subKey },
  });
  const keyText = await keyRes.text();
  if (!keyRes.ok) {
    console.error(`create apikey failed ${keyRes.status}: ${keyText.slice(0, 200)}`);
    process.exit(1);
  }
  const { apiKey } = JSON.parse(keyText);

  console.log("\nSandbox credentials provisioned. Add to .env.local:\n");
  console.log(`MTN_MOMO_API_USER=${apiUserId}`);
  console.log(`MTN_MOMO_API_KEY=${apiKey}`);
  console.log(`MTN_MOMO_TARGET_ENV=sandbox`);
  console.log(`\n(callbackHost registered: ${callbackHost})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
