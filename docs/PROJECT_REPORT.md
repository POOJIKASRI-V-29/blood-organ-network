# Blood & Organ Availability Network
### A Database Systems Course Project

---

## 1. Title

**Blood & Organ Availability Network** — a centralised, database-driven platform
for coordinating blood and organ availability between donors, patients,
hospitals, blood banks and transplant centres.

---

## 2. Abstract

Blood and organs are perishable, unevenly distributed, and urgently needed in
ways that are hard to predict. Blood banks discard stock that expired while a
hospital forty kilometres away was searching for it; platelets, with a five-day
shelf life, are wasted at rates well above other components. The coordination
problem is fundamentally a *data* problem: nobody has a consistent, current,
queryable view of what exists and who needs it.

This project implements that view. A normalised MySQL database models donors,
patients, institutions, individually identified blood units, recovered organs,
requests, and the allocations that connect them. On top of it sits a Node.js/
Express REST API and a React dashboard.

The design choice that drives everything else is that **inventory is modelled at
the level of the individual bag**, not as a per-group counter. That single
decision is what makes expiry tracking, first-expiring-first-out allocation,
wastage analytics and safe concurrent allocation possible at all.

Blood compatibility is not hardcoded. It is stored as a relation derived from
ABO/Rh antigen flags, so matching is a SQL join against a table the user can
inspect — and the same table produces the textbook-correct result that O− is the
universal red-cell donor while AB is the universal *plasma* donor, because plasma
reverses the rule.

The system demonstrates normalisation to 3NF, referential integrity with
deliberately chosen delete rules, CHECK constraints, views, stored procedures and
functions, triggers, indexing strategy, and ACID transactions with row-level
locking. It is delivered with 64 passing automated tests.

**The matching and allocation mechanisms are simplified simulations for academic
demonstration and must not be used for real-world medical decision-making.**

---

## 3. Problem statement

Blood and organ coordination in practice suffers from:

1. **Fragmented inventory** — each blood bank keeps its own records, usually in a
   spreadsheet or an isolated system. There is no network-wide answer to
   "where is there O− right now?"
2. **Wastage through expiry** — without visibility, stock expires unused. Short
   shelf lives (platelets: 5 days) make this acute.
3. **Manual compatibility checking** — ABO/Rh rules applied by hand, or encoded
   inconsistently in several places, risk error in exactly the situations where
   there is least time to check.
4. **No allocation audit trail** — when a unit is issued, there is often no
   durable record of *why* that unit, for whom, by whom.
5. **Opaque organ matching** — candidates are ranked by criteria that recipients
   and clinicians cannot inspect.
6. **Race conditions** — two hospitals can be told the same unit is available.

---

## 4. Objectives

1. Design a normalised relational schema (3NF) that models the domain faithfully.
2. Track blood at the granularity of the individual unit, with derived expiry.
3. Store blood compatibility as data, so matching is a join rather than branching code.
4. Allocate stock atomically, making double-allocation impossible.
5. Provide a transparent, configurable organ-matching score with visible reasons.
6. Enforce role-based access control across six distinct roles.
7. Maintain a complete audit trail, including changes made by the database itself.
8. Surface network-wide analytics computed by SQL aggregation.
9. Deliver a professional, responsive web interface over real APIs.
10. Demonstrate the DBMS concepts of a Database Systems course concretely.

---

## 5. Existing system

Current practice is typically one of:

| Approach | Limitation |
|---|---|
| Paper registers / spreadsheets per bank | No cross-institution visibility; no concurrency control; no integrity guarantees |
| Standalone blood-bank software | Manages one bank's stock; cannot answer network-level questions |
| Phone-based coordination | Slow, unrecorded, error-prone under time pressure |
| Donor-contact apps | Connect people, but do not model inventory, expiry or allocation |

None of these maintain an authoritative, queryable, concurrency-safe record of
*which physical unit exists where, in what state, until when*.

---

## 6. Proposed system

A single relational database as the source of truth, with:

