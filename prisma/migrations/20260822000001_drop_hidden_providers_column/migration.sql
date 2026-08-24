-- Migration: drop_hidden_providers_column
-- Remove hiddenProviders column from UserAiModelPreference table.
-- This column was used for blocking site-inherited providers in Pi Workspace,
-- which is no longer needed after Unified Model Registry refactoring.
--
-- Revert: If needed, restore with:
-- ALTER TABLE pm."UserAiModelPreference" ADD COLUMN IF NOT EXISTS "hiddenProviders" TEXT;

BEGIN;

-- Drop the column (IF EXISTS for safety)
ALTER TABLE pm."UserAiModelPreference" DROP COLUMN IF EXISTS "hiddenProviders";

-- Clean up any orphaned rows that were using magic provider/modelId values
-- These rows should not exist but we clean them up just in case
DELETE FROM pm."UserAiModelPreference"
WHERE "provider" = '__projecthub__' AND "modelId" = '__hidden_inherited_providers__';

COMMIT;
