import { query, queryOne } from '../config/db.js';

/**
 * All analytics are computed with SQL aggregation (COUNT / SUM / AVG / CASE /
 * GROUP BY / HAVING).  Nothing here pulls raw rows into Node to count them --
 * the database does the work it is designed for, and the API ships only the
 * summary rows.
 */

/** Headline tiles for the admin dashboard. */
export async function getOverview() {
  const counts = await queryOne(`
    SELECT
      (SELECT COUNT(*) FROM users)                                            AS totalUsers,
      (SELECT COUNT(*) FROM users WHERE status = 'ACTIVE')                    AS activeUsers,
      (SELECT COUNT(*) FROM users WHERE status = 'PENDING')                   AS pendingUsers,
      (SELECT COUNT(*) FROM donors)                                           AS totalDonors,
      (SELECT COUNT(*) FROM donors WHERE eligibility_status = 'ELIGIBLE')     AS eligibleDonors,
      (SELECT COUNT(*) FROM recipients)                                       AS totalRecipients,
      (SELECT COUNT(*) FROM hospitals WHERE status = 'ACTIVE')                AS activeHospitals,
      (SELECT COUNT(*) FROM blood_banks WHERE status = 'ACTIVE')              AS activeBloodBanks,
      (SELECT COUNT(*) FROM transplant_centers WHERE status = 'ACTIVE')       AS activeTransplantCenters,
      (SELECT COUNT(*) FROM blood_units
        WHERE status = 'AVAILABLE' AND expiry_date > CURDATE())               AS availableBloodUnits,
      (SELECT COUNT(*) FROM blood_units
        WHERE status = 'AVAILABLE' AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY))
                                                                              AS unitsExpiringSoon,
      (SELECT COUNT(*) FROM blood_donations)                                  AS totalDonations,
      (SELECT COUNT(*) FROM blood_requests
        WHERE status IN ('PENDING','MATCHING','MATCHED'))                     AS pendingBloodRequests,
      (SELECT COUNT(*) FROM blood_requests WHERE urgency = 'CRITICAL'
        AND status IN ('PENDING','MATCHING','MATCHED','ALLOCATED'))           AS criticalBloodRequests,
      (SELECT COUNT(*) FROM available_organs
        WHERE availability_status = 'AVAILABLE' AND viable_until > NOW())     AS availableOrgans,
      (SELECT COUNT(*) FROM organ_requests
        WHERE status IN ('PENDING','MATCHING','MATCH_FOUND'))                 AS pendingOrganRequests,
      (SELECT COUNT(*) FROM organ_donors WHERE consent_status = 'CONSENTED')  AS consentedOrganDonors,
      (SELECT COUNT(*) FROM organ_matches WHERE status = 'PROPOSED')          AS proposedOrganMatches
  `);

  const fulfilment = await queryOne(`
    SELECT COUNT(*) AS totalRequests,
           SUM(status = 'FULFILLED') AS fulfilled,
           ROUND(100.0 * SUM(status = 'FULFILLED') / NULLIF(COUNT(*), 0), 1) AS fulfilmentRatePct,
           ROUND(100.0 * SUM(status IN ('EXPIRED','REJECTED','CANCELLED')) / NULLIF(COUNT(*), 0), 1) AS unmetRatePct
      FROM blood_requests
  `);

  const wastage = await queryOne(`
    SELECT COUNT(*) AS unitsEverCreated,
           SUM(status = 'EXPIRED')    AS expiredUnused,
           SUM(status = 'TRANSFUSED') AS transfused,
           ROUND(100.0 * SUM(status = 'EXPIRED') / NULLIF(COUNT(*), 0), 1) AS wastagePct
      FROM blood_units
  `);

  return { ...counts, ...fulfilment, wastage };
}

/** Recent activity feed, drawn from the audit trail. */
export const getRecentActivity = (limit = 12) =>
  query(
    `SELECT a.audit_id AS auditId, a.action, a.entity_name AS entityName, a.entity_id AS entityId,
            a.description, a.source, a.created_at AS createdAt, u.full_name AS userName, u.role AS userRole
       FROM audit_logs a
       LEFT JOIN users u ON u.user_id = a.user_id
      ORDER BY a.audit_id DESC
      LIMIT ${Math.min(50, Math.max(1, Number(limit) || 12))}`,
  );

/* -------------------------------------------------------------------------
 * BLOOD ANALYTICS
 * ----------------------------------------------------------------------- */

