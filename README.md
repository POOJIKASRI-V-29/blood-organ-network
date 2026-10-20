# 🩸 Blood & Organ Availability Network

https://poojikasri-v-29.github.io/blood-organ-network/

A centralised, database-driven platform connecting **blood donors, organ donors,
patients, hospitals, blood banks and transplant centres** — built as a Database
Systems course project with a production-shaped full-stack implementation around
a carefully normalised MySQL schema.

> **Academic simulation.** The matching and allocation mechanisms in this project
> are simplified simulations intended to demonstrate database and software
> engineering concepts, and **must not be used for real-world medical
> decision-making**. All seeded personal data is fictitious.

---

## Why this design

Three decisions shape the whole project:

**1. Inventory is tracked per physical bag, not as a counter.**
A `(blood_group, quantity)` row cannot express expiry, cannot record that unit #47
was transfused, and cannot survive two allocators reading `100` and both writing
`99`. `blood_units` holds one row per bag, with its own expiry date derived by a
trigger from the component's shelf life.

**2. Blood compatibility is data, not code.**
`blood_compatibility` is generated from ABO/Rh antigen flags by a stored
procedure, so matching is a SQL join against a table you can inspect. The same
derivation produces the textbook-correct result in both directions — O⁻ is the
universal *red cell* donor, while AB is the universal *plasma* donor, because
plasma carries antibodies and reverses the rule.

**3. Allocation is a transaction, and the invariant lives in the database.**
`sp_allocate_blood_request` reserves units under `SELECT … FOR UPDATE … SKIP
LOCKED`, and `trg_blood_allocations_before_insert` rejects any attempt to
allocate a unit that is not `AVAILABLE` — including SQL typed by hand.

---

## Features

### Blood
- Donation recording with automatic separation into components
- Individually tracked units with derived expiry and a 7-state lifecycle
- Screening that automatically releases stock, or discards it on a failed result
- Availability search filtered **through the compatibility matrix**
- Requests with an 8-state validated workflow
- Candidate-unit preview, then transactional allocation
- First-expiring-first-out ordering with local-stock and exact-group preference
- Expiry housekeeping and donor-eligibility reinstatement

### Organs
- Organ donor registration with consent status and per-organ pledges
- Organ listing with a viability deadline derived from cold-ischemia limits
- Availability search that exposes **no donor identity**
- Configurable weighted matching with a visible score breakdown and reasons
- Match decision workflow: propose → accept → allocate → complete

### Platform
- Six roles with route-level and row-level access control
- Notifications written by database triggers in the same transaction as the change
- Complete audit trail distinguishing API, TRIGGER and PROCEDURE writers
- SQL-computed analytics with eight charts
- Responsive dashboard UI with loading, empty and error states throughout

---

## Tech stack

| Layer | Technology |
|---|---|
| Database | MySQL 8.0+ (InnoDB, utf8mb4) |
| Backend | Node.js 18+, Express 4, mysql2, JWT, bcryptjs, zod, helmet, express-rate-limit |
| Frontend | React 18, Vite 5, Tailwind CSS 3, React Router 6, Axios, Recharts |
| Testing | `node:test` + supertest |

---

## Architecture

```
React (Vite) ──HTTP/JSON + Bearer JWT──> Express REST API ──parameterised SQL──> MySQL
   pages                                  routes → middleware → controllers        23 tables
   context                                        → services                        8 views
   components/ui                                                                    6 procedures
   hooks                                                                            3 functions
                                                                                    10 triggers
```

Layering rule: **controllers never write SQL; services never touch HTTP.**
Logic that is set-based or must be atomic lives in the database.

---

## Database at a glance

| Object | Count |
|---|---|
| Tables | 23 |
| Views | 8 |
| Stored procedures | 6 |
| Stored functions | 3 |
| Triggers | 10 |
| Foreign keys | 50 |
| CHECK constraints | 11 |
| Indexes | ~100 |

<details>
<summary><strong>Table list</strong></summary>

