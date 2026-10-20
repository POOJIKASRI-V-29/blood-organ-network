-- ============================================================================
-- seed.sql   -   reference data + realistic demonstration data
--
-- DEMO CREDENTIALS
--   admin@bon.health        / Admin@123      (ADMIN)
--   donor@bon.health        / Password@123   (DONOR,             Aarav Sharma)
--   recipient@bon.health    / Password@123   (RECIPIENT,         Ishaan Verma)
--   hospital@bon.health     / Password@123   (HOSPITAL,          Apollo Speciality)
--   bloodbank@bon.health    / Password@123   (BLOOD_BANK,        Red Cross Bengaluru)
--   transplant@bon.health   / Password@123   (TRANSPLANT_CENTER, BLR Transplant Centre)
--   every other seeded account also uses Password@123
--
-- All personal data below is fictitious.
-- ============================================================================

USE blood_organ_network;

SET @DEMO_HASH  = '$2a$10$OS3zdlZV4H5O1i/8cJGcOe8yMtPdnYuuNUFUPQmPaSIbxEX294pxu'; -- Password@123
SET @ADMIN_HASH = '$2a$10$r62djwfJCpDVe678o6RnsOEQdU5sEAJus6LxAc0o1D9Lp4RNmP/02'; -- Admin@123

-- Clear transactional data (children first) so seed.sql is re-runnable.
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE organ_matches;
TRUNCATE TABLE organ_requests;
TRUNCATE TABLE available_organs;
TRUNCATE TABLE organ_donor_pledges;
TRUNCATE TABLE organ_donors;
TRUNCATE TABLE blood_allocations;
TRUNCATE TABLE blood_requests;
TRUNCATE TABLE blood_units;
TRUNCATE TABLE blood_donations;
TRUNCATE TABLE transplant_centers;
TRUNCATE TABLE blood_banks;
TRUNCATE TABLE hospitals;
TRUNCATE TABLE recipients;
TRUNCATE TABLE donors;
TRUNCATE TABLE notifications;
TRUNCATE TABLE audit_logs;
TRUNCATE TABLE users;
TRUNCATE TABLE blood_compatibility;
TRUNCATE TABLE matching_config;
TRUNCATE TABLE organ_types;
TRUNCATE TABLE blood_components;
TRUNCATE TABLE blood_groups;
TRUNCATE TABLE cities;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- 1. REFERENCE DATA
-- ============================================================================

INSERT INTO cities (city_id, name, state, region) VALUES
 (1,'Bengaluru','Karnataka','South'),
 (2,'Chennai','Tamil Nadu','South'),
 (3,'Hyderabad','Telangana','South'),
 (4,'Kochi','Kerala','South'),
 (5,'Mumbai','Maharashtra','West'),
 (6,'Pune','Maharashtra','West'),
 (7,'Ahmedabad','Gujarat','West'),
 (8,'New Delhi','Delhi','North'),
 (9,'Jaipur','Rajasthan','North'),
 (10,'Lucknow','Uttar Pradesh','North'),
 (11,'Kolkata','West Bengal','East'),
 (12,'Bhubaneswar','Odisha','East');

-- Antigen flags drive sp_rebuild_blood_compatibility().
INSERT INTO blood_groups (blood_group_id, group_code, abo_type, rh_factor, has_a, has_b, has_rh_d, population_pct) VALUES
 (1,'O+' ,'O' ,'+',0,0,1,36.50),
 (2,'O-' ,'O' ,'-',0,0,0, 1.60),
 (3,'A+' ,'A' ,'+',1,0,1,22.10),
 (4,'A-' ,'A' ,'-',1,0,0, 0.90),
 (5,'B+' ,'B' ,'+',0,1,1,30.90),
 (6,'B-' ,'B' ,'-',0,1,0, 1.30),
 (7,'AB+','AB','+',1,1,1, 6.40),
 (8,'AB-','AB','-',1,1,0, 0.30);

INSERT INTO blood_components (component_id, code, name, shelf_life_days, storage_temp, match_direction, description) VALUES
 (1,'WHOLE_BLOOD','Whole Blood',              35,'2 to 6 C',       'CELLULAR','Unseparated donation; used in massive haemorrhage'),
 (2,'RED_CELLS',  'Packed Red Blood Cells',   42,'2 to 6 C',       'CELLULAR','Most transfused component; treats anaemia and blood loss'),
 (3,'PLATELETS',  'Platelet Concentrate',      5,'20 to 24 C agitated','CELLULAR','Very short shelf life; used in chemotherapy and trauma'),
 (4,'PLASMA',     'Fresh Frozen Plasma',     365,'-25 C or below',  'PLASMA',  'Clotting factors; ABO rule is reversed'),
 (5,'CRYO',       'Cryoprecipitate',         365,'-25 C or below',  'PLASMA',  'Fibrinogen concentrate derived from plasma');

INSERT INTO organ_types (organ_type_id, code, name, description, max_cold_ischemia_hours, living_donation_possible, min_donor_age, max_donor_age) VALUES
 (1,'KIDNEY',   'Kidney',          'Most transplanted organ; living donation common',      24,TRUE ,  2,70),
 (2,'LIVER',    'Liver',           'Partial lobe donation possible from living donors',    12,TRUE ,  1,70),
 (3,'HEART',    'Heart',           'Deceased donation only; very short ischemia window',    6,FALSE,  1,60),
 (4,'LUNG',     'Lung',            'Deceased donation; highly time critical',               8,FALSE,  1,60),
 (5,'PANCREAS', 'Pancreas',        'Often transplanted together with a kidney',            18,FALSE,  1,55),
 (6,'CORNEA',   'Cornea',          'Tissue graft; can be stored far longer than organs',  336,FALSE,  2,80),
 (7,'INTESTINE','Small Intestine', 'Rare; for intestinal failure',                         10,FALSE,  1,50),
 (8,'MARROW',   'Bone Marrow',     'Haematopoietic stem cells from a living donor',        48,TRUE ,  1,60);

-- Organ matching weights - the algorithm reads these, so tuning needs no deploy.
INSERT INTO matching_config (config_key, config_value, description) VALUES
 ('organ_weight_blood',            40.0000,'Weight of ABO compatibility in the organ match score (%)'),
 ('organ_weight_urgency',          25.0000,'Weight of clinical urgency in the organ match score (%)'),
 ('organ_weight_priority',         20.0000,'Weight of the medical priority score (%)'),
 ('organ_weight_location',         10.0000,'Weight of geographic proximity (%)'),
 ('organ_weight_age',               5.0000,'Weight of donor/recipient age closeness (%)'),
 ('organ_min_match_score',         45.0000,'Proposals below this total score are not recorded'),
 ('organ_age_gap_tolerance_years', 25.0000,'Age gap at which the age sub-score reaches zero'),
 ('blood_donation_interval_days',  90.0000,'Days a donor is ineligible after donating whole blood'),
 ('blood_request_default_days',     7.0000,'Default days until required_by on a new blood request');

-- Derive the 8 x 8 x 5 compatibility matrix from the antigen flags.
CALL sp_rebuild_blood_compatibility();

