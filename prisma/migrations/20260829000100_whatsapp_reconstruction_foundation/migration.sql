-- CreateEnum
CREATE TYPE "WhatsAppChannelOrganizationalStatus" AS ENUM ('pending', 'active', 'cancelled', 'disabled');

-- CreateEnum
CREATE TYPE "WhatsAppChannelConnectionStatus" AS ENUM ('unknown', 'connected', 'disconnected', 'connecting', 'error');

-- CreateEnum
CREATE TYPE "WhatsAppChannelRoutingMode" AS ENUM ('department-owned', 'general-triage');

-- CreateEnum
CREATE TYPE "ServiceSessionStatus" AS ENUM ('open', 'waiting-customer', 'waiting-human', 'paused-by-higher-priority', 'closing', 'closed');

-- CreateEnum
CREATE TYPE "ServiceSessionControlMode" AS ENUM ('ai', 'human');

-- CreateEnum
CREATE TYPE "ServiceSessionPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "ServiceSessionPrioritySource" AS ENUM ('ai-agent', 'human-user', 'system', 'import');

-- CreateEnum
CREATE TYPE "QueueAssignmentStrategy" AS ENUM ('manual', 'round-robin', 'least-load');

-- CreateEnum
CREATE TYPE "ServiceAssignmentStatus" AS ENUM ('active', 'released', 'transferred', 'returned-to-queue');

-- CreateEnum
CREATE TYPE "ServiceAssignmentSource" AS ENUM ('manual', 'automatic', 'external-human', 'legacy-backfill');

-- CreateEnum
CREATE TYPE "ConversationParticipantRole" AS ENUM ('customer', 'representative', 'related-person', 'unknown');

-- CreateEnum
CREATE TYPE "ServiceCaseType" AS ENUM ('quote', 'billing', 'documentation', 'other');

-- CreateEnum
CREATE TYPE "ServiceCaseStatus" AS ENUM ('open', 'paused', 'resolved', 'cancelled');

-- CreateEnum
CREATE TYPE "ContinuityClassification" AS ENUM ('continuation', 'new-subject', 'uncertain');

-- CreateEnum
CREATE TYPE "ContinuityFallbackAction" AS ENUM ('reopen-previous', 'create-new', 'route-current');

-- CreateEnum
CREATE TYPE "WhatsAppMessageActorType" AS ENUM ('customer', 'human-user', 'external-human', 'ai-agent', 'system');

-- CreateEnum
CREATE TYPE "WhatsAppMessageSource" AS ENUM ('lume-web', 'whatsapp-app', 'automation', 'history-import', 'system');

-- CreateEnum
CREATE TYPE "MutationActorType" AS ENUM ('human-user', 'external-human', 'ai-agent', 'system', 'service');

-- CreateEnum
CREATE TYPE "LumeAgentType" AS ENUM ('orchestrator', 'customer-service', 'specialist', 'silent-classifier', 'supervisor');

-- CreateEnum
CREATE TYPE "LumeAgentStatus" AS ENUM ('active', 'disabled', 'archived');

-- CreateEnum

-- CreateEnum
CREATE TYPE "AgentPromptKind" AS ENUM ('platform', 'tenant-instructions');

-- CreateEnum
CREATE TYPE "AgentVersionStatus" AS ENUM ('draft', 'active', 'superseded', 'archived');

-- CreateEnum
CREATE TYPE "AgentAutonomyLevel" AS ENUM ('read', 'safe-write', 'sensitive-write');

-- CreateEnum
CREATE TYPE "AgentExecutionSource" AS ENUM ('whatsapp', 'internal', 'automation', 'media-interpretation');

-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'denied');

-- CreateEnum
CREATE TYPE "AgentExecutionAttemptStatus" AS ENUM ('running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentToolCallStatus" AS ENUM ('requested', 'allowed', 'denied', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "MediaAssetType" AS ENUM ('audio', 'image', 'document', 'spreadsheet', 'location', 'contact', 'video', 'other');

-- CreateEnum
CREATE TYPE "MediaProcessingStatus" AS ENUM ('stored', 'processing', 'interpreted', 'failed', 'unsupported');

-- CreateEnum
CREATE TYPE "MediaInterpretationStatus" AS ENUM ('pending', 'succeeded', 'failed', 'unsupported');

-- CreateEnum
CREATE TYPE "KnowledgeScope" AS ENUM ('tenant', 'department', 'multi-department');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('customer-safe', 'internal');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentSourceType" AS ENUM ('article', 'file');

-- CreateEnum
CREATE TYPE "KnowledgeVersionStatus" AS ENUM ('draft', 'published', 'superseded', 'archived');

-- CreateEnum
CREATE TYPE "KnowledgeReviewStatus" AS ENUM ('pending', 'approved', 'rejected', 'published');

-- CreateEnum
CREATE TYPE "KnowledgeGapStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "RegistrationDataReviewSource" AS ENUM ('whatsapp', 'internal', 'automation');

-- CreateEnum
CREATE TYPE "RegistrationDataReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "WhatsAppGroupAiMode" AS ENUM ('off', 'mention-only', 'assistant', 'autonomous');

-- AlterTable
ALTER TABLE "whatsapp_channels" ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "connection_status" "WhatsAppChannelConnectionStatus" NOT NULL DEFAULT 'disconnected',
ADD COLUMN     "created_by_user_id" UUID,
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "disabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "evolution_instance_id" VARCHAR(160),
ADD COLUMN     "organizational_status" "WhatsAppChannelOrganizationalStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "routing_mode" "WhatsAppChannelRoutingMode" NOT NULL DEFAULT 'general-triage',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "thread_id" UUID;

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "actor_agent_id" UUID,
ADD COLUMN     "actor_type" "WhatsAppMessageActorType",
ADD COLUMN     "agent_execution_id" UUID,
ADD COLUMN     "media_asset_id" UUID,
ADD COLUMN     "service_session_id" UUID,
ADD COLUMN     "source" "WhatsAppMessageSource",
ADD COLUMN     "thread_id" UUID;

-- AlterTable
ALTER TABLE "whatsapp_conversation_transitions" ADD COLUMN     "service_session_id" UUID,
ADD COLUMN     "thread_id" UUID;

-- AlterTable
ALTER TABLE "quote_requests" ADD COLUMN     "case_id" UUID,
ADD COLUMN     "created_by_agent_execution_id" UUID,
ADD COLUMN     "service_session_id" UUID,
ADD COLUMN     "thread_id" UUID;

-- AlterTable
ALTER TABLE "quote_proposal_documents" ADD COLUMN     "media_asset_id" UUID,
ADD COLUMN     "service_session_id" UUID,
ADD COLUMN     "thread_id" UUID;

-- CreateTable
CREATE TABLE "whatsapp_channel_automatic_target_departments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_channel_automatic_target_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_channel_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "command_id" VARCHAR(120) NOT NULL,
    "command_fingerprint" CHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "expected_version" INTEGER NOT NULL,
    "resulting_version" INTEGER NOT NULL,
    "actor_type" "MutationActorType" NOT NULL,
    "actor_user_id" UUID,
    "actor_agent_id" UUID,
    "before_snapshot" JSONB NOT NULL,
    "after_snapshot" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_channel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_threads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source_channel_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "last_inbound_at" TIMESTAMPTZ(3),
    "last_outbound_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_queues" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "assignment_strategy" "QueueAssignmentStrategy" NOT NULL DEFAULT 'manual',
    "max_concurrent_attendances" INTEGER,
    "priority_weight" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_sessions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "source_channel_id" UUID NOT NULL,
    "current_department_id" UUID,
    "responsible_user_id" UUID,
    "queue_id" UUID,
    "related_service_session_id" UUID,
    "status" "ServiceSessionStatus" NOT NULL DEFAULT 'open',
    "control_mode" "ServiceSessionControlMode" NOT NULL DEFAULT 'ai',
    "priority" "ServiceSessionPriority" NOT NULL DEFAULT 'normal',
    "priority_reason" VARCHAR(500),
    "priority_source" "ServiceSessionPrioritySource" NOT NULL DEFAULT 'system',
    "is_foreground" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "public_continuation_code" VARCHAR(12),
    "continuation_code_expires_at" TIMESTAMPTZ(3),
    "conversation_resolved" BOOLEAN NOT NULL DEFAULT false,
    "pending_actions" JSONB NOT NULL DEFAULT '[]',
    "resolution_confirmed_by_customer" BOOLEAN NOT NULL DEFAULT false,
    "closing_started_at" TIMESTAMPTZ(3),
    "closing_deadline_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_session_assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "service_session_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "assigned_user_id" UUID,
    "queue_id" UUID,
    "assigned_by_user_id" UUID,
    "previous_assignment_id" UUID,
    "status" "ServiceAssignmentStatus" NOT NULL DEFAULT 'active',
    "source" "ServiceAssignmentSource" NOT NULL DEFAULT 'manual',
    "reason" VARCHAR(500),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_session_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_session_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "service_session_id" UUID NOT NULL,
    "command_id" VARCHAR(120) NOT NULL,
    "command_fingerprint" CHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "expected_version" INTEGER NOT NULL,
    "resulting_version" INTEGER NOT NULL,
    "actor_type" "MutationActorType" NOT NULL,
    "actor_user_id" UUID,
    "actor_agent_id" UUID,
    "before_snapshot" JSONB NOT NULL,
    "after_snapshot" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_session_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "service_session_id" UUID NOT NULL,
    "whatsapp_contact_id" UUID NOT NULL,
    "registration_id" UUID,
    "role" "ConversationParticipantRole" NOT NULL DEFAULT 'unknown',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DECIMAL(5,4),
    "identification_source" VARCHAR(80),
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_cases" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "ServiceCaseType" NOT NULL,
    "status" "ServiceCaseStatus" NOT NULL DEFAULT 'open',
    "title" VARCHAR(200),
    "external_reference" VARCHAR(160),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID,
    "created_by_agent_execution_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_session_cases" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "service_session_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_session_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_session_continuity_decisions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "command_id" VARCHAR(120) NOT NULL,
    "source_service_session_id" UUID NOT NULL,
    "target_service_session_id" UUID,
    "target_department_id" UUID,
    "agent_execution_id" UUID,
    "classification" "ContinuityClassification" NOT NULL,
    "fallback_action" "ContinuityFallbackAction",
    "confidence" DECIMAL(5,4),
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_session_continuity_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lume_agents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "type" "LumeAgentType" NOT NULL,
    "status" "LumeAgentStatus" NOT NULL DEFAULT 'active',
    "contexts" "AgentExecutionSource"[] DEFAULT ARRAY[]::"AgentExecutionSource"[],
    "customer_facing" BOOLEAN NOT NULL DEFAULT false,
    "platform_managed" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lume_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_prompt_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "kind" "AgentPromptKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AgentVersionStatus" NOT NULL DEFAULT 'draft',
    "content" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "created_by_user_id" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runtime_config_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'openai',
    "model" VARCHAR(160) NOT NULL,
    "credential_ref" VARCHAR(255) NOT NULL,
    "credential_identifier" VARCHAR(160),
    "credential_version" VARCHAR(80),
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "status" "AgentVersionStatus" NOT NULL DEFAULT 'draft',
    "created_by_user_id" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runtime_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_capabilities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "autonomy_level" "AgentAutonomyLevel" NOT NULL,
    "customer_facing" BOOLEAN NOT NULL DEFAULT false,
    "platform_managed" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tools" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "autonomy_level" "AgentAutonomyLevel" NOT NULL,
    "input_schema" JSONB NOT NULL DEFAULT '{}',
    "output_schema" JSONB NOT NULL DEFAULT '{}',
    "platform_managed" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lume_agent_capabilities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lume_agent_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lume_agent_tools" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "tool_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lume_agent_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_executions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "agent_type" "LumeAgentType" NOT NULL,
    "service_session_id" UUID,
    "parent_execution_id" UUID,
    "input_message_id" UUID,
    "runtime_config_version_id" UUID NOT NULL,
    "platform_prompt_version_id" UUID,
    "tenant_prompt_version_id" UUID,
    "source" "AgentExecutionSource" NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'openai',
    "model" VARCHAR(160) NOT NULL,
    "credential_identifier" VARCHAR(160),
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'queued',
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "structured_decision" JSONB,
    "result" JSONB,
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(1000),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_execution_attempts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "runtime_config_version_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'openai',
    "model" VARCHAR(160) NOT NULL,
    "credential_identifier" VARCHAR(160),
    "status" "AgentExecutionAttemptStatus" NOT NULL DEFAULT 'running',
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "total_tokens" INTEGER,
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(1000),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_execution_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_calls" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "tool_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "AgentToolCallStatus" NOT NULL DEFAULT 'requested',
    "input_hash" CHAR(64),
    "request_metadata" JSONB NOT NULL DEFAULT '{}',
    "result_summary" JSONB,
    "authorization_reason" VARCHAR(500),
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(1000),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "MediaAssetType" NOT NULL,
    "status" "MediaProcessingStatus" NOT NULL DEFAULT 'stored',
    "storage_key" VARCHAR(700),
    "mime_type" VARCHAR(160),
    "original_name" VARCHAR(255),
    "size_bytes" INTEGER,
    "sha256" CHAR(64),
    "duration_seconds" DECIMAL(12,3),
    "page_count" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "stored_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_interpretations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "agent_execution_id" UUID,
    "status" "MediaInterpretationStatus" NOT NULL DEFAULT 'pending',
    "transcription" TEXT,
    "detected_language" VARCHAR(20),
    "extracted_text" TEXT,
    "summary" TEXT,
    "document_type" VARCHAR(120),
    "structured_data" JSONB,
    "provider" VARCHAR(50),
    "model" VARCHAR(160),
    "model_version" VARCHAR(160),
    "confidence" DECIMAL(5,4),
    "duration_seconds" DECIMAL(12,3),
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "media_interpretations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_interpretation_corrections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "interpretation_id" UUID NOT NULL,
    "corrected_by_user_id" UUID NOT NULL,
    "correction" TEXT NOT NULL,
    "feedback" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_interpretation_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "source_type" "KnowledgeDocumentSourceType" NOT NULL,
    "scope" "KnowledgeScope" NOT NULL DEFAULT 'tenant',
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'internal',
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_document_departments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_document_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_document_versions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "KnowledgeVersionStatus" NOT NULL DEFAULT 'draft',
    "content" TEXT,
    "storage_key" VARCHAR(700),
    "file_name" VARCHAR(255),
    "mime_type" VARCHAR(160),
    "size_bytes" INTEGER,
    "sha256" CHAR(64),
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "effective_from" TIMESTAMPTZ(3),
    "effective_until" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "published_by_user_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "page_number" INTEGER,
    "content" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "token_count" INTEGER,
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_suggestions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "service_session_id" UUID,
    "agent_execution_id" UUID,
    "resulting_document_id" UUID,
    "title" VARCHAR(240) NOT NULL,
    "proposed_content" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" "KnowledgeReviewStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_gaps" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "service_session_id" UUID,
    "agent_execution_id" UUID,
    "topic" VARCHAR(240) NOT NULL,
    "topic_normalized" VARCHAR(240) NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'open',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "first_observed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_observed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_execution_knowledge_sources" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "chunk_id" UUID,
    "document_version_number" INTEGER NOT NULL,
    "chunk_ordinal" INTEGER,
    "page_number" INTEGER,
    "retrieval_rank" INTEGER,
    "confidence" DECIMAL(5,4),
    "retrieved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_execution_knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_execution_media_sources" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "interpretation_id" UUID NOT NULL,
    "attached_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_execution_media_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_data_reviews" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "whatsapp_contact_id" UUID,
    "service_session_id" UUID,
    "agent_execution_id" UUID,
    "command_id" VARCHAR(120) NOT NULL,
    "field" VARCHAR(160) NOT NULL,
    "current_value" JSONB,
    "proposed_value" JSONB NOT NULL,
    "source" "RegistrationDataReviewSource" NOT NULL,
    "status" "RegistrationDataReviewStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registration_data_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_groups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "whatsapp_id" VARCHAR(160) NOT NULL,
    "display_name" VARCHAR(200),
    "ai_mode" "WhatsAppGroupAiMode" NOT NULL DEFAULT 'off',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "synced_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_group_participants" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "whatsapp_id" VARCHAR(160) NOT NULL,
    "phone_number" VARCHAR(20),
    "display_name" VARCHAR(160),
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "linked_registration_id" UUID,
    "joined_at" TIMESTAMPTZ(3),
    "left_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_group_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_group_messages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "participant_id" UUID,
    "media_asset_id" UUID,
    "provider_message_id" VARCHAR(160),
    "direction" "MessageDirection" NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'text',
    "text" TEXT,
    "media" JSONB,
    "correlation_id" VARCHAR(120) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_group_messages_pkey" PRIMARY KEY ("id")
);