**Reference** `cities` · `blood_groups` · `blood_components` · `organ_types` · `blood_compatibility` · `matching_config`
**Actors** `users` · `donors` · `recipients` · `hospitals` · `blood_banks` · `transplant_centers`
**Blood** `blood_donations` · `blood_units` · `blood_requests` · `blood_allocations`
**Organ** `organ_donors` · `organ_donor_pledges` · `available_organs` · `organ_requests` · `organ_matches`
**Cross-cutting** `notifications` · `audit_logs`
</details>

---

## Setup

### Prerequisites

- **Node.js 18+**
- **MySQL 8.0+** running, with a user that can create databases

> **Already have a local dev database?** This copy of the project ships with a
> self-contained MySQL instance on port 3307 under `.devdb/`, created during
> development. `backend/.env` already points at it, so you can skip straight to
> `npm start`. Start it after a reboot with
> `cd backend && ./scripts/devdb-server.sh start`. To use your own MySQL
> instead, edit `backend/.env` and run `npm run db:setup` — see
> [`LOCAL_DEV_NOTE.md`](LOCAL_DEV_NOTE.md).

### 1. Database and API

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your MySQL credentials:

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=blood_organ_network

JWT_SECRET=generate_with_openssl_rand_hex_48
JWT_EXPIRES_IN=8h
CORS_ORIGIN=http://localhost:5173
```

Generate a real secret:

```bash
openssl rand -hex 48
```

Install and build the database:

```bash
npm install
npm run db:setup
```

`db:setup` applies `schema.sql → triggers.sql → procedures.sql → views.sql →
seed.sql` in order and prints what it created:

```
  Schema (tables, keys, constraints, indexes)      ok (27 statements)
  Triggers                                         ok (21 statements)
  Stored procedures and functions                  ok (19 statements)
  Views                                            ok (17 statements)
  Seed data                                        ok (76 statements)

  tables 23 · views 8 · procedures 6 · functions 3 · triggers 10 ·
  foreign keys 50 · CHECK constraints 11
```

Start the API:

```bash
npm start          # http://localhost:4000
```

Check it:

```bash
curl http://localhost:4000/api/health
```

### 2. Frontend

```bash
cd ../frontend
npm install
npm run dev        # http://localhost:5173
```

The dev server proxies `/api` to `localhost:4000`, so the browser only ever talks
to one origin and CORS does not arise locally.

### Prefer to load the SQL by hand?

```bash
cd backend/sql
mysql -u root -p < schema.sql
mysql -u root -p < triggers.sql
mysql -u root -p < procedures.sql
mysql -u root -p < views.sql
mysql -u root -p < seed.sql
```

---

## npm scripts

**backend**

| Script | Does |
|---|---|
| `npm start` | Start the API |
| `npm run dev` | Start with file watching |
| `npm run db:setup` | Build the database with seed data |
| `npm run db:reset` | Drop and rebuild (same as setup) |
| `npm run db:structure` | Structure only, no seed data |
| `npm test` | Reseed, then run all 64 tests |

**frontend**

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build |

---

## Demo accounts

All seeded. Passwords are fictitious and for local demonstration only.

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@bon.health` | `Admin@123` |
| Donor | `donor@bon.health` | `Password@123` |
| Patient | `recipient@bon.health` | `Password@123` |
| Hospital | `hospital@bon.health` | `Password@123` |
| Blood bank | `bloodbank@bon.health` | `Password@123` |
| Transplant centre | `transplant@bon.health` | `Password@123` |

Every other seeded account also uses `Password@123`. The login page lists these
and fills the form on click.

### What is in the seed data

52 users across 6 roles · 30 donors (10 of whom have never donated) · 8 patients ·
5 hospitals · 5 blood banks · 3 transplant centres · 45 donations ·
104 blood units across all 8 groups and 5 components · blood requests in **every**
workflow state (pending, partially allocated, fulfilled, rejected, cancelled,
expired) · 14 organs · 8 organ requests · scored matches · notifications and
~274 audit entries, most written by triggers during seeding.

The seed deliberately calls the same stored procedures the API calls, so the demo
data is provably reachable through the application's own logic.

---

## API overview

**66 routes.** Full reference with payloads and status codes in
[`docs/API_DOCUMENTATION.md`](docs/API_DOCUMENTATION.md).

