-- ============================================================================
-- procedures.sql   -   stored functions and procedures
--
-- Each routine here exists because the logic is fundamentally set-based or must
-- be atomic.  Business rules that are merely "if/else over one row" are left in
-- the application layer where they are easier to test.
-- ============================================================================

USE blood_organ_network;

DROP FUNCTION  IF EXISTS fn_calculate_age;
DROP FUNCTION  IF EXISTS fn_blood_compatible;
DROP FUNCTION  IF EXISTS fn_compatible_unit_count;
DROP PROCEDURE IF EXISTS sp_rebuild_blood_compatibility;
DROP PROCEDURE IF EXISTS sp_search_available_blood;
DROP PROCEDURE IF EXISTS sp_get_compatible_blood_units;
DROP PROCEDURE IF EXISTS sp_allocate_blood_request;
DROP PROCEDURE IF EXISTS sp_find_organ_matches;
DROP PROCEDURE IF EXISTS sp_expire_stale_records;

DELIMITER $$

-- ===========================================================================
-- FUNCTION fn_calculate_age
-- Age in whole years.  Used by dashboards, the organ age-compatibility score
-- and eligibility checks, so it must be defined exactly once.
-- ===========================================================================
CREATE FUNCTION fn_calculate_age(p_dob DATE)
RETURNS INT
DETERMINISTIC
READS SQL DATA
BEGIN
  IF p_dob IS NULL THEN RETURN NULL; END IF;
  RETURN TIMESTAMPDIFF(YEAR, p_dob, CURDATE());
END$$

-- ===========================================================================
-- FUNCTION fn_blood_compatible
-- Single point of truth for "may this donor group be given to this recipient
-- group, for this component".  Reads the blood_compatibility relation rather
-- than re-deriving the rule, so SQL, the API and the UI can never disagree.
-- ===========================================================================
CREATE FUNCTION fn_blood_compatible(
  p_donor_group_id     TINYINT UNSIGNED,
  p_recipient_group_id TINYINT UNSIGNED,
  p_component_id       TINYINT UNSIGNED
)
RETURNS BOOLEAN
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE v_ok BOOLEAN DEFAULT FALSE;
  SELECT is_compatible INTO v_ok
    FROM blood_compatibility
   WHERE donor_group_id     = p_donor_group_id
     AND recipient_group_id = p_recipient_group_id
     AND component_id       = p_component_id;
  RETURN COALESCE(v_ok, FALSE);
END$$

-- ===========================================================================
-- FUNCTION fn_compatible_unit_count
-- How many unexpired, AVAILABLE units could serve this recipient group for
-- this component, across the whole network.  Used on the availability page and
-- in the "can this request be met?" check.
-- ===========================================================================
CREATE FUNCTION fn_compatible_unit_count(
  p_recipient_group_id TINYINT UNSIGNED,
  p_component_id       TINYINT UNSIGNED
)
RETURNS INT
DETERMINISTIC
READS SQL DATA
BEGIN
  DECLARE v_count INT DEFAULT 0;
  SELECT COUNT(*) INTO v_count
    FROM blood_units bu
    JOIN blood_compatibility bc
      ON bc.donor_group_id = bu.blood_group_id
     AND bc.component_id   = bu.component_id
   WHERE bc.recipient_group_id = p_recipient_group_id
     AND bc.component_id       = p_component_id
     AND bc.is_compatible      = TRUE
     AND bu.component_id       = p_component_id
     AND bu.status             = 'AVAILABLE'
     AND bu.expiry_date        > CURDATE();
  RETURN v_count;
END$$