* **Individually tracked blood units** — one row per bag, with its own collection
  date, expiry date and lifecycle status, derived from the component's shelf life
  by a database trigger.
* **Compatibility as a relation** — `blood_compatibility`, generated from antigen
  flags by a stored procedure, joined by every search and by the allocator.
* **Transactional allocation** — `sp_allocate_blood_request` reserves units under
  `SELECT … FOR UPDATE … SKIP LOCKED`, with a trigger enforcing the invariant.
* **Configurable organ matching** — weights stored in `matching_config`; each
  match records its five sub-scores and a human-readable reason.
* **Six-role RBAC** — enforced at the route level and scoped at the row level.
* **Complete audit trail** — API, trigger and procedure writes are distinguished
  by a `source` column.

---

## 7. Scope

### In scope

Donor and patient registration; institution registration with admin approval;
donation recording and component separation; screening with automatic release or
discard; inventory with expiry lifecycle; availability search with compatibility
filtering; blood requests with an eight-state workflow; transactional allocation;
organ donor pledges; organ listing with viability windows; organ requests;
weighted matching with decision workflow; notifications; audit log; analytics
dashboards; role-based access control.

### Out of scope

HLA cross-matching and immunological risk scoring; real-time transport logistics;
payment or billing; integration with hospital information systems; SMS/email
delivery; mobile applications; regulatory compliance certification.

### Explicitly simulated

Organ matching is a **simplified weighted score for academic demonstration**.
Real allocation uses HLA typing, crossmatch results, waiting time, MELD/PELD
scores and national policy. This project does not attempt that and must not be
used clinically.

---

## 8. Functional requirements

| ID | Requirement | Where implemented |
|---|---|---|
| FR-01 | Register as donor, patient, hospital, blood bank or transplant centre | `authService.register`, `Register.jsx` |
| FR-02 | Institutions require administrator approval | `status='PENDING'`, `directoryService.setUserStatus` |
| FR-03 | Authenticate and maintain a session | JWT, `middleware/auth.js` |
| FR-04 | Record a blood donation and separate it into components | `bloodService.recordDonation` |
| FR-05 | Derive unit expiry from component shelf life | `trg_blood_units_before_insert` |
| FR-06 | Record screening; release or discard units automatically | `trg_blood_donations_after_update` |
| FR-07 | Search availability, filtered by compatibility | `sp_search_available_blood` |
| FR-08 | Raise a blood request | `bloodService.createRequest` |
| FR-09 | Preview candidate units before allocating | `sp_get_compatible_blood_units` |
| FR-10 | Allocate units atomically | `sp_allocate_blood_request` |
| FR-11 | Prevent double allocation | `trg_blood_allocations_before_insert` |
| FR-12 | Progress a request through its workflow | `BLOOD_REQUEST_TRANSITIONS` |
| FR-13 | Register organ donation preferences | `organService.registerOrganDonor` |
| FR-14 | List a recovered organ with a viability deadline | `trg_available_organs_before_insert` |
| FR-15 | Search organ availability without exposing donors | `v_available_organs` |
| FR-16 | Raise an organ request | `organService.createOrganRequest` |
| FR-17 | Score candidate organs with visible reasons | `sp_find_organ_matches` |
| FR-18 | Accept / allocate / complete a match | `organService.updateMatchStatus` |
| FR-19 | Maintain donation and request history | `blood_donations`, `blood_allocations`, `organ_matches` |
| FR-20 | Administer users and institutions | `directoryService` |
| FR-21 | Notify users of changes affecting them | trigger-written `notifications` |
| FR-22 | Provide dashboards and analytics | `analyticsService`, `Analytics.jsx` |
| FR-23 | Maintain an audit trail | `audit_logs` with `source` |
| FR-24 | Retire expired stock and reinstate donor eligibility | `sp_expire_stale_records` |

---

## 9. Non-functional requirements

