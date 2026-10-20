-- ============================================================================
-- views.sql
--
-- These views are not decoration: the API queries them directly (see
-- backend/src/services/*.js), so the join/aggregation logic lives in the
-- database once instead of being re-typed in every controller.
-- ============================================================================

USE blood_organ_network;

DROP VIEW IF EXISTS v_available_blood_summary;
DROP VIEW IF EXISTS v_expiring_blood_units;
DROP VIEW IF EXISTS v_pending_blood_requests;
DROP VIEW IF EXISTS v_available_organs;
DROP VIEW IF EXISTS v_donor_activity_summary;
DROP VIEW IF EXISTS v_hospital_request_summary;
DROP VIEW IF EXISTS v_blood_bank_inventory;
DROP VIEW IF EXISTS v_organ_request_matches;

-- ---------------------------------------------------------------------------
-- v_available_blood_summary
-- Stock on hand, aggregated per bank / group / component.  Backs the public
-- availability page and the "blood units available" dashboard tile.
-- Note the WHERE expiry_date > CURDATE(): a bag that exists is not stock.
-- ---------------------------------------------------------------------------
CREATE VIEW v_available_blood_summary AS
SELECT
    bb.blood_bank_id,
    bb.name                              AS blood_bank,
    ci.city_id,
    ci.name                              AS city,
    ci.state,
    ci.region,
    bg.blood_group_id,
    bg.group_code                        AS blood_group,
    cmp.component_id,
    cmp.code                             AS component_code,
    cmp.name                             AS component,
    COUNT(*)                             AS available_units,
    SUM(bu.volume_ml)                    AS total_volume_ml,
    MIN(bu.expiry_date)                  AS earliest_expiry,
    SUM(CASE WHEN bu.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END)
                                         AS expiring_within_7_days
  FROM blood_units bu
  JOIN blood_banks      bb  ON bb.blood_bank_id  = bu.blood_bank_id
  JOIN cities           ci  ON ci.city_id        = bb.city_id
  JOIN blood_groups     bg  ON bg.blood_group_id = bu.blood_group_id
  JOIN blood_components cmp ON cmp.component_id  = bu.component_id
 WHERE bu.status = 'AVAILABLE'
   AND bu.expiry_date > CURDATE()
   AND bb.status = 'ACTIVE'
 GROUP BY bb.blood_bank_id, bb.name, ci.city_id, ci.name, ci.state, ci.region,
          bg.blood_group_id, bg.group_code, cmp.component_id, cmp.code, cmp.name;

-- ---------------------------------------------------------------------------
-- v_expiring_blood_units
-- Wastage-prevention list for blood-bank staff: individual bags within 14 days
-- of expiry, soonest first.
-- ---------------------------------------------------------------------------
CREATE VIEW v_expiring_blood_units AS
SELECT
    bu.blood_unit_id,
    bu.unit_code,
    bg.group_code                        AS blood_group,
    cmp.name                             AS component,
    bu.volume_ml,
    bu.collection_date,
    bu.expiry_date,
    DATEDIFF(bu.expiry_date, CURDATE())  AS days_to_expiry,
    bu.status,
    bb.blood_bank_id,
    bb.name                              AS blood_bank,
    ci.name                              AS city
  FROM blood_units bu
  JOIN blood_banks      bb  ON bb.blood_bank_id  = bu.blood_bank_id
  JOIN cities           ci  ON ci.city_id        = bb.city_id
  JOIN blood_groups     bg  ON bg.blood_group_id = bu.blood_group_id
  JOIN blood_components cmp ON cmp.component_id  = bu.component_id
 WHERE bu.status IN ('AVAILABLE','RESERVED','QUARANTINED')
   AND bu.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 14 DAY);

-- ---------------------------------------------------------------------------
-- v_pending_blood_requests
-- Open demand, with a live count of how much compatible stock exists for each
-- request (via fn_compatible_unit_count) so triage can see what is satisfiable.
-- ---------------------------------------------------------------------------
CREATE VIEW v_pending_blood_requests AS
SELECT
    br.blood_request_id,
    br.request_code,
    br.status,
    br.urgency,
    br.units_required,
    br.units_allocated,
    br.units_required - br.units_allocated AS units_outstanding,
    br.request_date,
    br.required_by,
    DATEDIFF(br.required_by, CURDATE())    AS days_remaining,
    bg.group_code                          AS blood_group,
    cmp.name                               AS component,
    h.hospital_id,
    h.name                                 AS hospital,
    ci.name                                AS city,
    ci.region,
    br.patient_name,
    u.full_name                            AS recipient_name,
    fn_compatible_unit_count(br.blood_group_id, br.component_id) AS compatible_units_in_network
  FROM blood_requests br
  JOIN hospitals        h   ON h.hospital_id     = br.hospital_id
  JOIN cities           ci  ON ci.city_id        = h.city_id
  JOIN blood_groups     bg  ON bg.blood_group_id = br.blood_group_id
  JOIN blood_components cmp ON cmp.component_id  = br.component_id
  LEFT JOIN recipients  r   ON r.recipient_id    = br.recipient_id
  LEFT JOIN users       u   ON u.user_id         = r.user_id
 WHERE br.status IN ('PENDING','MATCHING','MATCHED','ALLOCATED');

-- ---------------------------------------------------------------------------
-- v_available_organs
-- Public-facing organ availability.  Deliberately exposes NO donor identity:
-- no donor name, no user_id, no address - only the clinical attributes needed
-- to judge a match, plus the holding centre.
-- ---------------------------------------------------------------------------
CREATE VIEW v_available_organs AS
SELECT
    ao.organ_id,
    ao.organ_code,
    ot.organ_type_id,
    ot.code                                 AS organ_type_code,
    ot.name                                 AS organ_type,
    bg.blood_group_id,
    bg.group_code                           AS blood_group,
    ao.donor_age,
    ao.medical_status,
    ao.availability_status,
    ao.recovered_at,
    ao.viable_until,
    TIMESTAMPDIFF(HOUR, NOW(), ao.viable_until) AS hours_remaining,
    tc.center_id,
    tc.name                                 AS transplant_center,
    ci.city_id,
    ci.name                                 AS city,
    ci.state,
    ci.region,
    od.donor_kind
  FROM available_organs ao
  JOIN organ_types        ot ON ot.organ_type_id  = ao.organ_type_id
  JOIN blood_groups       bg ON bg.blood_group_id = ao.blood_group_id
  JOIN transplant_centers tc ON tc.center_id      = ao.center_id
  JOIN cities             ci ON ci.city_id        = ao.city_id
  JOIN organ_donors       od ON od.organ_donor_id = ao.organ_donor_id;

-- ---------------------------------------------------------------------------
-- v_donor_activity_summary
-- Per-donor lifetime activity.  LEFT JOINs so a donor who has never donated
-- still appears (with zeros) - an INNER JOIN here would silently hide exactly
-- the donors the outreach reports need to find.
-- ---------------------------------------------------------------------------
CREATE VIEW v_donor_activity_summary AS
SELECT
    d.donor_id,
    u.user_id,
    u.full_name                              AS donor_name,
    u.email,
    bg.group_code                            AS blood_group,
    ci.name                                  AS city,
    ci.region,
    fn_calculate_age(d.date_of_birth)        AS age,
    d.gender,
    d.eligibility_status,
    d.last_donation_date,
    COUNT(DISTINCT bd.donation_id)           AS total_donations,
    COALESCE(SUM(bd.volume_ml), 0)           AS total_volume_ml,
    SUM(CASE WHEN bd.screening_status = 'PASSED' THEN 1 ELSE 0 END) AS donations_passed,
    SUM(CASE WHEN bd.screening_status = 'FAILED' THEN 1 ELSE 0 END) AS donations_failed,
    COUNT(DISTINCT bu.blood_unit_id)         AS units_produced,
    MAX(bd.donation_date)                    AS most_recent_donation,
    CASE WHEN od.organ_donor_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_organ_donor,
    od.consent_status                        AS organ_consent_status
  FROM donors d
  JOIN users        u  ON u.user_id         = d.user_id
  JOIN blood_groups bg ON bg.blood_group_id = d.blood_group_id
  JOIN cities       ci ON ci.city_id        = d.city_id
  LEFT JOIN blood_donations bd ON bd.donor_id    = d.donor_id
  LEFT JOIN blood_units     bu ON bu.donation_id = bd.donation_id
  LEFT JOIN organ_donors    od ON od.donor_id    = d.donor_id
 GROUP BY d.donor_id, u.user_id, u.full_name, u.email, bg.group_code, ci.name, ci.region,
          d.date_of_birth, d.gender, d.eligibility_status, d.last_donation_date,
          od.organ_donor_id, od.consent_status;

-- ---------------------------------------------------------------------------
-- v_hospital_request_summary
-- Per-hospital demand and fulfilment rate.  The fulfilment rate is computed in
-- SQL with conditional aggregation, and NULLIF guards the divide-by-zero for a
-- hospital that has never raised a request.
-- ---------------------------------------------------------------------------
CREATE VIEW v_hospital_request_summary AS
SELECT
    h.hospital_id,
    h.name                                    AS hospital,
    ci.name                                   AS city,
    ci.region,
    h.status,
    COUNT(DISTINCT br.blood_request_id)       AS blood_requests_total,
    SUM(CASE WHEN br.status = 'FULFILLED' THEN 1 ELSE 0 END) AS blood_requests_fulfilled,
    SUM(CASE WHEN br.status IN ('PENDING','MATCHING','MATCHED') THEN 1 ELSE 0 END) AS blood_requests_open,
    SUM(CASE WHEN br.urgency = 'CRITICAL' THEN 1 ELSE 0 END) AS blood_requests_critical,
    COALESCE(SUM(br.units_required), 0)       AS units_requested,
    COALESCE(SUM(br.units_allocated), 0)      AS units_allocated,
    ROUND(100.0 * SUM(CASE WHEN br.status = 'FULFILLED' THEN 1 ELSE 0 END)
          / NULLIF(COUNT(DISTINCT br.blood_request_id), 0), 1) AS blood_fulfilment_rate_pct,
    COUNT(DISTINCT orq.organ_request_id)      AS organ_requests_total,
    SUM(CASE WHEN orq.status = 'TRANSPLANT_COMPLETED' THEN 1 ELSE 0 END) AS organ_transplants_completed
  FROM hospitals h
  JOIN cities ci ON ci.city_id = h.city_id
  LEFT JOIN blood_requests br  ON br.hospital_id  = h.hospital_id
  LEFT JOIN organ_requests orq ON orq.hospital_id = h.hospital_id
 GROUP BY h.hospital_id, h.name, ci.name, ci.region, h.status;

-- ---------------------------------------------------------------------------
-- v_blood_bank_inventory
-- Whole-inventory breakdown per bank including non-available states, so bank
-- staff can see quarantined / reserved / expired stock the public view hides.
-- ---------------------------------------------------------------------------
CREATE VIEW v_blood_bank_inventory AS
SELECT
    bb.blood_bank_id,
    bb.name                                   AS blood_bank,
    ci.name                                   AS city,
    bg.group_code                             AS blood_group,
    cmp.name                                  AS component,
    COUNT(*)                                  AS total_units,
    SUM(bu.status = 'AVAILABLE')              AS available_units,
    SUM(bu.status = 'RESERVED')               AS reserved_units,
    SUM(bu.status = 'QUARANTINED')            AS quarantined_units,
    SUM(bu.status = 'ISSUED')                 AS issued_units,
    SUM(bu.status = 'TRANSFUSED')             AS transfused_units,
    SUM(bu.status = 'EXPIRED')                AS expired_units,
    SUM(bu.status = 'DISCARDED')              AS discarded_units
  FROM blood_units bu
  JOIN blood_banks      bb  ON bb.blood_bank_id  = bu.blood_bank_id
  JOIN cities           ci  ON ci.city_id        = bb.city_id
  JOIN blood_groups     bg  ON bg.blood_group_id = bu.blood_group_id
  JOIN blood_components cmp ON cmp.component_id  = bu.component_id
 GROUP BY bb.blood_bank_id, bb.name, ci.name, bg.group_code, cmp.name;

-- ---------------------------------------------------------------------------
-- v_organ_request_matches
-- Flattened request + candidate-organ pairs with the score breakdown, used by
-- the organ matching screen so the UI never has to re-join five tables.
-- ---------------------------------------------------------------------------
CREATE VIEW v_organ_request_matches AS
SELECT
    om.match_id,
    om.status                                 AS match_status,
    om.compatibility_score,
    om.blood_score, om.urgency_score, om.priority_score, om.location_score, om.age_score,
    om.match_reason,
    om.matched_at,
    orq.organ_request_id,
    orq.request_code,
    orq.urgency,
    orq.medical_priority,
    orq.recipient_age,
    orq.status                                AS request_status,
    ot.name                                   AS organ_type,
    rbg.group_code                            AS recipient_blood_group,
    h.name                                    AS requesting_hospital,
    rci.name                                  AS requesting_city,
    ao.organ_id,
    ao.organ_code,
    ao.donor_age,
    ao.viable_until,
    ao.availability_status                    AS organ_status,
    obg.group_code                            AS organ_blood_group,
    tc.name                                   AS holding_center,
    oci.name                                  AS organ_city
  FROM organ_matches om
  JOIN organ_requests     orq ON orq.organ_request_id = om.organ_request_id
  JOIN available_organs   ao  ON ao.organ_id          = om.organ_id
  JOIN organ_types        ot  ON ot.organ_type_id     = orq.organ_type_id
  JOIN blood_groups       rbg ON rbg.blood_group_id   = orq.blood_group_id
  JOIN blood_groups       obg ON obg.blood_group_id   = ao.blood_group_id
  JOIN hospitals          h   ON h.hospital_id        = orq.hospital_id
  JOIN cities             rci ON rci.city_id          = h.city_id
  JOIN transplant_centers tc  ON tc.center_id         = ao.center_id
  JOIN cities             oci ON oci.city_id          = ao.city_id;
