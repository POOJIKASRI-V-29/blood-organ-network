# Testing

**64 automated tests across 5 suites — all passing.**

The suite is real and executable: it runs the Express application in-process with
`supertest` and queries the MySQL database directly to verify what the triggers
and constraints actually did.

```bash
cd backend
npm test
```

`pretest` rebuilds and reseeds the database first, so the suite always starts from
a known state and can be run repeatedly.

```
# tests 64
# suites 5
# pass 64
# fail 0
# duration_ms 1227
```

> **Note:** the suite writes to the database it is pointed at. Never run it
> against data you care about — `pretest` drops and recreates the schema.

---

## Test inventory

### Suite 1 — Authentication (`tests/auth.test.js`) · 10 tests

| ID | Test | Expected |
|---|---|---|
| TC-A01 | Valid login | 200, token issued, no `password_hash` anywhere in the response |
| TC-A02 | Wrong password | 401 |
| TC-A03 | Unknown email vs wrong password | **Identical** 401 message — prevents account enumeration |
| TC-A04 | Duplicate email on register | 409 |
| TC-A05 | Weak password (`abc`) | 400 with `details[].field === 'password'` |
| TC-A06 | Self-register as ADMIN | 403 |
| TC-A07 | Protected route, no token | 401 |
| TC-A08 | Malformed JWT | 401 |
| TC-A09 | `/auth/me` | 200 with the joined role profile (`donorId`, `bloodGroup`) |
| TC-A10 | Register a blood bank | 201 with `status: 'PENDING'`, not ACTIVE |

### Suite 2 — Role-based authorization (`tests/authorization.test.js`) · 10 tests

| ID | Test | Expected |
|---|---|---|
| TC-Z01 | ADMIN lists users | 200 |
| TC-Z02 | DONOR lists users | 403, message names the required role |
| TC-Z03 | DONOR records a donation | 403 |
| TC-Z04 | DONOR reads the audit log | 403 |
| TC-Z05 | RECIPIENT lists an organ | 403 |
| TC-Z06 | BLOOD_BANK raises a blood request | 403 |
| TC-Z07 | HOSPITAL reads blood-bank expiry list | 403 |
| TC-Z08 | **Row-level scoping** — a DONOR's donation list | Every row belongs to that donor |
| TC-Z09 | **Row-level scoping** — a HOSPITAL's request list | Every row belongs to that hospital |
| TC-Z10 | Housekeeping | 403 for HOSPITAL, 200 for ADMIN |

TC-Z08 and TC-Z09 matter most: they prove scoping is derived from the
**token**, not from a client-supplied id.

### Suite 3 — Blood subsystem (`tests/blood.test.js`) · 17 tests

| ID | Test | Expected |
|---|---|---|
| TC-B01 | Availability search | Only unexpired, available stock returned |
| TC-B02 | Availability privacy | No `donor_name`, `donor_id`, `email` or `address` in the payload |
| TC-B03 | Compatibility filter, O− patient | **Only O− units** offered |
| TC-B04 | Compatibility filter, AB+ patient | Several donor groups offered (universal recipient) |
| TC-B05 | Invalid request body | 400 listing `unitsRequired` and `urgency` |
| TC-B06 | Hospital raises a request | 201, `PENDING`, code matches `BR-YYYYMMDD-NNNN` |
| TC-B07 | Match preview ordering | Exact blood-group matches ranked before non-exact |
| TC-B08 | Allocation | 2 units reserved, request → `ALLOCATED`, allocations `RESERVED` |
| TC-B09 | **Allocation correctness** | `fn_blood_compatible()` returns true for every allocation in the database |
| TC-B10 | **No double allocation** | No `blood_unit_id` appears in more than one non-cancelled allocation |
| TC-B11 | Re-allocating a full request | 0 additional units |
| TC-B12 | Request for 40 AB− platelets | Allocates only what exists; never invents stock |
| TC-B13 | Fulfil | Units walk RESERVED → ISSUED → TRANSFUSED; verified in the database |
| TC-B14 | `FULFILLED → PENDING` | 409, message names the allowed next states |
| TC-B15 | Cancel an allocated request | Reserved unit returns to `AVAILABLE` — no stranded stock |
| TC-B16 | Donation inside the 90-day interval | 409 |
| TC-B17 | Expired stock | No unit is both `AVAILABLE` and past its expiry date |

### Suite 4 — Database constraints, triggers, transactions (`tests/database.test.js`) · 15 tests