| Group | Examples |
|---|---|
| Auth | `POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` |
| Reference | `GET /api/reference/bootstrap` · `GET /api/reference/compatibility` |
| Blood | `GET /api/blood/availability` · `POST /api/blood/donations` · `POST /api/blood/requests` · `GET /api/blood/requests/:id/match` · `POST /api/blood/requests/:id/allocate` |
| Organs | `GET /api/organs/availability` · `POST /api/organs` · `POST /api/organs/donors/me` |
| Organ requests | `POST /api/organ-requests` · `POST /api/organ-requests/:id/match` · `PATCH /api/organ-requests/matches/:id/status` |
| Directory | `GET /api/users` · `GET /api/hospitals` · `GET /api/blood-banks` · `GET /api/audit-logs` |
| Analytics | `GET /api/analytics/public` · `/overview` · `/blood` · `/organs` |

Responses use one envelope:

```json
{ "success": true,  "data": {}, "meta": {} }
{ "success": false, "error": { "message": "…", "details": [] } }
```

---

## DBMS concepts demonstrated

Each maps to a specific file and object — see
[`docs/DBMS_CONCEPTS.md`](docs/DBMS_CONCEPTS.md).

| Concept | Where |
|---|---|
| **Normalisation (1NF → 3NF/BCNF)** | `cities`, `blood_groups`, `blood_components`, `organ_donor_pledges` — worked through in `DATABASE_DESIGN.md` |
| **Primary & candidate keys** | Surrogate PKs with natural keys preserved as UNIQUE |
| **Foreign keys & referential integrity** | 50 FKs; CASCADE / RESTRICT / SET NULL chosen per relationship |
| **CHECK, NOT NULL, DEFAULT** | 11 CHECK constraints; defaults on status, volume, timestamps |
| **Joins** | INNER, LEFT (+ IS NULL), RIGHT, CROSS, LATERAL; a 9-table provenance join |
| **Aggregation** | COUNT/SUM/AVG/MIN/MAX, GROUP BY, HAVING, conditional aggregation |
| **Subqueries** | Scalar, derived-table, correlated, EXISTS, NOT EXISTS |
| **Views** | 8, all queried by the API — including the organ privacy boundary |
| **Stored procedures** | 6, including the transactional allocator and the organ matcher |
| **Stored functions** | 3 — `fn_calculate_age`, `fn_blood_compatible`, `fn_compatible_unit_count` |
| **Triggers** | 10 — derived expiry, lifecycle enforcement, double-allocation guard, auditing, notifications |
| **Transactions & ACID** | `START TRANSACTION … COMMIT` with `EXIT HANDLER … ROLLBACK`; `withTransaction()` in Node |
| **Concurrency control** | `SELECT … FOR UPDATE … SKIP LOCKED`, REPEATABLE READ |
| **Indexing** | ~100 indexes, each justified by a named query |
| **Security** | bcrypt, JWT, RBAC, parameterised SQL, zod validation, allow-listed ORDER BY |

### Try the SQL directly

```bash
mysql -u root -p blood_organ_network < backend/sql/useful_queries.sql
```

25 executable queries. A favourite — the universal-donor property proved from the
data rather than asserted:

```sql
SELECT d.group_code AS donor_group,
       SUM(bc.is_compatible) AS can_donate_to_n_groups,
       GROUP_CONCAT(CASE WHEN bc.is_compatible THEN r.group_code END
                    ORDER BY r.group_code SEPARATOR ', ') AS recipients
  FROM blood_compatibility bc
  JOIN blood_groups d ON d.blood_group_id = bc.donor_group_id
  JOIN blood_groups r ON r.blood_group_id = bc.recipient_group_id
 WHERE bc.component_id = 2                       -- packed red blood cells
 GROUP BY d.blood_group_id, d.group_code
 ORDER BY can_donate_to_n_groups DESC;
```

```
O-   8   A-, A+, AB-, AB+, B-, B+, O-, O+
O+   4   A+, AB+, B+, O+
A-   4   A-, A+, AB-, AB+
B-   4   AB-, AB+, B-, B+
A+   2   A+, AB+
B+   2   AB+, B+
AB-  2   AB-, AB+
AB+  1   AB+
```