export const unitsByBloodGroup = () =>
  query(`
    SELECT bg.group_code AS bloodGroup,
           COUNT(bu.blood_unit_id) AS availableUnits,
           COALESCE(SUM(bu.volume_ml), 0) AS totalVolumeMl,
           bg.population_pct AS populationPct
      FROM blood_groups bg
      LEFT JOIN blood_units bu
        ON bu.blood_group_id = bg.blood_group_id
       AND bu.status = 'AVAILABLE' AND bu.expiry_date > CURDATE()
     GROUP BY bg.blood_group_id, bg.group_code, bg.population_pct
     ORDER BY FIELD(bg.group_code,'O+','O-','A+','A-','B+','B-','AB+','AB-')
  `);

export const inventoryByCity = () =>
  query(`
    SELECT ci.name AS city, ci.region,
           COUNT(DISTINCT bb.blood_bank_id) AS bloodBanks,
           SUM(bu.status = 'AVAILABLE' AND bu.expiry_date > CURDATE()) AS availableUnits,
           SUM(bu.status = 'RESERVED')  AS reservedUnits,
           SUM(bu.status = 'EXPIRED')   AS expiredUnits
      FROM cities ci
      JOIN blood_banks bb ON bb.city_id = ci.city_id
      LEFT JOIN blood_units bu ON bu.blood_bank_id = bb.blood_bank_id
     GROUP BY ci.city_id, ci.name, ci.region
     ORDER BY availableUnits DESC
  `);

export const donationsPerMonth = (months = 6) =>
  query(
    `SELECT DATE_FORMAT(donation_date, '%Y-%m') AS month,
            COUNT(*) AS donations,
            SUM(volume_ml) AS volumeMl,
            COUNT(DISTINCT donor_id) AS distinctDonors,
            SUM(screening_status = 'PASSED') AS passedScreening
       FROM blood_donations
      WHERE donation_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
      GROUP BY month
      ORDER BY month`,
    [Math.min(24, Math.max(1, Number(months) || 6))],
  );

export const requestsPerMonth = (months = 6) =>
  query(
    `SELECT DATE_FORMAT(request_date, '%Y-%m') AS month,
            COUNT(*) AS requests,
            SUM(status = 'FULFILLED') AS fulfilled,
            SUM(status IN ('PENDING','MATCHING','MATCHED')) AS stillOpen,
            SUM(urgency = 'CRITICAL') AS critical
       FROM blood_requests
      WHERE request_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
      GROUP BY month
      ORDER BY month`,
    [Math.min(24, Math.max(1, Number(months) || 6))],
  );

/** Demand ranking -- which groups are asked for most, and how often they are met. */
export const mostRequestedBloodGroups = () =>
  query(`
    SELECT bg.group_code AS bloodGroup,
           COUNT(br.blood_request_id) AS requestCount,
           SUM(br.units_required) AS unitsRequested,
           SUM(br.units_allocated) AS unitsAllocated,
           ROUND(100.0 * SUM(br.units_allocated) / NULLIF(SUM(br.units_required), 0), 1) AS metPct
      FROM blood_groups bg
      JOIN blood_requests br ON br.blood_group_id = bg.blood_group_id
     GROUP BY bg.blood_group_id, bg.group_code
    HAVING COUNT(br.blood_request_id) > 0
     ORDER BY requestCount DESC
  `);

export const requestStatusBreakdown = () =>
  query(`
    SELECT status, COUNT(*) AS count,
           ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM blood_requests), 1) AS pct
      FROM blood_requests GROUP BY status ORDER BY count DESC
  `);

export const wastageByComponent = () =>
  query(`
    SELECT cmp.name AS component, cmp.shelf_life_days AS shelfLifeDays,
           COUNT(*) AS unitsCreated,
           SUM(bu.status = 'EXPIRED') AS expiredUnused,
           SUM(bu.status = 'TRANSFUSED') AS transfused,
           ROUND(100.0 * SUM(bu.status = 'EXPIRED') / COUNT(*), 1) AS wastagePct
      FROM blood_units bu
      JOIN blood_components cmp ON cmp.component_id = bu.component_id
     GROUP BY cmp.component_id, cmp.name, cmp.shelf_life_days
     ORDER BY wastagePct DESC
  `);

/* -------------------------------------------------------------------------
 * ORGAN ANALYTICS
 * ----------------------------------------------------------------------- */

