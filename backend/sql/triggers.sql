-- ============================================================================
-- triggers.sql
--
-- Every trigger here earns its place: it enforces an invariant or records
-- history that the application layer must not be trusted to get right, because
-- the rule must hold even for direct SQL issued at the mysql prompt (which is
-- exactly what happens during a viva demonstration).
--
-- Triggers deliberately NOT created:
--   * "recalculate inventory totals"  -> derived data, computed by views instead
--   * "send email"                    -> side effects outside the transaction
-- ============================================================================

USE blood_organ_network;

DROP TRIGGER IF EXISTS trg_blood_units_before_insert;
DROP TRIGGER IF EXISTS trg_blood_units_before_update;
DROP TRIGGER IF EXISTS trg_blood_units_after_update;
DROP TRIGGER IF EXISTS trg_blood_allocations_before_insert;
DROP TRIGGER IF EXISTS trg_blood_donations_after_insert;
DROP TRIGGER IF EXISTS trg_blood_donations_after_update;
DROP TRIGGER IF EXISTS trg_blood_requests_after_update;
DROP TRIGGER IF EXISTS trg_available_organs_before_insert;
DROP TRIGGER IF EXISTS trg_organ_matches_after_update;
DROP TRIGGER IF EXISTS trg_users_after_insert;

DELIMITER $$

-- ---------------------------------------------------------------------------
-- TRIGGER 1  trg_blood_units_before_insert
-- Purpose : derive expiry_date from the component's shelf life when the caller
--           does not supply one, so expiry can never be forgotten or invented.
--           shelf_life_days lives on blood_components (3NF); this trigger is
--           what connects that reference data to each physical bag.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_blood_units_before_insert
BEFORE INSERT ON blood_units
FOR EACH ROW
BEGIN
  DECLARE v_shelf_life SMALLINT UNSIGNED;

  IF NEW.expiry_date IS NULL THEN
    SELECT shelf_life_days INTO v_shelf_life
      FROM blood_components WHERE component_id = NEW.component_id;
    SET NEW.expiry_date = DATE_ADD(NEW.collection_date, INTERVAL v_shelf_life DAY);
  END IF;

  -- A bag that arrives already past its expiry is never sellable stock.
  IF NEW.expiry_date <= CURDATE() AND NEW.status = 'AVAILABLE' THEN
    SET NEW.status = 'EXPIRED';
  END IF;
END$$

-- ---------------------------------------------------------------------------
-- TRIGGER 2  trg_blood_units_before_update
-- Purpose : enforce the blood-unit lifecycle.  Without this a bug (or a manual
--           UPDATE) could move a TRANSFUSED bag back to AVAILABLE and put an
--           already-used unit back into circulation.
--           Legal transitions:
--             QUARANTINED -> AVAILABLE | DISCARDED | EXPIRED
--             AVAILABLE   -> RESERVED  | EXPIRED   | DISCARDED
--             RESERVED    -> ISSUED    | AVAILABLE | DISCARDED | EXPIRED
--             ISSUED      -> TRANSFUSED| DISCARDED
--             TRANSFUSED / DISCARDED   -> terminal
--             EXPIRED     -> DISCARDED
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_blood_units_before_update
BEFORE UPDATE ON blood_units
FOR EACH ROW
BEGIN
  DECLARE v_ok BOOLEAN DEFAULT TRUE;

  IF NEW.status <> OLD.status THEN
    CASE OLD.status
      WHEN 'QUARANTINED' THEN SET v_ok = NEW.status IN ('AVAILABLE','DISCARDED','EXPIRED');
      WHEN 'AVAILABLE'   THEN SET v_ok = NEW.status IN ('RESERVED','EXPIRED','DISCARDED');
      WHEN 'RESERVED'    THEN SET v_ok = NEW.status IN ('ISSUED','AVAILABLE','DISCARDED','EXPIRED');
      WHEN 'ISSUED'      THEN SET v_ok = NEW.status IN ('TRANSFUSED','DISCARDED');
      WHEN 'EXPIRED'     THEN SET v_ok = NEW.status IN ('DISCARDED');
      ELSE SET v_ok = FALSE;   -- TRANSFUSED and DISCARDED are terminal
    END CASE;

    IF NOT v_ok THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Illegal blood unit status transition';
    END IF;
  END IF;
