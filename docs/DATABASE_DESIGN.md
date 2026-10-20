# Database Design and Normalisation

Database: `blood_organ_network` · MySQL 8.0+ / InnoDB · utf8mb4

This document works through the normalisation of **this project's actual tables**.
Every "before" relation shown below is a design that was genuinely considered and
rejected, with the specific anomaly that caused the rejection.

---

## 1. Design method

The schema was derived in this order, before any application code was written:

1. Identify the real-world entities and the facts recorded about each.
2. Write the functional dependencies.
3. Decompose until every non-key attribute depends on the key, the whole key,
   and nothing but the key.
4. Choose primary and candidate keys.
5. Decide the referential action for every foreign key.
6. Add CHECK constraints for domain rules the type system cannot express.
7. Add indexes only for query patterns the application actually issues.

---

## 2. Universal relation and the anomalies it causes

A naïve single-table design for the blood subsystem:

```
BLOOD_RECORD(
  donation_id, donor_name, donor_email, donor_dob, donor_blood_group,
  donor_city, donor_state, donor_region,
  bank_name, bank_reg_no, bank_city, bank_state,
  donation_date, volume_ml, screening_status,
  component_name, component_shelf_life_days, unit_code, expiry_date, unit_status,
  request_code, patient_name, hospital_name, hospital_city, units_required, urgency
)
```

This is **unnormalised** and suffers all three classical anomalies:

| Anomaly | Concrete failure in this domain |
|---|---|
| **Insertion** | A newly registered blood bank cannot be recorded until somebody donates there, because `donation_id` is part of the key. A donor who has never donated cannot exist at all — yet the seed data contains 10 such donors, and the outreach query `Q4` exists specifically to find them. |
| **Update** | Correcting a donor's blood group means rewriting every row of their donation history. Miss one and the database simultaneously claims the donor is A+ and O+. In a transfusion system that is a patient-safety defect, not a tidiness issue. |
| **Deletion** | Deleting the last donation at a blood bank erases the blood bank's registration number, address and contact details. |

Additionally `component_shelf_life_days` repeats identically on every unit of that
component, and `donor_state`/`donor_region` repeat on every row for that city.

---

## 3. First Normal Form (1NF)

> Every attribute holds a single atomic value; no repeating groups; each row is unique.

Two violations were present in the first draft.

**3.1 A donor's pledged organs as a list**

```
organ_donors(organ_donor_id, donor_id, consent_status, pledged_organs)
                                                        ^ 'KIDNEY,LIVER,CORNEA'
```

A comma-separated list cannot be joined, indexed, or constrained by a foreign
key. "Which donors pledged a kidney?" becomes a `LIKE '%KIDNEY%'` scan that also
matches nothing reliably. **Resolved** by the associative table:

```sql
organ_donor_pledges(pledge_id, organ_donor_id, organ_type_id, pledged_at, status)
UNIQUE (organ_donor_id, organ_type_id)
```

**3.2 Inventory as a counter**

```
blood_stock(blood_bank_id, blood_group, quantity)   -- 'A+', 100
```

This looks atomic but hides a repeating group: 100 physically distinct bags, each
with its own collection date, expiry date and status, collapsed into one integer.
It cannot answer "which units expire this week", cannot record that unit #47 was
transfused, and cannot be kept consistent under concurrency — two allocators both
read 100, both write 99, and one unit is issued twice.

**Resolved** by `blood_units`, one row per physical bag. This is the single most
consequential modelling decision in the project; every expiry, allocation and
wastage feature depends on it.

---

## 4. Second Normal Form (2NF)

> In 1NF, and every non-key attribute is fully functionally dependent on the
> *whole* primary key. Only relations with composite keys can violate 2NF.

**Candidate relation** — compatibility with descriptive attributes attached:

```
blood_compatibility(donor_group_id, recipient_group_id, component_id,
                    is_compatible, component_name, shelf_life_days, storage_temp)
PK = (donor_group_id, recipient_group_id, component_id)
```

Functional dependencies:

```
(donor_group_id, recipient_group_id, component_id) → is_compatible     ✔ full
 component_id                                      → component_name,
                                                     shelf_life_days,
                                                     storage_temp      ✘ partial
```

