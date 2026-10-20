-- ============================================================================
-- useful_queries.sql
--
-- 25 demonstration queries against the live blood_organ_network schema.
-- Run the whole file:   mysql -u root -p blood_organ_network < useful_queries.sql
-- Every query here executes against the seeded database and returns rows.
-- ============================================================================

USE blood_organ_network;

-- ---------------------------------------------------------------------------
-- Q1  SELECT + WHERE + ORDER BY
-- All currently usable red cell units, soonest to expire first.
-- ---------------------------------------------------------------------------
SELECT unit_code, blood_group_id, volume_ml, collection_date, expiry_date
  FROM blood_units
 WHERE status = 'AVAILABLE'
   AND component_id = 2
   AND expiry_date > CURDATE()
 ORDER BY expiry_date ASC
 LIMIT 15;

-- ---------------------------------------------------------------------------
-- Q2  INNER JOIN (3 tables)
-- Donor name, blood group and city for every eligible donor.
-- ---------------------------------------------------------------------------
SELECT u.full_name, bg.group_code AS blood_group, c.name AS city, d.eligibility_status
  FROM donors d
  JOIN users        u  ON u.user_id         = d.user_id
  JOIN blood_groups bg ON bg.blood_group_id = d.blood_group_id
  JOIN cities       c  ON c.city_id         = d.city_id
 WHERE d.eligibility_status = 'ELIGIBLE'
 ORDER BY c.name, u.full_name;

-- ---------------------------------------------------------------------------
-- Q3  Multi-table JOIN (6 tables)
-- Full provenance of every allocated unit: which donor's blood went to which
-- patient at which hospital.  This is the query that justifies the whole
-- normalised design - it is only possible because nothing was denormalised.
-- ---------------------------------------------------------------------------
SELECT br.request_code,
       h.name              AS hospital,
       br.patient_name,
       bu.unit_code,
       dbg.group_code      AS unit_group,
       rbg.group_code      AS patient_group,
       du.full_name        AS donor,
       bb.name             AS supplied_by,
       ba.status           AS allocation_status
  FROM blood_allocations ba
  JOIN blood_requests br  ON br.blood_request_id = ba.blood_request_id
  JOIN blood_units    bu  ON bu.blood_unit_id    = ba.blood_unit_id
  JOIN blood_banks    bb  ON bb.blood_bank_id    = bu.blood_bank_id
  JOIN hospitals      h   ON h.hospital_id       = br.hospital_id
  JOIN blood_groups   dbg ON dbg.blood_group_id  = bu.blood_group_id
  JOIN blood_groups   rbg ON rbg.blood_group_id  = br.blood_group_id
  LEFT JOIN blood_donations bd ON bd.donation_id = bu.donation_id
  LEFT JOIN donors    d   ON d.donor_id          = bd.donor_id
  LEFT JOIN users     du  ON du.user_id          = d.user_id
 ORDER BY br.request_code, bu.unit_code;

-- ---------------------------------------------------------------------------
-- Q4  LEFT JOIN  -  find what is MISSING
-- Donors who have never donated.  An INNER JOIN would return nothing useful
-- here; the LEFT JOIN + IS NULL is the whole point.
-- ---------------------------------------------------------------------------
SELECT u.full_name, bg.group_code AS blood_group, c.name AS city, d.eligibility_status
  FROM donors d
  JOIN users        u  ON u.user_id         = d.user_id
  JOIN blood_groups bg ON bg.blood_group_id = d.blood_group_id
  JOIN cities       c  ON c.city_id         = d.city_id
  LEFT JOIN blood_donations bd ON bd.donor_id = d.donor_id
 WHERE bd.donation_id IS NULL;

-- ---------------------------------------------------------------------------
-- Q5  RIGHT JOIN
-- Every blood bank, including any holding no stock at all.  Written as a RIGHT
-- JOIN to demonstrate the operator; in production this codebase always writes
-- the equivalent LEFT JOIN with the tables swapped, because mixing join
-- directions in one query is a common source of bugs.
-- ---------------------------------------------------------------------------
SELECT bb.name AS blood_bank, c.name AS city, COUNT(bu.blood_unit_id) AS units_held
  FROM blood_units bu
 RIGHT JOIN blood_banks bb ON bb.blood_bank_id = bu.blood_bank_id
  JOIN cities c ON c.city_id = bb.city_id
 GROUP BY bb.blood_bank_id, bb.name, c.name
 ORDER BY units_held DESC;

