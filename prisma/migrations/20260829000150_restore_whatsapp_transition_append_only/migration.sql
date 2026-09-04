-- Reinstate the legacy append-only invariant immediately after the controlled
-- reconstruction backfill. Recreating the trigger is safe for databases where
-- the foundation migration had already been deployed.
DROP TRIGGER IF EXISTS "whatsapp_transitions_append_only"
ON "whatsapp_conversation_transitions";

CREATE TRIGGER "whatsapp_transitions_append_only"
BEFORE UPDATE OR DELETE ON "whatsapp_conversation_transitions"
FOR EACH ROW EXECUTE FUNCTION "reject_whatsapp_transition_mutation"();