| ID | Test | Expected |
|---|---|---|
| TC-D01 | Insert a unit at a non-existent blood bank | `ER_NO_REFERENCED_ROW_2` |
| TC-D02 | Duplicate `users.email` | `ER_DUP_ENTRY` |
| TC-D03 | `units_required = 999` | `chk_br_units` violated |
| TC-D04 | `cities.name = NULL` | `ER_BAD_NULL_ERROR` |
| TC-D05 | **Trigger 1** — insert a platelet unit with `expiry_date = NULL` | Expiry derived as collection + **5 days** |
| TC-D06 | **Trigger 2** — `AVAILABLE → TRANSFUSED` | Rejected: *"Illegal blood unit status transition"* |
| TC-D07 | **Trigger 4** — allocate a non-AVAILABLE unit | Rejected: *"not AVAILABLE"* / *"has expired"* |
| TC-D08 | **Trigger 5** — cached counters | `donors.total_donations` equals `COUNT(*)` for **every** donor |
| TC-D09 | **Trigger 6** — failed screening | Every unit from a FAILED donation is `DISCARDED` |
| TC-D10 | Trigger auditing | Audit rows exist with `source = 'TRIGGER'` |
| TC-D11 | **Transaction rollback** | An insert followed by a thrown error leaves the row count unchanged |
| TC-D12 | **Transaction commit** | A committed insert is visible afterwards |
| TC-D13 | **Compatibility matrix** | Exactly 320 rows; O− red cells serve 8 groups; AB+ red cells serve 1; AB+ plasma serves 8 |
| TC-D14 | Referential integrity | Zero orphaned rows across four join paths |
| TC-D15 | Schema inventory | 23 tables, 8 views, 6 procedures, 3 functions, 10 triggers, 50 FKs |

### Suite 5 — Organ subsystem (`tests/organ.test.js`) · 12 tests

| ID | Test | Expected |
|---|---|---|
| TC-O01 | **Organ privacy** | No `donorName`, `email`, `address`, `userId` or `organDonorId` in the response |
| TC-O02 | Listing filter | Every listed organ is `AVAILABLE` and still inside its viability window |
| TC-O03 | Donor records a pledge | 200, `CONSENTED`, 2 pledges stored |
| TC-O04 | `medicalPriority = 500` | 400 naming the field |
| TC-O05 | Hospital raises an organ request | 201, `PENDING` |
| TC-O06 | Run matching | Candidates scored, each 0–100, each with a reason; response carries the academic disclaimer |
| TC-O07 | **Score arithmetic** | Stored total equals `(40·blood + 25·urgency + 20·priority + 10·location + 5·age) / 100` for every match |
| TC-O08 | **Clinical correctness** | Every proposed organ is ABO-compatible with the recipient |
| TC-O09 | Ranking | Matches returned in descending score order |
| TC-O10 | `PROPOSED → ALLOCATED` | 409 — must pass through ACCEPTED |
| TC-O11 | `ACCEPTED → ALLOCATED` | Organ becomes `ALLOCATED`; rival PROPOSED matches for the same organ are cancelled |
| TC-O12 | **No double allocation** | No organ has more than one ALLOCATED/COMPLETED match |

---

## Manual verification performed

Beyond the automated suite, the following were verified by hand during development.

### Database build

```bash
cd backend && npm run db:setup
```
Output: `tables 23 · views 8 · procedures 6 · functions 3 · triggers 10 · foreign keys 50 · CHECK constraints 11`.
Rebuilt from scratch several times; the build is idempotent and reproducible.

### All 25 demonstration queries

```bash
mysql -u root -p blood_organ_network < backend/sql/useful_queries.sql
```
All 25 execute without error and return rows. Spot-checked results:

* **Q16** proves the universal-donor property directly from the data:
  `O− → 8 groups`, `O+ → 4`, `A− → 4`, `B− → 4`, `A+ → 2`, `B+ → 2`, `AB− → 2`, `AB+ → 1`.
* **Q24** shows the triggers firing: 120 `BLOOD_UNIT_STATUS_CHANGE`, 45
  `DONATION_RECORDED`, 42 `USER_REGISTERED`, 42 `SCREENING_PASSED`,
  2 `SCREENING_FAILED` — all with `source='TRIGGER'`.
* **Q25** reports platelet wastage at ~69%, which is exactly what a 5-day shelf
  life produces and is the clearest argument in the project for tracking units
  individually rather than as counters.

### Compatibility matrices rendered from the database

Red cells (rows = donor, columns = recipient):