-- ---------------------------------------------------------------------------
-- Q6  GROUP BY + aggregate functions (COUNT, SUM, MIN, AVG)
-- Network-wide stock position per blood group.
-- ---------------------------------------------------------------------------
SELECT bg.group_code                       AS blood_group,
       COUNT(*)                            AS units,
       SUM(bu.volume_ml)                   AS total_ml,
       ROUND(AVG(bu.volume_ml), 1)         AS avg_ml,
       MIN(bu.expiry_date)                 AS next_expiry,
       MAX(bu.expiry_date)                 AS last_expiry
  FROM blood_units bu
  JOIN blood_groups bg ON bg.blood_group_id = bu.blood_group_id
 WHERE bu.status = 'AVAILABLE' AND bu.expiry_date > CURDATE()
 GROUP BY bg.blood_group_id, bg.group_code
 ORDER BY units DESC;

-- ---------------------------------------------------------------------------
-- Q7  GROUP BY + HAVING
-- Blood groups that are running low: fewer than 6 usable units in the network.
-- HAVING is required because the filter applies to the aggregate, not the row.
-- ---------------------------------------------------------------------------
SELECT bg.group_code AS blood_group, COUNT(bu.blood_unit_id) AS usable_units
  FROM blood_groups bg
  LEFT JOIN blood_units bu
    ON bu.blood_group_id = bg.blood_group_id
   AND bu.status = 'AVAILABLE'
   AND bu.expiry_date > CURDATE()
 GROUP BY bg.blood_group_id, bg.group_code
HAVING COUNT(bu.blood_unit_id) < 6
 ORDER BY usable_units ASC;

-- ---------------------------------------------------------------------------
-- Q8  Subquery in WHERE (non-correlated)
-- Donors whose total donated volume is above the network average.
-- ---------------------------------------------------------------------------
SELECT u.full_name, SUM(bd.volume_ml) AS total_donated_ml, COUNT(*) AS donations
  FROM blood_donations bd
  JOIN donors d ON d.donor_id = bd.donor_id
  JOIN users  u ON u.user_id  = d.user_id
 GROUP BY d.donor_id, u.full_name
HAVING SUM(bd.volume_ml) > (
         SELECT AVG(donor_total)
           FROM (SELECT SUM(volume_ml) AS donor_total
                   FROM blood_donations GROUP BY donor_id) AS per_donor)
 ORDER BY total_donated_ml DESC;

-- ---------------------------------------------------------------------------
-- Q9  CORRELATED subquery
-- Each blood bank with the expiry date of its own soonest-to-expire unit.
-- The inner query re-executes per bank, referencing bb.blood_bank_id.
-- ---------------------------------------------------------------------------
SELECT bb.name AS blood_bank,
       (SELECT MIN(bu.expiry_date)
          FROM blood_units bu
         WHERE bu.blood_bank_id = bb.blood_bank_id
           AND bu.status = 'AVAILABLE') AS next_unit_to_expire,
       (SELECT COUNT(*)
          FROM blood_units bu
         WHERE bu.blood_bank_id = bb.blood_bank_id
           AND bu.status = 'AVAILABLE') AS available_units
  FROM blood_banks bb
 WHERE bb.status = 'ACTIVE'
 ORDER BY bb.name;

-- ---------------------------------------------------------------------------
-- Q10  EXISTS
-- Hospitals that have raised at least one CRITICAL blood request.
-- EXISTS stops at the first matching row, unlike COUNT(*) > 0.
-- ---------------------------------------------------------------------------
SELECT h.name AS hospital, c.name AS city
  FROM hospitals h
  JOIN cities c ON c.city_id = h.city_id
 WHERE EXISTS (
         SELECT 1 FROM blood_requests br
          WHERE br.hospital_id = h.hospital_id
            AND br.urgency = 'CRITICAL');

