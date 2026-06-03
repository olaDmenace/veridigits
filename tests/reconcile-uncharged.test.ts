import { describe, expect, it } from "vitest";
import { unchargedRetryCutoffIso } from "@/lib/inngest/reconcile-uncharged";

describe("unchargedRetryCutoffIso", () => {
  it("is 7 days before now", () => {
    const now = Date.UTC(2026, 5, 10, 0, 0, 0); // 2026-06-10
    const cutoff = new Date(unchargedRetryCutoffIso(now)).getTime();
    expect(now - cutoff).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns an ISO string", () => {
    expect(unchargedRetryCutoffIso(Date.now())).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });
});