-- ===========================================================================
-- PROCEDURE sp_rebuild_blood_compatibility
-- Derives the full 8 x 8 x n compatibility matrix from the antigen flags on
-- blood_groups and the rule direction on blood_components, using a CROSS JOIN.
--
-- Why a procedure rather than 320 literal INSERT statements: the matrix is a
-- pure function of the reference data.  Typing it by hand invites a silent
-- error (giving A+ blood to an O- patient), and adding a new component would
-- mean hand-writing 64 more rows.
--
-- ABO/Rh rules implemented (red-cell transfusion, textbook form):
--   CELLULAR (whole blood, red cells, platelets)
--       donor antigens must be a SUBSET of recipient antigens
--       => O- is the universal donor, AB+ the universal recipient
--   PLASMA (plasma, cryoprecipitate)
--       donor plasma carries antibodies against the antigens the donor lacks,
--       so the rule reverses: recipient antigens must be a subset of donor's
--       => AB is the universal plasma donor, O the universal plasma recipient
--       RhD is not considered for plasma components.
-- ===========================================================================
CREATE PROCEDURE sp_rebuild_blood_compatibility()
MODIFIES SQL DATA
BEGIN
  DELETE FROM blood_compatibility;

  INSERT INTO blood_compatibility
        (donor_group_id, recipient_group_id, component_id, is_compatible, rule_note)
  SELECT d.blood_group_id,
         r.blood_group_id,
         c.component_id,
         CASE c.match_direction
           WHEN 'CELLULAR' THEN (d.has_a <= r.has_a AND d.has_b <= r.has_b AND d.has_rh_d <= r.has_rh_d)
           WHEN 'PLASMA'   THEN (r.has_a <= d.has_a AND r.has_b <= d.has_b)
         END,
         CASE
           WHEN c.match_direction = 'CELLULAR'
                AND (d.has_a <= r.has_a AND d.has_b <= r.has_b AND d.has_rh_d <= r.has_rh_d)
             THEN CONCAT(d.group_code, ' red cells carry no antigen absent in ', r.group_code)
           WHEN c.match_direction = 'PLASMA'
                AND (r.has_a <= d.has_a AND r.has_b <= d.has_b)
             THEN CONCAT(d.group_code, ' plasma carries no antibody against ', r.group_code)
           WHEN c.match_direction = 'CELLULAR'
             THEN CONCAT('Incompatible: ', d.group_code, ' carries an antigen ', r.group_code, ' would react to')
           ELSE CONCAT('Incompatible: ', d.group_code, ' plasma carries an antibody against ', r.group_code)
         END
    FROM blood_groups d
   CROSS JOIN blood_groups r
   CROSS JOIN blood_components c;
END$$

-- ===========================================================================
-- PROCEDURE sp_search_available_blood
-- The availability search behind /api/blood/availability.
-- Aggregation deliberately happens in SQL (GROUP BY + conditional SUM), not in
-- JavaScript: the database can answer this from the idx_bu_search index without
-- shipping every individual bag to the application.
-- All parameters are optional (pass NULL to ignore that filter).
-- ===========================================================================
CREATE PROCEDURE sp_search_available_blood(
  IN p_recipient_group_id TINYINT UNSIGNED,   -- NULL = do not filter by compatibility
  IN p_component_id       TINYINT UNSIGNED,
  IN p_city_id            INT UNSIGNED,
  IN p_blood_bank_id      INT UNSIGNED,
  IN p_min_units          INT
)
READS SQL DATA
BEGIN
  SELECT
      bb.blood_bank_id,
      bb.name                                   AS blood_bank,
      ci.name                                   AS city,
      ci.state,
      bg.group_code                             AS blood_group,
      bc.name                                   AS component,
      COUNT(*)                                  AS available_units,
      SUM(bu.volume_ml)                         AS total_volume_ml,
      MIN(bu.expiry_date)                       AS earliest_expiry,
      SUM(CASE WHEN bu.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
               THEN 1 ELSE 0 END)               AS expiring_within_7_days
    FROM blood_units  bu
    JOIN blood_banks  bb ON bb.blood_bank_id = bu.blood_bank_id
    JOIN cities       ci ON ci.city_id       = bb.city_id
    JOIN blood_groups bg ON bg.blood_group_id = bu.blood_group_id
    JOIN blood_components bc ON bc.component_id = bu.component_id
   WHERE bu.status      = 'AVAILABLE'
     AND bu.expiry_date > CURDATE()
     AND bb.status      = 'ACTIVE'
     AND (p_component_id  IS NULL OR bu.component_id  = p_component_id)
     AND (p_city_id       IS NULL OR bb.city_id       = p_city_id)
     AND (p_blood_bank_id IS NULL OR bb.blood_bank_id = p_blood_bank_id)
     AND (p_recipient_group_id IS NULL
          OR fn_blood_compatible(bu.blood_group_id, p_recipient_group_id, bu.component_id))
   GROUP BY bb.blood_bank_id, bb.name, ci.name, ci.state, bg.group_code, bc.name
  HAVING COUNT(*) >= COALESCE(p_min_units, 1)
   ORDER BY available_units DESC, earliest_expiry ASC;
END$$