-- ---------------------------------------------------------------------------
-- Q11  NOT EXISTS
-- Registered organ donors who have not pledged a kidney.
-- ---------------------------------------------------------------------------
SELECT u.full_name, od.consent_status, od.donor_kind
  FROM organ_donors od
  JOIN donors d ON d.donor_id = od.donor_id
  JOIN users  u ON u.user_id  = d.user_id
 WHERE NOT EXISTS (
         SELECT 1 FROM organ_donor_pledges p
          WHERE p.organ_donor_id = od.organ_donor_id
            AND p.organ_type_id  = 1
            AND p.status = 'ACTIVE');

-- ---------------------------------------------------------------------------
-- Q12  CASE  -  bucketing a continuous value
-- Classify usable stock by how close it is to expiry.
-- ---------------------------------------------------------------------------
SELECT CASE
         WHEN DATEDIFF(expiry_date, CURDATE()) <= 3  THEN '1. Critical (<=3 days)'
         WHEN DATEDIFF(expiry_date, CURDATE()) <= 7  THEN '2. Urgent (4-7 days)'
         WHEN DATEDIFF(expiry_date, CURDATE()) <= 21 THEN '3. Watch (8-21 days)'
         ELSE                                              '4. Healthy (>21 days)'
       END                        AS expiry_band,
       COUNT(*)                   AS units,
       SUM(volume_ml)             AS total_ml
  FROM blood_units
 WHERE status = 'AVAILABLE' AND expiry_date > CURDATE()
 GROUP BY expiry_band
 ORDER BY expiry_band;

-- ---------------------------------------------------------------------------
-- Q13  CASE inside an aggregate (conditional aggregation / pivot)
-- Request pipeline per hospital, one row per hospital instead of one per state.
-- ---------------------------------------------------------------------------
SELECT h.name AS hospital,
       COUNT(*)                                                      AS total,
       SUM(CASE WHEN br.status='PENDING'   THEN 1 ELSE 0 END)        AS pending,
       SUM(CASE WHEN br.status='ALLOCATED' THEN 1 ELSE 0 END)        AS allocated,
       SUM(CASE WHEN br.status='FULFILLED' THEN 1 ELSE 0 END)        AS fulfilled,
       SUM(CASE WHEN br.status IN ('REJECTED','CANCELLED','EXPIRED') THEN 1 ELSE 0 END) AS closed_unmet,
       ROUND(100.0*SUM(CASE WHEN br.status='FULFILLED' THEN 1 ELSE 0 END)/COUNT(*),1) AS fulfil_pct
  FROM blood_requests br
  JOIN hospitals h ON h.hospital_id = br.hospital_id
 GROUP BY h.hospital_id, h.name
 ORDER BY total DESC;

-- ---------------------------------------------------------------------------
-- Q14  Date filtering + date grouping
-- Donations per month over the last 6 months (drives the dashboard chart).
-- ---------------------------------------------------------------------------
SELECT DATE_FORMAT(donation_date, '%Y-%m') AS month,
       COUNT(*)                            AS donations,
       SUM(volume_ml)                      AS volume_ml,
       COUNT(DISTINCT donor_id)            AS distinct_donors
  FROM blood_donations
 WHERE donation_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
 GROUP BY month
 ORDER BY month;

-- ---------------------------------------------------------------------------
-- Q15  THE COMPATIBILITY SEARCH
-- Which units in the network could be given to an O- patient needing red cells?
-- The join to blood_compatibility is what makes this a relational lookup rather
-- than hardcoded if/else logic in the application.
-- ---------------------------------------------------------------------------
SELECT bu.unit_code,
       dbg.group_code AS donor_group,
       bb.name        AS blood_bank,
       ci.name        AS city,
       bu.expiry_date,
       bc.rule_note
  FROM blood_units bu
  JOIN blood_compatibility bc ON bc.donor_group_id = bu.blood_group_id
                             AND bc.component_id   = bu.component_id
  JOIN blood_groups rbg ON rbg.blood_group_id = bc.recipient_group_id
  JOIN blood_groups dbg ON dbg.blood_group_id = bu.blood_group_id
  JOIN blood_banks  bb  ON bb.blood_bank_id   = bu.blood_bank_id
  JOIN cities       ci  ON ci.city_id         = bb.city_id
 WHERE rbg.group_code   = 'O-'
   AND bu.component_id  = 2
   AND bc.is_compatible = TRUE
   AND bu.status        = 'AVAILABLE'
   AND bu.expiry_date   > CURDATE()
 ORDER BY bu.expiry_date;

