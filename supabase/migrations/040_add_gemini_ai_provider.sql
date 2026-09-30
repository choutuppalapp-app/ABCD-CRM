-- ============================================================
-- 040_add_gemini_ai_provider.sql — Add Google Gemini as AI provider
--
-- Expands the ai_configs provider check constraint to allow 'gemini'.
-- ============================================================

DO $$
BEGIN
  ALTER TABLE IF EXISTS ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
  ALTER TABLE IF EXISTS ai_configs ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'gemini'));
END $$;
