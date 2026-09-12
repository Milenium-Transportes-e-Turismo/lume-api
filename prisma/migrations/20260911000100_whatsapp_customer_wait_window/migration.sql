-- Preserve lifecycle timestamp integrity while allowing policy-specific windows.
-- Existing thirty-minute sessions remain valid; new customer waits use the
-- configured one-hour window and explicit resolutions may close immediately.
ALTER TABLE "service_sessions"
  DROP CONSTRAINT "service_sessions_closing_window_check",
  ADD CONSTRAINT "service_sessions_closing_window_check"
    CHECK (
      (
        "status" = 'closing'::"ServiceSessionStatus"
        AND "closing_started_at" IS NOT NULL
        AND "closing_deadline_at" IS NOT NULL
        AND "closing_deadline_at" >= "closing_started_at"
      )
      OR
      (
        "status" <> 'closing'::"ServiceSessionStatus"
        AND "closing_started_at" IS NULL
        AND "closing_deadline_at" IS NULL
      )
    );