-- ---------------------------------------------------------------------------
-- Q16  The universal donor/recipient property, proved by the data
-- Counts how many of the 8 recipient groups each donor group can serve.
-- O- should return 8 (universal red cell donor), AB+ should return 1.
-- ---------------------------------------------------------------------------
SELECT d.group_code AS donor_group,
       SUM(bc.is_compatible) AS can_donate_red_cells_to_n_groups,
       GROUP_CONCAT(CASE WHEN bc.is_compatible THEN r.group_code END
                    ORDER BY r.group_code SEPARATOR ', ') AS recipients
  FROM blood_compatibility bc
  JOIN blood_groups d ON d.blood_group_id = bc.donor_group_id
  JOIN blood_groups r ON r.blood_group_id = bc.recipient_group_id
 WHERE bc.component_id = 2
 GROUP BY d.blood_group_id, d.group_code
 ORDER BY can_donate_red_cells_to_n_groups DESC;

-- ---------------------------------------------------------------------------
-- Q17  Pending request analysis  -  demand vs supply
-- For every open request, how much compatible stock actually exists.
-- Uses the stored function fn_compatible_unit_count.
-- ---------------------------------------------------------------------------
SELECT br.request_code,
       bg.group_code                      AS needs,
       cmp.code                           AS component,
       br.urgency,
       br.units_required - br.units_allocated AS still_needed,
       fn_compatible_unit_count(br.blood_group_id, br.component_id) AS compatible_in_network,
       CASE WHEN fn_compatible_unit_count(br.blood_group_id, br.component_id)
                 >= br.units_required - br.units_allocated
            THEN 'Satisfiable now' ELSE 'SHORTFALL' END AS verdict
  FROM blood_requests br
  JOIN blood_groups     bg  ON bg.blood_group_id = br.blood_group_id
  JOIN blood_components cmp ON cmp.component_id  = br.component_id
 WHERE br.status IN ('PENDING','MATCHING','MATCHED','ALLOCATED')
 ORDER BY FIELD(br.urgency,'CRITICAL','URGENT','ROUTINE'), br.request_date;

-- ---------------------------------------------------------------------------
-- Q18  Inventory statistics by city  (JOIN + GROUP BY + conditional SUM)
-- ---------------------------------------------------------------------------
SELECT ci.name AS city, ci.region,
       COUNT(DISTINCT bb.blood_bank_id) AS banks,
       COUNT(bu.blood_unit_id)          AS total_units,
       SUM(bu.status='AVAILABLE')       AS available,
       SUM(bu.status='RESERVED')        AS reserved,
       SUM(bu.status='EXPIRED')         AS expired,
       ROUND(100.0*SUM(bu.status='EXPIRED')/NULLIF(COUNT(bu.blood_unit_id),0),1) AS wastage_pct
  FROM cities ci
  JOIN blood_banks bb ON bb.city_id = ci.city_id
  LEFT JOIN blood_units bu ON bu.blood_bank_id = bb.blood_bank_id
 GROUP BY ci.city_id, ci.name, ci.region
 ORDER BY total_units DESC;

-- ---------------------------------------------------------------------------
-- Q19  VIEW usage  -  querying v_available_blood_summary
-- ---------------------------------------------------------------------------
SELECT blood_group, component, SUM(available_units) AS units, MIN(earliest_expiry) AS next_expiry
  FROM v_available_blood_summary
 GROUP BY blood_group, component
 ORDER BY units DESC;

-- ---------------------------------------------------------------------------
-- Q20  VIEW usage  -  top donors from v_donor_activity_summary
-- ---------------------------------------------------------------------------
SELECT donor_name, blood_group, city, total_donations, total_volume_ml,
       units_produced, is_organ_donor
  FROM v_donor_activity_summary
 WHERE total_donations > 0
 ORDER BY total_donations DESC, total_volume_ml DESC
 LIMIT 10;