-- Safe preflight: a channel phone is globally exclusive, including disabled or
-- cancelled channels. Abort before creating the index rather than deleting or
-- rewriting any existing channel.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "whatsapp_channels"
    GROUP BY "phone_number"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce global WhatsApp channel phone uniqueness: duplicate phone values exist. Resolve them explicitly before retrying this migration.';
  END IF;
END
$$;

CREATE UNIQUE INDEX "whatsapp_channels_phone_number_global_key"
  ON "whatsapp_channels"("phone_number");

-- Safe preflight for the previously unbound registration phone reference.
-- This converts the existing UUID hint into a tenant-isolated FK without
-- silently nulling or reassigning any historical value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "registration_phones" rp
    LEFT JOIN "whatsapp_contacts" wc
      ON wc."id" = rp."whatsapp_contact_id"
     AND wc."company_id" = rp."company_id"
    WHERE rp."whatsapp_contact_id" IS NOT NULL
      AND wc."id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot bind registration phones to WhatsApp contacts: invalid or cross-tenant references exist.';
  END IF;
END
$$;

-- Backfill channel lifecycle without touching provider/instance identifiers.
-- In particular, existing technical names (including milenium-production)
-- are copied verbatim and are never renamed or recreated by this migration.
UPDATE "whatsapp_channels"
SET "organizational_status" = CASE
      WHEN "enabled" THEN 'active'::"WhatsAppChannelOrganizationalStatus"
      ELSE 'disabled'::"WhatsAppChannelOrganizationalStatus"
    END,
    "connection_status" = 'unknown'::"WhatsAppChannelConnectionStatus";

-- The production channel keeps its immutable technical Evolution identity,
-- while its user-facing ownership is made explicit as required by the
-- migration contract. Fail closed when the canonical department is missing;
-- never guess another department or rename the technical instance.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "whatsapp_channels" channel
    WHERE channel."instance_name" = 'milenium-production'
      AND NOT EXISTS (
        SELECT 1
        FROM "tenant_departments" department
        WHERE department."company_id" = channel."company_id"
          AND department."code" = 'commercial'
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill milenium-production: the tenant has no Commercial department.';
  END IF;
END
$$;

UPDATE "whatsapp_channels" channel
SET "name" = 'Canal Comercial',
    "department_id" = department."id"
FROM "tenant_departments" department
WHERE channel."instance_name" = 'milenium-production'
  AND department."company_id" = channel."company_id"
  AND department."code" = 'commercial';

WITH conversation_owner AS (
  SELECT
    c."company_id",
    c."channel_id",
    (ARRAY_AGG(DISTINCT d."id"))[1] AS "department_id"
  FROM "whatsapp_conversations" c
  JOIN "tenant_departments" d
    ON d."company_id" = c."company_id"
   AND d."code" = c."department"
  GROUP BY c."company_id", c."channel_id"
  HAVING COUNT(DISTINCT c."department") = 1
)
UPDATE "whatsapp_channels" channel
SET "department_id" = owner."department_id"
FROM conversation_owner owner
WHERE owner."company_id" = channel."company_id"
  AND owner."channel_id" = channel."id"
  AND channel."department_id" IS NULL;

WITH name_owner AS (
  SELECT
    channel."id" AS "channel_id",
    channel."company_id",
    (ARRAY_AGG(department."id" ORDER BY department."created_at"))[1] AS "department_id"
  FROM "whatsapp_channels" channel
  JOIN "tenant_departments" department
    ON department."company_id" = channel."company_id"
   AND LOWER(channel."name") LIKE '%' || LOWER(department."name") || '%'
  WHERE channel."department_id" IS NULL
  GROUP BY channel."id", channel."company_id"
  HAVING COUNT(*) = 1
)
UPDATE "whatsapp_channels" channel
SET "department_id" = owner."department_id"
FROM name_owner owner
WHERE owner."company_id" = channel."company_id"
  AND owner."channel_id" = channel."id"
  AND channel."department_id" IS NULL;

WITH default_owner AS (
  SELECT
    channel."id" AS "channel_id",
    channel."company_id",
    (ARRAY_AGG(department."id" ORDER BY department."created_at"))[1] AS "department_id"
  FROM "whatsapp_channels" channel
  JOIN "tenant_departments" department
    ON department."company_id" = channel."company_id"
   AND department."is_default" = true
  WHERE channel."department_id" IS NULL
  GROUP BY channel."id", channel."company_id"
  HAVING COUNT(*) = 1
)
UPDATE "whatsapp_channels" channel
SET "department_id" = owner."department_id"
FROM default_owner owner
WHERE owner."company_id" = channel."company_id"
  AND owner."channel_id" = channel."id"
  AND channel."department_id" IS NULL;

UPDATE "whatsapp_channels"
SET "routing_mode" = CASE
  WHEN "department_id" IS NULL
    THEN 'general-triage'::"WhatsAppChannelRoutingMode"
  ELSE 'department-owned'::"WhatsAppChannelRoutingMode"
END;

INSERT INTO "whatsapp_channel_automatic_target_departments" (
  "id", "company_id", "channel_id", "department_id", "created_at"
)
SELECT gen_random_uuid(), channel."company_id", channel."id", channel."department_id", CURRENT_TIMESTAMP
FROM "whatsapp_channels" channel
WHERE channel."department_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "whatsapp_channel_automatic_target_departments" target
    WHERE target."company_id" = channel."company_id"
      AND target."channel_id" = channel."id"
      AND target."department_id" = channel."department_id"
  );

INSERT INTO "whatsapp_channel_events" (
  "id", "company_id", "channel_id", "command_id", "command_fingerprint",
  "name", "expected_version", "resulting_version", "actor_type",
  "actor_user_id", "actor_agent_id", "before_snapshot", "after_snapshot",
  "metadata", "created_at"
)
SELECT
  gen_random_uuid(),
  channel."company_id",
  channel."id",
  'legacy-channel-backfill:' || channel."id"::text,
  md5('legacy-channel-backfill:' || channel."id"::text) ||
    md5('legacy-channel-backfill:v2:' || channel."id"::text),
  'legacy-channel-backfill',
  0,
  channel."version",
  'system'::"MutationActorType",
  NULL,
  NULL,
  '{}'::jsonb,
  jsonb_build_object(
    'id', channel."id"::text,
    'instanceName', channel."instance_name",
    'phoneNumber', channel."phone_number",
    'organizationalStatus', channel."organizational_status"::text,
    'connectionStatus', channel."connection_status"::text,
    'routingMode', channel."routing_mode"::text,
    'departmentId', channel."department_id"
  ),
  jsonb_build_object('source', 'migration'),
  CURRENT_TIMESTAMP