-- ============================================================================
-- 2. USERS  (ids are explicit so every later reference is unambiguous)
-- ============================================================================

INSERT INTO users (user_id, full_name, email, password_hash, phone, role, status) VALUES
 (1,'Network Administrator','admin@bon.health',@ADMIN_HASH,'+91-80-4000-1000','ADMIN','ACTIVE'),

 -- 20 blood donors ------------------------------------------------------------
 ( 2,'Aarav Sharma',    'donor@bon.health',            @DEMO_HASH,'+91-98450-11001','DONOR','ACTIVE'),
 ( 3,'Priya Nair',      'priya.nair@bon.health',       @DEMO_HASH,'+91-98450-11002','DONOR','ACTIVE'),
 ( 4,'Rohan Mehta',     'rohan.mehta@bon.health',      @DEMO_HASH,'+91-98450-11003','DONOR','ACTIVE'),
 ( 5,'Ananya Iyer',     'ananya.iyer@bon.health',      @DEMO_HASH,'+91-98450-11004','DONOR','ACTIVE'),
 ( 6,'Vikram Singh',    'vikram.singh@bon.health',     @DEMO_HASH,'+91-98450-11005','DONOR','ACTIVE'),
 ( 7,'Sneha Reddy',     'sneha.reddy@bon.health',      @DEMO_HASH,'+91-98450-11006','DONOR','ACTIVE'),
 ( 8,'Arjun Desai',     'arjun.desai@bon.health',      @DEMO_HASH,'+91-98450-11007','DONOR','ACTIVE'),
 ( 9,'Kavya Menon',     'kavya.menon@bon.health',      @DEMO_HASH,'+91-98450-11008','DONOR','ACTIVE'),
 (10,'Rahul Bose',      'rahul.bose@bon.health',       @DEMO_HASH,'+91-98450-11009','DONOR','ACTIVE'),
 (11,'Meera Krishnan',  'meera.krishnan@bon.health',   @DEMO_HASH,'+91-98450-11010','DONOR','ACTIVE'),
 (12,'Karan Malhotra',  'karan.malhotra@bon.health',   @DEMO_HASH,'+91-98450-11011','DONOR','ACTIVE'),
 (13,'Divya Pillai',    'divya.pillai@bon.health',     @DEMO_HASH,'+91-98450-11012','DONOR','ACTIVE'),
 (14,'Siddharth Rao',   'siddharth.rao@bon.health',    @DEMO_HASH,'+91-98450-11013','DONOR','ACTIVE'),
 (15,'Nisha Gupta',     'nisha.gupta@bon.health',      @DEMO_HASH,'+91-98450-11014','DONOR','ACTIVE'),
 (16,'Aditya Joshi',    'aditya.joshi@bon.health',     @DEMO_HASH,'+91-98450-11015','DONOR','ACTIVE'),
 (17,'Pooja Banerjee',  'pooja.banerjee@bon.health',   @DEMO_HASH,'+91-98450-11016','DONOR','ACTIVE'),
 (18,'Manish Agarwal',  'manish.agarwal@bon.health',   @DEMO_HASH,'+91-98450-11017','DONOR','ACTIVE'),
 (19,'Lakshmi Subramanian','lakshmi.s@bon.health',     @DEMO_HASH,'+91-98450-11018','DONOR','ACTIVE'),
 (20,'Farhan Qureshi',  'farhan.qureshi@bon.health',   @DEMO_HASH,'+91-98450-11019','DONOR','ACTIVE'),
 (21,'Tara DSouza',     'tara.dsouza@bon.health',      @DEMO_HASH,'+91-98450-11020','DONOR','PENDING'),
 -- registered donors who have not yet given blood (the outreach pool)
 (43,'Neha Bhat',       'neha.bhat@bon.health',        @DEMO_HASH,'+91-98450-11021','DONOR','ACTIVE'),
 (44,'Imran Shaikh',    'imran.shaikh@bon.health',     @DEMO_HASH,'+91-98450-11022','DONOR','ACTIVE'),
 (45,'Sanjana Rout',    'sanjana.rout@bon.health',     @DEMO_HASH,'+91-98450-11023','DONOR','ACTIVE'),
 (46,'Dev Patel',       'dev.patel@bon.health',        @DEMO_HASH,'+91-98450-11024','DONOR','ACTIVE'),
 (47,'Ritika Chauhan',  'ritika.chauhan@bon.health',   @DEMO_HASH,'+91-98450-11025','DONOR','ACTIVE'),
 (48,'Joseph Fernandes','joseph.fernandes@bon.health', @DEMO_HASH,'+91-98450-11026','DONOR','ACTIVE'),
 (49,'Ayesha Siddiqui', 'ayesha.siddiqui@bon.health',  @DEMO_HASH,'+91-98450-11027','DONOR','ACTIVE'),
 (50,'Harsh Vardhan',   'harsh.vardhan@bon.health',    @DEMO_HASH,'+91-98450-11028','DONOR','ACTIVE'),
 (51,'Bhavna Solanki',  'bhavna.solanki@bon.health',   @DEMO_HASH,'+91-98450-11029','DONOR','ACTIVE'),
 (52,'Rajeev Pandey',   'rajeev.pandey@bon.health',    @DEMO_HASH,'+91-98450-11030','DONOR','ACTIVE'),

 -- 8 recipients ---------------------------------------------------------------
 (22,'Ishaan Verma',    'recipient@bon.health',        @DEMO_HASH,'+91-98450-22001','RECIPIENT','ACTIVE'),
 (23,'Riya Chatterjee', 'riya.chatterjee@bon.health',  @DEMO_HASH,'+91-98450-22002','RECIPIENT','ACTIVE'),
 (24,'Sameer Kulkarni', 'sameer.kulkarni@bon.health',  @DEMO_HASH,'+91-98450-22003','RECIPIENT','ACTIVE'),
 (25,'Aisha Khan',      'aisha.khan@bon.health',       @DEMO_HASH,'+91-98450-22004','RECIPIENT','ACTIVE'),
 (26,'Gaurav Thakur',   'gaurav.thakur@bon.health',    @DEMO_HASH,'+91-98450-22005','RECIPIENT','ACTIVE'),
 (27,'Shruti Deshmukh', 'shruti.deshmukh@bon.health',  @DEMO_HASH,'+91-98450-22006','RECIPIENT','ACTIVE'),
 (28,'Nikhil Raghavan', 'nikhil.raghavan@bon.health',  @DEMO_HASH,'+91-98450-22007','RECIPIENT','ACTIVE'),
 (29,'Zoya Ansari',     'zoya.ansari@bon.health',      @DEMO_HASH,'+91-98450-22008','RECIPIENT','ACTIVE'),

 -- 5 hospital accounts ---------------------------------------------------------
 (30,'Apollo Speciality Hospital','hospital@bon.health',      @DEMO_HASH,'+91-80-4000-2001','HOSPITAL','ACTIVE'),
 (31,'Lilavati Medical Centre',   'lilavati@bon.health',      @DEMO_HASH,'+91-22-4000-2002','HOSPITAL','ACTIVE'),
 (32,'Capital Institute of Medical Sciences','capital@bon.health',@DEMO_HASH,'+91-11-4000-2003','HOSPITAL','ACTIVE'),
 (33,'Kauvery General Hospital',  'kauvery@bon.health',       @DEMO_HASH,'+91-44-4000-2004','HOSPITAL','ACTIVE'),
 (34,'Belle Vue Clinic',          'bellevue@bon.health',      @DEMO_HASH,'+91-33-4000-2005','HOSPITAL','PENDING'),

 -- 5 blood bank accounts -------------------------------------------------------
 (35,'Red Cross Blood Bank Bengaluru','bloodbank@bon.health', @DEMO_HASH,'+91-80-4000-3001','BLOOD_BANK','ACTIVE'),
 (36,'Mumbai Central Blood Bank',     'mumbaibank@bon.health',@DEMO_HASH,'+91-22-4000-3002','BLOOD_BANK','ACTIVE'),
 (37,'Delhi Regional Blood Bank',     'delhibank@bon.health', @DEMO_HASH,'+91-11-4000-3003','BLOOD_BANK','ACTIVE'),
 (38,'Chennai City Blood Bank',       'chennaibank@bon.health',@DEMO_HASH,'+91-44-4000-3004','BLOOD_BANK','ACTIVE'),
 (39,'Kolkata Eastern Blood Bank',    'kolkatabank@bon.health',@DEMO_HASH,'+91-33-4000-3005','BLOOD_BANK','ACTIVE'),

 -- 3 transplant centre accounts ------------------------------------------------
 (40,'Bengaluru Transplant Centre','transplant@bon.health',   @DEMO_HASH,'+91-80-4000-4001','TRANSPLANT_CENTER','ACTIVE'),
 (41,'Mumbai Transplant Institute','mumbaitx@bon.health',     @DEMO_HASH,'+91-22-4000-4002','TRANSPLANT_CENTER','ACTIVE'),
 (42,'Delhi Organ Transplant Unit','delhitx@bon.health',      @DEMO_HASH,'+91-11-4000-4003','TRANSPLANT_CENTER','ACTIVE');