| ID | Requirement | How met |
|---|---|---|
| NFR-01 | Integrity | 50 FKs, 11 CHECKs, NOT NULL, UNIQUE candidate keys, 10 triggers |
| NFR-02 | Atomicity under concurrency | `FOR UPDATE … SKIP LOCKED` inside explicit transactions |
| NFR-03 | Security | bcrypt, JWT, RBAC, zod validation, parameterised SQL, helmet, CORS, rate limiting |
| NFR-04 | Privacy | Donor identity excluded from every availability response |
| NFR-05 | Performance | Composite indexes matched to real query shapes; aggregation in SQL |
| NFR-06 | Usability | Loading / empty / error states everywhere; confirmations before destructive actions |
| NFR-07 | Accessibility | Semantic HTML, labelled controls, visible focus rings, ARIA on dialogs and live regions |
| NFR-08 | Responsiveness | Works from ~400 px to desktop |
| NFR-09 | Maintainability | Layered architecture; no file over ~600 lines; single-purpose modules |
| NFR-10 | Reproducibility | `npm run db:setup` rebuilds everything deterministically |

---

## 10. System architecture

```
┌────────────────────────────────────────────────────────┐
│  React 18 + Vite + Tailwind + React Router + Recharts  │
│  pages · components · context (auth, reference, toast) │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS/JSON, Bearer JWT
┌───────────────────────────▼────────────────────────────┐
│  Express REST API (66 routes)                          │
│  routes → middleware (auth, RBAC, zod) → controllers   │
│           → services → mysql2 pool                     │
│  helmet · CORS · rate limiting · central error mapper  │
└───────────────────────────┬────────────────────────────┘
                            │ parameterised SQL only
┌───────────────────────────▼────────────────────────────┐
│  MySQL 8 / InnoDB — blood_organ_network                │
│  23 tables · 8 views · 6 procedures · 3 functions      │
│  10 triggers · 50 FKs · 11 CHECKs                      │
│  transactions · row-level locking                      │
└────────────────────────────────────────────────────────┘
```

Layering rule: **controllers never write SQL, services never touch HTTP.**
Business logic that is set-based or must be atomic lives in the database.

---

## 11. ER model

See **`ER_DIAGRAM.md`** for the full Mermaid diagram, the relationship inventory
(7 one-to-one, ~25 one-to-many, 4 many-to-many resolved by associative tables)
and the referential-integrity policy.

Key structural points:

* `users` is the single authentication identity; five 1:1 specialisations carry
  role-specific attributes, each enforced by a UNIQUE on the foreign key.
* `blood_compatibility` is a **ternary** relationship — compatibility depends on
  the donor group, the recipient group *and* the component.
* `blood_allocations` and `organ_matches` resolve the two central many-to-many
  relationships and carry their own attributes (status, score, reason).

---

## 12. Relational schema

23 relations. Full DDL in `backend/sql/schema.sql`.

**Reference** `cities`, `blood_groups`, `blood_components`, `organ_types`,
`blood_compatibility`, `matching_config`
**Actors** `users`, `donors`, `recipients`, `hospitals`, `blood_banks`, `transplant_centers`
**Blood** `blood_donations`, `blood_units`, `blood_requests`, `blood_allocations`
**Organ** `organ_donors`, `organ_donor_pledges`, `available_organs`, `organ_requests`, `organ_matches`
**Cross-cutting** `notifications`, `audit_logs`

---

## 13. Normalisation

Worked through in **`DATABASE_DESIGN.md`** with this project's own tables.

* **UNF → 1NF** — a comma-separated pledged-organ list became
  `organ_donor_pledges`; a `(blood_group, quantity)` counter became `blood_units`.
* **1NF → 2NF** — `blood_components` extracted from `blood_compatibility`,
  removing the partial dependency `component_id → shelf_life_days`.
* **2NF → 3NF** — `cities` extracted, removing `city → state, region`;
  `blood_groups` extracted, removing `group_code → abo_type, rh_factor`.
* **BCNF** — all relations comply.

Three cached values (`donors.total_donations`, `donors.last_donation_date`,
`blood_requests.units_allocated`) are stored deliberately and maintained
exclusively by triggers or transactional procedures; test TC-D08 asserts they
never drift.