FROM "whatsapp_channels" channel;

-- One durable thread per legacy canonical channel/contact relationship. Reuse
-- the legacy conversation UUID so imports and external references remain
-- traceable without rewriting their identifiers.
INSERT INTO "whatsapp_threads" (
  "id", "company_id", "source_channel_id", "contact_id",
  "last_inbound_at", "last_outbound_at", "created_at", "updated_at"
)
SELECT
  conversation."id",
  conversation."company_id",
  conversation."channel_id",
  conversation."contact_id",
  conversation."last_inbound_at",
  conversation."last_outbound_at",
  conversation."created_at",
  conversation."updated_at"
FROM "whatsapp_conversations" conversation
ON CONFLICT ("id") DO NOTHING;

UPDATE "whatsapp_conversations"
SET "thread_id" = "id"
WHERE "thread_id" IS NULL;

-- Materialize a default queue per department. This does not change current
-- ownership; it only gives legacy waiting-human rows a valid queue target.
INSERT INTO "service_queues" (
  "id", "company_id", "department_id", "name", "assignment_strategy",
  "max_concurrent_attendances", "priority_weight", "enabled",
  "created_by_user_id", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), department."company_id", department."id", 'Atendimento',
  'manual'::"QueueAssignmentStrategy", NULL, 0, true, NULL,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenant_departments" department
WHERE NOT EXISTS (
  SELECT 1
  FROM "service_queues" queue
  WHERE queue."company_id" = department."company_id"
    AND queue."department_id" = department."id"
    AND queue."name" = 'Atendimento'
);

-- A legacy canonical conversation becomes one explicitly marked foreground
-- session. Historical episode boundaries were previously collapsed, so this
-- migration intentionally does not invent additional sessions.
INSERT INTO "service_sessions" (
  "id", "company_id", "thread_id", "source_channel_id",
  "current_department_id", "responsible_user_id", "queue_id",
  "related_service_session_id", "status", "control_mode", "priority",
  "priority_reason", "priority_source", "is_foreground", "version",
  "public_continuation_code", "continuation_code_expires_at",
  "conversation_resolved", "pending_actions",
  "resolution_confirmed_by_customer", "closing_started_at",
  "closing_deadline_at", "closed_at", "created_at", "updated_at"
)
SELECT
  conversation."id",
  conversation."company_id",
  conversation."id",
  conversation."channel_id",
  department."id",
  conversation."assigned_to_user_id",
  CASE
    WHEN conversation."conversation_state" = 'sent-to-human'::"ConversationState"
      THEN queue."id"
    ELSE NULL
  END,
  NULL,
  CASE conversation."conversation_state"
    WHEN 'waiting-for-customer'::"ConversationState" THEN 'waiting-customer'::"ServiceSessionStatus"
    WHEN 'sent-to-human'::"ConversationState" THEN 'waiting-human'::"ServiceSessionStatus"
    WHEN 'closed'::"ConversationState" THEN 'closed'::"ServiceSessionStatus"
    ELSE 'open'::"ServiceSessionStatus"
  END,
  CASE
    WHEN conversation."conversation_state" IN (
      'sent-to-human'::"ConversationState",
      'human-active'::"ConversationState"
    ) THEN 'human'::"ServiceSessionControlMode"
    ELSE 'ai'::"ServiceSessionControlMode"
  END,
  'normal'::"ServiceSessionPriority",
  'Legacy conversation projection',
  'import'::"ServiceSessionPrioritySource",
  conversation."conversation_state" <> 'closed'::"ConversationState",
  GREATEST(conversation."version", 1),
  NULL,
  NULL,
  conversation."conversation_state" = 'closed'::"ConversationState",
  '[]'::jsonb,
  false,
  NULL,
  NULL,
  CASE
    WHEN conversation."conversation_state" = 'closed'::"ConversationState"
      THEN COALESCE(conversation."closed_at", conversation."updated_at")
    ELSE NULL
  END,
  conversation."created_at",
  conversation."updated_at"
FROM "whatsapp_conversations" conversation
LEFT JOIN "tenant_departments" department
  ON department."company_id" = conversation."company_id"
 AND department."code" = conversation."department"
LEFT JOIN "service_queues" queue
  ON queue."company_id" = conversation."company_id"
 AND queue."department_id" = department."id"
 AND queue."name" = 'Atendimento'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "service_session_assignments" (
  "id", "company_id", "service_session_id", "department_id",
  "assigned_user_id", "queue_id", "assigned_by_user_id",
  "previous_assignment_id", "status", "source", "reason",
  "started_at", "ended_at", "created_at"
)
SELECT
  gen_random_uuid(), session."company_id", session."id",
  session."current_department_id", session."responsible_user_id",
  session."queue_id", NULL, NULL,
  'active'::"ServiceAssignmentStatus",
  'legacy-backfill'::"ServiceAssignmentSource",
  'Projected from legacy conversation ownership',
  session."created_at", NULL, CURRENT_TIMESTAMP
FROM "service_sessions" session
WHERE session."current_department_id" IS NOT NULL
  AND (session."responsible_user_id" IS NOT NULL OR session."queue_id" IS NOT NULL)
  AND session."status" <> 'closed'::"ServiceSessionStatus";

INSERT INTO "service_session_events" (
  "id", "company_id", "service_session_id", "command_id",
  "command_fingerprint", "name", "expected_version", "resulting_version",
  "actor_type", "actor_user_id", "actor_agent_id", "before_snapshot",
  "after_snapshot", "metadata", "created_at"
)
SELECT
  gen_random_uuid(),
  session."company_id",
  session."id",
  'legacy-session-backfill:' || session."id"::text,
  md5('legacy-session-backfill:' || session."id"::text) ||
    md5('legacy-session-backfill:v2:' || session."id"::text),
  'legacy-session-backfill',
  GREATEST(session."version" - 1, 0),
  session."version",
  'system'::"MutationActorType",
  NULL,
  NULL,
  '{}'::jsonb,
  jsonb_build_object(
    'id', session."id"::text,
    'threadId', session."thread_id"::text,
    'sourceChannelId', session."source_channel_id"::text,
    'status', session."status"::text,
    'controlMode', session."control_mode"::text,
    'departmentId', session."current_department_id",
    'responsibleUserId', session."responsible_user_id",
    'queueId', session."queue_id",
    'priority', session."priority"::text,
    'isForeground', session."is_foreground"
  ),
  jsonb_build_object('source', 'legacy-conversation-projection'),
  CURRENT_TIMESTAMP
FROM "service_sessions" session;

-- Preserve existing media metadata as first-class assets without moving or
-- deleting the original columns/content.
INSERT INTO "media_assets" (
  "id", "company_id", "type", "status", "storage_key", "mime_type",
  "original_name", "size_bytes", "sha256", "duration_seconds",
  "page_count", "metadata", "stored_at", "created_at", "updated_at"
)
SELECT
  message."id",
  message."company_id",
  CASE message."kind"
    WHEN 'audio'::"MessageKind" THEN 'audio'::"MediaAssetType"
    WHEN 'image'::"MessageKind" THEN 'image'::"MediaAssetType"
    WHEN 'document'::"MessageKind" THEN 'document'::"MediaAssetType"
    WHEN 'video'::"MessageKind" THEN 'video'::"MediaAssetType"
    WHEN 'location'::"MessageKind" THEN 'location'::"MediaAssetType"
    WHEN 'contact'::"MessageKind" THEN 'contact'::"MediaAssetType"
    ELSE 'other'::"MediaAssetType"
  END,
  CASE
    WHEN message."kind" = 'video'::"MessageKind"
      THEN 'unsupported'::"MediaProcessingStatus"
    ELSE 'stored'::"MediaProcessingStatus"
  END,
  message."media_storage_key",
  message."media_mime_type",
  message."media_original_name",
  message."media_size_bytes",
  message."media_sha256",
  NULL,
  NULL,
  COALESCE(message."media", '{}'::jsonb) || COALESCE(
    (
      SELECT jsonb_build_object(
        'historyImport',
        jsonb_build_object(
          'batchId', reference."batch_id"::text,
          'sourceSystem', reference."source_system",
          'externalId', reference."external_id"
        )
      )
      FROM "whatsapp_import_external_refs" reference
      JOIN "whatsapp_import_batches" import_batch
        ON import_batch."id" = reference."batch_id"
       AND import_batch."company_id" = reference."company_id"
       AND import_batch."status" = 'applied'::"WhatsAppImportBatchStatus"
      WHERE reference."company_id" = message."company_id"
        AND reference."entity_type" = 'message'
        AND reference."internal_id" = message."id"
      ORDER BY reference."created_at" ASC, reference."id" ASC
      LIMIT 1
    ),
    '{}'::jsonb
  ),
  message."media_stored_at",
  message."created_at",
  message."updated_at"
FROM "whatsapp_messages" message
WHERE message."kind" <> 'text'::"MessageKind"
   OR message."media_storage_key" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

UPDATE "whatsapp_messages" message
SET "thread_id" = conversation."id",
    "service_session_id" = conversation."id",
    "media_asset_id" = (
      SELECT asset."id"
      FROM "media_assets" asset
      WHERE asset."id" = message."id"
        AND asset."company_id" = message."company_id"
    ),
    "actor_type" = CASE
      WHEN message."direction" = 'inbound'::"MessageDirection"
        THEN 'customer'::"WhatsAppMessageActorType"
      WHEN message."actor_user_id" IS NOT NULL
        THEN 'human-user'::"WhatsAppMessageActorType"
      WHEN message."automation_purpose" IS NOT NULL
        THEN 'ai-agent'::"WhatsAppMessageActorType"
      ELSE 'external-human'::"WhatsAppMessageActorType"
    END,
    "source" = CASE
      WHEN EXISTS (
        SELECT 1
        FROM "whatsapp_import_external_refs" reference
        JOIN "whatsapp_import_batches" import_batch
          ON import_batch."id" = reference."batch_id"
         AND import_batch."company_id" = reference."company_id"
         AND import_batch."status" = 'applied'::"WhatsAppImportBatchStatus"
        WHERE reference."company_id" = message."company_id"
          AND reference."entity_type" = 'message'
          AND reference."internal_id" = message."id"
      ) THEN 'history-import'::"WhatsAppMessageSource"
      WHEN message."direction" = 'inbound'::"MessageDirection"
        THEN 'whatsapp-app'::"WhatsAppMessageSource"
      WHEN message."actor_user_id" IS NOT NULL
        THEN 'lume-web'::"WhatsAppMessageSource"
      WHEN message."automation_purpose" IS NOT NULL
        THEN 'automation'::"WhatsAppMessageSource"
      ELSE 'whatsapp-app'::"WhatsAppMessageSource"
    END
FROM "whatsapp_conversations" conversation
WHERE conversation."id" = message."conversation_id"
  AND conversation."company_id" = message."company_id";

UPDATE "whatsapp_conversation_transitions" transition
SET "thread_id" = transition."conversation_id",
    "service_session_id" = transition."conversation_id"
WHERE transition."thread_id" IS NULL
   OR transition."service_session_id" IS NULL;

