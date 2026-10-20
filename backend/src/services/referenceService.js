import { query } from '../config/db.js';

/**
 * Reference/lookup data.  These tables change almost never, so the frontend
 * fetches them once at startup and caches them in React context.
 */

export const listCities = () =>
  query('SELECT city_id AS cityId, name, state, region FROM cities ORDER BY name');

export const listBloodGroups = () =>
  query(`SELECT blood_group_id AS bloodGroupId, group_code AS groupCode,
                abo_type AS aboType, rh_factor AS rhFactor, population_pct AS populationPct
           FROM blood_groups
          ORDER BY FIELD(group_code,'O+','O-','A+','A-','B+','B-','AB+','AB-')`);

export const listBloodComponents = () =>
  query(`SELECT component_id AS componentId, code, name, shelf_life_days AS shelfLifeDays,
                storage_temp AS storageTemp, match_direction AS matchDirection, description
           FROM blood_components ORDER BY component_id`);

export const listOrganTypes = () =>
  query(`SELECT organ_type_id AS organTypeId, code, name, description,
                max_cold_ischemia_hours AS maxColdIschemiaHours,
                living_donation_possible AS livingDonationPossible,
                min_donor_age AS minDonorAge, max_donor_age AS maxDonorAge
           FROM organ_types ORDER BY name`);

/** The full compatibility matrix, for the reference page in the UI. */
export const getCompatibilityMatrix = (componentId) =>
  query(
    `SELECT d.group_code AS donorGroup, r.group_code AS recipientGroup,
            bc.is_compatible AS isCompatible, bc.rule_note AS ruleNote,
            c.code AS componentCode, c.name AS componentName, c.match_direction AS matchDirection
       FROM blood_compatibility bc
       JOIN blood_groups d ON d.blood_group_id = bc.donor_group_id
       JOIN blood_groups r ON r.blood_group_id = bc.recipient_group_id
       JOIN blood_components c ON c.component_id = bc.component_id
      WHERE bc.component_id = ?
      ORDER BY FIELD(d.group_code,'O-','O+','A-','A+','B-','B+','AB-','AB+'),
               FIELD(r.group_code,'O-','O+','A-','A+','B-','B+','AB-','AB+')`,
    [componentId],
  );

export const getMatchingConfig = () =>
  query('SELECT config_key AS configKey, config_value AS configValue, description FROM matching_config ORDER BY config_key');