`component_name` depends on only *part* of the key. With 8 × 8 = 64 rows per
component, the name and shelf life of "Packed Red Blood Cells" would be stored 64
times; changing the shelf life would require 64 consistent updates.

**Decomposition:**

```sql
blood_components(component_id PK, code, name, shelf_life_days, storage_temp, match_direction)
blood_compatibility(donor_group_id, recipient_group_id, component_id, is_compatible, rule_note)
```

Now `shelf_life_days` is stored exactly once per component — which is precisely
why `trg_blood_units_before_insert` can derive every unit's expiry date from a
single authoritative value.

The same reasoning applies to `organ_donor_pledges`: its key is
`(organ_donor_id, organ_type_id)`, and any organ description would depend only on
`organ_type_id`. Descriptions therefore live in `organ_types`.

---

## 5. Third Normal Form (3NF)

> In 2NF, and no non-key attribute is transitively dependent on the primary key.

**5.1 Location — the main 3NF decomposition**

```
hospitals(hospital_id, name, registration_number, address, city, state, region, phone)
```

Functional dependencies:

```
hospital_id → city
city        → state, region          ← transitive dependency
∴ hospital_id → state, region  (transitively)
```

`state` is not a fact about the hospital; it is a fact about the city. Consequences
of leaving it:

* Bengaluru could be recorded in "Karnataka" on one hospital row and "Karnatka" on
  another — the analytics query `Q18` (inventory by city and region) would then
  report two different cities.
* Re-assigning a city to a different region requires updating every hospital,
  blood bank, donor, recipient and organ row that mentions it.

**Decomposition:**

```sql
cities(city_id PK, name, state, region, UNIQUE(name, state))
hospitals(hospital_id PK, ..., city_id FK → cities)
```

Five tables now reference `cities`: `hospitals`, `blood_banks`, `donors`,
`recipients`, `available_organs`. One authoritative row per city serves all of them.

**5.2 Blood group**

```
donors(donor_id, ..., blood_group, abo_type, rh_factor)
  donor_id    → blood_group
  blood_group → abo_type, rh_factor     ← transitive
```

Resolved into `blood_groups`, which also carries the antigen flags (`has_a`,
`has_b`, `has_rh_d`). Those flags are not redundant with `group_code` — they are
the machine-readable form that lets `sp_rebuild_blood_compatibility()` *derive*
the 320-row matrix by relational set logic instead of it being hand-typed.

**5.3 Organ type**

`max_cold_ischemia_hours`, `min_donor_age` and `max_donor_age` are properties of
the organ *type*, not of a recovered organ. They live in `organ_types`, and
`trg_available_organs_before_insert` reads the ischemia window from there to
derive each organ's `viable_until`.

---

## 6. Attributes that look denormalised but are not

Three columns store values that could in principle be recomputed. Each is a
deliberate, controlled decision.

| Column | Could be derived from | Why it is stored | How drift is prevented |
|---|---|---|---|
| `donors.total_donations` | `COUNT(*)` over `blood_donations` | Shown on every donor list and dashboard; recomputing per row is a correlated subquery per donor | Maintained *only* by `trg_blood_donations_after_insert` — no application code writes it |
| `donors.last_donation_date` | `MAX(donation_date)` | Drives the 90-day eligibility rule on every donation attempt | Same trigger |
| `blood_requests.units_allocated` | `COUNT(*)` over `blood_allocations` | Needed inside the allocation loop, which already holds a row lock on the request | Written only by `sp_allocate_blood_request` and the status-change path, both transactional |

`blood_units.blood_group_id` duplicates `blood_donations.blood_group_id` for units
that came from a donation. It is kept because `donation_id` is **nullable** — a
unit transferred in from another network has no donation row, but must still have
a blood group. The column is therefore not redundant for the general case.

`organ_matches` stores the five component sub-scores alongside the total. These
are an audit record of *how the algorithm scored at that moment*: re-running the
matcher after someone re-tunes `matching_config` must not silently rewrite
history. The score is a recorded fact, not a derived value.

---

## 7. Boyce–Codd Normal Form

Every relation is in BCNF. The only composite-key relations are
`blood_compatibility`, `organ_donor_pledges`, `blood_allocations` and
`organ_matches`; in each, the only determinant is the whole key (or a declared
candidate key), so no BCNF violation arises.