-- ===========================================================================
-- PROCEDURE sp_get_compatible_blood_units
-- Lists the individual units that COULD satisfy a request, in the order the
-- allocator would take them.  Drives the "preview matches" screen, so the user
-- sees exactly what allocation is about to do.
--
-- Ordering policy (also used by sp_allocate_blood_request):
--   1. exact blood-group match first   (preserve rare universal stock)
--   2. same city as the requesting hospital  (shorter cold chain)
--   3. first-expiring-first-out        (minimise wastage)
-- ===========================================================================
CREATE PROCEDURE sp_get_compatible_blood_units(IN p_request_id INT UNSIGNED)
READS SQL DATA
BEGIN
  DECLARE v_group_id  TINYINT UNSIGNED;
  DECLARE v_component TINYINT UNSIGNED;
  DECLARE v_city_id   INT UNSIGNED;

  SELECT br.blood_group_id, br.component_id, h.city_id
    INTO v_group_id, v_component, v_city_id
    FROM blood_requests br
    JOIN hospitals h ON h.hospital_id = br.hospital_id
   WHERE br.blood_request_id = p_request_id;

  SELECT
      bu.blood_unit_id,
      bu.unit_code,
      bg.group_code                          AS unit_blood_group,
      cmp.name                               AS component,
      bu.volume_ml,
      bu.expiry_date,
      DATEDIFF(bu.expiry_date, CURDATE())    AS days_to_expiry,
      bb.name                                AS blood_bank,
      ci.name                                AS city,
      (bu.blood_group_id = v_group_id)       AS exact_group_match,
      (bb.city_id = v_city_id)               AS same_city,
      bc.rule_note                           AS compatibility_reason
    FROM blood_units bu
    JOIN blood_compatibility bc
      ON bc.donor_group_id = bu.blood_group_id
     AND bc.component_id   = bu.component_id
     AND bc.recipient_group_id = v_group_id
    JOIN blood_banks      bb  ON bb.blood_bank_id  = bu.blood_bank_id
    JOIN cities           ci  ON ci.city_id        = bb.city_id
    JOIN blood_groups     bg  ON bg.blood_group_id = bu.blood_group_id
    JOIN blood_components cmp ON cmp.component_id  = bu.component_id
   WHERE bu.component_id  = v_component
     AND bc.is_compatible = TRUE
     AND bu.status        = 'AVAILABLE'
     AND bu.expiry_date   > CURDATE()
   ORDER BY exact_group_match DESC, same_city DESC, bu.expiry_date ASC;
END$$