-- Existing quote requests remain the business source of truth. A Case reuses
-- the quote UUID and only provides the new process boundary.
INSERT INTO "service_cases" (
  "id", "company_id", "type", "status", "title",
  "external_reference", "metadata", "created_by_user_id",
  "created_by_agent_execution_id", "resolved_at", "created_at", "updated_at"
)
SELECT
  quote."id",
  quote."company_id",
  'quote'::"ServiceCaseType",
  CASE quote."status"
    WHEN 'cancelled'::"RequestStatus" THEN 'cancelled'::"ServiceCaseStatus"
    WHEN 'approved'::"RequestStatus" THEN 'resolved'::"ServiceCaseStatus"
    WHEN 'rejected'::"RequestStatus" THEN 'resolved'::"ServiceCaseStatus"
    ELSE 'open'::"ServiceCaseStatus"
  END,
  'Orçamento legado #' || quote."sequence"::text,
  'legacy-quote:' || quote."id"::text,
  jsonb_build_object('legacyQuoteRequestId', quote."id"::text),
  quote."requested_by_user_id",
  NULL,
  CASE
    WHEN quote."status" IN (
      'approved'::"RequestStatus",
      'rejected'::"RequestStatus",
      'cancelled'::"RequestStatus"
    ) THEN COALESCE(quote."decided_at", quote."updated_at")
    ELSE NULL
  END,
  quote."created_at",
  quote."updated_at"
FROM "quote_requests" quote
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "service_session_cases" (
  "id", "company_id", "service_session_id", "case_id", "is_primary", "created_at"
)
SELECT
  gen_random_uuid(), quote."company_id", quote."conversation_id",
  quote."id", true, quote."created_at"
FROM "quote_requests" quote
JOIN "service_sessions" session
  ON session."id" = quote."conversation_id"
 AND session."company_id" = quote."company_id";

UPDATE "quote_requests"
SET "thread_id" = "conversation_id",
    "service_session_id" = "conversation_id",
    "case_id" = "id"
WHERE "thread_id" IS NULL
   OR "service_session_id" IS NULL
   OR "case_id" IS NULL;

UPDATE "quote_proposal_documents"
SET "thread_id" = "conversation_id",
    "service_session_id" = "conversation_id"
WHERE "thread_id" IS NULL
   OR "service_session_id" IS NULL;