END$$

-- ---------------------------------------------------------------------------
-- TRIGGER 3  trg_blood_units_after_update
-- Purpose : write an immutable audit trail of inventory status changes.
--           Recorded with source='TRIGGER' so audit entries written by the
--           database can be told apart from those written by the API.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_blood_units_after_update
AFTER UPDATE ON blood_units
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source)
    VALUES (NULL, 'BLOOD_UNIT_STATUS_CHANGE', 'blood_units', NEW.blood_unit_id,
            CONCAT('Unit ', NEW.unit_code, ': ', OLD.status, ' -> ', NEW.status),
            'TRIGGER');
  END IF;
END$$

-- ---------------------------------------------------------------------------
-- TRIGGER 4  trg_blood_allocations_before_insert
-- Purpose : THE double-allocation guard.  A unit may only be allocated while it
--           is AVAILABLE and unexpired.  This is the database-level invariant
--           behind the "never allocate the same unit twice" requirement; the
--           allocation procedure additionally locks rows with SELECT ... FOR
--           UPDATE, but this trigger holds even for hand-written SQL.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_blood_allocations_before_insert
BEFORE INSERT ON blood_allocations
FOR EACH ROW
BEGIN
  DECLARE v_status VARCHAR(20);
  DECLARE v_expiry DATE;

  SELECT status, expiry_date INTO v_status, v_expiry
    FROM blood_units WHERE blood_unit_id = NEW.blood_unit_id;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Allocation failed: blood unit does not exist';
  END IF;

  IF v_status <> 'AVAILABLE' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Allocation failed: blood unit is not AVAILABLE (already allocated, issued or discarded)';
  END IF;

  IF v_expiry <= CURDATE() THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Allocation failed: blood unit has expired';
  END IF;
END$$

-- ---------------------------------------------------------------------------
-- TRIGGER 5  trg_blood_donations_after_insert
-- Purpose : maintain the donor's derived donation state.  Keeping this in the
--           database guarantees donors.total_donations can never drift away
--           from the blood_donations rows, whatever inserts them.
--           A donor becomes temporarily ineligible for 90 days after donating.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_blood_donations_after_insert
AFTER INSERT ON blood_donations
FOR EACH ROW
BEGIN
  UPDATE donors
     SET last_donation_date = NEW.donation_date,
         total_donations    = total_donations + 1,
         eligibility_status = CASE
           WHEN eligibility_status = 'INELIGIBLE' THEN 'INELIGIBLE'
           ELSE 'TEMPORARILY_INELIGIBLE'
         END
   WHERE donor_id = NEW.donor_id;

  INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source)
  VALUES (NEW.recorded_by, 'DONATION_RECORDED', 'blood_donations', NEW.donation_id,
          CONCAT('Donation of ', NEW.volume_ml, 'ml recorded for donor #', NEW.donor_id),
          'TRIGGER');
END$$

-- ---------------------------------------------------------------------------
-- TRIGGER 6  trg_blood_donations_after_update
-- Purpose : a failed infectious-disease screen must immediately quarantine and
--           discard every unit produced from that donation.  This is a safety
--           invariant that must not depend on application code remembering.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_blood_donations_after_update
AFTER UPDATE ON blood_donations
FOR EACH ROW
BEGIN
  IF NEW.screening_status <> OLD.screening_status THEN
    IF NEW.screening_status = 'FAILED' THEN
      UPDATE blood_units
         SET status = 'DISCARDED'
       WHERE donation_id = NEW.donation_id
         AND status IN ('QUARANTINED','AVAILABLE');

      INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source)
      VALUES (NULL, 'SCREENING_FAILED', 'blood_donations', NEW.donation_id,
              'Screening failed - all derived units discarded', 'TRIGGER');

    ELSEIF NEW.screening_status = 'PASSED' THEN
      UPDATE blood_units
         SET status = 'AVAILABLE'
       WHERE donation_id = NEW.donation_id
         AND status = 'QUARANTINED'
         AND expiry_date > CURDATE();

      INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source)
      VALUES (NULL, 'SCREENING_PASSED', 'blood_donations', NEW.donation_id,
              'Screening passed - derived units released to inventory', 'TRIGGER');
    END IF;
  END IF;