-- ---------------------------------------------------------------------------
-- Q21  Organ availability by type and urgency demand
-- ---------------------------------------------------------------------------
SELECT ot.name AS organ_type,
       COUNT(DISTINCT ao.organ_id)  AS organs_available,
       COUNT(DISTINCT orq.organ_request_id) AS open_requests,
       SUM(CASE WHEN orq.urgency='CRITICAL' THEN 1 ELSE 0 END) AS critical_requests
  FROM organ_types ot
  LEFT JOIN available_organs ao
    ON ao.organ_type_id = ot.organ_type_id
   AND ao.availability_status = 'AVAILABLE'
   AND ao.viable_until > NOW()
  LEFT JOIN organ_requests orq
    ON orq.organ_type_id = ot.organ_type_id
   AND orq.status IN ('PENDING','MATCHING','MATCH_FOUND')
 GROUP BY ot.organ_type_id, ot.name
 ORDER BY open_requests DESC, organs_available DESC;

-- ---------------------------------------------------------------------------
-- Q22  Organ match ranking with the score breakdown
-- ---------------------------------------------------------------------------
SELECT request_code, organ_code, organ_type,
       recipient_blood_group, organ_blood_group,
       compatibility_score, blood_score, urgency_score, priority_score,
       location_score, ROUND(age_score,1) AS age_score, match_status
  FROM v_organ_request_matches
 WHERE match_status = 'PROPOSED'
 ORDER BY compatibility_score DESC;

-- ---------------------------------------------------------------------------
-- Q23  Self-referencing comparison via JOIN on the same table
-- Donor/recipient pairs in the same city whose groups are red-cell compatible.
-- Demonstrates joining blood_groups twice under different aliases.
-- ---------------------------------------------------------------------------
SELECT du.full_name AS donor, dbg.group_code AS donor_group,
       ru.full_name AS recipient, rbg.group_code AS recipient_group,
       ci.name      AS shared_city
  FROM donors d
  JOIN users        du  ON du.user_id        = d.user_id
  JOIN blood_groups dbg ON dbg.blood_group_id = d.blood_group_id
  JOIN recipients   r   ON r.city_id         = d.city_id
  JOIN users        ru  ON ru.user_id        = r.user_id
  JOIN blood_groups rbg ON rbg.blood_group_id = r.blood_group_id
  JOIN cities       ci  ON ci.city_id        = d.city_id
  JOIN blood_compatibility bc
    ON bc.donor_group_id     = d.blood_group_id
   AND bc.recipient_group_id = r.blood_group_id
   AND bc.component_id       = 2
 WHERE bc.is_compatible = TRUE
   AND d.eligibility_status = 'ELIGIBLE'
 ORDER BY ci.name, du.full_name;

-- ---------------------------------------------------------------------------
-- Q24  Audit trail  -  what the triggers have recorded
-- Proves the triggers are firing: source='TRIGGER' rows were written by the
-- database itself, not by the API.
-- ---------------------------------------------------------------------------
SELECT source, action, COUNT(*) AS events, MAX(created_at) AS most_recent
  FROM audit_logs
 GROUP BY source, action
 ORDER BY source, events DESC;

-- ---------------------------------------------------------------------------
-- Q25  Wastage analysis  -  expired stock that was never used, by component
-- The number this project ultimately exists to reduce.
-- ---------------------------------------------------------------------------
SELECT cmp.name AS component,
       cmp.shelf_life_days,
       COUNT(*)                                   AS units_ever_created,
       SUM(bu.status = 'EXPIRED')                 AS expired_unused,
       SUM(bu.status = 'TRANSFUSED')              AS transfused,
       ROUND(100.0 * SUM(bu.status='EXPIRED') / COUNT(*), 1) AS wastage_pct
  FROM blood_units bu
  JOIN blood_components cmp ON cmp.component_id = bu.component_id
 GROUP BY cmp.component_id, cmp.name, cmp.shelf_life_days
 ORDER BY wastage_pct DESC;
