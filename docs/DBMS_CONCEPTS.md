# DBMS Concepts — Where Each One Is Implemented

Every concept below points at the **actual file, object and line-level construct**
in this repository. Nothing here is aspirational.

Verify counts at any time:

```bash
mysql -u root -p -e "
SELECT
 (SELECT COUNT(*) FROM information_schema.tables            WHERE table_schema='blood_organ_network' AND table_type='BASE TABLE') AS tables,
 (SELECT COUNT(*) FROM information_schema.views             WHERE table_schema='blood_organ_network') AS views,
 (SELECT COUNT(*) FROM information_schema.routines          WHERE routine_schema='blood_organ_network' AND routine_type='PROCEDURE') AS procedures,
 (SELECT COUNT(*) FROM information_schema.routines          WHERE routine_schema='blood_organ_network' AND routine_type='FUNCTION') AS functions,
 (SELECT COUNT(*) FROM information_schema.triggers          WHERE trigger_schema='blood_organ_network') AS triggers,
 (SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema='blood_organ_network') AS foreign_keys,
 (SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_schema='blood_organ_network') AS check_constraints;"
```

Expected: **23 tables, 8 views, 6 procedures, 3 functions, 10 triggers, 50 foreign keys, 11 CHECK constraints.**

---

## 1. Relational model

| Aspect | Where |
|---|---|
| 23 relations in 3NF | `backend/sql/schema.sql` |
| Domains via `ENUM`, `DATE`, `DECIMAL`, `BOOLEAN` | throughout `schema.sql` |
| Tuples uniquely identified | every table has a PK |
| Derived relations | the 8 views in `views.sql` |

---

## 2. Primary keys

Every table declares one. Surrogate `AUTO_INCREMENT` keys are used except:

* `blood_compatibility` — natural composite key
  `(donor_group_id, recipient_group_id, component_id)`
* `matching_config` — `config_key`

`schema.sql`, every `PRIMARY KEY (...)` clause.

---

## 3. Candidate / unique keys

Natural keys are preserved as UNIQUE constraints even where a surrogate PK exists:
`users.email`, `cities(name,state)`, `blood_groups.group_code`,
`hospitals.registration_number`, `blood_units.unit_code`,
`blood_requests.request_code`, `organ_matches(organ_request_id, organ_id)`, and
others — see `DATABASE_DESIGN.md` §8 for the full list.

**One-to-one cardinality is enforced by a UNIQUE on the foreign key**:
`uq_donors_user`, `uq_recipients_user`, `uq_hospitals_user`, `uq_tc_hospital`,
`uq_od_donor`.

---

## 4. Foreign keys and referential integrity

50 foreign keys in `schema.sql`. The delete rule is chosen per relationship:

* `CASCADE` — child is existentially dependent (`users → donors`, `organ_donors → organ_donor_pledges`)
* `RESTRICT` — child is a permanent medical record (`donors → blood_donations`, `blood_units → blood_allocations`)
* `SET NULL` — reference is informational (`blood_donations.recorded_by`, `blood_requests.created_by`)

Surfaced to the user: `directoryService.deleteUser()` catches the RESTRICT and
returns *"has N donation record(s). Medical history cannot be deleted; suspend the
account instead."* — see `backend/src/services/directoryService.js`.

Driver-level FK errors are mapped to HTTP 400/409 in
`backend/src/middleware/errorHandler.js` (`ER_NO_REFERENCED_ROW_2`, `ER_ROW_IS_REFERENCED_2`).

---

## 5. NOT NULL, DEFAULT and CHECK constraints

* `NOT NULL` on every attribute that is mandatory in the domain.
* `DEFAULT` — `status DEFAULT 'PENDING'`, `volume_ml DEFAULT 450`,
  `created_at DEFAULT CURRENT_TIMESTAMP`, `updated_at ... ON UPDATE CURRENT_TIMESTAMP`.
* 11 `CHECK` constraints — listed in `DATABASE_DESIGN.md` §9.

Demonstration:

```sql
INSERT INTO blood_requests (request_code, hospital_id, blood_group_id, component_id,
                            units_required, required_by)
VALUES ('BR-TEST', 1, 1, 2, 999, CURDATE());
-- ERROR 3819: Check constraint 'chk_br_units' is violated.
```

---