-- ============================================================================
-- 3. ACTOR PROFILES
-- ============================================================================

INSERT INTO donors (donor_id, user_id, date_of_birth, gender, blood_group_id, city_id, address, weight_kg, eligibility_status) VALUES
 ( 1, 2,'1995-04-12','MALE'  ,1, 1,'14, 3rd Cross, Indiranagar',       74.5,'ELIGIBLE'),
 ( 2, 3,'1992-09-23','FEMALE',2, 1,'88, Jayanagar 4th Block',          58.0,'ELIGIBLE'),
 ( 3, 4,'1988-01-30','MALE'  ,3, 5,'402, Andheri West',                81.2,'ELIGIBLE'),
 ( 4, 5,'1998-07-15','FEMALE',5, 2,'21, T Nagar',                      55.4,'ELIGIBLE'),
 ( 5, 6,'1985-11-02','MALE'  ,1, 8,'C-19, Vasant Kunj',                88.0,'ELIGIBLE'),
 ( 6, 7,'1996-03-19','FEMALE',7, 3,'7-1-24, Begumpet',                 61.3,'ELIGIBLE'),
 ( 7, 8,'1991-06-08','MALE'  ,4, 7,'32, Satellite Road',               77.9,'ELIGIBLE'),
 ( 8, 9,'1999-12-25','FEMALE',1, 4,'19, Panampilly Nagar',             52.8,'ELIGIBLE'),
 ( 9,10,'1987-08-14','MALE'  ,5,11,'56, Salt Lake Sector 2',           83.6,'ELIGIBLE'),
 (10,11,'1994-02-27','FEMALE',3, 2,'104, Adyar',                       59.1,'ELIGIBLE'),
 (11,12,'1990-05-05','MALE'  ,6, 8,'B-7, Greater Kailash',             79.4,'ELIGIBLE'),
 (12,13,'1997-10-11','FEMALE',1, 4,'8, Kaloor',                        56.7,'ELIGIBLE'),
 (13,14,'1986-07-21','MALE'  ,2, 1,'45, Koramangala 6th Block',        85.3,'ELIGIBLE'),
 (14,15,'1993-01-09','FEMALE',8, 9,'D-12, Malviya Nagar',              54.2,'ELIGIBLE'),
 (15,16,'1989-04-03','MALE'  ,3, 6,'77, Koregaon Park',                80.1,'ELIGIBLE'),
 (16,17,'2000-08-30','FEMALE',5,11,'23, Ballygunge',                   57.5,'ELIGIBLE'),
 (17,18,'1984-12-17','MALE'  ,1,10,'9, Gomti Nagar',                   90.2,'TEMPORARILY_INELIGIBLE'),
 (18,19,'1995-09-06','FEMALE',3, 2,'61, Velachery',                    60.8,'ELIGIBLE'),
 (19,20,'1992-11-28','MALE'  ,5, 5,'307, Bandra East',                 76.0,'ELIGIBLE'),
 (20,21,'2003-02-14','FEMALE',1,12,'15, Saheed Nagar',                 49.0,'INELIGIBLE'),
 -- never donated yet; eligibility_status keeps its ELIGIBLE default
 (21,43,'1996-06-18','FEMALE',3, 1,'62, HSR Layout',                  57.2,'ELIGIBLE'),
 (22,44,'1991-03-25','MALE'  ,1, 5,'18, Kurla West',                  82.4,'ELIGIBLE'),
 (23,45,'1999-11-09','FEMALE',5,12,'34, Patia',                       53.9,'ELIGIBLE'),
 (24,46,'1988-08-02','MALE'  ,7, 7,'91, Bopal',                       78.6,'ELIGIBLE'),
 (25,47,'1994-04-29','FEMALE',2, 9,'C-5, Vaishali Nagar',             55.1,'ELIGIBLE'),
 (26,48,'1986-12-13','MALE'  ,3, 4,'7, Fort Kochi',                   84.0,'ELIGIBLE'),
 (27,49,'2000-07-21','FEMALE',6, 8,'B-14, Jamia Nagar',               51.8,'ELIGIBLE'),
 (28,50,'1990-01-16','MALE'  ,5,10,'22, Hazratganj',                  80.3,'ELIGIBLE'),
 (29,51,'1997-09-30','FEMALE',4, 6,'46, Baner',                       54.7,'ELIGIBLE'),
 (30,52,'1983-05-07','MALE'  ,1, 3,'3-6-88, Himayatnagar',            87.1,'ELIGIBLE');

