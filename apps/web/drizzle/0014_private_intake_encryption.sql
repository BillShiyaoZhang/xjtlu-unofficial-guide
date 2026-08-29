ALTER TABLE `research_intakes` ADD `payload_ciphertext` text;
--> statement-breakpoint
ALTER TABLE `research_intakes` ADD `payload_key_version` integer;
--> statement-breakpoint
DROP TRIGGER `trg_research_intakes_validate_expiry_purge`;
--> statement-breakpoint
CREATE TRIGGER `trg_research_intakes_validate_expiry_purge`
BEFORE UPDATE OF `status` ON `research_intakes`
WHEN NEW.`status` = 'expired' AND NEW.`status` IS NOT OLD.`status`
BEGIN
  SELECT CASE WHEN NEW.`expires_at` > unixepoch()
    OR NEW.`purged_at` IS NULL
    OR NEW.`participant_ref_hash` != 'purged'
    OR NEW.`body` IS NOT NULL
    OR NEW.`source_url` IS NOT NULL
    OR NEW.`provenance_role` IS NOT NULL
    OR NEW.`payload_ciphertext` IS NOT NULL
    OR NEW.`payload_key_version` IS NOT NULL
    THEN RAISE(ABORT, 'invalid_research_intake_expiry_purge') END;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_research_intake_encrypted_payload_immutable`
BEFORE UPDATE OF `payload_ciphertext`, `payload_key_version` ON `research_intakes`
WHEN OLD.`payload_ciphertext` IS NOT NULL
  AND NEW.`status` != 'expired'
  AND (NEW.`payload_ciphertext` IS NOT OLD.`payload_ciphertext`
       OR NEW.`payload_key_version` IS NOT OLD.`payload_key_version`)
BEGIN
  SELECT RAISE(ABORT, 'research_intake_payload_immutable');
END;
--> statement-breakpoint
PRAGMA optimize;
