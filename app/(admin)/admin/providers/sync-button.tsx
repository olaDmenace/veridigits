"use client";

import { useState, useTransition } from "react";
import { triggerCatalogSync } from "./actions";

export function SyncButton({ providerSlug }: { providerSlug?: string }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function fire() {
    setFeedback(null);
    start(async () => {
      const result = await triggerCatalogSync(providerSlug);
      setFeedback(
        result.ok
          ? "Queued. Check Inngest dashboard for run status."
          : result.error,
      );
      setTimeout(() => setFeedback(null), 4000);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={fire}
        disabled={pending}
      >
        {pending
          ? "Queuing…"
          : `Sync ${providerSlug ?? "all providers"}`}
      </button>
      {feedback ? <span className="caption">{feedback}</span> : null}
    </div>
  );
}