END$$

-- ---------------------------------------------------------------------------
-- TRIGGER 7  trg_blood_requests_after_update
-- Purpose : audit the request workflow and notify the requester in the same
--           transaction as the status change, so a committed status change can
--           never exist without its notification.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_blood_requests_after_update
AFTER UPDATE ON blood_requests
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source)
    VALUES (NULL, 'BLOOD_REQUEST_STATUS_CHANGE', 'blood_requests', NEW.blood_request_id,
            CONCAT('Request ', NEW.request_code, ': ', OLD.status, ' -> ', NEW.status), 'TRIGGER');

    IF NEW.created_by IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, message, type, entity_name, entity_id)
      VALUES (NEW.created_by,
              CONCAT('Blood request ', NEW.request_code, ' is now ', NEW.status),
              CONCAT('Your request for ', NEW.units_required, ' unit(s) moved from ',
                     OLD.status, ' to ', NEW.status, '.'),
              CASE NEW.status
                WHEN 'FULFILLED' THEN 'SUCCESS'
                WHEN 'ALLOCATED' THEN 'SUCCESS'
                WHEN 'REJECTED'  THEN 'WARNING'
                WHEN 'EXPIRED'   THEN 'WARNING'
                ELSE 'INFO' END,
              'blood_requests', NEW.blood_request_id);
    END IF;
  END IF;
END$$

-- ---------------------------------------------------------------------------
-- TRIGGER 8  trg_available_organs_before_insert
-- Purpose : derive the viability deadline from the organ type's maximum cold
--           ischemia time.  Like trigger 1, this binds reference data to each
--           recorded organ so the deadline cannot be mistyped.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_available_organs_before_insert
BEFORE INSERT ON available_organs
FOR EACH ROW
BEGIN
  DECLARE v_hours SMALLINT UNSIGNED;

  IF NEW.viable_until IS NULL THEN
    SELECT max_cold_ischemia_hours INTO v_hours
      FROM organ_types WHERE organ_type_id = NEW.organ_type_id;
    SET NEW.viable_until = DATE_ADD(NEW.recovered_at, INTERVAL v_hours HOUR);
  END IF;
END$$

-- ---------------------------------------------------------------------------
-- TRIGGER 9  trg_organ_matches_after_update
-- Purpose : audit clinical match decisions (accept / reject / allocate), which
--           is the part of the organ workflow that most needs traceability.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_organ_matches_after_update
AFTER UPDATE ON organ_matches
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source)
    VALUES (NEW.decided_by, 'ORGAN_MATCH_STATUS_CHANGE', 'organ_matches', NEW.match_id,
            CONCAT('Match #', NEW.match_id, ' (score ', NEW.compatibility_score, '): ',
                   OLD.status, ' -> ', NEW.status),
            'TRIGGER');
  END IF;
END$$

-- ---------------------------------------------------------------------------
-- TRIGGER 10  trg_users_after_insert
-- Purpose : audit account creation and greet the new account.  Gives every
--           dashboard at least one notification from the moment of signup.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_users_after_insert
AFTER INSERT ON users
FOR EACH ROW
BEGIN
  INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source)
  VALUES (NEW.user_id, 'USER_REGISTERED', 'users', NEW.user_id,
          CONCAT('New ', NEW.role, ' account: ', NEW.email), 'TRIGGER');

  INSERT INTO notifications (user_id, title, message, type)
  VALUES (NEW.user_id, 'Welcome to the Blood & Organ Availability Network',
          CONCAT('Your ', REPLACE(NEW.role,'_',' '), ' account has been created. ',
                 'This platform is an academic simulation.'),
          'INFO');
END$$

DELIMITER ;