export const organAvailabilityByType = () =>
  query(`
    SELECT ot.name AS organType, ot.code AS organTypeCode,
           COUNT(DISTINCT CASE WHEN ao.availability_status = 'AVAILABLE'
                                AND ao.viable_until > NOW() THEN ao.organ_id END) AS available,
           COUNT(DISTINCT CASE WHEN ao.availability_status = 'TRANSPLANTED' THEN ao.organ_id END) AS transplanted,
           COUNT(DISTINCT CASE WHEN orq.status IN ('PENDING','MATCHING','MATCH_FOUND')
                               THEN orq.organ_request_id END) AS openRequests
      FROM organ_types ot
      LEFT JOIN available_organs ao ON ao.organ_type_id = ot.organ_type_id
      LEFT JOIN organ_requests  orq ON orq.organ_type_id = ot.organ_type_id
     GROUP BY ot.organ_type_id, ot.name, ot.code
     ORDER BY openRequests DESC, available DESC
  `);

export const organRequestsByUrgency = () =>
  query(`
    SELECT urgency, COUNT(*) AS requests,
           ROUND(AVG(medical_priority), 1) AS avgMedicalPriority,
           SUM(status = 'TRANSPLANT_COMPLETED') AS completed
      FROM organ_requests
     GROUP BY urgency
     ORDER BY FIELD(urgency,'CRITICAL','URGENT','ROUTINE')
  `);

export const organDonorPledgeStats = () =>
  query(`
    SELECT ot.name AS organType, COUNT(p.pledge_id) AS activePledges
      FROM organ_types ot
      LEFT JOIN organ_donor_pledges p
        ON p.organ_type_id = ot.organ_type_id AND p.status = 'ACTIVE'
     GROUP BY ot.organ_type_id, ot.name
     ORDER BY activePledges DESC
  `);

/* -------------------------------------------------------------------------
 * HOSPITAL / DONOR SUMMARIES  (read straight from the views)
 * ----------------------------------------------------------------------- */

export const hospitalRequestSummary = () =>
  query(`
    SELECT hospital_id AS hospitalId, hospital, city, region, status,
           blood_requests_total AS bloodRequestsTotal,
           blood_requests_fulfilled AS bloodRequestsFulfilled,
           blood_requests_open AS bloodRequestsOpen,
           blood_requests_critical AS bloodRequestsCritical,
           units_requested AS unitsRequested, units_allocated AS unitsAllocated,
           blood_fulfilment_rate_pct AS fulfilmentRatePct,
           organ_requests_total AS organRequestsTotal,
           organ_transplants_completed AS organTransplantsCompleted
      FROM v_hospital_request_summary
     ORDER BY bloodRequestsTotal DESC
  `);

export const topDonors = (limit = 10) =>
  query(
    `SELECT donor_id AS donorId, donor_name AS donorName, blood_group AS bloodGroup, city, region,
            age, total_donations AS totalDonations, total_volume_ml AS totalVolumeMl,
            units_produced AS unitsProduced, is_organ_donor AS isOrganDonor,
            last_donation_date AS lastDonationDate, eligibility_status AS eligibilityStatus
       FROM v_donor_activity_summary
      WHERE total_donations > 0
      ORDER BY total_donations DESC, total_volume_ml DESC
      LIMIT ${Math.min(50, Math.max(1, Number(limit) || 10))}`,
  );

/** Public statistics for the landing page (no authentication required). */
export async function getPublicStats() {
  const stats = await queryOne(`
    SELECT
      (SELECT COUNT(*) FROM donors)                                       AS registeredDonors,
      (SELECT COUNT(*) FROM organ_donors WHERE consent_status='CONSENTED') AS organDonors,
      (SELECT COUNT(*) FROM blood_units
        WHERE status='AVAILABLE' AND expiry_date > CURDATE())             AS bloodUnitsAvailable,
      (SELECT COUNT(*) FROM available_organs
        WHERE availability_status='AVAILABLE' AND viable_until > NOW())   AS organsAvailable,
      (SELECT COUNT(*) FROM hospitals WHERE status='ACTIVE')              AS hospitals,
      (SELECT COUNT(*) FROM blood_banks WHERE status='ACTIVE')            AS bloodBanks,
      (SELECT COUNT(*) FROM transplant_centers WHERE status='ACTIVE')     AS transplantCenters,
      (SELECT COUNT(*) FROM cities)                                       AS citiesCovered,
      (SELECT COUNT(*) FROM blood_donations)                              AS donationsRecorded,
      (SELECT COUNT(*) FROM blood_requests WHERE status='FULFILLED')      AS requestsFulfilled
  `);
  const byGroup = await unitsByBloodGroup();
  const byOrgan = await organAvailabilityByType();
  return { stats, bloodByGroup: byGroup, organsByType: byOrgan };
}