INSERT INTO recipients (recipient_id, user_id, date_of_birth, gender, blood_group_id, city_id, address, medical_notes) VALUES
 (1,22,'1979-03-11','MALE'  ,7, 1,'202, Whitefield',        'Chronic kidney disease, stage 5. On dialysis three times weekly.'),
 (2,23,'1966-08-19','FEMALE',6,11,'41, Park Street',        'Decompensated cirrhosis. Listed for liver transplant.'),
 (3,24,'1990-12-04','MALE'  ,4, 6,'88, Aundh',              'Aplastic anaemia. Requires frequent platelet support.'),
 (4,25,'2001-05-22','FEMALE',2, 8,'A-4, Saket',             'Thalassaemia major. Regular red cell transfusions.'),
 (5,26,'1972-01-15','MALE'  ,1, 5,'1104, Powai',            'Dilated cardiomyopathy. Heart transplant candidate.'),
 (6,27,'1995-07-07','FEMALE',3, 2,'17, Nungambakkam',       'Post-partum haemorrhage protocol on file.'),
 (7,28,'1958-10-29','MALE'  ,5, 1,'5, Malleswaram',         'Type 1 diabetes with renal failure. Kidney-pancreas candidate.'),
 (8,29,'1988-04-18','FEMALE',8, 8,'E-22, Dwarka',           'Corneal scarring, both eyes. Awaiting graft.');

INSERT INTO hospitals (hospital_id, user_id, name, registration_number, address, city_id, phone, email, bed_capacity, status) VALUES
 (1,30,'Apollo Speciality Hospital','HOSP-KA-001','154, Bannerghatta Road',       1,'+91-80-4000-2001','hospital@bon.health',  850,'ACTIVE'),
 (2,31,'Lilavati Medical Centre',   'HOSP-MH-002','A-791, Bandra Reclamation',    5,'+91-22-4000-2002','lilavati@bon.health',  620,'ACTIVE'),
 (3,32,'Capital Institute of Medical Sciences','HOSP-DL-003','Ansari Nagar East', 8,'+91-11-4000-2003','capital@bon.health',  1400,'ACTIVE'),
 (4,33,'Kauvery General Hospital',  'HOSP-TN-004','199, Luz Church Road',         2,'+91-44-4000-2004','kauvery@bon.health',   410,'ACTIVE'),
 (5,34,'Belle Vue Clinic',          'HOSP-WB-005','9, Dr U N Brahmachari Street',11,'+91-33-4000-2005','bellevue@bon.health',  330,'PENDING');

INSERT INTO blood_banks (blood_bank_id, user_id, hospital_id, name, registration_number, address, city_id, phone, email, status) VALUES
 (1,35,1,   'Red Cross Blood Bank Bengaluru','BB-KA-001','26, Race Course Road',    1,'+91-80-4000-3001','bloodbank@bon.health',  'ACTIVE'),
 (2,36,NULL,'Mumbai Central Blood Bank',     'BB-MH-002','Tardeo Road, Mumbai Central',5,'+91-22-4000-3002','mumbaibank@bon.health','ACTIVE'),
 (3,37,3,   'Delhi Regional Blood Bank',     'BB-DL-003','Ansari Nagar West',        8,'+91-11-4000-3003','delhibank@bon.health',  'ACTIVE'),
 (4,38,NULL,'Chennai City Blood Bank',       'BB-TN-004','Egmore, Poonamallee High Road',2,'+91-44-4000-3004','chennaibank@bon.health','ACTIVE'),
 (5,39,NULL,'Kolkata Eastern Blood Bank',    'BB-WB-005','Manicktala Main Road',    11,'+91-33-4000-3005','kolkatabank@bon.health','ACTIVE');

INSERT INTO transplant_centers (center_id, hospital_id, user_id, license_number, name, status) VALUES
 (1,1,40,'TX-KA-0001','Bengaluru Transplant Centre','ACTIVE'),
 (2,2,41,'TX-MH-0002','Mumbai Transplant Institute','ACTIVE'),
 (3,3,42,'TX-DL-0003','Delhi Organ Transplant Unit','ACTIVE');

-- ============================================================================
-- 4. BLOOD DONATIONS
-- Dates are relative to CURDATE() so the demo data never goes stale.
-- Donations are inserted as PENDING screening, then released in step 6 - this
-- deliberately exercises trg_blood_donations_after_update during seeding.
-- ============================================================================