-- ===========================================================================
-- PROCEDURE sp_allocate_blood_request
--
-- THE transactional core of the blood subsystem.
--
--   START TRANSACTION
--     for each unit still needed:
--        SELECT ... LIMIT 1 FOR UPDATE SKIP LOCKED   <- row lock, no deadlock
--        INSERT INTO blood_allocations               <- trigger re-checks state
--        UPDATE blood_units SET status='RESERVED'    <- trigger validates move
--     update the request totals and status
--     write an audit row
--   COMMIT   (any failure -> ROLLBACK, nothing is half-allocated)
--
-- FOR UPDATE takes an exclusive lock on each candidate row; SKIP LOCKED makes a
-- concurrent allocator step over rows the first one is already holding instead
-- of blocking on them.  Together with trg_blood_allocations_before_insert this
-- makes double-allocation impossible even under concurrent requests.
-- ===========================================================================
CREATE PROCEDURE sp_allocate_blood_request(
  IN  p_request_id INT UNSIGNED,
  IN  p_user_id    INT UNSIGNED,
  OUT p_allocated  INT,
  OUT p_message    VARCHAR(255)
)
MODIFIES SQL DATA
BEGIN
  DECLARE v_needed     INT DEFAULT 0;
  DECLARE v_already    INT DEFAULT 0;
  DECLARE v_group_id   TINYINT UNSIGNED;
  DECLARE v_component  TINYINT UNSIGNED;
  DECLARE v_city_id    INT UNSIGNED;
  DECLARE v_status     VARCHAR(20);
  DECLARE v_code       VARCHAR(30);
  DECLARE v_unit_id    INT UNSIGNED;
  DECLARE v_new_status VARCHAR(20);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET p_allocated = 0;

  START TRANSACTION;

  -- Lock the request row itself so two operators cannot allocate it at once.
  SELECT br.units_required, br.units_allocated, br.blood_group_id,
         br.component_id, br.status, br.request_code, h.city_id
    INTO v_needed, v_already, v_group_id, v_component, v_status, v_code, v_city_id
    FROM blood_requests br
    JOIN hospitals h ON h.hospital_id = br.hospital_id
   WHERE br.blood_request_id = p_request_id
   FOR UPDATE;

  IF v_needed IS NULL THEN
    ROLLBACK;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Blood request not found';
  END IF;

  IF v_status NOT IN ('PENDING','MATCHING','MATCHED','ALLOCATED') THEN
    ROLLBACK;
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Request is not in an allocatable state';
  END IF;

  -- Take units one at a time, newest lock first, until the request is met.
  allocation_loop: WHILE v_already + p_allocated < v_needed DO
    SET v_unit_id = NULL;

    SELECT bu.blood_unit_id INTO v_unit_id
      FROM blood_units bu
      JOIN blood_compatibility bc
        ON bc.donor_group_id     = bu.blood_group_id
       AND bc.component_id       = bu.component_id
       AND bc.recipient_group_id = v_group_id
      JOIN blood_banks bb ON bb.blood_bank_id = bu.blood_bank_id
     WHERE bu.component_id  = v_component
       AND bc.is_compatible = TRUE
       AND bu.status        = 'AVAILABLE'
       AND bu.expiry_date   > CURDATE()
       AND bb.status        = 'ACTIVE'
     ORDER BY (bu.blood_group_id = v_group_id) DESC,   -- 1. exact group
              (bb.city_id        = v_city_id)  DESC,   -- 2. local stock
              bu.expiry_date ASC                       -- 3. first-expiring-first-out
     LIMIT 1
     FOR UPDATE SKIP LOCKED;

    IF v_unit_id IS NULL THEN
      LEAVE allocation_loop;              -- no more compatible stock
    END IF;

    INSERT INTO blood_allocations (blood_request_id, blood_unit_id, allocated_by, status)
    VALUES (p_request_id, v_unit_id, p_user_id, 'RESERVED');

    UPDATE blood_units SET status = 'RESERVED' WHERE blood_unit_id = v_unit_id;

    SET p_allocated = p_allocated + 1;
  END WHILE allocation_loop;

  -- Decide the resulting request state.
  IF v_already + p_allocated = 0 THEN
    SET v_new_status = 'PENDING';
    SET p_message = 'No compatible, unexpired units are currently available';
  ELSEIF v_already + p_allocated < v_needed THEN
    SET v_new_status = 'ALLOCATED';
    SET p_message = CONCAT('Partially allocated: ', v_already + p_allocated,
                           ' of ', v_needed, ' units reserved');
  ELSE
    SET v_new_status = 'ALLOCATED';
    SET p_message = CONCAT('Fully allocated: ', v_needed, ' units reserved');
  END IF;

  UPDATE blood_requests
     SET units_allocated = v_already + p_allocated,
         status          = v_new_status
   WHERE blood_request_id = p_request_id;

  INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source)
  VALUES (p_user_id, 'BLOOD_ALLOCATION', 'blood_requests', p_request_id,
          CONCAT('Request ', v_code, ': ', p_message), 'PROCEDURE');

  COMMIT;
END$$