---

## 14. Database implementation

| Object | Count | File |
|---|---|---|
| Tables | 23 | `schema.sql` |
| Views | 8 | `views.sql` |
| Stored procedures | 6 | `procedures.sql` |
| Stored functions | 3 | `procedures.sql` |
| Triggers | 10 | `triggers.sql` |
| Foreign keys | 50 | `schema.sql` |
| CHECK constraints | 11 | `schema.sql` |
| Indexes | ~100 | `schema.sql` |

`DBMS_CONCEPTS.md` maps every concept to the file and object implementing it.

---

## 15. SQL queries

`backend/sql/useful_queries.sql` contains 25 executable demonstration queries
covering SELECT/WHERE/ORDER BY, INNER/LEFT/RIGHT/CROSS joins, a 6-table join,
GROUP BY, HAVING, aggregates, scalar/derived/correlated subqueries, EXISTS,
NOT EXISTS, CASE, conditional aggregation, date grouping, and view usage.

The analytically interesting ones:

* **Q3** traces which donor's blood reached which patient — a 9-table join only
  possible because nothing was denormalised.
* **Q16** proves the universal-donor property from the data alone.
* **Q24** shows the triggers firing, grouped by `source`.
* **Q25** quantifies wastage per component, exposing the 5-day platelet problem.

---

## 16. Backend architecture

```
backend/src/
├── config/       env, mysql2 pool + withTransaction, constants & state machines
├── middleware/   auth (authenticate, authorize, requireActive), validate, errorHandler
├── validators/   zod schemas (registration is a discriminated union on role)
├── services/     all SQL; auth, blood, organ, analytics, directory, notification, reference
├── controllers/  HTTP only — parse, delegate, respond
├── routes/       route table with roles declared per route
├── app.js        helmet, CORS, rate limits, JSON limits, mounting
└── server.js     startup DB check, graceful shutdown
```

Cross-cutting decisions:

* One response envelope for every endpoint.
* `asyncHandler` so no rejected promise escapes.
* Database errors mapped centrally to HTTP codes; stack traces never leave the server.
* `LIMIT`/`OFFSET` coerced to bounded integers; `ORDER BY` resolved through an
  allow-list — the only two places where SQL cannot be parameterised.

---

## 17. Frontend architecture

```
frontend/src/
├── services/api.js   axios instance, envelope unwrapping, 401 handling
├── context/          AuthContext, ReferenceContext, ToastContext
├── hooks/useApi.js   { data, loading, error, reload } with stale-response guarding
├── components/ui/    Badge, Card, StatCard, Modal, ConfirmDialog, Pagination, DataState…
├── components/charts/ Recharts wrappers with one shared palette
├── layouts/          PublicLayout, AppLayout (role-derived navigation)
└── pages/            landing, auth, dashboards, blood, organs, admin
```

`<DataState>` resolves loading / error / empty / content uniformly, which is why
every list in the application behaves the same way. Navigation is derived from
the signed-in role, so users are never shown a link the API would refuse.

---

## 18. Authentication and authorization

* **bcrypt** (cost 10); `password_hash` never enters a response.
* **JWT** bearer tokens; the user is re-loaded from the database on every request,
  so suspension takes effect immediately rather than at token expiry.
* **Six roles**, declared per route. ADMIN is not implicitly permitted anywhere.
* **Row-level scoping** from the token: a donor's `donorId` and a hospital's
  `hospitalId` come from the session, never from the request body.
* Institutions register as `PENDING` and cannot act until approved.
* Login failures are indistinguishable between unknown email and wrong password.

---

## 19. Matching algorithms

### 19.1 Blood

1. Validate the request (zod) and its workflow state.
2. Join candidate units against `blood_compatibility` for the recipient's group
   **and the requested component**.
3. Exclude anything not `AVAILABLE`, expired, or held at an inactive bank.
4. Order by: exact group → same city as the requesting hospital → first-expiring-first-out.
5. Inside a transaction, lock each candidate with `FOR UPDATE … SKIP LOCKED`,
   insert the allocation (the trigger re-checks the invariant), set the unit
   `RESERVED`.