INSERT INTO blood_donations (donation_id, donor_id, blood_bank_id, blood_group_id, donation_date, volume_ml, hemoglobin_gdl, screening_status, recorded_by) VALUES
 ( 1, 1,1,1,DATE_SUB(CURDATE(),INTERVAL  4 DAY),450,14.2,'PENDING',35),
 ( 2, 2,1,2,DATE_SUB(CURDATE(),INTERVAL  6 DAY),450,13.1,'PENDING',35),
 ( 3,13,1,2,DATE_SUB(CURDATE(),INTERVAL  9 DAY),450,15.0,'PENDING',35),
 ( 4, 1,1,1,DATE_SUB(CURDATE(),INTERVAL 98 DAY),450,14.0,'PENDING',35),
 ( 5, 2,1,2,DATE_SUB(CURDATE(),INTERVAL 75 DAY),450,12.9,'PENDING',35),
 ( 6, 8,1,1,DATE_SUB(CURDATE(),INTERVAL 11 DAY),400,13.4,'PENDING',35),
 ( 7,12,1,1,DATE_SUB(CURDATE(),INTERVAL 14 DAY),450,13.8,'PENDING',35),
 ( 8, 5,3,1,DATE_SUB(CURDATE(),INTERVAL  3 DAY),450,15.3,'PENDING',37),
 ( 9,11,3,6,DATE_SUB(CURDATE(),INTERVAL  7 DAY),450,14.6,'PENDING',37),
 (10,14,3,8,DATE_SUB(CURDATE(),INTERVAL  5 DAY),400,12.7,'PENDING',37),
 (11,17,3,1,DATE_SUB(CURDATE(),INTERVAL 21 DAY),450,14.9,'PENDING',37),
 (12, 5,3,1,DATE_SUB(CURDATE(),INTERVAL 95 DAY),450,15.1,'PENDING',37),
 (13,11,3,6,DATE_SUB(CURDATE(),INTERVAL 88 DAY),450,14.3,'PENDING',37),
 (14,14,3,8,DATE_SUB(CURDATE(),INTERVAL 12 DAY),400,12.5,'PENDING',37),
 (15, 3,2,3,DATE_SUB(CURDATE(),INTERVAL  2 DAY),450,15.5,'PENDING',36),
 (16,19,2,5,DATE_SUB(CURDATE(),INTERVAL  8 DAY),450,14.1,'PENDING',36),
 (17,15,2,3,DATE_SUB(CURDATE(),INTERVAL 16 DAY),450,13.9,'PENDING',36),
 (18, 3,2,3,DATE_SUB(CURDATE(),INTERVAL 70 DAY),450,15.2,'PENDING',36),
 (19,19,2,5,DATE_SUB(CURDATE(),INTERVAL 60 DAY),450,14.4,'PENDING',36),
 (20,15,2,3,DATE_SUB(CURDATE(),INTERVAL 10 DAY),450,13.7,'PENDING',36),
 (21, 4,4,5,DATE_SUB(CURDATE(),INTERVAL  1 DAY),400,12.8,'PENDING',38),
 (22,10,4,3,DATE_SUB(CURDATE(),INTERVAL  6 DAY),450,13.6,'PENDING',38),
 (23,18,4,3,DATE_SUB(CURDATE(),INTERVAL 13 DAY),450,13.2,'PENDING',38),
 (24, 4,4,5,DATE_SUB(CURDATE(),INTERVAL 85 DAY),400,12.6,'PENDING',38),
 (25,10,4,3,DATE_SUB(CURDATE(),INTERVAL 18 DAY),450,13.5,'PENDING',38),
 (26,18,4,3,DATE_SUB(CURDATE(),INTERVAL 50 DAY),450,13.3,'PENDING',38),
 (27, 9,5,5,DATE_SUB(CURDATE(),INTERVAL  2 DAY),450,14.8,'PENDING',39),
 (28,16,5,5,DATE_SUB(CURDATE(),INTERVAL  9 DAY),400,12.4,'PENDING',39),
 (29, 9,5,5,DATE_SUB(CURDATE(),INTERVAL 92 DAY),450,14.7,'PENDING',39),
 (30,16,5,5,DATE_SUB(CURDATE(),INTERVAL 45 DAY),400,12.2,'PENDING',39),
 (31, 6,1,7,DATE_SUB(CURDATE(),INTERVAL  5 DAY),450,14.5,'PENDING',35),
 (32, 7,2,4,DATE_SUB(CURDATE(),INTERVAL  3 DAY),450,15.4,'PENDING',36),
 (33, 7,2,4,DATE_SUB(CURDATE(),INTERVAL 80 DAY),450,15.0,'PENDING',36),
 (34, 6,1,7,DATE_SUB(CURDATE(),INTERVAL 40 DAY),450,14.2,'PENDING',35),
 (35,13,1,2,DATE_SUB(CURDATE(),INTERVAL 30 DAY),450,14.9,'PENDING',35),
 (36,12,1,1,DATE_SUB(CURDATE(),INTERVAL 55 DAY),450,13.9,'PENDING',35),
 (37, 8,1,1,DATE_SUB(CURDATE(),INTERVAL 65 DAY),400,13.1,'PENDING',35),
 (38,17,3,1,DATE_SUB(CURDATE(),INTERVAL 90 DAY),450,14.6,'PENDING',37),
 (39,20,5,1,DATE_SUB(CURDATE(),INTERVAL 25 DAY),400,11.8,'PENDING',39),
 (40, 1,1,1,DATE_SUB(CURDATE(),INTERVAL 20 DAY),450,14.3,'PENDING',35),
 (41, 2,1,2,DATE_SUB(CURDATE(),INTERVAL 35 DAY),450,13.0,'PENDING',35),
 (42, 3,2,3,DATE_SUB(CURDATE(),INTERVAL 28 DAY),450,15.1,'PENDING',36),
 (43, 4,4,5,DATE_SUB(CURDATE(),INTERVAL 33 DAY),400,12.9,'PENDING',38),
 (44, 5,3,1,DATE_SUB(CURDATE(),INTERVAL 42 DAY),450,15.2,'PENDING',37),
 (45, 9,5,5,DATE_SUB(CURDATE(),INTERVAL 38 DAY),450,14.5,'PENDING',39);

-- ============================================================================
-- 5. BLOOD UNITS
-- Generated from the donations by CROSS JOINing with the component list, which
-- is how a real bank works: one whole-blood donation is separated into several
-- components, each with its own shelf life.
--   every donation      -> packed red cells + fresh frozen plasma
--   every 3rd donation  -> platelet concentrate (5 day shelf life)
--   every 7th donation  -> kept as whole blood instead
-- expiry_date is left NULL on purpose: trg_blood_units_before_insert derives it
-- from blood_components.shelf_life_days.
-- ============================================================================

INSERT INTO blood_units (unit_code, donation_id, blood_bank_id, blood_group_id, component_id, volume_ml, collection_date, expiry_date, status)
SELECT CONCAT('BU-', LPAD(bd.donation_id,4,'0'), '-', c.code),
       bd.donation_id, bd.blood_bank_id, bd.blood_group_id, c.component_id,
       CASE c.code WHEN 'RED_CELLS' THEN 280 WHEN 'PLASMA' THEN 220
                   WHEN 'PLATELETS' THEN 60  ELSE 450 END,
       bd.donation_date,
       NULL,                      -- derived by trigger from shelf_life_days
       'QUARANTINED'
  FROM blood_donations bd
 CROSS JOIN blood_components c
 WHERE (c.code IN ('RED_CELLS','PLASMA')            AND bd.donation_id % 7 <> 0)
    OR (c.code = 'PLATELETS'  AND bd.donation_id % 3 = 0 AND bd.donation_id % 7 <> 0)
    OR (c.code = 'WHOLE_BLOOD' AND bd.donation_id % 7 = 0);

-- A small stock of cryoprecipitate held centrally.
INSERT INTO blood_units (unit_code, donation_id, blood_bank_id, blood_group_id, component_id, volume_ml, collection_date, expiry_date, status)
SELECT CONCAT('BU-CRYO-', LPAD(bd.donation_id,4,'0')),
       bd.donation_id, bd.blood_bank_id, bd.blood_group_id, 5, 40, bd.donation_date, NULL, 'QUARANTINED'
  FROM blood_donations bd
 WHERE bd.donation_id IN (1,8,15,21,27,31,32);

-- ============================================================================
-- 6. SCREENING  -  releases quarantined stock via trg_blood_donations_after_update
-- Two donations fail screening; their units are auto-discarded by the trigger.
-- One stays PENDING so the "awaiting screening" state is demonstrable.
-- ============================================================================

UPDATE blood_donations SET screening_status = 'PASSED',
       screened_at = DATE_ADD(donation_date, INTERVAL 1 DAY)
 WHERE donation_id NOT IN (39, 30, 21);

UPDATE blood_donations SET screening_status = 'FAILED',
       screened_at = DATE_ADD(donation_date, INTERVAL 1 DAY),
       notes = 'Reactive on infectious disease screening - units discarded'
 WHERE donation_id IN (39, 30);
-- donation 21 intentionally left PENDING

-- ============================================================================
-- 7. BLOOD REQUESTS  -  covering every workflow state
-- ============================================================================