-- ===========================================================================
-- PROCEDURE sp_find_organ_matches
--
-- SIMPLIFIED ACADEMIC MATCHING ALGORITHM - NOT A CLINICAL ALLOCATION SYSTEM.
-- Real organ allocation uses HLA typing, crossmatching, waiting time, PELD/MELD
-- scores and national policy.  This computes a transparent weighted score so
-- the database concepts (join, derived attributes, configurable weights) can be
-- demonstrated and explained.
--
-- score = (w_blood*blood + w_urgency*urg + w_priority*pri + w_loc*loc + w_age*age) / 100
-- Weights come from the matching_config table - no magic numbers in code.
-- Blood-incompatible organs are excluded outright rather than scored low.
-- ===========================================================================
CREATE PROCEDURE sp_find_organ_matches(
  IN  p_request_id INT UNSIGNED,
  IN  p_user_id    INT UNSIGNED,
  OUT p_match_count INT
)
MODIFIES SQL DATA
BEGIN
  DECLARE v_w_blood, v_w_urgency, v_w_priority, v_w_location, v_w_age DECIMAL(10,4);
  DECLARE v_min_score, v_age_tolerance DECIMAL(10,4);
  DECLARE v_type_id TINYINT UNSIGNED;
  DECLARE v_group_id TINYINT UNSIGNED;
  DECLARE v_city_id INT UNSIGNED;
  DECLARE v_region VARCHAR(40);
  DECLARE v_urgency VARCHAR(10);
  DECLARE v_priority TINYINT UNSIGNED;
  DECLARE v_age TINYINT UNSIGNED;
  DECLARE v_code VARCHAR(30);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET p_match_count = 0;

  SELECT config_value INTO v_w_blood       FROM matching_config WHERE config_key='organ_weight_blood';
  SELECT config_value INTO v_w_urgency     FROM matching_config WHERE config_key='organ_weight_urgency';
  SELECT config_value INTO v_w_priority    FROM matching_config WHERE config_key='organ_weight_priority';
  SELECT config_value INTO v_w_location    FROM matching_config WHERE config_key='organ_weight_location';
  SELECT config_value INTO v_w_age         FROM matching_config WHERE config_key='organ_weight_age';
  SELECT config_value INTO v_min_score     FROM matching_config WHERE config_key='organ_min_match_score';
  SELECT config_value INTO v_age_tolerance FROM matching_config WHERE config_key='organ_age_gap_tolerance_years';

  START TRANSACTION;

  SELECT orq.organ_type_id, orq.blood_group_id, orq.urgency, orq.medical_priority,
         orq.recipient_age, orq.request_code, h.city_id, ci.region
    INTO v_type_id, v_group_id, v_urgency, v_priority, v_age, v_code, v_city_id, v_region
    FROM organ_requests orq
    JOIN hospitals h ON h.hospital_id = orq.hospital_id
    JOIN cities    ci ON ci.city_id   = h.city_id
   WHERE orq.organ_request_id = p_request_id
   FOR UPDATE;

  IF v_type_id IS NULL THEN
    ROLLBACK;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Organ request not found';
  END IF;

  -- Re-running the matcher refreshes only the untouched proposals; decisions a
  -- clinician has already recorded (ACCEPTED / ALLOCATED / ...) are preserved.
  DELETE FROM organ_matches
   WHERE organ_request_id = p_request_id AND status = 'PROPOSED';

  INSERT INTO organ_matches (
      organ_request_id, organ_id, compatibility_score,
      blood_score, urgency_score, priority_score, location_score, age_score,
      match_reason, status)
  SELECT p_request_id, t.organ_id, ROUND(t.total_score, 2),
         t.blood_score, t.urgency_score, t.priority_score, t.location_score, t.age_score,
         t.reason, 'PROPOSED'
    FROM (
      SELECT
          ao.organ_id,
          s.blood_score, s.urgency_score, s.priority_score, s.location_score, s.age_score,
          (v_w_blood    * s.blood_score
         + v_w_urgency  * s.urgency_score
         + v_w_priority * s.priority_score
         + v_w_location * s.location_score
         + v_w_age      * s.age_score) / 100                       AS total_score,
          CONCAT_WS(' | ',
            CASE WHEN s.blood_score = 100
                 THEN CONCAT('Exact blood group match (', bg.group_code, ')')
                 ELSE CONCAT('Blood group compatible (', bg.group_code, ' -> recipient)') END,
            CONCAT('Urgency: ', v_urgency),
            CONCAT('Medical priority score: ', v_priority),
            CASE WHEN s.location_score = 100 THEN 'Same city as requesting hospital'
                 WHEN s.location_score = 70  THEN CONCAT('Same region (', ci.region, ')')
                 ELSE 'Outside region - transport time applies' END,
            CONCAT('Donor age ', ao.donor_age, ' vs recipient ', v_age,
                   ' (', ABS(CAST(ao.donor_age AS SIGNED) - CAST(v_age AS SIGNED)), 'y gap)'),
            CONCAT('Viable until ', DATE_FORMAT(ao.viable_until, '%Y-%m-%d %H:%i'))
          )                                                        AS reason
        FROM available_organs ao
        JOIN cities       ci ON ci.city_id        = ao.city_id
        JOIN blood_groups bg ON bg.blood_group_id = ao.blood_group_id
        JOIN organ_types  ot ON ot.organ_type_id  = ao.organ_type_id
        JOIN blood_compatibility bcmp
          ON bcmp.donor_group_id     = ao.blood_group_id
         AND bcmp.recipient_group_id = v_group_id
         AND bcmp.component_id       = (SELECT component_id FROM blood_components WHERE code = 'WHOLE_BLOOD')
        JOIN LATERAL (
          SELECT
            CASE WHEN ao.blood_group_id = v_group_id THEN 100 ELSE 85 END AS blood_score,
            CASE v_urgency WHEN 'CRITICAL' THEN 100 WHEN 'URGENT' THEN 70 ELSE 40 END AS urgency_score,
            v_priority AS priority_score,
            CASE WHEN ao.city_id = v_city_id THEN 100
                 WHEN ci.region  = v_region  THEN 70
                 ELSE 40 END AS location_score,
            GREATEST(0, 100 - (ABS(CAST(ao.donor_age AS SIGNED) - CAST(v_age AS SIGNED))
                               * 100.0 / v_age_tolerance)) AS age_score
        ) s ON TRUE
       WHERE ao.organ_type_id       = v_type_id
         AND ao.availability_status = 'AVAILABLE'
         AND ao.medical_status      = 'VIABLE'
         AND ao.viable_until        > NOW()
         AND bcmp.is_compatible     = TRUE
         -- respect the organ type's own donor age window
         AND ao.donor_age BETWEEN ot.min_donor_age AND ot.max_donor_age
         -- an organ already proposed to this request keeps its existing decision row
         AND NOT EXISTS (
               SELECT 1 FROM organ_matches om
                WHERE om.organ_request_id = p_request_id AND om.organ_id = ao.organ_id)
    ) t
   WHERE t.total_score >= v_min_score
   ORDER BY t.total_score DESC;

  SET p_match_count = ROW_COUNT();

  UPDATE organ_requests
     SET status = CASE WHEN p_match_count > 0 THEN 'MATCH_FOUND' ELSE 'MATCHING' END
   WHERE organ_request_id = p_request_id
     AND status IN ('PENDING','MATCHING','MATCH_FOUND');

  INSERT INTO audit_logs (user_id, action, entity_name, entity_id, description, source)
  VALUES (p_user_id, 'ORGAN_MATCHING_RUN', 'organ_requests', p_request_id,
          CONCAT('Request ', v_code, ': ', p_match_count, ' candidate organ(s) scored'),
          'PROCEDURE');

  COMMIT;
