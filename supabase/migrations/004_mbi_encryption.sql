-- 004_mbi_encryption.sql
-- ════════════════════════════════════════════════════════════════════
-- At-rest MBI encryption + security PIN hashing on supplement_applications
-- ════════════════════════════════════════════════════════════════════
--
-- W1 audit MEDIUM #18 + #19 flagged plaintext mbi_number + security_pin
-- columns on supplement_applications. CMS retired SSN-based HICN partly
-- because of breach exposure; NIST SP 800-63B Appendix A.3 requires PIN
-- verifier secrets to be stored as one-way hashes; HIPAA Security Rule
-- §164.312(a)(2)(iv) requires encryption-or-equivalent on PHI at rest.
--
-- This migration is ADDITIVE: the existing mbi_number + security_pin
-- columns are NOT dropped here. A follow-up migration (after every
-- consumer build that writes the new columns has been deployed AND any
-- legacy plaintext rows have been backfilled into the encrypted forms)
-- can DROP them. The application code already routes new writes through
-- the new columns — this migration just makes them exist.
--
-- Regulation: HIPAA Security Rule 45 CFR §164.312(a)(2)(iv); CMS NGD
-- MBI guidance; NIST SP 800-63B Appendix A.3.
--
-- ⚠ EXECUTION SAFETY
--
-- 1. DO NOT run this against the live Plan Match Production Supabase
--    project (rpcbrkmvalvdmroqzpaq) until Rob has confirmed:
--    a. ENCRYPTION_KEY is set in the Vercel plan-match-supplement
--       project for Production + Preview environments.
--    b. The application code that writes encrypted_mbi / mbi_last4 /
--       pin_hash is deployed and a fresh test submission round-trips
--       end-to-end.
-- 2. Re-running is safe — every clause uses IF NOT EXISTS / IF EXISTS.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS public.supplement_applications
  ADD COLUMN IF NOT EXISTS encrypted_mbi text,
  ADD COLUMN IF NOT EXISTS mbi_last4 varchar(4),
  ADD COLUMN IF NOT EXISTS mbi_masked text,
  ADD COLUMN IF NOT EXISTS pin_hash varchar(64);

-- Index on mbi_last4 so the agent-side "find by last-4" caller-verification
-- query (used by Rob during inbound calls) doesn't full-scan a table that
-- grows monotonically with every new enrollment.
CREATE INDEX IF NOT EXISTS supplement_applications_mbi_last4_idx
  ON public.supplement_applications (mbi_last4)
  WHERE mbi_last4 IS NOT NULL;

COMMENT ON COLUMN public.supplement_applications.encrypted_mbi IS
  'AES-256-GCM ciphertext of the full MBI, base64(iv ‖ authTag ‖ ciphertext). '
  'See api/_lib/crypto.ts for the encryption helper. Decrypt only at carrier '
  'submission time; the agent UI uses mbi_last4 + mbi_masked for caller '
  'verification.';

COMMENT ON COLUMN public.supplement_applications.mbi_last4 IS
  'Last 4 chars of the MBI. Display-safe; indexed for caller verification '
  'lookups. Same value as encrypt(mbi).slice(-4).';

COMMENT ON COLUMN public.supplement_applications.mbi_masked IS
  'Display form for the agent UI, e.g. "*******1234". Pre-computed at write '
  'time so the agent can render the masked identifier without ever calling '
  'decrypt().';

COMMENT ON COLUMN public.supplement_applications.pin_hash IS
  'SHA-256 hex hash of the 4-digit security PIN. The verify-on-call flow '
  'compares against this hash; the original PIN is no longer recoverable '
  'from the DB. NIST SP 800-63B Appendix A.3.';

-- Note: mbi_number + security_pin are intentionally NOT dropped here.
-- After the application has been writing encrypted values for at least
-- one AEP / OEP cycle and any legacy plaintext rows have been backfilled,
-- a follow-up migration can DROP them:
--
--   ALTER TABLE public.supplement_applications
--     DROP COLUMN IF EXISTS mbi_number,
--     DROP COLUMN IF EXISTS security_pin;