INSERT INTO blood_requests (blood_request_id, request_code, recipient_id, hospital_id, blood_group_id, component_id, units_required, urgency, patient_name, request_date, required_by, status, notes, created_by) VALUES
 (1,'BR-2001',4,3,2,2,4,'CRITICAL','Aisha Khan',      DATE_SUB(NOW(),INTERVAL 2 DAY),DATE_ADD(CURDATE(),INTERVAL 2 DAY),'PENDING','Thalassaemia transfusion cycle. O- required.',25),
 (2,'BR-2002',1,1,7,2,2,'URGENT','Ishaan Verma',      DATE_SUB(NOW(),INTERVAL 1 DAY),DATE_ADD(CURDATE(),INTERVAL 3 DAY),'PENDING','Pre-dialysis top up.',22),
 (3,'BR-2003',3,2,4,3,3,'CRITICAL','Sameer Kulkarni', DATE_SUB(NOW(),INTERVAL 3 DAY),DATE_ADD(CURDATE(),INTERVAL 1 DAY),'PENDING','Platelet support, aplastic anaemia.',24),
 (4,'BR-2004',6,4,3,2,2,'ROUTINE','Shruti Deshmukh',  DATE_SUB(NOW(),INTERVAL 5 DAY),DATE_ADD(CURDATE(),INTERVAL 6 DAY),'PENDING','Elective surgery standby.',27),
 (5,'BR-2005',NULL,1,1,2,6,'CRITICAL','RTA Trauma Case 114',DATE_SUB(NOW(),INTERVAL 1 DAY),DATE_ADD(CURDATE(),INTERVAL 1 DAY),'PENDING','Road traffic accident, mass transfusion protocol.',30),
 (6,'BR-2006',2,5,6,4,2,'URGENT','Riya Chatterjee',   DATE_SUB(NOW(),INTERVAL 4 DAY),DATE_ADD(CURDATE(),INTERVAL 4 DAY),'PENDING','Coagulopathy, FFP required.',23),
 (7,'BR-2007',5,2,1,2,3,'URGENT','Gaurav Thakur',     DATE_SUB(NOW(),INTERVAL 6 DAY),DATE_ADD(CURDATE(),INTERVAL 5 DAY),'PENDING','Cardiac workup.',26),
 (8,'BR-2008',8,3,8,2,1,'ROUTINE','Zoya Ansari',      DATE_SUB(NOW(),INTERVAL 8 DAY),DATE_ADD(CURDATE(),INTERVAL 7 DAY),'PENDING','Pre-operative reserve.',29),
 (9,'BR-2009',7,1,5,2,2,'ROUTINE','Nikhil Raghavan',  DATE_SUB(NOW(),INTERVAL 20 DAY),DATE_SUB(CURDATE(),INTERVAL 5 DAY),'PENDING','Older request, now past its required-by date.',28),
 (10,'BR-2010',NULL,4,3,1,2,'URGENT','Obstetric Case 77',DATE_SUB(NOW(),INTERVAL 12 DAY),DATE_ADD(CURDATE(),INTERVAL 9 DAY),'PENDING','Post-partum haemorrhage standby.',33),
 (11,'BR-2011',1,1,7,4,1,'ROUTINE','Ishaan Verma',    DATE_SUB(NOW(),INTERVAL 15 DAY),DATE_ADD(CURDATE(),INTERVAL 10 DAY),'REJECTED','Duplicate of BR-2002, withdrawn by clinician.',22),
 (12,'BR-2012',4,3,2,2,2,'ROUTINE','Aisha Khan',      DATE_SUB(NOW(),INTERVAL 40 DAY),DATE_SUB(CURDATE(),INTERVAL 30 DAY),'CANCELLED','Patient transferred to another centre.',25);

-- ============================================================================
-- 8. ORGAN SUBSYSTEM
-- ============================================================================

INSERT INTO organ_donors (organ_donor_id, donor_id, registration_date, donor_kind, consent_status, medical_status, next_of_kin, notes) VALUES
 ( 1, 1,DATE_SUB(CURDATE(),INTERVAL 400 DAY),'LIVING'  ,'CONSENTED','CLEARED'         ,'Sunita Sharma','Pledged after a campus donation drive.'),
 ( 2, 3,DATE_SUB(CURDATE(),INTERVAL 320 DAY),'LIVING'  ,'CONSENTED','CLEARED'         ,'Nikita Mehta',NULL),
 ( 3, 5,DATE_SUB(CURDATE(),INTERVAL 280 DAY),'DECEASED','CONSENTED','CLEARED'         ,'Harpreet Singh','Brain-stem death certified; family consent recorded.'),
 ( 4, 7,DATE_SUB(CURDATE(),INTERVAL 250 DAY),'LIVING'  ,'CONSENTED','UNDER_EVALUATION','Reema Desai',NULL),
 ( 5, 9,DATE_SUB(CURDATE(),INTERVAL 220 DAY),'DECEASED','CONSENTED','CLEARED'         ,'Anjali Bose','Multi-organ donor.'),
 ( 6,11,DATE_SUB(CURDATE(),INTERVAL 190 DAY),'LIVING'  ,'CONSENTED','CLEARED'         ,'Deepa Krishnan',NULL),
 ( 7,13,DATE_SUB(CURDATE(),INTERVAL 150 DAY),'DECEASED','CONSENTED','CLEARED'         ,'Shalini Rao','Multi-organ donor.'),
 ( 8,15,DATE_SUB(CURDATE(),INTERVAL 120 DAY),'LIVING'  ,'PENDING'  ,'UNDER_EVALUATION','Rekha Joshi','Awaiting counselling session.'),
 ( 9,17,DATE_SUB(CURDATE(),INTERVAL  90 DAY),'LIVING'  ,'WITHDRAWN','NOT_CLEARED'     ,'Vinod Agarwal','Consent withdrawn on medical advice.'),
 (10,19,DATE_SUB(CURDATE(),INTERVAL  60 DAY),'LIVING'  ,'CONSENTED','CLEARED'         ,'Maria DSouza',NULL);

INSERT INTO organ_donor_pledges (organ_donor_id, organ_type_id, pledged_at, status) VALUES
 (1,1,DATE_SUB(CURDATE(),INTERVAL 400 DAY),'ACTIVE'),(1,6,DATE_SUB(CURDATE(),INTERVAL 400 DAY),'ACTIVE'),(1,8,DATE_SUB(CURDATE(),INTERVAL 400 DAY),'ACTIVE'),
 (2,1,DATE_SUB(CURDATE(),INTERVAL 320 DAY),'ACTIVE'),(2,2,DATE_SUB(CURDATE(),INTERVAL 320 DAY),'ACTIVE'),
 (3,1,DATE_SUB(CURDATE(),INTERVAL 280 DAY),'ACTIVE'),(3,2,DATE_SUB(CURDATE(),INTERVAL 280 DAY),'ACTIVE'),(3,3,DATE_SUB(CURDATE(),INTERVAL 280 DAY),'ACTIVE'),(3,6,DATE_SUB(CURDATE(),INTERVAL 280 DAY),'ACTIVE'),
 (4,1,DATE_SUB(CURDATE(),INTERVAL 250 DAY),'ACTIVE'),(4,8,DATE_SUB(CURDATE(),INTERVAL 250 DAY),'ACTIVE'),
 (5,1,DATE_SUB(CURDATE(),INTERVAL 220 DAY),'ACTIVE'),(5,2,DATE_SUB(CURDATE(),INTERVAL 220 DAY),'ACTIVE'),(5,4,DATE_SUB(CURDATE(),INTERVAL 220 DAY),'ACTIVE'),(5,5,DATE_SUB(CURDATE(),INTERVAL 220 DAY),'ACTIVE'),(5,6,DATE_SUB(CURDATE(),INTERVAL 220 DAY),'ACTIVE'),
 (6,1,DATE_SUB(CURDATE(),INTERVAL 190 DAY),'ACTIVE'),(6,6,DATE_SUB(CURDATE(),INTERVAL 190 DAY),'ACTIVE'),
 (7,1,DATE_SUB(CURDATE(),INTERVAL 150 DAY),'ACTIVE'),(7,2,DATE_SUB(CURDATE(),INTERVAL 150 DAY),'ACTIVE'),(7,3,DATE_SUB(CURDATE(),INTERVAL 150 DAY),'ACTIVE'),(7,5,DATE_SUB(CURDATE(),INTERVAL 150 DAY),'ACTIVE'),
 (8,1,DATE_SUB(CURDATE(),INTERVAL 120 DAY),'ACTIVE'),
 (9,1,DATE_SUB(CURDATE(),INTERVAL  90 DAY),'WITHDRAWN'),
 (10,1,DATE_SUB(CURDATE(),INTERVAL 60 DAY),'ACTIVE'),(10,6,DATE_SUB(CURDATE(),INTERVAL 60 DAY),'ACTIVE'),(10,8,DATE_SUB(CURDATE(),INTERVAL 60 DAY),'ACTIVE');

