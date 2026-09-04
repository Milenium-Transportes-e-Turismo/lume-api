-- The legacy transition ledger is append-only. The reconstruction foundation
-- needs one controlled backfill after adding thread_id and service_session_id,
-- so remove the legacy guard only while upgrading a pre-foundation database.
DO $$
BEGIN
  IF to_regclass('public.whatsapp_conversation_transitions') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'whatsapp_conversation_transitions'
         AND column_name = 'thread_id'
     )
  THEN
    EXECUTE 'DROP TRIGGER IF EXISTS "whatsapp_transitions_append_only" ON "whatsapp_conversation_transitions"';
  END IF;
END;
$$;