---

## 8. Keys

### Primary keys

All tables use a surrogate integer primary key (`AUTO_INCREMENT`), except
`blood_compatibility` (natural composite key) and `matching_config`
(`config_key`). Surrogates keep foreign keys narrow and make the natural key
mutable — a blood bank can be re-registered without rewriting its units.

### Candidate keys preserved as UNIQUE

Using a surrogate PK does not licence dropping the natural key. Each natural key
is retained as a UNIQUE constraint so the relational model stays honest:

| Table | Candidate key |
|---|---|
| `users` | `email` |
| `cities` | `(name, state)` |
| `blood_groups` | `group_code`, and `(abo_type, rh_factor)` |
| `blood_components` | `code` |
| `organ_types` | `code` |
| `hospitals` | `registration_number`, `email` |
| `blood_banks` | `registration_number`, `email` |
| `transplant_centers` | `license_number`, `hospital_id` |
| `blood_units` | `unit_code` |
| `blood_requests` | `request_code` |
| `available_organs` | `organ_code` |
| `organ_requests` | `request_code` |
| `blood_allocations` | `(blood_request_id, blood_unit_id)` |
| `organ_matches` | `(organ_request_id, organ_id)` |
| `organ_donor_pledges` | `(organ_donor_id, organ_type_id)` |

---

## 9. Domain constraints

Rules the type system cannot express are declared as CHECK constraints so they
hold regardless of which client writes the row:

| Constraint | Rule |
|---|---|
| `chk_bu_expiry` | `expiry_date > collection_date` |
| `chk_ao_viability` | `viable_until > recovered_at` |
| `chk_br_units` | `units_required BETWEEN 1 AND 50` |
| `chk_br_allocated` | `units_allocated <= units_required` |
| `chk_or_priority` | `medical_priority BETWEEN 0 AND 100` |
| `chk_om_score` | `compatibility_score BETWEEN 0 AND 100` |
| `chk_donors_weight` | `weight_kg BETWEEN 20 AND 300` when present |
| `chk_bd_volume` | `volume_ml BETWEEN 100 AND 600` |
| `chk_organ_age_range` | `min_donor_age < max_donor_age` |
| `chk_component_shelf_life` | `shelf_life_days BETWEEN 1 AND 3650` |

State machines (`blood_units.status`, request statuses) are `ENUM` columns whose
*transitions* are policed by `trg_blood_units_before_update` and by
`BLOOD_REQUEST_TRANSITIONS` / `ORGAN_REQUEST_TRANSITIONS` in
`backend/src/config/constants.js`.

---

## 10. Indexing

Indexes were chosen from the queries the application actually issues, not added
column by column. Every index below has a named caller.

| Index | Table | Serves |
|---|---|---|
| `uq_users_email` | `users` | Login lookup on every sign-in (`authService.login`) |
| `idx_users_role_status` | `users` | Admin user list filtered by role/status |
| `idx_bu_search` (`blood_group_id, component_id, status, expiry_date`) | `blood_units` | **The hot path.** Composite and column-ordered to match `sp_search_available_blood` and the allocator's candidate query: equality on group and component, equality on status, range on expiry |
| `idx_bu_expiry` | `blood_units` | `v_expiring_blood_units`, and the housekeeping sweep |
| `idx_bu_bank_status` | `blood_units` | A blood bank viewing its own inventory |
| `idx_br_status_urgency` | `blood_requests` | Triage list ordered by urgency |
| `idx_br_hospital_status` | `blood_requests` | Hospital dashboard |
| `idx_ao_search` (`organ_type_id, blood_group_id, availability_status`) | `available_organs` | `sp_find_organ_matches` candidate scan |
| `idx_ao_viable` | `available_organs` | Viability expiry sweep |
| `idx_or_status_priority` | `organ_requests` | Waiting list ordered by clinical priority |
| `idx_notif_user_read` (`user_id, is_read, created_at`) | `notifications` | The unread badge, which runs on every page load — covered by this index |
| `idx_bc_lookup` | `blood_compatibility` | Compatibility joins from the recipient side |
| `idx_donors_blood_group`, `idx_donors_city_eligibility` | `donors` | Donor search by group and by city/eligibility |
| `idx_audit_entity`, `idx_audit_created` | `audit_logs` | Audit filtering and reverse-chronological listing |

