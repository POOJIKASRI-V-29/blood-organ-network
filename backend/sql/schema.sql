-- ============================================================================
-- BLOOD & ORGAN AVAILABILITY NETWORK
-- schema.sql  -  Relational schema (MySQL 8.0+)
--
-- Design notes
--   * Normalised to 3NF.  Lookup tables (cities, blood_groups, blood_components,
--     organ_types) exist specifically to remove transitive dependencies that
--     would otherwise appear in the main entity tables.  See docs/DATABASE_DESIGN.md
--   * Every FK action is chosen deliberately:  CASCADE only where the child row
--     is existentially dependent on the parent (a profile cannot outlive its user);
--     RESTRICT everywhere the child is an immutable historical/medical record.
--   * Surrogate integer PKs are used throughout; natural keys are preserved as
--     UNIQUE constraints (candidate keys) so the relational model stays honest.
-- ============================================================================

DROP DATABASE IF EXISTS blood_organ_network;
CREATE DATABASE blood_organ_network
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE blood_organ_network;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- SECTION 1 : REFERENCE / LOOKUP ENTITIES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- cities
-- Why this table exists:  storing (city, state, region) directly on hospitals,
-- blood_banks, donors ... creates the transitive dependency
--        hospital_id -> city -> state, region
-- which violates 3NF and allows a city to be recorded in two different states.
-- Extracting it gives one authoritative row per city.
-- ---------------------------------------------------------------------------
CREATE TABLE cities (
  city_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(80)  NOT NULL,
  state        VARCHAR(80)  NOT NULL,
  region       VARCHAR(40)  NOT NULL,
  PRIMARY KEY (city_id),
  UNIQUE KEY uq_cities_name_state (name, state),   -- candidate key
  KEY idx_cities_region (region)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- blood_groups
-- The eight ABO/Rh groups.  The antigen flags (has_a / has_b / has_rh_d) are
-- NOT redundant duplication of group_code -- they are the machine-readable form
-- that lets the compatibility matrix be DERIVED by relational set logic instead
-- of being hand-typed (see sp_rebuild_blood_compatibility in procedures.sql).
-- ---------------------------------------------------------------------------
CREATE TABLE blood_groups (
  blood_group_id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_code     VARCHAR(3)  NOT NULL,
  abo_type       ENUM('A','B','AB','O') NOT NULL,
  rh_factor      ENUM('+','-')          NOT NULL,
  has_a          BOOLEAN NOT NULL,
  has_b          BOOLEAN NOT NULL,
  has_rh_d       BOOLEAN NOT NULL,
  population_pct DECIMAL(5,2) NULL,
  PRIMARY KEY (blood_group_id),
  UNIQUE KEY uq_blood_groups_code (group_code),        -- candidate key
  UNIQUE KEY uq_blood_groups_abo_rh (abo_type, rh_factor)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- blood_components
-- shelf_life_days depends only on the component, never on the unit -> its own
-- relation.  Triggers use it to derive blood_units.expiry_date automatically.
-- ---------------------------------------------------------------------------
CREATE TABLE blood_components (
  component_id    TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(20)  NOT NULL,
  name            VARCHAR(60)  NOT NULL,
  shelf_life_days SMALLINT UNSIGNED NOT NULL,
  storage_temp    VARCHAR(30)  NOT NULL,
  -- Direction of the ABO rule for this component.  CELLULAR components carry
  -- donor antigens (donor antigens must be a subset of the recipient's);
  -- PLASMA components carry donor ANTIBODIES, so the rule is exactly reversed.
  -- Storing it here keeps the rule in data instead of scattering it in code.
  match_direction ENUM('CELLULAR','PLASMA') NOT NULL DEFAULT 'CELLULAR',
  description     VARCHAR(255) NULL,
  PRIMARY KEY (component_id),
  UNIQUE KEY uq_blood_components_code (code),
  CONSTRAINT chk_component_shelf_life CHECK (shelf_life_days BETWEEN 1 AND 3650)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- organ_types
-- ---------------------------------------------------------------------------
CREATE TABLE organ_types (
  organ_type_id           TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                    VARCHAR(20)  NOT NULL,
  name                    VARCHAR(60)  NOT NULL,
  description             VARCHAR(255) NULL,
  max_cold_ischemia_hours SMALLINT UNSIGNED NOT NULL,
  living_donation_possible BOOLEAN NOT NULL DEFAULT FALSE,
  min_donor_age           TINYINT UNSIGNED NOT NULL DEFAULT 1,
  max_donor_age           TINYINT UNSIGNED NOT NULL DEFAULT 80,
  PRIMARY KEY (organ_type_id),
  UNIQUE KEY uq_organ_types_code (code),
  CONSTRAINT chk_organ_age_range CHECK (min_donor_age < max_donor_age)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- blood_compatibility
-- Associative relation resolving the many-to-many "which group may receive from
-- which group, for which component".  Component is part of the key because
-- plasma compatibility is the REVERSE of red-cell compatibility.
-- Populated by sp_rebuild_blood_compatibility(), never hand-edited.
-- ---------------------------------------------------------------------------
CREATE TABLE blood_compatibility (
  donor_group_id     TINYINT UNSIGNED NOT NULL,
  recipient_group_id TINYINT UNSIGNED NOT NULL,
  component_id       TINYINT UNSIGNED NOT NULL,
  is_compatible      BOOLEAN NOT NULL,
  rule_note          VARCHAR(120) NULL,
  PRIMARY KEY (donor_group_id, recipient_group_id, component_id),
  CONSTRAINT fk_bc_donor_group     FOREIGN KEY (donor_group_id)     REFERENCES blood_groups (blood_group_id)   ON DELETE CASCADE,
  CONSTRAINT fk_bc_recipient_group FOREIGN KEY (recipient_group_id) REFERENCES blood_groups (blood_group_id)   ON DELETE CASCADE,
  CONSTRAINT fk_bc_component       FOREIGN KEY (component_id)       REFERENCES blood_components (component_id) ON DELETE CASCADE,
  KEY idx_bc_lookup (recipient_group_id, component_id, is_compatible)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- matching_config
-- Organ-matching weights live in the database so the algorithm has no magic
-- numbers and the weighting can be re-tuned without redeploying code.
-- ---------------------------------------------------------------------------
CREATE TABLE matching_config (
  config_key   VARCHAR(60)  NOT NULL,
  config_value DECIMAL(10,4) NOT NULL,
  description  VARCHAR(255) NOT NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (config_key)
) ENGINE = InnoDB;

-- ============================================================================
-- SECTION 2 : IDENTITY & ACTORS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- users  -  single authentication identity for every actor in the network.
-- Role-specific attributes are pushed into the specialisation tables below
-- (donors / recipients / hospitals / ...) so that users holds only attributes
-- that are functionally dependent on user_id alone.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  user_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone         VARCHAR(20)  NULL,
  role          ENUM('ADMIN','DONOR','RECIPIENT','HOSPITAL','BLOOD_BANK','TRANSPLANT_CENTER') NOT NULL,
  status        ENUM('PENDING','ACTIVE','SUSPENDED','REJECTED') NOT NULL DEFAULT 'ACTIVE',
  last_login_at DATETIME NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_email (email),               -- candidate key + login index
  KEY idx_users_role_status (role, status)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- donors  -  1:1 specialisation of users (role = DONOR)
-- ---------------------------------------------------------------------------
CREATE TABLE donors (
  donor_id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             INT UNSIGNED NOT NULL,
  date_of_birth       DATE NOT NULL,
  gender              ENUM('MALE','FEMALE','OTHER') NOT NULL,
  blood_group_id      TINYINT UNSIGNED NOT NULL,
  city_id             INT UNSIGNED NOT NULL,
  address             VARCHAR(255) NULL,
  weight_kg           DECIMAL(5,2) NULL,
  last_donation_date  DATE NULL,
  total_donations     INT UNSIGNED NOT NULL DEFAULT 0,
  eligibility_status  ENUM('ELIGIBLE','TEMPORARILY_INELIGIBLE','INELIGIBLE') NOT NULL DEFAULT 'ELIGIBLE',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (donor_id),
  UNIQUE KEY uq_donors_user (user_id),             -- enforces the 1:1 cardinality
  CONSTRAINT fk_donors_user        FOREIGN KEY (user_id)        REFERENCES users (user_id)              ON DELETE CASCADE,
  CONSTRAINT fk_donors_blood_group FOREIGN KEY (blood_group_id) REFERENCES blood_groups (blood_group_id) ON DELETE RESTRICT,
  CONSTRAINT fk_donors_city        FOREIGN KEY (city_id)        REFERENCES cities (city_id)             ON DELETE RESTRICT,
  KEY idx_donors_blood_group (blood_group_id),
  KEY idx_donors_city_eligibility (city_id, eligibility_status),
  CONSTRAINT chk_donors_weight CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 300)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- recipients  -  1:1 specialisation of users (role = RECIPIENT)
-- ---------------------------------------------------------------------------
CREATE TABLE recipients (
  recipient_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NOT NULL,
  date_of_birth  DATE NOT NULL,
  gender         ENUM('MALE','FEMALE','OTHER') NOT NULL,
  blood_group_id TINYINT UNSIGNED NOT NULL,
  city_id        INT UNSIGNED NOT NULL,
  address        VARCHAR(255) NULL,
  medical_notes  TEXT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (recipient_id),
  UNIQUE KEY uq_recipients_user (user_id),
  CONSTRAINT fk_recipients_user        FOREIGN KEY (user_id)        REFERENCES users (user_id)               ON DELETE CASCADE,
  CONSTRAINT fk_recipients_blood_group FOREIGN KEY (blood_group_id) REFERENCES blood_groups (blood_group_id) ON DELETE RESTRICT,
  CONSTRAINT fk_recipients_city        FOREIGN KEY (city_id)        REFERENCES cities (city_id)              ON DELETE RESTRICT,
  KEY idx_recipients_blood_group (blood_group_id)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- hospitals
-- user_id is NULLABLE: a hospital may be registered by an admin before its
-- login account is provisioned.  The UNIQUE key still forbids two hospitals
-- sharing one account.
-- ---------------------------------------------------------------------------
CREATE TABLE hospitals (
  hospital_id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             INT UNSIGNED NULL,
  name                VARCHAR(160) NOT NULL,
  registration_number VARCHAR(60)  NOT NULL,
  address             VARCHAR(255) NOT NULL,
  city_id             INT UNSIGNED NOT NULL,
  phone               VARCHAR(20)  NOT NULL,
  email               VARCHAR(160) NOT NULL,
  bed_capacity        SMALLINT UNSIGNED NULL,
  status              ENUM('PENDING','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (hospital_id),
  UNIQUE KEY uq_hospitals_regno (registration_number),   -- natural/candidate key
  UNIQUE KEY uq_hospitals_user (user_id),
  UNIQUE KEY uq_hospitals_email (email),
  CONSTRAINT fk_hospitals_user FOREIGN KEY (user_id) REFERENCES users (user_id)  ON DELETE SET NULL,
  CONSTRAINT fk_hospitals_city FOREIGN KEY (city_id) REFERENCES cities (city_id) ON DELETE RESTRICT,
  KEY idx_hospitals_city_status (city_id, status)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- blood_banks
-- ---------------------------------------------------------------------------
CREATE TABLE blood_banks (
  blood_bank_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             INT UNSIGNED NULL,
  hospital_id         INT UNSIGNED NULL,          -- set when bank is hospital-attached
  name                VARCHAR(160) NOT NULL,
  registration_number VARCHAR(60)  NOT NULL,
  address             VARCHAR(255) NOT NULL,
  city_id             INT UNSIGNED NOT NULL,
  phone               VARCHAR(20)  NOT NULL,
  email               VARCHAR(160) NOT NULL,
  status              ENUM('PENDING','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (blood_bank_id),
  UNIQUE KEY uq_blood_banks_regno (registration_number),
  UNIQUE KEY uq_blood_banks_user (user_id),
  UNIQUE KEY uq_blood_banks_email (email),
  CONSTRAINT fk_bb_user     FOREIGN KEY (user_id)     REFERENCES users (user_id)         ON DELETE SET NULL,
  CONSTRAINT fk_bb_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (hospital_id) ON DELETE SET NULL,
  CONSTRAINT fk_bb_city     FOREIGN KEY (city_id)     REFERENCES cities (city_id)        ON DELETE RESTRICT,
  KEY idx_bb_city_status (city_id, status)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- transplant_centers  -  a transplant centre is always hosted BY a hospital
-- (1:1 here; the UNIQUE on hospital_id encodes that business rule).
-- ---------------------------------------------------------------------------
CREATE TABLE transplant_centers (
  center_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hospital_id    INT UNSIGNED NOT NULL,
  user_id        INT UNSIGNED NULL,
  license_number VARCHAR(60) NOT NULL,
  name           VARCHAR(160) NOT NULL,
  status         ENUM('PENDING','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (center_id),
  UNIQUE KEY uq_tc_license (license_number),
  UNIQUE KEY uq_tc_hospital (hospital_id),
  UNIQUE KEY uq_tc_user (user_id),
  CONSTRAINT fk_tc_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals (hospital_id) ON DELETE RESTRICT,
  CONSTRAINT fk_tc_user     FOREIGN KEY (user_id)     REFERENCES users (user_id)         ON DELETE SET NULL
) ENGINE = InnoDB;

-- ============================================================================
-- SECTION 3 : BLOOD SUBSYSTEM
-- ============================================================================

-- ---------------------------------------------------------------------------
-- blood_donations  -  the clinical act of donating.  ON DELETE RESTRICT on the
-- donor: a donation is a permanent medical record and must not vanish when a
-- profile is removed.
-- ---------------------------------------------------------------------------
CREATE TABLE blood_donations (
  donation_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  donor_id         INT UNSIGNED NOT NULL,
  blood_bank_id    INT UNSIGNED NOT NULL,
  blood_group_id   TINYINT UNSIGNED NOT NULL,
  donation_date    DATE NOT NULL,
  volume_ml        SMALLINT UNSIGNED NOT NULL DEFAULT 450,
  hemoglobin_gdl   DECIMAL(4,1) NULL,
  screening_status ENUM('PENDING','PASSED','FAILED') NOT NULL DEFAULT 'PENDING',
  screened_at      DATETIME NULL,
  notes            VARCHAR(255) NULL,
  recorded_by      INT UNSIGNED NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (donation_id),
  CONSTRAINT fk_bd_donor       FOREIGN KEY (donor_id)       REFERENCES donors (donor_id)             ON DELETE RESTRICT,
  CONSTRAINT fk_bd_bank        FOREIGN KEY (blood_bank_id)  REFERENCES blood_banks (blood_bank_id)   ON DELETE RESTRICT,
  CONSTRAINT fk_bd_blood_group FOREIGN KEY (blood_group_id) REFERENCES blood_groups (blood_group_id) ON DELETE RESTRICT,
  CONSTRAINT fk_bd_recorded_by FOREIGN KEY (recorded_by)    REFERENCES users (user_id)               ON DELETE SET NULL,
  KEY idx_bd_donor_date (donor_id, donation_date),
  KEY idx_bd_bank_date (blood_bank_id, donation_date),
  KEY idx_bd_date (donation_date),
  CONSTRAINT chk_bd_volume CHECK (volume_ml BETWEEN 100 AND 600)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- blood_units  -  THE inventory table.
-- Deliberately NOT modelled as (blood_group, quantity) counters:  a real bank
-- tracks individually identified, individually expiring bags.  Counter-style
-- inventory cannot express expiry, component separation, or allocation history,
-- and is impossible to keep consistent under concurrency.
-- One donation yields 1..n units (whole blood is separated into components).
-- ---------------------------------------------------------------------------
CREATE TABLE blood_units (
  blood_unit_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  unit_code       VARCHAR(30) NOT NULL,
  donation_id     INT UNSIGNED NULL,          -- NULL = unit imported from another bank
  blood_bank_id   INT UNSIGNED NOT NULL,
  blood_group_id  TINYINT UNSIGNED NOT NULL,
  component_id    TINYINT UNSIGNED NOT NULL,
  volume_ml       SMALLINT UNSIGNED NOT NULL,
  collection_date DATE NOT NULL,
  expiry_date     DATE NOT NULL,
  status          ENUM('AVAILABLE','RESERVED','ISSUED','TRANSFUSED','EXPIRED','DISCARDED','QUARANTINED')
                    NOT NULL DEFAULT 'QUARANTINED',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (blood_unit_id),
  UNIQUE KEY uq_bu_code (unit_code),
  CONSTRAINT fk_bu_donation    FOREIGN KEY (donation_id)    REFERENCES blood_donations (donation_id) ON DELETE SET NULL,
  CONSTRAINT fk_bu_bank        FOREIGN KEY (blood_bank_id)  REFERENCES blood_banks (blood_bank_id)   ON DELETE RESTRICT,
  CONSTRAINT fk_bu_blood_group FOREIGN KEY (blood_group_id) REFERENCES blood_groups (blood_group_id) ON DELETE RESTRICT,
  CONSTRAINT fk_bu_component   FOREIGN KEY (component_id)   REFERENCES blood_components (component_id) ON DELETE RESTRICT,
  -- Primary search path: "give me available A+ red cells that have not expired"
  KEY idx_bu_search (blood_group_id, component_id, status, expiry_date),
  KEY idx_bu_expiry (expiry_date),
  KEY idx_bu_bank_status (blood_bank_id, status),
  CONSTRAINT chk_bu_expiry CHECK (expiry_date > collection_date)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- blood_requests
-- recipient_id is nullable because a hospital may request stock for a patient
-- who has no portal account (mass-casualty, unconscious admission).
-- ---------------------------------------------------------------------------
CREATE TABLE blood_requests (
  blood_request_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_code     VARCHAR(30) NOT NULL,
  recipient_id     INT UNSIGNED NULL,
  hospital_id      INT UNSIGNED NOT NULL,
  blood_group_id   TINYINT UNSIGNED NOT NULL,
  component_id     TINYINT UNSIGNED NOT NULL,
  units_required   SMALLINT UNSIGNED NOT NULL,
  units_allocated  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  urgency          ENUM('ROUTINE','URGENT','CRITICAL') NOT NULL DEFAULT 'ROUTINE',
  patient_name     VARCHAR(120) NULL,
  request_date     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  required_by      DATE NOT NULL,
  status           ENUM('PENDING','MATCHING','MATCHED','ALLOCATED','FULFILLED','REJECTED','CANCELLED','EXPIRED')
                     NOT NULL DEFAULT 'PENDING',
  notes            VARCHAR(500) NULL,
  created_by       INT UNSIGNED NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (blood_request_id),
  UNIQUE KEY uq_br_code (request_code),
  CONSTRAINT fk_br_recipient   FOREIGN KEY (recipient_id)   REFERENCES recipients (recipient_id)     ON DELETE SET NULL,
  CONSTRAINT fk_br_hospital    FOREIGN KEY (hospital_id)    REFERENCES hospitals (hospital_id)       ON DELETE RESTRICT,
  CONSTRAINT fk_br_blood_group FOREIGN KEY (blood_group_id) REFERENCES blood_groups (blood_group_id) ON DELETE RESTRICT,
  CONSTRAINT fk_br_component   FOREIGN KEY (component_id)   REFERENCES blood_components (component_id) ON DELETE RESTRICT,
  CONSTRAINT fk_br_created_by  FOREIGN KEY (created_by)     REFERENCES users (user_id)               ON DELETE SET NULL,
  KEY idx_br_status_urgency (status, urgency),
  KEY idx_br_blood_group (blood_group_id),
  KEY idx_br_hospital_status (hospital_id, status),
  KEY idx_br_request_date (request_date),
  CONSTRAINT chk_br_units CHECK (units_required BETWEEN 1 AND 50),
  CONSTRAINT chk_br_allocated CHECK (units_allocated <= units_required)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- blood_allocations  -  associative table resolving the M:N between requests
-- and physical units.  A unit may appear here more than once ONLY if earlier
-- allocations were cancelled; trg_ba_before_insert enforces that the unit is
-- AVAILABLE at the moment of allocation, which is what actually prevents
-- double-allocation.
-- ---------------------------------------------------------------------------
CREATE TABLE blood_allocations (
  allocation_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  blood_request_id INT UNSIGNED NOT NULL,
  blood_unit_id    INT UNSIGNED NOT NULL,
  allocated_by     INT UNSIGNED NULL,
  allocated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status           ENUM('RESERVED','ISSUED','TRANSFUSED','CANCELLED') NOT NULL DEFAULT 'RESERVED',
  notes            VARCHAR(255) NULL,
  PRIMARY KEY (allocation_id),
  UNIQUE KEY uq_ba_request_unit (blood_request_id, blood_unit_id),
  CONSTRAINT fk_ba_request FOREIGN KEY (blood_request_id) REFERENCES blood_requests (blood_request_id) ON DELETE CASCADE,
  CONSTRAINT fk_ba_unit    FOREIGN KEY (blood_unit_id)    REFERENCES blood_units (blood_unit_id)       ON DELETE RESTRICT,
  CONSTRAINT fk_ba_by      FOREIGN KEY (allocated_by)     REFERENCES users (user_id)                   ON DELETE SET NULL,
  KEY idx_ba_unit_status (blood_unit_id, status)
) ENGINE = InnoDB;

-- ============================================================================
-- SECTION 4 : ORGAN SUBSYSTEM
-- ============================================================================

CREATE TABLE organ_donors (
  organ_donor_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  donor_id          INT UNSIGNED NOT NULL,
  registration_date DATE NOT NULL,
  donor_kind        ENUM('LIVING','DECEASED') NOT NULL DEFAULT 'LIVING',
  consent_status    ENUM('PENDING','CONSENTED','WITHDRAWN') NOT NULL DEFAULT 'PENDING',
  medical_status    ENUM('UNDER_EVALUATION','CLEARED','NOT_CLEARED') NOT NULL DEFAULT 'UNDER_EVALUATION',
  next_of_kin       VARCHAR(120) NULL,
  notes             VARCHAR(500) NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (organ_donor_id),
  UNIQUE KEY uq_od_donor (donor_id),   -- a donor registers as organ donor at most once
  CONSTRAINT fk_od_donor FOREIGN KEY (donor_id) REFERENCES donors (donor_id) ON DELETE CASCADE,
  KEY idx_od_consent (consent_status, medical_status)
) ENGINE = InnoDB;

-- Associative table: which organ types has this donor pledged?  (M:N)
CREATE TABLE organ_donor_pledges (
  pledge_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organ_donor_id INT UNSIGNED NOT NULL,
  organ_type_id  TINYINT UNSIGNED NOT NULL,
  pledged_at     DATE NOT NULL,
  status         ENUM('ACTIVE','WITHDRAWN') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (pledge_id),
  UNIQUE KEY uq_pledge (organ_donor_id, organ_type_id),
  CONSTRAINT fk_pledge_od   FOREIGN KEY (organ_donor_id) REFERENCES organ_donors (organ_donor_id) ON DELETE CASCADE,
  CONSTRAINT fk_pledge_type FOREIGN KEY (organ_type_id)  REFERENCES organ_types (organ_type_id)   ON DELETE RESTRICT
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- available_organs  -  a physically recovered, currently listed organ.
-- ---------------------------------------------------------------------------
CREATE TABLE available_organs (
  organ_id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organ_code          VARCHAR(30) NOT NULL,
  organ_donor_id      INT UNSIGNED NOT NULL,
  organ_type_id       TINYINT UNSIGNED NOT NULL,
  blood_group_id      TINYINT UNSIGNED NOT NULL,
  center_id           INT UNSIGNED NOT NULL,
  city_id             INT UNSIGNED NOT NULL,
  donor_age           TINYINT UNSIGNED NOT NULL,
  hla_type            VARCHAR(60) NULL,
  medical_status      ENUM('UNDER_EVALUATION','VIABLE','NOT_VIABLE') NOT NULL DEFAULT 'UNDER_EVALUATION',
  availability_status ENUM('AVAILABLE','RESERVED','ALLOCATED','TRANSPLANTED','EXPIRED','DISCARDED')
                        NOT NULL DEFAULT 'AVAILABLE',
  recovered_at        DATETIME NOT NULL,
  viable_until        DATETIME NOT NULL,
  notes               VARCHAR(500) NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (organ_id),
  UNIQUE KEY uq_ao_code (organ_code),
  CONSTRAINT fk_ao_donor       FOREIGN KEY (organ_donor_id) REFERENCES organ_donors (organ_donor_id)     ON DELETE RESTRICT,
  CONSTRAINT fk_ao_type        FOREIGN KEY (organ_type_id)  REFERENCES organ_types (organ_type_id)       ON DELETE RESTRICT,
  CONSTRAINT fk_ao_blood_group FOREIGN KEY (blood_group_id) REFERENCES blood_groups (blood_group_id)     ON DELETE RESTRICT,
  CONSTRAINT fk_ao_center      FOREIGN KEY (center_id)      REFERENCES transplant_centers (center_id)    ON DELETE RESTRICT,
  CONSTRAINT fk_ao_city        FOREIGN KEY (city_id)        REFERENCES cities (city_id)                  ON DELETE RESTRICT,
  KEY idx_ao_search (organ_type_id, blood_group_id, availability_status),
  KEY idx_ao_status (availability_status),
  KEY idx_ao_viable (viable_until),
  CONSTRAINT chk_ao_viability CHECK (viable_until > recovered_at),
  CONSTRAINT chk_ao_age CHECK (donor_age BETWEEN 1 AND 100)
) ENGINE = InnoDB;

CREATE TABLE organ_requests (
  organ_request_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_code     VARCHAR(30) NOT NULL,
  recipient_id     INT UNSIGNED NOT NULL,
  hospital_id      INT UNSIGNED NOT NULL,
  organ_type_id    TINYINT UNSIGNED NOT NULL,
  blood_group_id   TINYINT UNSIGNED NOT NULL,
  urgency          ENUM('ROUTINE','URGENT','CRITICAL') NOT NULL DEFAULT 'ROUTINE',
  medical_priority TINYINT UNSIGNED NOT NULL DEFAULT 50,
  recipient_age    TINYINT UNSIGNED NOT NULL,
  request_date     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  required_by      DATE NULL,
  status           ENUM('PENDING','MATCHING','MATCH_FOUND','ALLOCATED','TRANSPLANT_COMPLETED','REJECTED','CANCELLED','EXPIRED')
                     NOT NULL DEFAULT 'PENDING',
  notes            VARCHAR(500) NULL,
  created_by       INT UNSIGNED NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (organ_request_id),
  UNIQUE KEY uq_or_code (request_code),
  CONSTRAINT fk_or_recipient   FOREIGN KEY (recipient_id)   REFERENCES recipients (recipient_id)     ON DELETE RESTRICT,
  CONSTRAINT fk_or_hospital    FOREIGN KEY (hospital_id)    REFERENCES hospitals (hospital_id)       ON DELETE RESTRICT,
  CONSTRAINT fk_or_type        FOREIGN KEY (organ_type_id)  REFERENCES organ_types (organ_type_id)   ON DELETE RESTRICT,
  CONSTRAINT fk_or_blood_group FOREIGN KEY (blood_group_id) REFERENCES blood_groups (blood_group_id) ON DELETE RESTRICT,
  CONSTRAINT fk_or_created_by  FOREIGN KEY (created_by)     REFERENCES users (user_id)               ON DELETE SET NULL,
  KEY idx_or_type_status (organ_type_id, status),
  KEY idx_or_status_priority (status, medical_priority),
  KEY idx_or_hospital (hospital_id),
  CONSTRAINT chk_or_priority CHECK (medical_priority BETWEEN 0 AND 100)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------------
-- organ_matches  -  associative table between requests and organs, carrying the
-- score produced by the (simplified, academic) matching algorithm.
-- ---------------------------------------------------------------------------
CREATE TABLE organ_matches (
  match_id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organ_request_id    INT UNSIGNED NOT NULL,
  organ_id            INT UNSIGNED NOT NULL,
  compatibility_score DECIMAL(5,2) NOT NULL,
  blood_score         DECIMAL(5,2) NOT NULL DEFAULT 0,
  urgency_score       DECIMAL(5,2) NOT NULL DEFAULT 0,
  priority_score      DECIMAL(5,2) NOT NULL DEFAULT 0,
  location_score      DECIMAL(5,2) NOT NULL DEFAULT 0,
  age_score           DECIMAL(5,2) NOT NULL DEFAULT 0,
  match_reason        VARCHAR(500) NOT NULL,
  matched_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by          INT UNSIGNED NULL,
  status              ENUM('PROPOSED','ACCEPTED','REJECTED','ALLOCATED','COMPLETED','CANCELLED')
                        NOT NULL DEFAULT 'PROPOSED',
  PRIMARY KEY (match_id),
  UNIQUE KEY uq_om_request_organ (organ_request_id, organ_id),
  CONSTRAINT fk_om_request FOREIGN KEY (organ_request_id) REFERENCES organ_requests (organ_request_id) ON DELETE CASCADE,
  CONSTRAINT fk_om_organ   FOREIGN KEY (organ_id)         REFERENCES available_organs (organ_id)       ON DELETE CASCADE,
  CONSTRAINT fk_om_by      FOREIGN KEY (decided_by)       REFERENCES users (user_id)                   ON DELETE SET NULL,
  KEY idx_om_score (organ_request_id, compatibility_score),
  KEY idx_om_organ_status (organ_id, status),
  CONSTRAINT chk_om_score CHECK (compatibility_score BETWEEN 0 AND 100)
) ENGINE = InnoDB;

-- ============================================================================
-- SECTION 5 : CROSS-CUTTING
-- ============================================================================

CREATE TABLE notifications (
  notification_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NOT NULL,
  title           VARCHAR(140) NOT NULL,
  message         VARCHAR(500) NOT NULL,
  type            ENUM('INFO','SUCCESS','WARNING','CRITICAL') NOT NULL DEFAULT 'INFO',
  entity_name     VARCHAR(60) NULL,
  entity_id       INT UNSIGNED NULL,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  -- covering index for the "unread badge" query, which runs on every page load
  KEY idx_notif_user_read (user_id, is_read, created_at)
) ENGINE = InnoDB;

CREATE TABLE audit_logs (
  audit_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NULL,       -- NULL = written by a database trigger
  action      VARCHAR(60)  NOT NULL,
  entity_name VARCHAR(60)  NOT NULL,
  entity_id   INT UNSIGNED NULL,
  description VARCHAR(500) NULL,
  source      ENUM('API','TRIGGER','PROCEDURE') NOT NULL DEFAULT 'API',
  ip_address  VARCHAR(45)  NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL,
  KEY idx_audit_entity (entity_name, entity_id),
  KEY idx_audit_created (created_at)
) ENGINE = InnoDB;