END$$

-- ===========================================================================
-- PROCEDURE sp_expire_stale_records
-- Housekeeping run by the API on a schedule (and callable during a demo):
-- retires blood past its expiry date, organs past their viability window and
-- requests past their required-by date.  Written as three set-based UPDATEs
-- rather than a row loop.
-- ===========================================================================
CREATE PROCEDURE sp_expire_stale_records(
  OUT p_units_expired      INT,
  OUT p_organs_expired     INT,
  OUT p_requests_expired   INT,
  OUT p_donors_reinstated  INT
)
MODIFIES SQL DATA
BEGIN
  DECLARE v_interval INT DEFAULT 90;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SELECT config_value INTO v_interval
    FROM matching_config WHERE config_key = 'blood_donation_interval_days';

  START TRANSACTION;

  UPDATE blood_units
     SET status = 'EXPIRED'
   WHERE status IN ('AVAILABLE','QUARANTINED')
     AND expiry_date <= CURDATE();
  SET p_units_expired = ROW_COUNT();

  UPDATE available_organs
     SET availability_status = 'EXPIRED'
   WHERE availability_status IN ('AVAILABLE','RESERVED')
     AND viable_until <= NOW();
  SET p_organs_expired = ROW_COUNT();

  UPDATE blood_requests
     SET status = 'EXPIRED'
   WHERE status IN ('PENDING','MATCHING','MATCHED')
     AND required_by < CURDATE();
  SET p_requests_expired = ROW_COUNT();

  -- Restore eligibility once the mandatory interval since the last donation has
  -- passed.  trg_blood_donations_after_insert makes a donor TEMPORARILY_INELIGIBLE
  -- when they give blood; without this counterpart nobody would ever become
  -- eligible again.  Donors marked permanently INELIGIBLE are never reinstated.
  UPDATE donors
     SET eligibility_status = 'ELIGIBLE'
   WHERE eligibility_status = 'TEMPORARILY_INELIGIBLE'
     AND (last_donation_date IS NULL
          OR DATEDIFF(CURDATE(), last_donation_date) >= v_interval);
  SET p_donors_reinstated = ROW_COUNT();

  INSERT INTO audit_logs (user_id, action, entity_name, description, source)
  VALUES (NULL, 'HOUSEKEEPING_EXPIRY', 'system',
          CONCAT(p_units_expired, ' units, ', p_organs_expired, ' organs, ',
                 p_requests_expired, ' requests expired; ',
                 p_donors_reinstated, ' donors became eligible again'), 'PROCEDURE');

  COMMIT;
END$$

DELIMITER ;