Deliberately **not** indexed: `blood_units.volume_ml`, `users.full_name`,
`*.notes`, and other low-selectivity or never-filtered columns. Every index costs
write throughput on a table that receives a row per bag per status change.

Column order inside composite indexes follows the equality-then-range rule: in
`idx_bu_search`, `status` (equality) precedes `expiry_date` (range), so the whole
predicate can be satisfied from the index.

---

## 11. Transaction and concurrency design

The critical section is blood allocation, in `sp_allocate_blood_request`:

```sql
START TRANSACTION;
  SELECT ... FROM blood_requests WHERE blood_request_id = ? FOR UPDATE;  -- lock the request
  WHILE still_needed DO
    SELECT blood_unit_id INTO v_unit
      FROM blood_units ... WHERE status='AVAILABLE' AND expiry_date > CURDATE()
      ORDER BY exact_group_match DESC, same_city DESC, expiry_date ASC
      LIMIT 1 FOR UPDATE SKIP LOCKED;                                    -- lock one unit
    INSERT INTO blood_allocations ...;                                   -- trigger re-checks
    UPDATE blood_units SET status='RESERVED' ...;                        -- trigger validates
  END WHILE;
  UPDATE blood_requests SET units_allocated=..., status=...;
  INSERT INTO audit_logs ...;
COMMIT;                                     -- any failure → ROLLBACK, nothing half-done
```

* **`FOR UPDATE`** takes an exclusive row lock, so a concurrent transaction cannot
  read a unit as AVAILABLE and allocate it too.
* **`SKIP LOCKED`** makes a second allocator step over rows the first is holding
  instead of blocking, so two simultaneous emergencies proceed in parallel rather
  than serialising.
* **`trg_blood_allocations_before_insert`** re-checks the unit is AVAILABLE and
  unexpired at insert time, raising `SQLSTATE 45000` otherwise. This is the
  invariant that holds even for SQL typed at the `mysql` prompt.

Isolation level is InnoDB's default **REPEATABLE READ**.

Ordering policy inside the allocator is a real clinical trade-off encoded in
`ORDER BY`:

1. exact blood-group match first — preserve scarce universal-donor stock;
2. same city as the requesting hospital — shorter cold chain;
3. first-expiring-first-out — minimise wastage.

---

## 12. Why each table exists

| Table | Justification |
|---|---|
| `cities` | Removes the `city → state, region` transitive dependency from five tables |
| `blood_groups` | Removes `group_code → abo_type, rh_factor`; antigen flags let the compatibility matrix be derived |
| `blood_components` | Removes the partial dependency on `component_id`; single source of shelf life |
| `blood_compatibility` | Makes compatibility a *joinable relation* rather than branching logic scattered through code |
| `organ_types` | Reference data plus the ischemia window and donor age limits used by the matcher |
| `matching_config` | Keeps the organ-matching weights as data, so tuning needs no redeployment and the algorithm has no magic numbers |
| `users` | One authentication identity; role-specific attributes pushed to specialisations |
| `donors`, `recipients`, `hospitals`, `blood_banks`, `transplant_centers` | Role specialisations holding attributes that apply to only one role |
| `blood_donations` | The clinical act — permanent record, separate from the products it yields |
| `blood_units` | The inventory grain: one physically identified, individually expiring bag |
| `blood_requests` | Demand, with its own workflow state |
| `blood_allocations` | Resolves requests ↔ units; the allocation history survives status changes |
| `organ_donors` | Consent and medical clearance are facts about the *pledge*, not the blood donor |
| `organ_donor_pledges` | Resolves donors ↔ organ types (1NF fix) |
| `available_organs` | A physically recovered organ with its own viability clock |
| `organ_requests` | Organ demand with clinical priority |
| `organ_matches` | Resolves requests ↔ organs and records the score breakdown as an audit fact |
| `notifications` | Per-user message queue, written in the same transaction as the change |
| `audit_logs` | Append-only history; `source` distinguishes API, TRIGGER and PROCEDURE writers |

No table in the schema is a duplicate of another, and none exists solely to
demonstrate a feature.
