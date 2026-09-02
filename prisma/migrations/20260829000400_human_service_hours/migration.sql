-- Human availability controls handoff expectations only. AI availability is
-- intentionally not scheduled. Existing tenants remain effectively always
-- open until a default schedule is configured.

ALTER TABLE "companies"
  ADD COLUMN "human_service_hours" JSONB,
  ADD COLUMN "off_hours_handoff_message" VARCHAR(500) NOT NULL
    DEFAULT 'Recebemos sua solicitação e ela já está na fila de atendimento. Retornaremos no próximo período disponível.';

ALTER TABLE "tenant_departments"
  ADD COLUMN "human_service_hours_override" JSONB;

ALTER TABLE "service_sessions"
  ADD COLUMN "off_hours_handoff_notified_at" TIMESTAMPTZ(3);

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_human_service_hours_object_check" CHECK (
    "human_service_hours" IS NULL
    OR jsonb_typeof("human_service_hours") = 'object'
  ),
  ADD CONSTRAINT "companies_off_hours_handoff_message_check" CHECK (
    length(btrim("off_hours_handoff_message")) BETWEEN 1 AND 500
  );

ALTER TABLE "tenant_departments"
  ADD CONSTRAINT "tenant_departments_human_service_hours_object_check" CHECK (
    "human_service_hours_override" IS NULL
    OR jsonb_typeof("human_service_hours_override") = 'object'
  );

COMMENT ON COLUMN "companies"."human_service_hours" IS
  'Tenant default human attendance schedule; NULL preserves the pre-feature always-open behavior.';
COMMENT ON COLUMN "tenant_departments"."human_service_hours_override" IS
  'Optional override for the tenant human attendance schedule.';
COMMENT ON COLUMN "service_sessions"."off_hours_handoff_notified_at" IS
  'Set atomically when the single off-hours handoff message is claimed.';