-- CreateIndex
CREATE INDEX "whatsapp_channel_automatic_target_departments_company_id_de_idx" ON "whatsapp_channel_automatic_target_departments"("company_id", "department_id", "channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_channel_auto_target_company_channel_department_key" ON "whatsapp_channel_automatic_target_departments"("company_id", "channel_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_channel_automatic_target_departments_id_company_id_key" ON "whatsapp_channel_automatic_target_departments"("id", "company_id");

-- CreateIndex
CREATE INDEX "whatsapp_threads_company_id_updated_at_idx" ON "whatsapp_threads"("company_id", "updated_at");

-- CreateIndex
CREATE INDEX "whatsapp_threads_company_id_contact_id_updated_at_idx" ON "whatsapp_threads"("company_id", "contact_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_threads_id_company_id_key" ON "whatsapp_threads"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_threads_company_channel_contact_key" ON "whatsapp_threads"("company_id", "source_channel_id", "contact_id");

-- CreateIndex
CREATE INDEX "service_queues_company_id_department_id_enabled_idx" ON "service_queues"("company_id", "department_id", "enabled");

-- CreateIndex
CREATE INDEX "service_queues_created_by_user_id_company_id_idx" ON "service_queues"("created_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_queues_id_company_id_key" ON "service_queues"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_queues_company_id_department_id_name_key" ON "service_queues"("company_id", "department_id", "name");

-- CreateIndex
CREATE INDEX "service_sessions_company_id_thread_id_status_updated_at_idx" ON "service_sessions"("company_id", "thread_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "service_sessions_department_status_priority_idx" ON "service_sessions"("company_id", "current_department_id", "status", "priority", "updated_at");

-- CreateIndex
CREATE INDEX "service_sessions_responsible_user_id_company_id_status_idx" ON "service_sessions"("responsible_user_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "service_sessions_queue_id_company_id_status_priority_idx" ON "service_sessions"("queue_id", "company_id", "status", "priority");

-- CreateIndex
CREATE INDEX "service_sessions_related_service_session_id_company_id_idx" ON "service_sessions"("related_service_session_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_sessions_id_company_id_key" ON "service_sessions"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_sessions_company_id_public_continuation_code_key" ON "service_sessions"("company_id", "public_continuation_code");

-- Supports the bounded lifecycle worker without tenant-specific runtime SQL.
CREATE INDEX "service_sessions_status_closing_deadline_at_idx" ON "service_sessions"("status", "closing_deadline_at");

-- CreateIndex
CREATE INDEX "service_session_assignments_company_id_service_session_id_s_idx" ON "service_session_assignments"("company_id", "service_session_id", "started_at");

-- CreateIndex
CREATE INDEX "service_session_assignments_company_id_department_id_status_idx" ON "service_session_assignments"("company_id", "department_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "service_session_assignments_assigned_user_id_company_id_sta_idx" ON "service_session_assignments"("assigned_user_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "service_session_assignments_queue_id_company_id_status_idx" ON "service_session_assignments"("queue_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "service_session_assignments_previous_assignment_id_company__idx" ON "service_session_assignments"("previous_assignment_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_session_assignments_id_company_id_key" ON "service_session_assignments"("id", "company_id");

-- CreateIndex
CREATE INDEX "conversation_participants_company_id_service_session_id_val_idx" ON "conversation_participants"("company_id", "service_session_id", "valid_until");

-- CreateIndex
CREATE INDEX "conversation_participants_company_id_whatsapp_contact_id_va_idx" ON "conversation_participants"("company_id", "whatsapp_contact_id", "valid_until");

-- CreateIndex
CREATE INDEX "conversation_participants_company_id_registration_id_valid__idx" ON "conversation_participants"("company_id", "registration_id", "valid_until");

-- CreateIndex
CREATE INDEX "conversation_participants_confirmed_by_user_id_company_id_idx" ON "conversation_participants"("confirmed_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_id_company_id_key" ON "conversation_participants"("id", "company_id");

-- CreateIndex
CREATE INDEX "service_cases_company_id_type_status_updated_at_idx" ON "service_cases"("company_id", "type", "status", "updated_at");

-- CreateIndex
CREATE INDEX "service_cases_created_by_user_id_company_id_idx" ON "service_cases"("created_by_user_id", "company_id");

-- CreateIndex
CREATE INDEX "service_cases_created_by_agent_execution_id_company_id_idx" ON "service_cases"("created_by_agent_execution_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_cases_id_company_id_key" ON "service_cases"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_cases_company_id_external_reference_key" ON "service_cases"("company_id", "external_reference");

-- CreateIndex
CREATE INDEX "service_session_cases_company_id_case_id_created_at_idx" ON "service_session_cases"("company_id", "case_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_session_cases_id_company_id_key" ON "service_session_cases"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_session_cases_company_id_service_session_id_case_id_key" ON "service_session_cases"("company_id", "service_session_id", "case_id");

-- CreateIndex
CREATE INDEX "service_session_continuity_decisions_company_id_source_serv_idx" ON "service_session_continuity_decisions"("company_id", "source_service_session_id", "created_at");

-- CreateIndex
CREATE INDEX "service_session_continuity_decisions_target_service_session_idx" ON "service_session_continuity_decisions"("target_service_session_id", "company_id");

-- CreateIndex
CREATE INDEX "service_session_continuity_decisions_target_department_id_c_idx" ON "service_session_continuity_decisions"("target_department_id", "company_id");

-- CreateIndex
CREATE INDEX "service_session_continuity_decisions_agent_execution_id_com_idx" ON "service_session_continuity_decisions"("agent_execution_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_session_continuity_decisions_id_company_id_key" ON "service_session_continuity_decisions"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_session_continuity_decisions_company_id_command_id_key" ON "service_session_continuity_decisions"("company_id", "command_id");

-- CreateIndex
CREATE INDEX "lume_agents_company_id_status_type_idx" ON "lume_agents"("company_id", "status", "type");

-- CreateIndex
CREATE INDEX "lume_agents_created_by_user_id_company_id_idx" ON "lume_agents"("created_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "lume_agents_id_company_id_key" ON "lume_agents"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "lume_agents_company_id_code_key" ON "lume_agents"("company_id", "code");

-- CreateIndex
CREATE INDEX "agent_prompt_versions_company_id_agent_id_kind_status_idx" ON "agent_prompt_versions"("company_id", "agent_id", "kind", "status");

-- CreateIndex
CREATE INDEX "agent_prompt_versions_created_by_user_id_company_id_idx" ON "agent_prompt_versions"("created_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_prompt_versions_id_company_id_key" ON "agent_prompt_versions"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_prompt_versions_company_id_agent_id_kind_version_key" ON "agent_prompt_versions"("company_id", "agent_id", "kind", "version");

-- CreateIndex
CREATE INDEX "agent_runtime_config_versions_company_id_agent_id_status_idx" ON "agent_runtime_config_versions"("company_id", "agent_id", "status");

-- CreateIndex
CREATE INDEX "agent_runtime_config_versions_created_by_user_id_company_id_idx" ON "agent_runtime_config_versions"("created_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runtime_config_versions_id_company_id_key" ON "agent_runtime_config_versions"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runtime_config_versions_company_id_agent_id_version_key" ON "agent_runtime_config_versions"("company_id", "agent_id", "version");

-- CreateIndex
CREATE INDEX "agent_capabilities_company_id_enabled_autonomy_level_idx" ON "agent_capabilities"("company_id", "enabled", "autonomy_level");

-- CreateIndex
CREATE UNIQUE INDEX "agent_capabilities_id_company_id_key" ON "agent_capabilities"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_capabilities_company_id_code_key" ON "agent_capabilities"("company_id", "code");

-- CreateIndex
CREATE INDEX "agent_tools_company_id_enabled_autonomy_level_idx" ON "agent_tools"("company_id", "enabled", "autonomy_level");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tools_id_company_id_key" ON "agent_tools"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tools_company_id_code_key" ON "agent_tools"("company_id", "code");

-- CreateIndex
CREATE INDEX "lume_agent_capabilities_company_id_capability_id_enabled_idx" ON "lume_agent_capabilities"("company_id", "capability_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "lume_agent_capabilities_id_company_id_key" ON "lume_agent_capabilities"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "lume_agent_capabilities_company_id_agent_id_capability_id_key" ON "lume_agent_capabilities"("company_id", "agent_id", "capability_id");

-- CreateIndex
CREATE INDEX "lume_agent_tools_company_id_tool_id_enabled_idx" ON "lume_agent_tools"("company_id", "tool_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "lume_agent_tools_id_company_id_key" ON "lume_agent_tools"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "lume_agent_tools_company_id_agent_id_tool_id_key" ON "lume_agent_tools"("company_id", "agent_id", "tool_id");

-- CreateIndex
CREATE INDEX "agent_executions_company_id_agent_id_created_at_idx" ON "agent_executions"("company_id", "agent_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_executions_company_id_service_session_id_created_at_idx" ON "agent_executions"("company_id", "service_session_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_executions_parent_execution_id_company_id_idx" ON "agent_executions"("parent_execution_id", "company_id");

-- CreateIndex
CREATE INDEX "agent_executions_input_message_id_company_id_idx" ON "agent_executions"("input_message_id", "company_id");

-- CreateIndex
CREATE INDEX "agent_executions_runtime_config_version_id_company_id_idx" ON "agent_executions"("runtime_config_version_id", "company_id");

-- CreateIndex
CREATE INDEX "agent_executions_company_id_status_created_at_idx" ON "agent_executions"("company_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_executions_id_company_id_key" ON "agent_executions"("id", "company_id");

-- CreateIndex
CREATE INDEX "agent_execution_attempts_company_id_status_started_at_idx" ON "agent_execution_attempts"("company_id", "status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_execution_attempts_id_company_id_key" ON "agent_execution_attempts"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_execution_attempts_company_id_execution_id_attempt_nu_key" ON "agent_execution_attempts"("company_id", "execution_id", "attempt_number");

-- CreateIndex
CREATE INDEX "agent_tool_calls_company_id_tool_id_status_created_at_idx" ON "agent_tool_calls"("company_id", "tool_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tool_calls_id_company_id_key" ON "agent_tool_calls"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tool_calls_company_id_execution_id_sequence_key" ON "agent_tool_calls"("company_id", "execution_id", "sequence");

-- CreateIndex
CREATE INDEX "media_assets_company_id_sha256_idx" ON "media_assets"("company_id", "sha256");

-- CreateIndex
CREATE INDEX "media_assets_company_id_status_created_at_idx" ON "media_assets"("company_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_id_company_id_key" ON "media_assets"("id", "company_id");

-- CreateIndex
CREATE INDEX "media_assets_company_id_storage_key_idx" ON "media_assets"("company_id", "storage_key");

-- CreateIndex
CREATE INDEX "media_interpretations_company_id_status_created_at_idx" ON "media_interpretations"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "media_interpretations_agent_execution_id_company_id_idx" ON "media_interpretations"("agent_execution_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_interpretations_id_company_id_key" ON "media_interpretations"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_interpretations_media_asset_id_company_id_key" ON "media_interpretations"("media_asset_id", "company_id");

-- CreateIndex
CREATE INDEX "media_interpretation_corrections_corrected_by_user_id_compa_idx" ON "media_interpretation_corrections"("corrected_by_user_id", "company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_interpretation_corrections_id_company_id_key" ON "media_interpretation_corrections"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_interpretation_corrections_interpretation_id_company__key" ON "media_interpretation_corrections"("interpretation_id", "company_id");

-- CreateIndex
CREATE INDEX "knowledge_bases_company_id_enabled_archived_at_idx" ON "knowledge_bases"("company_id", "enabled", "archived_at");

-- CreateIndex
CREATE INDEX "knowledge_bases_created_by_user_id_company_id_idx" ON "knowledge_bases"("created_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_bases_id_company_id_key" ON "knowledge_bases"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_bases_company_id_name_key" ON "knowledge_bases"("company_id", "name");

-- CreateIndex
CREATE INDEX "knowledge_documents_company_id_knowledge_base_id_archived_a_idx" ON "knowledge_documents"("company_id", "knowledge_base_id", "archived_at");

-- CreateIndex
CREATE INDEX "knowledge_documents_company_id_scope_visibility_idx" ON "knowledge_documents"("company_id", "scope", "visibility");

-- CreateIndex
CREATE INDEX "knowledge_documents_created_by_user_id_company_id_idx" ON "knowledge_documents"("created_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_id_company_id_key" ON "knowledge_documents"("id", "company_id");

-- CreateIndex
CREATE INDEX "knowledge_document_departments_company_id_department_id_doc_idx" ON "knowledge_document_departments"("company_id", "department_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_departments_id_company_id_key" ON "knowledge_document_departments"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_departments_company_id_document_id_depar_key" ON "knowledge_document_departments"("company_id", "document_id", "department_id");

-- CreateIndex
CREATE INDEX "knowledge_versions_retrieval_idx" ON "knowledge_document_versions"("company_id", "document_id", "status", "effective_from", "effective_until");

-- CreateIndex
CREATE INDEX "knowledge_document_versions_created_by_user_id_company_id_idx" ON "knowledge_document_versions"("created_by_user_id", "company_id");

-- CreateIndex
CREATE INDEX "knowledge_document_versions_published_by_user_id_company_id_idx" ON "knowledge_document_versions"("published_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_versions_id_company_id_key" ON "knowledge_document_versions"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_versions_company_id_document_id_version_key" ON "knowledge_document_versions"("company_id", "document_id", "version");

-- CreateIndex
CREATE INDEX "knowledge_chunks_company_id_document_version_id_page_number_idx" ON "knowledge_chunks"("company_id", "document_version_id", "page_number");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_id_company_id_key" ON "knowledge_chunks"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_company_id_document_version_id_ordinal_key" ON "knowledge_chunks"("company_id", "document_version_id", "ordinal");

-- CreateIndex
CREATE INDEX "knowledge_suggestions_company_id_status_created_at_idx" ON "knowledge_suggestions"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_suggestions_service_session_id_company_id_idx" ON "knowledge_suggestions"("service_session_id", "company_id");

-- CreateIndex
CREATE INDEX "knowledge_suggestions_agent_execution_id_company_id_idx" ON "knowledge_suggestions"("agent_execution_id", "company_id");

-- CreateIndex
CREATE INDEX "knowledge_suggestions_reviewed_by_user_id_company_id_idx" ON "knowledge_suggestions"("reviewed_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_suggestions_id_company_id_key" ON "knowledge_suggestions"("id", "company_id");

-- CreateIndex
CREATE INDEX "knowledge_gaps_company_id_status_occurrence_count_last_obse_idx" ON "knowledge_gaps"("company_id", "status", "occurrence_count", "last_observed_at");

-- CreateIndex
CREATE INDEX "knowledge_gaps_service_session_id_company_id_idx" ON "knowledge_gaps"("service_session_id", "company_id");

-- CreateIndex
CREATE INDEX "knowledge_gaps_agent_execution_id_company_id_idx" ON "knowledge_gaps"("agent_execution_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_gaps_id_company_id_key" ON "knowledge_gaps"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_gaps_company_id_topic_normalized_key" ON "knowledge_gaps"("company_id", "topic_normalized");

-- CreateIndex
CREATE INDEX "agent_execution_knowledge_sources_company_id_execution_id_r_idx" ON "agent_execution_knowledge_sources"("company_id", "execution_id", "retrieved_at");

-- CreateIndex
CREATE INDEX "agent_execution_knowledge_sources_document_version_id_compa_idx" ON "agent_execution_knowledge_sources"("document_version_id", "company_id");

-- CreateIndex
CREATE INDEX "agent_execution_knowledge_sources_chunk_id_company_id_idx" ON "agent_execution_knowledge_sources"("chunk_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_execution_knowledge_sources_id_company_id_key" ON "agent_execution_knowledge_sources"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_execution_knowledge_sources_company_id_execution_id_d_key" ON "agent_execution_knowledge_sources"("company_id", "execution_id", "document_version_id", "chunk_id");

-- CreateIndex
CREATE INDEX "agent_execution_media_sources_interpretation_id_company_id_idx" ON "agent_execution_media_sources"("interpretation_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_execution_media_sources_id_company_id_key" ON "agent_execution_media_sources"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_execution_media_sources_company_id_execution_id_inter_key" ON "agent_execution_media_sources"("company_id", "execution_id", "interpretation_id");

-- CreateIndex
CREATE INDEX "registration_data_reviews_company_id_registration_id_status_idx" ON "registration_data_reviews"("company_id", "registration_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "registration_data_reviews_service_session_id_company_id_idx" ON "registration_data_reviews"("service_session_id", "company_id");

-- CreateIndex
CREATE INDEX "registration_data_reviews_agent_execution_id_company_id_idx" ON "registration_data_reviews"("agent_execution_id", "company_id");

-- CreateIndex
CREATE INDEX "registration_data_reviews_whatsapp_contact_id_company_id_idx" ON "registration_data_reviews"("whatsapp_contact_id", "company_id");

-- CreateIndex
CREATE INDEX "registration_data_reviews_reviewed_by_user_id_company_id_idx" ON "registration_data_reviews"("reviewed_by_user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_data_reviews_id_company_id_key" ON "registration_data_reviews"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_data_reviews_company_id_command_id_key" ON "registration_data_reviews"("company_id", "command_id");

-- CreateIndex
CREATE INDEX "whatsapp_groups_company_id_channel_id_archived_at_idx" ON "whatsapp_groups"("company_id", "channel_id", "archived_at");

-- CreateIndex
CREATE INDEX "whatsapp_groups_company_id_ai_mode_idx" ON "whatsapp_groups"("company_id", "ai_mode");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_groups_id_company_id_key" ON "whatsapp_groups"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_groups_company_id_channel_id_whatsapp_id_key" ON "whatsapp_groups"("company_id", "channel_id", "whatsapp_id");

-- CreateIndex
CREATE INDEX "whatsapp_group_participants_company_id_phone_number_idx" ON "whatsapp_group_participants"("company_id", "phone_number");

-- CreateIndex
CREATE INDEX "whatsapp_group_participants_linked_registration_id_company__idx" ON "whatsapp_group_participants"("linked_registration_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_group_participants_id_company_id_key" ON "whatsapp_group_participants"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_group_participants_company_id_group_id_whatsapp_id_key" ON "whatsapp_group_participants"("company_id", "group_id", "whatsapp_id");

-- CreateIndex
CREATE INDEX "whatsapp_group_messages_company_id_group_id_occurred_at_id_idx" ON "whatsapp_group_messages"("company_id", "group_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "whatsapp_group_messages_participant_id_company_id_occurred__idx" ON "whatsapp_group_messages"("participant_id", "company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "whatsapp_group_messages_media_asset_id_company_id_idx" ON "whatsapp_group_messages"("media_asset_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_group_messages_id_company_id_key" ON "whatsapp_group_messages"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_group_messages_company_id_channel_id_provider_mess_key" ON "whatsapp_group_messages"("company_id", "channel_id", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_group_messages_company_id_correlation_id_key" ON "whatsapp_group_messages"("company_id", "correlation_id");

-- CreateIndex
CREATE INDEX "whatsapp_channels_company_id_organizational_status_connecti_idx" ON "whatsapp_channels"("company_id", "organizational_status", "connection_status");

-- CreateIndex
CREATE INDEX "whatsapp_channels_department_id_company_id_idx" ON "whatsapp_channels"("department_id", "company_id");

-- CreateIndex
CREATE INDEX "whatsapp_channels_created_by_user_id_company_id_idx" ON "whatsapp_channels"("created_by_user_id", "company_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_thread_id_company_id_idx" ON "whatsapp_conversations"("thread_id", "company_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_thread_id_company_id_occurred_at_idx" ON "whatsapp_messages"("thread_id", "company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_service_session_id_company_id_occurred_at_idx" ON "whatsapp_messages"("service_session_id", "company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_media_asset_id_company_id_idx" ON "whatsapp_messages"("media_asset_id", "company_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_actor_agent_id_company_id_occurred_at_idx" ON "whatsapp_messages"("actor_agent_id", "company_id", "occurred_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_agent_execution_id_company_id_idx" ON "whatsapp_messages"("agent_execution_id", "company_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversation_transitions_thread_id_company_id_crea_idx" ON "whatsapp_conversation_transitions"("thread_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_conversation_transitions_service_session_id_compan_idx" ON "whatsapp_conversation_transitions"("service_session_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_requests_thread_id_company_id_created_at_idx" ON "quote_requests"("thread_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_requests_service_session_id_company_id_created_at_idx" ON "quote_requests"("service_session_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_requests_case_id_company_id_idx" ON "quote_requests"("case_id", "company_id");

-- CreateIndex
CREATE INDEX "quote_requests_created_by_agent_execution_id_company_id_idx" ON "quote_requests"("created_by_agent_execution_id", "company_id");

-- CreateIndex
CREATE INDEX "quote_proposal_documents_thread_id_company_id_created_at_idx" ON "quote_proposal_documents"("thread_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_proposal_documents_service_session_id_company_id_crea_idx" ON "quote_proposal_documents"("service_session_id", "company_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_proposal_documents_media_asset_id_company_id_idx" ON "quote_proposal_documents"("media_asset_id", "company_id");

-- AddForeignKey
ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "whatsapp_channels_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "whatsapp_channels_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "tenant_departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_thread_id_company_id_fkey" FOREIGN KEY ("thread_id", "company_id") REFERENCES "whatsapp_threads"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_thread_id_company_id_fkey" FOREIGN KEY ("thread_id", "company_id") REFERENCES "whatsapp_threads"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_media_asset_id_company_id_fkey" FOREIGN KEY ("media_asset_id", "company_id") REFERENCES "media_assets"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_actor_agent_id_company_id_fkey" FOREIGN KEY ("actor_agent_id", "company_id") REFERENCES "lume_agents"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_agent_execution_id_company_id_fkey" FOREIGN KEY ("agent_execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversation_transitions" ADD CONSTRAINT "whatsapp_conversation_transitions_thread_id_company_id_fkey" FOREIGN KEY ("thread_id", "company_id") REFERENCES "whatsapp_threads"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_conversation_transitions" ADD CONSTRAINT "whatsapp_conversation_transitions_service_session_id_compa_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_thread_id_company_id_fkey" FOREIGN KEY ("thread_id", "company_id") REFERENCES "whatsapp_threads"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_case_id_company_id_fkey" FOREIGN KEY ("case_id", "company_id") REFERENCES "service_cases"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_created_by_agent_execution_id_company_id_fkey" FOREIGN KEY ("created_by_agent_execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_proposal_documents" ADD CONSTRAINT "quote_proposal_documents_thread_id_company_id_fkey" FOREIGN KEY ("thread_id", "company_id") REFERENCES "whatsapp_threads"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_proposal_documents" ADD CONSTRAINT "quote_proposal_documents_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_proposal_documents" ADD CONSTRAINT "quote_proposal_documents_media_asset_id_company_id_fkey" FOREIGN KEY ("media_asset_id", "company_id") REFERENCES "media_assets"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_channel_automatic_target_departments" ADD CONSTRAINT "whatsapp_channel_automatic_target_departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_channel_automatic_target_departments" ADD CONSTRAINT "whatsapp_channel_automatic_target_departments_channel_id_c_fkey" FOREIGN KEY ("channel_id", "company_id") REFERENCES "whatsapp_channels"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_channel_automatic_target_departments" ADD CONSTRAINT "whatsapp_channel_automatic_target_departments_department_i_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "tenant_departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_source_channel_id_company_id_fkey" FOREIGN KEY ("source_channel_id", "company_id") REFERENCES "whatsapp_channels"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_threads" ADD CONSTRAINT "whatsapp_threads_contact_id_company_id_fkey" FOREIGN KEY ("contact_id", "company_id") REFERENCES "whatsapp_contacts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_queues" ADD CONSTRAINT "service_queues_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_queues" ADD CONSTRAINT "service_queues_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "tenant_departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_queues" ADD CONSTRAINT "service_queues_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_thread_id_company_id_fkey" FOREIGN KEY ("thread_id", "company_id") REFERENCES "whatsapp_threads"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_source_channel_id_company_id_fkey" FOREIGN KEY ("source_channel_id", "company_id") REFERENCES "whatsapp_channels"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_current_department_id_company_id_fkey" FOREIGN KEY ("current_department_id", "company_id") REFERENCES "tenant_departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_responsible_user_id_company_id_fkey" FOREIGN KEY ("responsible_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_queue_id_company_id_fkey" FOREIGN KEY ("queue_id", "company_id") REFERENCES "service_queues"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_related_service_session_id_company_id_fkey" FOREIGN KEY ("related_service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_assignments" ADD CONSTRAINT "service_session_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_assignments" ADD CONSTRAINT "service_session_assignments_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_assignments" ADD CONSTRAINT "service_session_assignments_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "tenant_departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_assignments" ADD CONSTRAINT "service_session_assignments_assigned_user_id_company_id_fkey" FOREIGN KEY ("assigned_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_assignments" ADD CONSTRAINT "service_session_assignments_queue_id_company_id_fkey" FOREIGN KEY ("queue_id", "company_id") REFERENCES "service_queues"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_assignments" ADD CONSTRAINT "service_session_assignments_assigned_by_user_id_company_id_fkey" FOREIGN KEY ("assigned_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_assignments" ADD CONSTRAINT "service_session_assignments_previous_assignment_id_company_fkey" FOREIGN KEY ("previous_assignment_id", "company_id") REFERENCES "service_session_assignments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_whatsapp_contact_id_company_id_fkey" FOREIGN KEY ("whatsapp_contact_id", "company_id") REFERENCES "whatsapp_contacts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_registration_id_company_id_fkey" FOREIGN KEY ("registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_confirmed_by_user_id_company_id_fkey" FOREIGN KEY ("confirmed_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_cases" ADD CONSTRAINT "service_cases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_cases" ADD CONSTRAINT "service_cases_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_cases" ADD CONSTRAINT "service_cases_created_by_agent_execution_id_company_id_fkey" FOREIGN KEY ("created_by_agent_execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_cases" ADD CONSTRAINT "service_session_cases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_cases" ADD CONSTRAINT "service_session_cases_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_cases" ADD CONSTRAINT "service_session_cases_case_id_company_id_fkey" FOREIGN KEY ("case_id", "company_id") REFERENCES "service_cases"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_continuity_decisions" ADD CONSTRAINT "service_session_continuity_decisions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_continuity_decisions" ADD CONSTRAINT "service_session_continuity_decisions_source_service_sessio_fkey" FOREIGN KEY ("source_service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_continuity_decisions" ADD CONSTRAINT "service_session_continuity_decisions_target_service_sessio_fkey" FOREIGN KEY ("target_service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_continuity_decisions" ADD CONSTRAINT "service_session_continuity_decisions_target_department_id__fkey" FOREIGN KEY ("target_department_id", "company_id") REFERENCES "tenant_departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_session_continuity_decisions" ADD CONSTRAINT "service_session_continuity_decisions_agent_execution_id_co_fkey" FOREIGN KEY ("agent_execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lume_agents" ADD CONSTRAINT "lume_agents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lume_agents" ADD CONSTRAINT "lume_agents_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_agent_id_company_id_fkey" FOREIGN KEY ("agent_id", "company_id") REFERENCES "lume_agents"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runtime_config_versions" ADD CONSTRAINT "agent_runtime_config_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runtime_config_versions" ADD CONSTRAINT "agent_runtime_config_versions_agent_id_company_id_fkey" FOREIGN KEY ("agent_id", "company_id") REFERENCES "lume_agents"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runtime_config_versions" ADD CONSTRAINT "agent_runtime_config_versions_created_by_user_id_company_i_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_capabilities" ADD CONSTRAINT "agent_capabilities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lume_agent_capabilities" ADD CONSTRAINT "lume_agent_capabilities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lume_agent_capabilities" ADD CONSTRAINT "lume_agent_capabilities_agent_id_company_id_fkey" FOREIGN KEY ("agent_id", "company_id") REFERENCES "lume_agents"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lume_agent_capabilities" ADD CONSTRAINT "lume_agent_capabilities_capability_id_company_id_fkey" FOREIGN KEY ("capability_id", "company_id") REFERENCES "agent_capabilities"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lume_agent_tools" ADD CONSTRAINT "lume_agent_tools_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lume_agent_tools" ADD CONSTRAINT "lume_agent_tools_agent_id_company_id_fkey" FOREIGN KEY ("agent_id", "company_id") REFERENCES "lume_agents"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lume_agent_tools" ADD CONSTRAINT "lume_agent_tools_tool_id_company_id_fkey" FOREIGN KEY ("tool_id", "company_id") REFERENCES "agent_tools"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_agent_id_company_id_fkey" FOREIGN KEY ("agent_id", "company_id") REFERENCES "lume_agents"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_parent_execution_id_company_id_fkey" FOREIGN KEY ("parent_execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_input_message_id_company_id_fkey" FOREIGN KEY ("input_message_id", "company_id") REFERENCES "whatsapp_messages"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_runtime_config_version_id_company_id_fkey" FOREIGN KEY ("runtime_config_version_id", "company_id") REFERENCES "agent_runtime_config_versions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_platform_prompt_version_id_company_id_fkey" FOREIGN KEY ("platform_prompt_version_id", "company_id") REFERENCES "agent_prompt_versions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_tenant_prompt_version_id_company_id_fkey" FOREIGN KEY ("tenant_prompt_version_id", "company_id") REFERENCES "agent_prompt_versions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_attempts" ADD CONSTRAINT "agent_execution_attempts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_attempts" ADD CONSTRAINT "agent_execution_attempts_execution_id_company_id_fkey" FOREIGN KEY ("execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_attempts" ADD CONSTRAINT "agent_execution_attempts_runtime_config_version_id_company_fkey" FOREIGN KEY ("runtime_config_version_id", "company_id") REFERENCES "agent_runtime_config_versions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_execution_id_company_id_fkey" FOREIGN KEY ("execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_tool_id_company_id_fkey" FOREIGN KEY ("tool_id", "company_id") REFERENCES "agent_tools"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_interpretations" ADD CONSTRAINT "media_interpretations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_interpretations" ADD CONSTRAINT "media_interpretations_media_asset_id_company_id_fkey" FOREIGN KEY ("media_asset_id", "company_id") REFERENCES "media_assets"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_interpretations" ADD CONSTRAINT "media_interpretations_agent_execution_id_company_id_fkey" FOREIGN KEY ("agent_execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_interpretation_corrections" ADD CONSTRAINT "media_interpretation_corrections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_interpretation_corrections" ADD CONSTRAINT "media_interpretation_corrections_interpretation_id_company_fkey" FOREIGN KEY ("interpretation_id", "company_id") REFERENCES "media_interpretations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_interpretation_corrections" ADD CONSTRAINT "media_interpretation_corrections_corrected_by_user_id_comp_fkey" FOREIGN KEY ("corrected_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_knowledge_base_id_company_id_fkey" FOREIGN KEY ("knowledge_base_id", "company_id") REFERENCES "knowledge_bases"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_departments" ADD CONSTRAINT "knowledge_document_departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_departments" ADD CONSTRAINT "knowledge_document_departments_document_id_company_id_fkey" FOREIGN KEY ("document_id", "company_id") REFERENCES "knowledge_documents"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_departments" ADD CONSTRAINT "knowledge_document_departments_department_id_company_id_fkey" FOREIGN KEY ("department_id", "company_id") REFERENCES "tenant_departments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_document_id_company_id_fkey" FOREIGN KEY ("document_id", "company_id") REFERENCES "knowledge_documents"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_created_by_user_id_company_id_fkey" FOREIGN KEY ("created_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_published_by_user_id_company_i_fkey" FOREIGN KEY ("published_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_version_id_company_id_fkey" FOREIGN KEY ("document_version_id", "company_id") REFERENCES "knowledge_document_versions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_suggestions" ADD CONSTRAINT "knowledge_suggestions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_suggestions" ADD CONSTRAINT "knowledge_suggestions_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_suggestions" ADD CONSTRAINT "knowledge_suggestions_agent_execution_id_company_id_fkey" FOREIGN KEY ("agent_execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_suggestions" ADD CONSTRAINT "knowledge_suggestions_resulting_document_id_company_id_fkey" FOREIGN KEY ("resulting_document_id", "company_id") REFERENCES "knowledge_documents"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_suggestions" ADD CONSTRAINT "knowledge_suggestions_reviewed_by_user_id_company_id_fkey" FOREIGN KEY ("reviewed_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_agent_execution_id_company_id_fkey" FOREIGN KEY ("agent_execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_knowledge_sources" ADD CONSTRAINT "agent_execution_knowledge_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_knowledge_sources" ADD CONSTRAINT "agent_execution_knowledge_sources_execution_id_company_id_fkey" FOREIGN KEY ("execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_knowledge_sources" ADD CONSTRAINT "agent_execution_knowledge_sources_document_version_id_comp_fkey" FOREIGN KEY ("document_version_id", "company_id") REFERENCES "knowledge_document_versions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_knowledge_sources" ADD CONSTRAINT "agent_execution_knowledge_sources_chunk_id_company_id_fkey" FOREIGN KEY ("chunk_id", "company_id") REFERENCES "knowledge_chunks"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_media_sources" ADD CONSTRAINT "agent_execution_media_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_media_sources" ADD CONSTRAINT "agent_execution_media_sources_execution_id_company_id_fkey" FOREIGN KEY ("execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_execution_media_sources" ADD CONSTRAINT "agent_execution_media_sources_interpretation_id_company_id_fkey" FOREIGN KEY ("interpretation_id", "company_id") REFERENCES "media_interpretations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_data_reviews" ADD CONSTRAINT "registration_data_reviews_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_data_reviews" ADD CONSTRAINT "registration_data_reviews_registration_id_company_id_fkey" FOREIGN KEY ("registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_data_reviews" ADD CONSTRAINT "registration_data_reviews_whatsapp_contact_id_company_id_fkey" FOREIGN KEY ("whatsapp_contact_id", "company_id") REFERENCES "whatsapp_contacts"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_data_reviews" ADD CONSTRAINT "registration_data_reviews_service_session_id_company_id_fkey" FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_data_reviews" ADD CONSTRAINT "registration_data_reviews_agent_execution_id_company_id_fkey" FOREIGN KEY ("agent_execution_id", "company_id") REFERENCES "agent_executions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_data_reviews" ADD CONSTRAINT "registration_data_reviews_reviewed_by_user_id_company_id_fkey" FOREIGN KEY ("reviewed_by_user_id", "company_id") REFERENCES "users"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_channel_id_company_id_fkey" FOREIGN KEY ("channel_id", "company_id") REFERENCES "whatsapp_channels"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_participants" ADD CONSTRAINT "whatsapp_group_participants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_participants" ADD CONSTRAINT "whatsapp_group_participants_group_id_company_id_fkey" FOREIGN KEY ("group_id", "company_id") REFERENCES "whatsapp_groups"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_participants" ADD CONSTRAINT "whatsapp_group_participants_linked_registration_id_company_fkey" FOREIGN KEY ("linked_registration_id", "company_id") REFERENCES "routing_companies"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_messages" ADD CONSTRAINT "whatsapp_group_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_messages" ADD CONSTRAINT "whatsapp_group_messages_channel_id_company_id_fkey" FOREIGN KEY ("channel_id", "company_id") REFERENCES "whatsapp_channels"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_messages" ADD CONSTRAINT "whatsapp_group_messages_group_id_company_id_fkey" FOREIGN KEY ("group_id", "company_id") REFERENCES "whatsapp_groups"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_messages" ADD CONSTRAINT "whatsapp_group_messages_participant_id_company_id_fkey" FOREIGN KEY ("participant_id", "company_id") REFERENCES "whatsapp_group_participants"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_group_messages" ADD CONSTRAINT "whatsapp_group_messages_media_asset_id_company_id_fkey" FOREIGN KEY ("media_asset_id", "company_id") REFERENCES "media_assets"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes and tenant-isolated foreign keys for the command/event ledgers added
-- on top of the generated structural diff.
CREATE UNIQUE INDEX "whatsapp_channel_events_id_company_id_key"
  ON "whatsapp_channel_events"("id", "company_id");
CREATE UNIQUE INDEX "whatsapp_channel_events_company_id_command_id_key"
  ON "whatsapp_channel_events"("company_id", "command_id");
CREATE INDEX "whatsapp_channel_events_company_id_channel_id_resulting_ver_idx"
  ON "whatsapp_channel_events"("company_id", "channel_id", "resulting_version");
CREATE INDEX "whatsapp_channel_events_actor_user_id_company_id_created_at_idx"
  ON "whatsapp_channel_events"("actor_user_id", "company_id", "created_at");
CREATE INDEX "whatsapp_channel_events_actor_agent_id_company_id_created_a_idx"
  ON "whatsapp_channel_events"("actor_agent_id", "company_id", "created_at");

CREATE UNIQUE INDEX "service_session_events_id_company_id_key"
  ON "service_session_events"("id", "company_id");
CREATE UNIQUE INDEX "service_session_events_company_id_command_id_key"
  ON "service_session_events"("company_id", "command_id");
CREATE INDEX "service_session_events_company_id_service_session_id_result_idx"
  ON "service_session_events"("company_id", "service_session_id", "resulting_version");
CREATE INDEX "service_session_events_actor_user_id_company_id_created_at_idx"
  ON "service_session_events"("actor_user_id", "company_id", "created_at");
CREATE INDEX "service_session_events_actor_agent_id_company_id_created_at_idx"
  ON "service_session_events"("actor_agent_id", "company_id", "created_at");

ALTER TABLE "whatsapp_channel_events"
  ADD CONSTRAINT "whatsapp_channel_events_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "whatsapp_channel_events_channel_id_company_id_fkey"
  FOREIGN KEY ("channel_id", "company_id") REFERENCES "whatsapp_channels"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "whatsapp_channel_events_actor_user_id_company_id_fkey"
  FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "whatsapp_channel_events_actor_agent_id_company_id_fkey"
  FOREIGN KEY ("actor_agent_id", "company_id") REFERENCES "lume_agents"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_session_events"
  ADD CONSTRAINT "service_session_events_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "service_session_events_service_session_id_company_id_fkey"
  FOREIGN KEY ("service_session_id", "company_id") REFERENCES "service_sessions"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "service_session_events_actor_user_id_company_id_fkey"
  FOREIGN KEY ("actor_user_id", "company_id") REFERENCES "users"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "service_session_events_actor_agent_id_company_id_fkey"
  FOREIGN KEY ("actor_agent_id", "company_id") REFERENCES "lume_agents"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "registration_phones"
  ADD CONSTRAINT "registration_phones_whatsapp_contact_id_company_id_fkey"
  FOREIGN KEY ("whatsapp_contact_id", "company_id") REFERENCES "whatsapp_contacts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-column invariants that Prisma cannot express.
ALTER TABLE "whatsapp_channels"
  ADD CONSTRAINT "whatsapp_channels_positive_version_check"
    CHECK ("version" > 0),
  ADD CONSTRAINT "whatsapp_channels_department_owned_check"
    CHECK ("routing_mode" <> 'department-owned'::"WhatsAppChannelRoutingMode" OR "department_id" IS NOT NULL);

ALTER TABLE "service_queues"
  ADD CONSTRAINT "service_queues_max_concurrent_check"
    CHECK ("max_concurrent_attendances" IS NULL OR "max_concurrent_attendances" > 0);

ALTER TABLE "service_sessions"
  ADD CONSTRAINT "service_sessions_positive_version_check"
    CHECK ("version" > 0),
  ADD CONSTRAINT "service_sessions_continuation_code_check"
    CHECK (
      ("public_continuation_code" IS NULL AND "continuation_code_expires_at" IS NULL)
      OR
      (
        "status" = 'closed'::"ServiceSessionStatus"
        AND "closed_at" IS NOT NULL
        AND "public_continuation_code" ~ '^[0-9]{3}$'
        AND "continuation_code_expires_at" = "closed_at" + INTERVAL '7 days'
      )
    ),
  ADD CONSTRAINT "service_sessions_closed_timestamp_check"
    CHECK (
      ("status" = 'closed'::"ServiceSessionStatus" AND "closed_at" IS NOT NULL)
      OR
      ("status" <> 'closed'::"ServiceSessionStatus" AND "closed_at" IS NULL)
    ),
  ADD CONSTRAINT "service_sessions_closing_window_check"
    CHECK (
      (
        "status" = 'closing'::"ServiceSessionStatus"
        AND "closing_started_at" IS NOT NULL
        AND "closing_deadline_at" = "closing_started_at" + INTERVAL '30 minutes'
      )
      OR
      (
        "status" <> 'closing'::"ServiceSessionStatus"
        AND "closing_started_at" IS NULL
        AND "closing_deadline_at" IS NULL
      )
    ),
  ADD CONSTRAINT "service_sessions_pending_actions_array_check"
    CHECK (jsonb_typeof("pending_actions") = 'array');

ALTER TABLE "service_session_assignments"
  ADD CONSTRAINT "service_assignments_target_check"
    CHECK ("assigned_user_id" IS NOT NULL OR "queue_id" IS NOT NULL),
  ADD CONSTRAINT "service_assignments_active_end_check"
    CHECK ("status" <> 'active'::"ServiceAssignmentStatus" OR "ended_at" IS NULL);

ALTER TABLE "whatsapp_channel_events"
  ADD CONSTRAINT "whatsapp_channel_events_version_step_check"
    CHECK ("expected_version" >= 0 AND "resulting_version" = "expected_version" + 1),
  ADD CONSTRAINT "whatsapp_channel_events_actor_check"
    CHECK (
      ("actor_type" <> 'human-user'::"MutationActorType" OR "actor_user_id" IS NOT NULL)
      AND
      ("actor_type" <> 'ai-agent'::"MutationActorType" OR "actor_agent_id" IS NOT NULL)
    );

ALTER TABLE "service_session_events"
  ADD CONSTRAINT "service_session_events_version_step_check"
    CHECK ("expected_version" >= 0 AND "resulting_version" = "expected_version" + 1),
  ADD CONSTRAINT "service_session_events_actor_check"
    CHECK (
      ("actor_type" <> 'human-user'::"MutationActorType" OR "actor_user_id" IS NOT NULL)
      AND
      ("actor_type" <> 'ai-agent'::"MutationActorType" OR "actor_agent_id" IS NOT NULL)
    );

ALTER TABLE "conversation_participants"
  ADD CONSTRAINT "conversation_participants_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)),
  ADD CONSTRAINT "conversation_participants_validity_check"
    CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from");

ALTER TABLE "service_session_continuity_decisions"
  ADD CONSTRAINT "continuity_decisions_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "agent_prompt_versions"
  ADD CONSTRAINT "agent_prompt_versions_positive_version_check" CHECK ("version" > 0);

ALTER TABLE "agent_runtime_config_versions"
  ADD CONSTRAINT "agent_runtime_configs_positive_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "agent_runtime_configs_credential_ref_check"
    CHECK (
      "credential_ref" ~ '^(env|docker-secret)://[A-Za-z0-9._/-]+$'
      AND "credential_ref" !~* 'sk-[A-Za-z0-9_-]+'
      AND "credential_ref" !~ '(^|/)\.\.(/|$)'
    );

ALTER TABLE "agent_executions"
  ADD CONSTRAINT "agent_executions_usage_check"
    CHECK (
      ("latency_ms" IS NULL OR "latency_ms" >= 0)
      AND ("input_tokens" IS NULL OR "input_tokens" >= 0)
      AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
      AND ("total_tokens" IS NULL OR "total_tokens" >= 0)
    );

ALTER TABLE "agent_execution_attempts"
  ADD CONSTRAINT "agent_execution_attempts_usage_check"
    CHECK (
      "attempt_number" > 0
      AND ("latency_ms" IS NULL OR "latency_ms" >= 0)
      AND ("input_tokens" IS NULL OR "input_tokens" >= 0)
      AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
      AND ("total_tokens" IS NULL OR "total_tokens" >= 0)
    );

ALTER TABLE "media_interpretations"
  ADD CONSTRAINT "media_interpretations_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "knowledge_document_versions"
  ADD CONSTRAINT "knowledge_versions_positive_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "knowledge_versions_effective_range_check"
    CHECK ("effective_until" IS NULL OR "effective_from" IS NULL OR "effective_until" > "effective_from");

ALTER TABLE "agent_execution_knowledge_sources"
  ADD CONSTRAINT "agent_knowledge_sources_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "registration_data_reviews"
  ADD CONSTRAINT "registration_data_reviews_resolution_check"
    CHECK (
      ("status" = 'pending'::"RegistrationDataReviewStatus" AND "reviewed_at" IS NULL AND "reviewed_by_user_id" IS NULL)
      OR
      ("status" <> 'pending'::"RegistrationDataReviewStatus" AND "reviewed_at" IS NOT NULL AND "reviewed_by_user_id" IS NOT NULL)
    );

-- One active/foreground/primary projection at a time. These are partial
-- indexes because closed/history rows remain retained indefinitely.
-- Existing channel preferences are intentionally preserved. Only channels
-- created after this migration ingest fromMe/group events by default so they
-- can classify external-human takeovers and synchronize groups with AI OFF.
ALTER TABLE "whatsapp_channels"
  ALTER COLUMN "ignore_from_me" SET DEFAULT false,
  ALTER COLUMN "ignore_groups" SET DEFAULT false;

CREATE UNIQUE INDEX "service_sessions_one_foreground_per_thread_key"
  ON "service_sessions"("company_id", "thread_id")
  WHERE "is_foreground" = true AND "status" <> 'closed'::"ServiceSessionStatus";

CREATE UNIQUE INDEX "service_assignments_one_active_per_session_key"
  ON "service_session_assignments"("company_id", "service_session_id")
  WHERE "status" = 'active'::"ServiceAssignmentStatus";

CREATE UNIQUE INDEX "conversation_participants_one_primary_key"
  ON "conversation_participants"("company_id", "service_session_id")
  WHERE "is_primary" = true AND "valid_until" IS NULL;

CREATE UNIQUE INDEX "agent_prompt_versions_one_active_key"
  ON "agent_prompt_versions"("company_id", "agent_id", "kind")
  WHERE "status" = 'active'::"AgentVersionStatus";

CREATE UNIQUE INDEX "agent_runtime_configs_one_active_key"
  ON "agent_runtime_config_versions"("company_id", "agent_id")
  WHERE "status" = 'active'::"AgentVersionStatus";

CREATE UNIQUE INDEX "agent_runtime_configs_active_credential_ref_key"
  ON "agent_runtime_config_versions"("company_id", "credential_ref")
  WHERE "status" = 'active'::"AgentVersionStatus";

CREATE UNIQUE INDEX "knowledge_versions_one_published_key"
  ON "knowledge_document_versions"("company_id", "document_id")
  WHERE "status" = 'published'::"KnowledgeVersionStatus";

-- Technical Evolution identifiers and the originating channel are immutable.
CREATE OR REPLACE FUNCTION lume_protect_whatsapp_channel_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."instance_name" IS DISTINCT FROM OLD."instance_name" THEN
    RAISE EXCEPTION 'Evolution instance_name is immutable for WhatsApp channel %', OLD."id";
  END IF;

  IF OLD."evolution_instance_id" IS NOT NULL
     AND NEW."evolution_instance_id" IS DISTINCT FROM OLD."evolution_instance_id" THEN
    RAISE EXCEPTION 'Evolution instance_id is immutable once assigned for WhatsApp channel %', OLD."id";
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "whatsapp_channels_protect_instance_identity"
BEFORE UPDATE OF "instance_name", "evolution_instance_id"
ON "whatsapp_channels"
FOR EACH ROW EXECUTE FUNCTION lume_protect_whatsapp_channel_identity();

CREATE OR REPLACE FUNCTION lume_protect_service_origin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
     OR NEW."source_channel_id" IS DISTINCT FROM OLD."source_channel_id" THEN
    RAISE EXCEPTION 'ServiceSession thread/source channel are immutable for session %', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "service_sessions_protect_origin"
BEFORE UPDATE OF "thread_id", "source_channel_id"
ON "service_sessions"
FOR EACH ROW EXECUTE FUNCTION lume_protect_service_origin();

-- Command ledgers are append-only.
CREATE OR REPLACE FUNCTION lume_reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Operational event ledger % is append-only', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER "whatsapp_channel_events_append_only"
BEFORE UPDATE OR DELETE ON "whatsapp_channel_events"
FOR EACH ROW EXECUTE FUNCTION lume_reject_event_mutation();

CREATE TRIGGER "service_session_events_append_only"
BEFORE UPDATE OR DELETE ON "service_session_events"
FOR EACH ROW EXECUTE FUNCTION lume_reject_event_mutation();

-- Prompt/config payloads are immutable versions. Lifecycle status/timestamps
-- may change, but a content/model/credential change requires a new version.
CREATE OR REPLACE FUNCTION lume_protect_agent_prompt_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(NEW."company_id", NEW."agent_id", NEW."kind", NEW."version", NEW."content", NEW."content_hash")
     IS DISTINCT FROM
     ROW(OLD."company_id", OLD."agent_id", OLD."kind", OLD."version", OLD."content", OLD."content_hash") THEN
    RAISE EXCEPTION 'Agent prompt version payload is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "agent_prompt_versions_immutable_payload"
BEFORE UPDATE ON "agent_prompt_versions"
FOR EACH ROW EXECUTE FUNCTION lume_protect_agent_prompt_version();

CREATE OR REPLACE FUNCTION lume_protect_agent_runtime_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
       NEW."company_id", NEW."agent_id", NEW."version", NEW."provider",
       NEW."model", NEW."credential_ref", NEW."credential_identifier",
       NEW."credential_version", NEW."parameters"
     ) IS DISTINCT FROM ROW(
       OLD."company_id", OLD."agent_id", OLD."version", OLD."provider",
       OLD."model", OLD."credential_ref", OLD."credential_identifier",
       OLD."credential_version", OLD."parameters"
     ) THEN
    RAISE EXCEPTION 'Agent runtime config version payload is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "agent_runtime_configs_immutable_payload"
BEFORE UPDATE ON "agent_runtime_config_versions"
FOR EACH ROW EXECUTE FUNCTION lume_protect_agent_runtime_version();

-- Published knowledge and its chunks cannot be overwritten. Status may move
-- from published to superseded/archived while the content remains intact.
CREATE OR REPLACE FUNCTION lume_protect_knowledge_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft'::"KnowledgeVersionStatus" THEN
      RAISE EXCEPTION 'Published knowledge versions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" <> 'draft'::"KnowledgeVersionStatus"
     AND ROW(
       NEW."company_id", NEW."document_id", NEW."version", NEW."content",
       NEW."storage_key", NEW."file_name", NEW."mime_type", NEW."size_bytes",
       NEW."sha256", NEW."provenance", NEW."effective_from", NEW."effective_until",
       NEW."published_by_user_id", NEW."published_at"
     ) IS DISTINCT FROM ROW(
       OLD."company_id", OLD."document_id", OLD."version", OLD."content",
       OLD."storage_key", OLD."file_name", OLD."mime_type", OLD."size_bytes",
       OLD."sha256", OLD."provenance", OLD."effective_from", OLD."effective_until",
       OLD."published_by_user_id", OLD."published_at"
     ) THEN
    RAISE EXCEPTION 'Published knowledge version payload is immutable';
  END IF;

  IF OLD."status" = 'published'::"KnowledgeVersionStatus"
     AND NEW."status" NOT IN (
       'published'::"KnowledgeVersionStatus",
       'superseded'::"KnowledgeVersionStatus",
       'archived'::"KnowledgeVersionStatus"
     ) THEN
    RAISE EXCEPTION 'Published knowledge version status cannot move backwards';
  ELSIF OLD."status" = 'superseded'::"KnowledgeVersionStatus"
        AND NEW."status" NOT IN (
          'superseded'::"KnowledgeVersionStatus",
          'archived'::"KnowledgeVersionStatus"
        ) THEN
    RAISE EXCEPTION 'Superseded knowledge version status cannot move backwards';
  ELSIF OLD."status" = 'archived'::"KnowledgeVersionStatus"
        AND NEW."status" <> 'archived'::"KnowledgeVersionStatus" THEN
    RAISE EXCEPTION 'Archived knowledge version status is terminal';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "knowledge_versions_immutable_payload"
BEFORE UPDATE OR DELETE ON "knowledge_document_versions"
FOR EACH ROW EXECUTE FUNCTION lume_protect_knowledge_version();

CREATE OR REPLACE FUNCTION lume_protect_knowledge_chunk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status "KnowledgeVersionStatus";
  parent_id UUID;
  tenant_id UUID;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."document_version_id" ELSE NEW."document_version_id" END;
  tenant_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."company_id" ELSE NEW."company_id" END;

  SELECT version."status"
  INTO parent_status
  FROM "knowledge_document_versions" version
  WHERE version."id" = parent_id
    AND version."company_id" = tenant_id;

  IF parent_status IS DISTINCT FROM 'draft'::"KnowledgeVersionStatus" THEN
    RAISE EXCEPTION 'Chunks of a non-draft knowledge version are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "knowledge_chunks_follow_version_immutability"
BEFORE INSERT OR UPDATE OR DELETE ON "knowledge_chunks"
FOR EACH ROW EXECUTE FUNCTION lume_protect_knowledge_chunk();

-- Video may be retained, but never receives an AI interpretation in this
-- feature. An UNSUPPORTED marker remains allowed for observability.
CREATE OR REPLACE FUNCTION lume_reject_video_interpretation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  asset_type "MediaAssetType";
BEGIN
  SELECT asset."type"
  INTO asset_type
  FROM "media_assets" asset
  WHERE asset."id" = NEW."media_asset_id"
    AND asset."company_id" = NEW."company_id";

  IF asset_type = 'video'::"MediaAssetType"
     AND NEW."status" <> 'unsupported'::"MediaInterpretationStatus" THEN
    RAISE EXCEPTION 'Video interpretation is not supported';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "media_interpretations_reject_video_analysis"
BEFORE INSERT OR UPDATE ON "media_interpretations"
FOR EACH ROW EXECUTE FUNCTION lume_reject_video_interpretation();

-- Operational records are retained. Lifecycle is expressed with
-- cancel/disable/close/archive/status columns rather than DELETE.
CREATE OR REPLACE FUNCTION lume_reject_operational_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Physical deletion is disabled for operational table %', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER "whatsapp_channels_no_physical_delete"
BEFORE DELETE ON "whatsapp_channels"
FOR EACH ROW EXECUTE FUNCTION lume_reject_operational_delete();

CREATE TRIGGER "service_sessions_no_physical_delete"
BEFORE DELETE ON "service_sessions"
FOR EACH ROW EXECUTE FUNCTION lume_reject_operational_delete();

CREATE TRIGGER "agent_executions_no_physical_delete"
BEFORE DELETE ON "agent_executions"
FOR EACH ROW EXECUTE FUNCTION lume_reject_operational_delete();

CREATE TRIGGER "registration_data_reviews_no_physical_delete"
BEFORE DELETE ON "registration_data_reviews"
FOR EACH ROW EXECUTE FUNCTION lume_reject_operational_delete();