```
donor  O-  O+  A-  A+  B-  B+  AB- AB+
O-     Y   Y   Y   Y   Y   Y   Y   Y     ← universal donor
O+     .   Y   .   Y   .   Y   .   Y
A-     .   .   Y   Y   .   .   Y   Y
A+     .   .   .   Y   .   .   .   Y
B-     .   .   .   .   Y   Y   Y   Y
B+     .   .   .   .   .   Y   .   Y
AB-    .   .   .   .   .   .   Y   Y
AB+    .   .   .   .   .   .   .   Y
                                   ↑ universal recipient
```

Plasma is the mirror image (AB plasma serves everyone, O plasma only O) — the
reversal is driven by `blood_components.match_direction`, not by special-case code.

### Frontend

```bash
cd frontend && npm run build
```
Builds clean with no warnings:
`index.html 0.86 kB · css 34.38 kB · react 164 kB · index 220 kB · charts 411 kB`.

Every page was opened in a browser against the live API and confirmed to render
real data:

| Page | Verified |
|---|---|
| Landing | Live statistics and per-group availability from `/analytics/public` |
| Login / Register | Demo account fill, validation errors, role-specific fields |
| Admin dashboard | 52 users, 11 eligible donors, 59 units, 12 organs, charts |
| Donor / Recipient / Hospital / Blood bank / Transplant dashboards | Role-specific tiles and lists |
| Blood availability | 32 stock lines, filters, compatibility filtering |
| Blood request detail | Workflow timeline, supply position, shortfall warning, allocation table |
| Match preview modal | Candidate units with "exact" and "local" annotations |
| Donations | Record-donation modal, screening pass/fail confirmations |
| Inventory | Paginated units with days-to-expiry colouring |
| Organ availability / registry | Listing, filters, status editing |
| Organ request detail | Score breakdown bars, weighted contributions, reasons, decision buttons |
| Analytics | 8 charts populated from SQL aggregates |
| Directory | Five tabs, admin status controls |
| Audit log | TRIGGER / PROCEDURE / API source badges |
| Notifications, Profile | Read state, password change |

Responsive behaviour was checked at desktop, tablet and ~400 px widths.

---

## Bugs found and fixed during testing

Testing found four real defects. Each is listed with its fix.

| # | Defect | Symptom | Fix |
|---|---|---|---|
| 1 | `getSort()` already appends the sort direction, but `organService` appended a second one | `ORDER BY viable_until DESC ASC` → SQL syntax error, 500 on `/organs/availability` | Removed the duplicate; `getSort` now takes an explicit `defaultDir`, documented as returning the direction itself |
| 2 | JSX children are evaluated eagerly, so `data.rows.map(...)` ran before `<DataState>` could render the loading or error branch | White screen with *"Cannot read properties of null"* whenever a request failed or was still in flight | Guarded all 25 call sites: `(data?.rows ?? []).map(...)` |
| 3 | A donor was set `TEMPORARILY_INELIGIBLE` by a trigger after donating, but nothing ever restored eligibility | Dashboard read *"Active donors 0 of 20"*; donors were ineligible forever | `sp_expire_stale_records` now reinstates donors past the interval and reports the count |
| 4 | `createDonationSchema` required `bloodBankId`, but the controller overrides it for BLOOD_BANK accounts | A blood bank recording a donation got 400 instead of proceeding (caught by TC-B16) | `bloodBankId` is now optional in the schema; the service raises a clear 400 if it cannot be resolved |

A fifth issue surfaced in the seed rather than the code: every seeded donor had
donated recently, so the "donors who never donated" outreach query (Q4) returned
nothing. Ten registered-but-not-yet-donated donors were added, which made both
the query and the eligibility statistics realistic.

---

## Coverage summary

| Area | Covered | Not covered |
|---|---|---|
| Authentication | Login, registration for all 5 self-service roles, password policy, token handling, enumeration resistance | Password reset by email (not implemented) |
| Authorization | All 6 roles, route-level and row-level scoping | — |
| Blood workflow | Search, compatibility, request, preview, allocate, fulfil, cancel, expire | Multi-bank transfer between banks |
| Organ workflow | Pledge, list, request, match, accept, allocate, complete | HLA cross-matching (out of scope — documented) |
| Database | FK, UNIQUE, CHECK, NOT NULL, 6 of 10 triggers, commit/rollback, referential integrity, object inventory | Triggers 3, 7, 9, 10 are exercised indirectly (they write audit/notification rows, asserted in aggregate by TC-D10) |
| Concurrency | Single-process locking paths | True parallel allocation under load — see *Limitations* in `PROJECT_REPORT.md` |
| Frontend | Manual verification of every page | No automated component or end-to-end tests |