## 6. Normalisation

Worked through in `DATABASE_DESIGN.md` using this project's tables:

* **1NF** — `organ_donor_pledges` replaces a comma-separated organ list;
  `blood_units` replaces a `(group, quantity)` counter.
* **2NF** — `blood_components` extracted from `blood_compatibility`
  (partial dependency on `component_id`).
* **3NF** — `cities` extracted (`city → state, region`); `blood_groups` extracted
  (`group_code → abo_type, rh_factor`); `organ_types` extracted.
* **BCNF** — all relations comply.

---

## 7. Joins

| Join type | Where |
|---|---|
| `INNER JOIN` | `useful_queries.sql` Q2, Q3 (6 tables), Q15, Q23 |
| `LEFT JOIN` | Q4 (donors who never donated — `LEFT JOIN … IS NULL`), Q7, Q18, Q21; `v_donor_activity_summary`, `v_hospital_request_summary` |
| `RIGHT JOIN` | Q5 (every blood bank including those holding no stock) |
| `CROSS JOIN` | `sp_rebuild_blood_compatibility()` — generates the 8 × 8 × 5 matrix |
| `LATERAL` (derived) | `sp_find_organ_matches()` — computes the five sub-scores per candidate |
| Self-style multi-alias join | Q23 — `blood_groups` joined twice as donor and recipient |

Q3 joins `blood_allocations → blood_requests → blood_units → blood_banks →
hospitals → blood_groups (×2) → blood_donations → donors → users` to trace which
donor's blood reached which patient. That query is only possible because nothing
was denormalised.

---

## 8. Aggregation, GROUP BY, HAVING

* `COUNT`, `SUM`, `AVG`, `MIN`, `MAX` — Q6, and `analyticsService.js` throughout.
* `GROUP BY` — Q6, Q13, Q14, Q16, Q18, Q25; all eight views.
* `HAVING` — Q7 (blood groups with fewer than 6 usable units), Q8 (donors above
  the network average), `sp_search_available_blood` (`HAVING COUNT(*) >= p_min_units`),
  `analyticsService.mostRequestedBloodGroups`.
* **Conditional aggregation** (pivot) — `SUM(CASE WHEN … THEN 1 ELSE 0 END)` in
  Q13, `v_blood_bank_inventory`, `v_hospital_request_summary`.

All dashboard and analytics figures are computed in SQL. `analyticsService.js`
contains no `.reduce()` over rows fetched for counting.

---

## 9. Subqueries

| Kind | Where |
|---|---|
| Scalar subquery in `SELECT` | Q9, `listDonations` (units produced per donation) |
| Subquery in `FROM` (derived table) | Q8 (`per_donor`), `sp_find_organ_matches` |
| Subquery in `WHERE` | Q8 |
| **Correlated** subquery | Q9 — inner query references `bb.blood_bank_id` from the outer |
| `EXISTS` | Q10 — hospitals that have raised a CRITICAL request |
| `NOT EXISTS` | Q11 — organ donors who have not pledged a kidney; also in `sp_find_organ_matches` to avoid re-proposing an organ |

---

## 10. Views (8)

`backend/sql/views.sql` — each is queried by the API, not merely declared.

| View | Read by |
|---|---|
| `v_available_blood_summary` | `bloodService.getAvailabilitySummary` → landing page, dashboards |
| `v_expiring_blood_units` | `bloodService.getExpiringUnits` → blood-bank dashboard, inventory |
| `v_pending_blood_requests` | open-demand reporting; uses `fn_compatible_unit_count` per row |
| `v_available_organs` | `organService.searchOrgans` / `getOrgan` → **the privacy boundary**: exposes clinical attributes only, no donor name, user id or address |
| `v_donor_activity_summary` | `directoryService.listDonors`, `analyticsService.topDonors` |
| `v_hospital_request_summary` | `analyticsService.hospitalRequestSummary` → hospital dashboard |
| `v_blood_bank_inventory` | full inventory breakdown including non-available states |
| `v_organ_request_matches` | `organService.listMatches` → the match screen |

---

## 11. Stored procedures (6)

`backend/sql/procedures.sql`

