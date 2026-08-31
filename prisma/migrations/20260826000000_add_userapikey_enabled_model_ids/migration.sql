-- Migration: add_userapikey_enabled_model_ids
-- Add model-level filtering capability to UserApiKey table.
-- Allows specifying which models can be used with a given API key.

BEGIN;

ALTER TABLE pm."UserApiKey"
  ADD COLUMN IF NOT EXISTS "enabledModelIds" JSONB;

-- Index for efficient querying of model filtering
CREATE INDEX IF NOT EXISTS "UserApiKey_enabledModelIds_idx" ON pm."UserApiKey" USING GIN ("enabledModelIds");

COMMIT;