-- viable_until is left NULL: trg_available_organs_before_insert derives it from
-- organ_types.max_cold_ischemia_hours.
INSERT INTO available_organs (organ_code, organ_donor_id, organ_type_id, blood_group_id, center_id, city_id, donor_age, hla_type, medical_status, availability_status, recovered_at, viable_until, notes) VALUES
 ('ORG-3001', 3,1,1,1, 1,40,'A2,B7,DR15','VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL  6 HOUR),NULL,'Left kidney, deceased donor.'),
 ('ORG-3002', 3,1,1,1, 1,40,'A2,B7,DR15','VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL  6 HOUR),NULL,'Right kidney, same donor.'),
 ('ORG-3003', 3,2,1,1, 1,40,'A2,B7,DR15','VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL  4 HOUR),NULL,'Whole liver.'),
 ('ORG-3004', 5,1,5,3, 8,38,'A1,B8,DR3' ,'VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL  3 HOUR),NULL,'Left kidney.'),
 ('ORG-3005', 5,3,5,3, 8,38,'A1,B8,DR3' ,'VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL  2 HOUR),NULL,'Heart, very short window.'),
 ('ORG-3006', 5,4,5,3, 8,38,'A1,B8,DR3' ,'VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL  2 HOUR),NULL,'Left lung.'),
 ('ORG-3007', 7,1,2,2, 5,39,'A3,B35,DR4','VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL  5 HOUR),NULL,'Left kidney, O- universal donor.'),
 ('ORG-3008', 7,2,2,2, 5,39,'A3,B35,DR4','VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL  5 HOUR),NULL,'Liver, O- universal donor.'),
 ('ORG-3009', 7,5,2,2, 5,39,'A3,B35,DR4','VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL  4 HOUR),NULL,'Pancreas.'),
 ('ORG-3010', 1,6,1,1, 1,31,NULL,'VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL 48 HOUR),NULL,'Cornea, left eye.'),
 ('ORG-3011', 1,6,1,1, 1,31,NULL,'VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL 48 HOUR),NULL,'Cornea, right eye.'),
 ('ORG-3012', 6,1,6,3, 8,36,'A11,B27,DR7','UNDER_EVALUATION','AVAILABLE',DATE_SUB(NOW(),INTERVAL 1 HOUR),NULL,'Living donor kidney, evaluation in progress.'),
 ('ORG-3013',10,8,5,2, 5,34,'A2,B44,DR13','VIABLE','AVAILABLE',DATE_SUB(NOW(),INTERVAL 10 HOUR),NULL,'Bone marrow, living donor.'),
 ('ORG-3014', 2,1,3,1, 1,38,'A24,B13,DR11','VIABLE','TRANSPLANTED',DATE_SUB(NOW(),INTERVAL 30 DAY),DATE_SUB(NOW(),INTERVAL 29 DAY),'Historic record: transplant completed.');

INSERT INTO organ_requests (organ_request_id, request_code, recipient_id, hospital_id, organ_type_id, blood_group_id, urgency, medical_priority, recipient_age, request_date, required_by, status, notes, created_by) VALUES
 (1,'OR-4001',1,1,1,7,'URGENT'  ,82,fn_calculate_age('1979-03-11'),DATE_SUB(NOW(),INTERVAL 10 DAY),DATE_ADD(CURDATE(),INTERVAL 60 DAY),'PENDING','ESRD on dialysis 3x weekly. AB+ recipient.',22),
 (2,'OR-4002',2,5,2,6,'CRITICAL',95,fn_calculate_age('1966-08-19'),DATE_SUB(NOW(),INTERVAL  5 DAY),DATE_ADD(CURDATE(),INTERVAL 14 DAY),'PENDING','Decompensated cirrhosis, rising MELD.',23),
 (3,'OR-4003',5,2,3,1,'CRITICAL',90,fn_calculate_age('1972-01-15'),DATE_SUB(NOW(),INTERVAL  3 DAY),DATE_ADD(CURDATE(),INTERVAL  7 DAY),'PENDING','Dilated cardiomyopathy, inotrope dependent.',26),
 (4,'OR-4004',7,1,1,5,'URGENT'  ,75,fn_calculate_age('1958-10-29'),DATE_SUB(NOW(),INTERVAL  8 DAY),DATE_ADD(CURDATE(),INTERVAL 45 DAY),'PENDING','Kidney first, pancreas to follow.',28),
 (5,'OR-4005',7,1,5,5,'ROUTINE' ,60,fn_calculate_age('1958-10-29'),DATE_SUB(NOW(),INTERVAL  8 DAY),DATE_ADD(CURDATE(),INTERVAL 90 DAY),'PENDING','Pancreas, second stage.',28),
 (6,'OR-4006',8,3,6,8,'ROUTINE' ,45,fn_calculate_age('1988-04-18'),DATE_SUB(NOW(),INTERVAL 15 DAY),DATE_ADD(CURDATE(),INTERVAL 120 DAY),'PENDING','Bilateral corneal graft.',29),
 (7,'OR-4007',3,2,8,4,'URGENT'  ,78,fn_calculate_age('1990-12-04'),DATE_SUB(NOW(),INTERVAL  6 DAY),DATE_ADD(CURDATE(),INTERVAL 30 DAY),'PENDING','Aplastic anaemia, marrow transplant.',24),
 (8,'OR-4008',4,3,1,2,'ROUTINE' ,50,fn_calculate_age('2001-05-22'),DATE_SUB(NOW(),INTERVAL 25 DAY),DATE_ADD(CURDATE(),INTERVAL 180 DAY),'CANCELLED','Withdrawn - patient opted for continued dialysis.',25);

-- ============================================================================
-- 9. RUN THE REAL WORKFLOWS
-- The seed does not fake allocations or match scores: it calls the same stored
-- procedures the API calls, so the demo data is provably reachable through the
-- application's own logic.
-- ============================================================================

-- Blood allocation (transactional, FOR UPDATE + SKIP LOCKED inside).
CALL sp_allocate_blood_request( 2, 30, @a, @m);   -- AB+ red cells  -> expect full
CALL sp_allocate_blood_request( 1, 32, @a, @m);   -- O- red cells   -> expect partial (rare group)
CALL sp_allocate_blood_request( 5, 30, @a, @m);   -- trauma, 6 units O+
CALL sp_allocate_blood_request( 4, 33, @a, @m);   -- A+ routine
CALL sp_allocate_blood_request( 6, 34, @a, @m);   -- B- plasma (reverse ABO rule)
CALL sp_allocate_blood_request( 7, 31, @a, @m);   -- O+ urgent
CALL sp_allocate_blood_request( 3, 31, @a, @m);   -- A- platelets -> expect NO stock (5 day shelf life)

-- Carry request 2 all the way through to FULFILLED so the full lifecycle
-- PENDING -> ALLOCATED -> FULFILLED exists in the data.
UPDATE blood_units bu
  JOIN blood_allocations ba ON ba.blood_unit_id = bu.blood_unit_id
   SET bu.status = 'ISSUED'
 WHERE ba.blood_request_id = 2 AND ba.status = 'RESERVED';

UPDATE blood_units bu
  JOIN blood_allocations ba ON ba.blood_unit_id = bu.blood_unit_id
   SET bu.status = 'TRANSFUSED'
 WHERE ba.blood_request_id = 2 AND ba.status = 'RESERVED';

UPDATE blood_allocations SET status = 'TRANSFUSED' WHERE blood_request_id = 2;
UPDATE blood_requests    SET status = 'FULFILLED'  WHERE blood_request_id = 2;

-- Request 9 is past its required-by date; let the housekeeping procedure retire it.
CALL sp_expire_stale_records(@u, @o, @r, @d);

-- Organ matching (weighted score read from matching_config).
CALL sp_find_organ_matches(1, 30, @c);
CALL sp_find_organ_matches(2, 34, @c);
CALL sp_find_organ_matches(3, 31, @c);
CALL sp_find_organ_matches(4, 30, @c);
CALL sp_find_organ_matches(5, 30, @c);
CALL sp_find_organ_matches(6, 32, @c);
CALL sp_find_organ_matches(7, 31, @c);

-- Accept the strongest proposal for the critical liver request and allocate it,
-- so an ACCEPTED/ALLOCATED match exists for the UI to display.
UPDATE organ_matches om
  JOIN (SELECT organ_id FROM organ_matches
         WHERE organ_request_id = 2 AND status = 'PROPOSED'
         ORDER BY compatibility_score DESC LIMIT 1) pick
    ON pick.organ_id = om.organ_id
   SET om.status = 'ALLOCATED', om.decided_by = 41
 WHERE om.organ_request_id = 2;

UPDATE available_organs ao
  JOIN organ_matches om ON om.organ_id = ao.organ_id AND om.status = 'ALLOCATED'
   SET ao.availability_status = 'ALLOCATED'
 WHERE om.organ_request_id = 2;

UPDATE organ_requests SET status = 'ALLOCATED' WHERE organ_request_id = 2;

-- A completed historical transplant (organ ORG-3014).
INSERT INTO organ_matches (organ_request_id, organ_id, compatibility_score,
        blood_score, urgency_score, priority_score, location_score, age_score,
        match_reason, matched_at, decided_by, status)
SELECT 1, ao.organ_id, 82.50, 85, 70, 82, 100, 92,   -- = (40*85+25*70+20*82+10*100+5*92)/100
       'Historic completed transplant: blood group compatible | Same city as requesting hospital',
       DATE_SUB(NOW(), INTERVAL 30 DAY), 40, 'COMPLETED'
  FROM available_organs ao WHERE ao.organ_code = 'ORG-3014';

-- ============================================================================
-- 10. EXTRA NOTIFICATIONS
-- (most notifications are produced by triggers during the steps above; these
--  add the operational reminders a real deployment would also generate)
-- ============================================================================

INSERT INTO notifications (user_id, title, message, type, entity_name, entity_id) VALUES
 (35,'7 units expiring within a week','Review the expiring stock list and prioritise it for allocation.','WARNING','blood_banks',1),
 (37,'Platelet stock is critically low','No unexpired platelet concentrate is currently held at your bank.','CRITICAL','blood_banks',3),
 ( 2,'You are eligible to donate again','90 days have passed since your last whole blood donation.','SUCCESS','donors',1),
 (22,'A kidney match has been proposed','Candidate organs have been scored against request OR-4001.','INFO','organ_requests',1),
 (23,'Organ allocated for OR-4002','A liver has been allocated to your request. Your transplant team will contact you.','SUCCESS','organ_requests',2),
 ( 1,'Hospital registration awaiting approval','Belle Vue Clinic has registered and is pending verification.','WARNING','hospitals',5),
 ( 1,'Donor account awaiting approval','Tara DSouza has registered as a donor and is pending verification.','INFO','users',21);

-- Mark a few as already read so the UI has both states.
UPDATE notifications SET is_read = TRUE
 WHERE notification_id % 3 = 0;

-- ============================================================================
-- 11. SEED SUMMARY
-- ============================================================================
SELECT 'cities' AS entity, COUNT(*) AS rows_seeded FROM cities
UNION ALL SELECT 'blood_groups',        COUNT(*) FROM blood_groups
UNION ALL SELECT 'blood_components',    COUNT(*) FROM blood_components
UNION ALL SELECT 'blood_compatibility', COUNT(*) FROM blood_compatibility
UNION ALL SELECT 'organ_types',         COUNT(*) FROM organ_types
UNION ALL SELECT 'users',               COUNT(*) FROM users
UNION ALL SELECT 'donors',              COUNT(*) FROM donors
UNION ALL SELECT 'recipients',          COUNT(*) FROM recipients
UNION ALL SELECT 'hospitals',           COUNT(*) FROM hospitals
UNION ALL SELECT 'blood_banks',         COUNT(*) FROM blood_banks
UNION ALL SELECT 'transplant_centers',  COUNT(*) FROM transplant_centers
UNION ALL SELECT 'blood_donations',     COUNT(*) FROM blood_donations
UNION ALL SELECT 'blood_units',         COUNT(*) FROM blood_units
UNION ALL SELECT 'blood_requests',      COUNT(*) FROM blood_requests
UNION ALL SELECT 'blood_allocations',   COUNT(*) FROM blood_allocations
UNION ALL SELECT 'organ_donors',        COUNT(*) FROM organ_donors
UNION ALL SELECT 'organ_donor_pledges', COUNT(*) FROM organ_donor_pledges
UNION ALL SELECT 'available_organs',    COUNT(*) FROM available_organs
UNION ALL SELECT 'organ_requests',      COUNT(*) FROM organ_requests
UNION ALL SELECT 'organ_matches',       COUNT(*) FROM organ_matches
UNION ALL SELECT 'notifications',       COUNT(*) FROM notifications
UNION ALL SELECT 'audit_logs',          COUNT(*) FROM audit_logs;