| Procedure | Purpose | Called from |
|---|---|---|
| `sp_rebuild_blood_compatibility()` | Derives the 320-row matrix from antigen flags by CROSS JOIN | `seed.sql` |
| `sp_search_available_blood(...)` | Availability search with GROUP BY / HAVING | `bloodService.searchAvailability` |
| `sp_get_compatible_blood_units(id)` | Ranked candidate units for a request | `bloodService.previewMatches` |
| `sp_allocate_blood_request(...)` | **Transactional allocation** with `FOR UPDATE … SKIP LOCKED` | `bloodService.allocate` |
| `sp_find_organ_matches(...)` | Weighted organ scoring from `matching_config` | `organService.runMatching` |
| `sp_expire_stale_records(...)` | Retires expired units/organs/requests; reinstates donor eligibility | `bloodService.runExpiry` |

## 12. Stored functions (3)

| Function | Purpose | Used by |
|---|---|---|
| `fn_calculate_age(dob)` | Age in whole years | `v_donor_activity_summary`, `authService.getProfile`, `seed.sql` |
| `fn_blood_compatible(donor, recipient, component)` | Single source of truth for compatibility | `sp_search_available_blood`, test queries |
| `fn_compatible_unit_count(group, component)` | Usable compatible units network-wide | `v_pending_blood_requests`, `bloodService.getRequest`, Q17 |

---

## 13. Triggers (10)

`backend/sql/triggers.sql` — each enforces an invariant or records history that
must hold even for SQL typed directly at the prompt.

| # | Trigger | Timing | Purpose |
|---|---|---|---|
| 1 | `trg_blood_units_before_insert` | BEFORE INSERT | Derives `expiry_date` from `blood_components.shelf_life_days`; forces a past-dated unit to EXPIRED |
| 2 | `trg_blood_units_before_update` | BEFORE UPDATE | **Enforces the 7-state unit lifecycle**; raises `SQLSTATE 45000` on an illegal transition (e.g. TRANSFUSED → AVAILABLE) |
| 3 | `trg_blood_units_after_update` | AFTER UPDATE | Audits every status change with `source='TRIGGER'` |
| 4 | `trg_blood_allocations_before_insert` | BEFORE INSERT | **The double-allocation guard** — rejects allocation of a unit that is not AVAILABLE, or is expired |
| 5 | `trg_blood_donations_after_insert` | AFTER INSERT | Maintains `donors.total_donations`, `last_donation_date`, sets TEMPORARILY_INELIGIBLE |
| 6 | `trg_blood_donations_after_update` | AFTER UPDATE | Screening PASSED releases quarantined units to AVAILABLE; FAILED discards every unit from that donation |
| 7 | `trg_blood_requests_after_update` | AFTER UPDATE | Audits the workflow and writes the requester's notification in the same transaction |
| 8 | `trg_available_organs_before_insert` | BEFORE INSERT | Derives `viable_until` from `organ_types.max_cold_ischemia_hours` |
| 9 | `trg_organ_matches_after_update` | AFTER UPDATE | Audits clinical match decisions |
| 10 | `trg_users_after_insert` | AFTER INSERT | Audits account creation and issues a welcome notification |

Triggers **not** created, and why: recalculating inventory totals (derived data —
views do it), and sending email (side effect outside the transaction boundary).

---

## 14. Transactions and ACID

**Atomicity** — `sp_allocate_blood_request` wraps the whole allocation in
`START TRANSACTION … COMMIT` with `DECLARE EXIT HANDLER FOR SQLEXCEPTION
BEGIN ROLLBACK; RESIGNAL; END`. A failure part-way leaves no half-allocated
request. In Node, `withTransaction()` in `backend/src/config/db.js` gives the same
guarantee to multi-statement service operations (fulfilling a request, accepting
an organ match, registering a user with their profile).

**Consistency** — foreign keys, CHECK constraints and the lifecycle triggers
cannot be bypassed by application code.

**Isolation** — InnoDB REPEATABLE READ, plus explicit `SELECT … FOR UPDATE` on the
request row and on each candidate unit; `SKIP LOCKED` prevents convoying.

**Durability** — InnoDB redo log; committed allocations survive restart.

Rollback is demonstrable:

```sql
START TRANSACTION;
  UPDATE blood_units SET status='RESERVED' WHERE blood_unit_id=1;
  SELECT status FROM blood_units WHERE blood_unit_id=1;   -- RESERVED
ROLLBACK;
  SELECT status FROM blood_units WHERE blood_unit_id=1;   -- AVAILABLE again
```

