-- Manual migration: persist_hidden_inherited_providers
-- User-level override for Pi Workspace inherited Provider visibility.
-- Existing rows remain valid: NULL is interpreted as an empty hidden-provider list.

BEGIN;

ALTER TABLE pm."UserAiModelPreference"
  ADD COLUMN IF NOT EXISTS "hiddenProviders" TEXT;

COMMIT;