6. Update the request totals and status; write an audit row; commit.

The ordering encodes three real trade-offs: preserve scarce universal stock,
shorten the cold chain, and minimise wastage.

### 19.2 Organ — simplified academic simulation

```
score = (40·blood + 25·urgency + 20·priority + 10·location + 5·age) / 100
```

| Component | Scoring |
|---|---|
| Blood | 100 exact group, 85 compatible; **incompatible organs are excluded entirely, not scored low** |
| Urgency | CRITICAL 100, URGENT 70, ROUTINE 40 |
| Medical priority | the clinician's 0–100 value |
| Location | 100 same city, 70 same region, 40 otherwise |
| Age | `max(0, 100 − |donor − recipient| × 100 / tolerance)`, tolerance 25 years |

Weights and the minimum score live in `matching_config`, so re-tuning requires no
code change. Each match stores its five sub-scores and a readable reason
("Exact blood group match (O+)", "Same city as requesting hospital"), and the UI
shows the weighted contribution of each. Test TC-O07 asserts the stored total
always equals the weighted sum.

**This is a teaching model, not a clinical allocation system.**

---

## 20. Screenshots

Capture with the application running (`npm run dev` in both folders) and place in
`docs/screenshots/`:

| File | Page |
|---|---|
| `01-landing.png` | Landing with live availability |
| `02-login.png` | Sign-in with demo accounts |
| `03-admin-dashboard.png` | Administrator dashboard |
| `04-blood-availability.png` | Availability search with compatibility filter |
| `05-blood-request-detail.png` | Workflow timeline and allocated units |
| `06-match-preview.png` | Candidate units modal |
| `07-organ-matches.png` | Score breakdown with reasons |
| `08-analytics.png` | Charts |
| `09-audit-log.png` | TRIGGER / PROCEDURE / API badges |
| `10-compatibility.png` | Compatibility matrix |
| `11-donor-dashboard.png` | Donor view |
| `12-mobile.png` | Narrow-width layout |

---

## 21. Testing

64 automated tests across 5 suites, all passing — see **`TESTING.md`** for the
full inventory, the manual verification performed, and the four defects testing
found and fixed.

```bash
cd backend && npm test
# tests 64 · pass 64 · fail 0
```

---

## 22. Results

The system meets its objectives.

**Database:** 23 tables in 3NF, 50 foreign keys with individually justified delete
rules, 11 CHECK constraints, 8 views, 6 procedures, 3 functions, 10 triggers,
~100 indexes. Rebuilds deterministically with one command.

**Correctness demonstrated from the data:**

* The compatibility matrix is textbook-correct in both directions — O− red cells
  serve all 8 groups, AB+ red cells serve 1; AB plasma serves all 8, O plasma
  serves 1. Neither was typed by hand; both are derived from antigen flags.
* Across all allocations in the seeded database, `fn_blood_compatible()` returns
  true for every one (TC-B09).
* No unit and no organ is ever allocated twice (TC-B10, TC-O12).
* Cached counters never drift from their source rows (TC-D08).
* Illegal state transitions are refused at both the database and API layers
  (TC-D06, TC-B14, TC-O10).

**Seeded demonstration data:** 52 users across 6 roles, 30 donors, 8 patients,
5 hospitals, 5 blood banks, 3 transplant centres, 45 donations, 104 blood units,
12+ blood requests spanning every workflow state, 14 organs, 8 organ requests,
11 scored matches, 56 notifications and 274 audit entries — of which the majority
were written by triggers during seeding, proving they fire.

**Analytical findings from the seeded network:** platelet wastage reaches ~69%,
against ~22% overall, driven entirely by the 5-day shelf life. Rare groups (AB−,
O−) show the lowest request-fulfilment rates. Both are exactly the insights a
network-level view is supposed to surface, and neither is visible in a
counter-based inventory model.

---

## 23. Limitations