---

## 15. Concurrency control

* Row-level locking via `SELECT … FOR UPDATE` (`sp_allocate_blood_request`,
  `sp_find_organ_matches`, `organService.updateMatchStatus`).
* `SKIP LOCKED` so concurrent allocators take different units rather than blocking.
* Lock-wait timeout mapped to HTTP 409 (`ER_LOCK_WAIT_TIMEOUT` in `errorHandler.js`).
* Optimistic guards: the organ allocation path re-reads `availability_status`
  under `FOR UPDATE` and refuses if another centre took the organ first.

---

## 16. Indexing

Documented with the query each index serves in `DATABASE_DESIGN.md` §10.
The hot path is `idx_bu_search (blood_group_id, component_id, status, expiry_date)`
— column order follows equality-before-range so the allocator's predicate is
satisfied from the index.

Inspect a plan:

```sql
EXPLAIN SELECT bu.blood_unit_id FROM blood_units bu
 WHERE bu.blood_group_id=1 AND bu.component_id=2
   AND bu.status='AVAILABLE' AND bu.expiry_date > CURDATE();
```

---

## 17. Authentication and authorisation

* Passwords hashed with **bcrypt** (cost 10) — `authService.register/login`.
  `password_hash` is never selected into an API response.
* **JWT** bearer tokens signed with `JWT_SECRET`; `authenticate` re-loads the user
  from the database on every request, so suspending an account takes effect
  immediately rather than at token expiry.
* **Role-based access control** — `authorize(...roles)` in
  `backend/src/middleware/auth.js`, applied per route in `backend/src/routes/*.js`.
  ADMIN is not implicitly allowed anywhere; each route states its own roles.
* **Row-level scoping** — a DONOR sees only their own donations, a HOSPITAL only
  its own requests. The profile id is taken from the token-derived session
  (`req.user.donorId`, `req.user.hospitalId`), never from client input.
* Uniform login failure message + bcrypt comparison against a dummy hash for
  unknown emails, so the endpoint cannot be used to enumerate accounts.

---

## 18. SQL injection prevention

* Every query uses **parameterised placeholders** via `mysql2`'s
  `connection.execute(sql, params)` — see `backend/src/config/db.js`.
* String concatenation of user input into SQL appears nowhere in the codebase.
* `multipleStatements: false` on the pool blocks stacked-query injection.
* `LIMIT`/`OFFSET` cannot be bound as parameters in MySQL, so they are coerced to
  bounded integers in `utils/pagination.js` before interpolation.
* `ORDER BY` columns come from an **allow-list map**, never from the raw query
  string (`getSort`).
* All request bodies and query strings are validated and whitelisted by **zod**
  schemas (`backend/src/validators/`) before reaching a service.

Try it:

```bash
curl "localhost:4000/api/blood/units?status=AVAILABLE';DROP TABLE users;--" \
  -H "Authorization: Bearer $TOKEN"
# → 400 Validation failed (status is not a member of the allowed enum)
```

---

## 19. Data privacy

* `v_available_organs` is the organ privacy boundary — no donor identity leaves it.
* The blood availability search returns bank-level aggregates only; no donor is
  linked to a unit in any public response.
* `password_hash` is excluded from every `SELECT` that feeds a response.
* Audit rows record *who* and *what*, not clinical detail.

---

## 20. Error handling and HTTP status mapping

`backend/src/middleware/errorHandler.js` translates database errors:

| MySQL error | HTTP | Message shown |
|---|---|---|
| `ER_DUP_ENTRY` | 409 | "That value is already registered and must be unique." |
| `ER_NO_REFERENCED_ROW_2` | 400 | "A referenced record does not exist (foreign key constraint)." |
| `ER_ROW_IS_REFERENCED_2` | 409 | "This record is still referenced by other records…" |
| `ER_CHECK_CONSTRAINT_VIOLATED` | 400 | "A value violates a database CHECK constraint." |
| `ER_SIGNAL_EXCEPTION` (our triggers) | 409 | The trigger's own `MESSAGE_TEXT` |
| `ER_LOCK_WAIT_TIMEOUT` | 409 | "The record is locked by another operation. Please retry." |

Stack traces are never sent to clients.