---

## Testing

```bash
cd backend && npm test
```

```
# tests 64
# suites 5
# pass 64
# fail 0
```

| Suite | Tests | Covers |
|---|---|---|
| Authentication | 10 | Login, registration, password policy, enumeration resistance |
| Authorization | 10 | All 6 roles, route-level and row-level scoping |
| Blood subsystem | 17 | Search, compatibility, allocation, fulfilment, double-allocation, expiry |
| Database | 15 | FK, UNIQUE, CHECK, NOT NULL, triggers, commit/rollback, matrix correctness |
| Organ subsystem | 12 | Privacy, matching, score arithmetic, decision workflow |

`npm test` reseeds the database first — never point it at data you care about.

Full inventory, manual verification and the four defects testing uncovered:
[`docs/TESTING.md`](docs/TESTING.md).

---

## Screenshots

Place captures in `docs/screenshots/` — see `docs/PROJECT_REPORT.md` §20 for the
suggested list (landing, dashboards, availability search, request detail with the
workflow timeline, organ match breakdown, analytics, audit log, compatibility
matrix, mobile layout).

---

## Project structure

```
blood-organ-network/
├── backend/
│   ├── sql/
│   │   ├── schema.sql            23 tables, 50 FKs, 11 CHECKs, ~100 indexes
│   │   ├── triggers.sql          10 triggers, each with its rationale
│   │   ├── procedures.sql        6 procedures + 3 functions
│   │   ├── views.sql             8 views
│   │   ├── seed.sql              reference + realistic demo data
│   │   └── useful_queries.sql    25 demonstration queries
│   ├── scripts/setup-database.js one-command database build
│   ├── src/
│   │   ├── config/               env, pool, withTransaction, state machines
│   │   ├── middleware/           auth, RBAC, validation, error mapping
│   │   ├── validators/           zod schemas
│   │   ├── services/             all SQL lives here
│   │   ├── controllers/          HTTP only
│   │   ├── routes/               66 routes, roles declared per route
│   │   ├── app.js
│   │   └── server.js
│   └── tests/                    64 tests across 5 suites
├── frontend/
│   └── src/
│       ├── services/api.js       axios client
│       ├── context/              auth, reference data, toasts
│       ├── hooks/useApi.js
│       ├── components/ui/        shared component library
│       ├── components/charts/
│       ├── layouts/
│       └── pages/                landing, auth, dashboards, blood, organs, admin
└── docs/
    ├── ER_DIAGRAM.md
    ├── DATABASE_DESIGN.md
    ├── DBMS_CONCEPTS.md
    ├── API_DOCUMENTATION.md
    ├── TESTING.md
    └── PROJECT_REPORT.md
```

---

## Future enhancements

HLA typing and crossmatch modelling · real distance/transport-time geography ·
demand forecasting from historical series · inter-bank transfer before expiry ·
email/SMS delivery for critical requests · refresh tokens with session revocation ·
audit-log partitioning and archival · a donor mobile app · read replicas for
analytics · automated frontend tests and CI.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/ER_DIAGRAM.md`](docs/ER_DIAGRAM.md) | ER diagram, relationship inventory, referential-integrity policy |
| [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md) | Normalisation to 3NF with worked examples, keys, indexes, transactions |
| [`docs/DBMS_CONCEPTS.md`](docs/DBMS_CONCEPTS.md) | Every DBMS concept mapped to its implementation |
| [`docs/API_DOCUMENTATION.md`](docs/API_DOCUMENTATION.md) | All 66 endpoints with payloads and status codes |
| [`docs/TESTING.md`](docs/TESTING.md) | 64 tests, manual verification, defects found and fixed |
| [`docs/PROJECT_REPORT.md`](docs/PROJECT_REPORT.md) | Full academic report |

---

## Licence and disclaimer

Academic coursework. Not licensed for clinical or commercial use.

**The matching and allocation mechanisms in this academic project are simplified
simulations intended to demonstrate database and software engineering concepts
and must not be used for real-world medical decision-making.**