1. **Organ matching is a simplification.** No HLA typing, crossmatch, waiting
   time, MELD/PELD score or policy. Not clinically usable.
2. **ABO compatibility is applied uniformly to all organ types.** In reality
   avascular grafts such as cornea do not require ABO matching; the model is
   conservative here rather than accurate.
3. **Concurrency is designed for but not load-tested.** The locking strategy is
   correct by construction and exercised single-process; no parallel soak test
   was run.
4. **No delivery channel for notifications.** They are persisted in-database and
   shown in the UI; no email or SMS is sent.
5. **No frontend automated tests.** Every page was verified manually; there are
   no component or end-to-end tests.
6. **Single-database deployment.** No replication, sharding or archival strategy;
   `audit_logs` grows without bound.
7. **Geography is coarse.** Proximity is city/region equality, not distance or
   transport time.
8. **Screening is a status, not a result set.** Individual infectious-disease
   marker results are not modelled.
9. **No soft delete.** Records are removed or retained, with no tombstone state.

---

## 24. Future enhancements

1. HLA typing and crossmatch modelling, with immunological risk in the score.
2. Real geography — coordinates, distance and estimated transport time, so the
   location score reflects whether an organ can physically arrive in time.
3. Demand forecasting from historical donation and request series, driving
   "collect O− this week" recommendations.
4. Inter-bank transfer workflow so surplus stock moves before it expires.
5. Email/SMS delivery for CRITICAL requests, with a notification outbox table.
6. Refresh tokens and per-device session revocation.
7. Audit-log partitioning by month with archival.
8. A donor-facing mobile application with appointment booking.
9. Read replicas for the analytics workload.
10. Automated frontend testing and CI.

---

## 25. Conclusion

The project delivers a working blood and organ coordination network built
database-first: the schema was designed, normalised and constrained before any
application code was written, and the most important rules live in the database
where no client can bypass them.

Three decisions carried the most weight. Modelling inventory as individually
identified units rather than counters made expiry, wastage and safe allocation
tractable. Storing blood compatibility as a derived relation turned a
safety-critical rule into inspectable data and removed the possibility of it
being encoded inconsistently across the codebase. Performing allocation inside a
transaction with row-level locking, backed by a trigger that enforces the
invariant independently, made double-allocation impossible rather than merely
unlikely.

The work also demonstrates that a schema can encode genuine domain policy: the
allocator's `ORDER BY` clause is a clinical trade-off between preserving rare
stock, shortening the cold chain and minimising wastage, expressed in SQL.

Testing was not an afterthought — it found four real defects, including a silent
frontend crash on every failed request and a rule that left donors permanently
ineligible after their first donation. All were fixed and are covered by
regression tests.

The organ-matching component is deliberately and visibly a simulation. Making the
weights configurable data, recording each sub-score, and showing the reasoning in
the interface is both better engineering and an honest representation of what the
system is: a demonstration of database and software engineering concepts, not a
medical device.

---

## Appendix A — Running the project

See the root **`README.md`**. In brief:

```bash
# database
cd backend && cp .env.example .env    # edit DB_* values
npm install && npm run db:setup

# API
npm start                             # http://localhost:4000

# frontend
cd ../frontend && npm install && npm run dev   # http://localhost:5173
```

Demo credentials: `admin@bon.health / Admin@123`, and `Password@123` for
`donor@`, `recipient@`, `hospital@`, `bloodbank@`, `transplant@bon.health`.

## Appendix B — Documentation index

| Document | Contents |
|---|---|
| `ER_DIAGRAM.md` | ER diagram, relationship inventory, referential-integrity policy |
| `DATABASE_DESIGN.md` | Normalisation to 3NF with worked examples, keys, indexes, transactions |
| `DBMS_CONCEPTS.md` | Every DBMS concept mapped to its file and object |
| `API_DOCUMENTATION.md` | All 66 endpoints, payloads, status codes, worked example |
| `TESTING.md` | 64 tests, manual verification, defects found and fixed |
| `PROJECT_REPORT.md` | This report |
