# API Documentation

Base URL: `http://localhost:4000/api` · **66 routes**

The route table below was generated from the running Express app, so it matches
`backend/src/routes/*.js` exactly.

---

## Conventions

### Response envelope

Success:
```json
{ "success": true, "data": { }, "meta": { } }
```

Failure:
```json
{ "success": false, "error": { "message": "…", "details": [ { "field": "…", "message": "…" } ] } }
```

`meta` is present on paginated endpoints:
```json
{ "page": 1, "limit": 20, "total": 104, "totalPages": 6, "hasNext": true, "hasPrev": false }
```

### Authentication

All endpoints except those marked **public** require:

```
Authorization: Bearer <jwt>
```

Tokens are returned by `POST /auth/register` and `POST /auth/login`, and expire
after `JWT_EXPIRES_IN` (default 8h). The token is verified *and* the user
re-loaded from the database on every request, so a suspended account stops
working immediately.

### Status codes

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 400 | Validation failed / foreign key missing / CHECK violated |
| 401 | No token, invalid token, expired session, wrong credentials |
| 403 | Authenticated but role not permitted, or account not ACTIVE |
| 404 | Resource not found |
| 409 | Conflict — duplicate key, illegal state transition, unit already allocated, row locked |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error (stack traces never returned) |

### Pagination and sorting

`?page=1&limit=20&sortBy=<key>&sortDir=asc|desc&search=<text>`

`limit` is capped at 100. `sortBy` is resolved through a server-side allow-list;
an unrecognised value falls back to the endpoint default.

### Rate limiting

* `/api/*` — 300 requests / minute
* `/api/auth/login`, `/register`, `/change-password` — 20 requests / 15 minutes

---

## 1. Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | public | Database name, MySQL version, disclaimer |

---

## 2. Authentication — `/auth`

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/auth/register` | public | Create an account and its role profile (atomic) |
| POST | `/auth/login` | public | Exchange credentials for a JWT |
| POST | `/auth/logout` | any | Records the sign-out in the audit trail |
| GET | `/auth/me` | any | Current user plus the joined role profile |
| PATCH | `/auth/me` | any | Update own name, phone, address, city, weight, notes |
| POST | `/auth/change-password` | any | Requires the current password |

**`POST /auth/register`** — the body is a discriminated union on `role`.

DONOR / RECIPIENT (activated immediately):
```json
{
  "role": "DONOR",
  "fullName": "Neha Bhat",
  "email": "neha@example.com",
  "password": "Password@123",
  "phone": "+91-98450-11021",
  "dateOfBirth": "1996-06-18",
  "gender": "FEMALE",
  "bloodGroupId": 3,
  "cityId": 1,
  "address": "62, HSR Layout",
  "weightKg": 57.2
}
```

HOSPITAL / BLOOD_BANK (created **PENDING**, needs admin approval):
```json
{
  "role": "BLOOD_BANK",
  "fullName": "Contact Person",
  "email": "bank@example.com",
  "password": "Password@123",
  "organisationName": "City Blood Bank",
  "registrationNumber": "BB-KA-099",
  "address": "12 Main Road",
  "cityId": 1
}
```

TRANSPLANT_CENTER additionally requires `licenseNumber` and `hospitalId`.

Password policy (enforced by `validators/common.js`): ≥ 8 characters, containing a
letter, a digit and a symbol.

`ADMIN` accounts cannot be self-registered → **403**.

**`POST /auth/login`**
```json
{ "email": "admin@bon.health", "password": "Admin@123" }
```
→
```json
{ "success": true, "data": { "user": { "userId": 1, "role": "ADMIN", "…": "…" }, "token": "eyJ…" } }
```
Unknown email and wrong password return the **same** 401 message, so the endpoint
cannot be used to enumerate accounts.

---

## 3. Reference data — `/reference` (public)

| Method | Path | Description |
|---|---|---|
| GET | `/reference/bootstrap` | Cities, blood groups, components, organ types in one call |
| GET | `/reference/cities` | 12 cities with state and region |
| GET | `/reference/blood-groups` | 8 groups with antigen flags and population share |
| GET | `/reference/blood-components` | 5 components with shelf life and match direction |
| GET | `/reference/organ-types` | 8 organ types with ischemia window and age limits |
| GET | `/reference/compatibility?componentId=2` | The full compatibility matrix for one component |
| GET | `/reference/matching-config` | Organ-matching weights |

---

## 4. Blood — `/blood`

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/blood/availability` | any | Stock search (calls `sp_search_available_blood`) |
| GET | `/blood/availability/summary` | any | Totals per group and component |
| GET | `/blood/expiring` | ADMIN, BLOOD_BANK | Units within 14 days of expiry |
| GET | `/blood/units` | ADMIN, BLOOD_BANK, HOSPITAL | Paginated inventory |
| GET | `/blood/donations` | ADMIN, BLOOD_BANK, DONOR | Donation list (a DONOR sees only their own) |
| GET | `/blood/donations/:id` | ADMIN, BLOOD_BANK, DONOR | Donation with its derived units |
| POST | `/blood/donations` | ADMIN, BLOOD_BANK | Record a donation and separate it into units |
| PATCH | `/blood/donations/:id/screening` | ADMIN, BLOOD_BANK | Record PASSED / FAILED |
| GET | `/blood/requests` | any | Request list, scoped by role |
| GET | `/blood/requests/:id` | any | Request with allocations and supply position |
| POST | `/blood/requests` | ADMIN, HOSPITAL, RECIPIENT | Raise a request |
| GET | `/blood/requests/:id/match` | ADMIN, HOSPITAL, BLOOD_BANK | Preview candidate units (no writes) |
| POST | `/blood/requests/:id/allocate` | ADMIN, HOSPITAL, BLOOD_BANK | **Transactional allocation** |
| PATCH | `/blood/requests/:id/status` | ADMIN, HOSPITAL, BLOOD_BANK | Validated workflow transition |
| POST | `/blood/housekeeping/expire` | ADMIN | Run `sp_expire_stale_records` |

**`GET /blood/availability`**

Query: `recipientBloodGroupId`, `componentId`, `cityId`, `bloodBankId`, `minUnits`.

Supplying `recipientBloodGroupId` filters **through the compatibility matrix** —
the result is everything that could be transfused to that patient, not only their
own group. Donor identity is never included.

**`POST /blood/donations`**
```json
{
  "donorId": 17,
  "bloodBankId": 1,
  "donationDate": "2026-09-15",
  "volumeMl": 450,
  "hemoglobinGdl": 14.1,
  "components": [ { "componentId": 2 }, { "componentId": 4 } ]
}
```
Units are created **QUARANTINED**; their `expiry_date` is derived by
`trg_blood_units_before_insert`. Donating inside the 90-day interval → **409**.

**`PATCH /blood/donations/:id/screening`**
```json
{ "screeningStatus": "PASSED" }
```
`PASSED` releases in-date units to AVAILABLE; `FAILED` discards every unit from
that donation. Both effects are applied by `trg_blood_donations_after_update`.

**`POST /blood/requests/:id/allocate`**
```json
{
  "allocated": 2,
  "message": "Fully allocated: 2 units reserved",
  "request": { "status": "ALLOCATED", "unitsAllocated": 2, "allocations": [ … ] }
}
```
Ordering: exact blood group → same city as the requesting hospital →
first-expiring-first-out. A unit can never be allocated twice
(`trg_blood_allocations_before_insert`).

**`PATCH /blood/requests/:id/status`**

Legal transitions (`config/constants.js`):

```
PENDING   → MATCHING | MATCHED | ALLOCATED | REJECTED | CANCELLED | EXPIRED
MATCHING  → MATCHED | ALLOCATED | PENDING | REJECTED | CANCELLED | EXPIRED
MATCHED   → ALLOCATED | PENDING | REJECTED | CANCELLED | EXPIRED
ALLOCATED → FULFILLED | CANCELLED
FULFILLED | REJECTED | CANCELLED | EXPIRED → (terminal)
```

Illegal transitions return **409** naming the allowed next states.
`FULFILLED` walks reserved units RESERVED → ISSUED → TRANSFUSED;
`CANCELLED`/`REJECTED` return reserved units to AVAILABLE.

---

## 5. Organs — `/organs`

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/organs/donors/me` | DONOR | Own organ-donor registration and pledges |
| POST | `/organs/donors/me` | DONOR | Create/update consent and pledged organ types |
| GET | `/organs/availability` | any | Organ search — reads `v_available_organs` |
| GET | `/organs/:id` | any | One organ (clinical attributes only) |
| POST | `/organs` | ADMIN, TRANSPLANT_CENTER | List a recovered organ |
| PATCH | `/organs/:id/status` | ADMIN, TRANSPLANT_CENTER | Update medical / availability status |

`viable_until` is derived by `trg_available_organs_before_insert` from the organ
type's cold-ischemia window. Listing an organ for a donor who has not consented
returns **409**.

---

## 6. Organ requests — `/organ-requests`

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/organ-requests` | any | List, scoped by role |
| POST | `/organ-requests` | ADMIN, HOSPITAL, RECIPIENT, TRANSPLANT_CENTER | Raise a request |
| GET | `/organ-requests/:id` | any | Request with its scored matches |
| GET | `/organ-requests/:id/matches` | any | Matches with the score breakdown |
| POST | `/organ-requests/:id/match` | ADMIN, HOSPITAL, TRANSPLANT_CENTER | **Run the matching algorithm** |
| PATCH | `/organ-requests/:id/status` | ADMIN, HOSPITAL, TRANSPLANT_CENTER | Workflow transition |
| PATCH | `/organ-requests/matches/:id/status` | ADMIN, TRANSPLANT_CENTER, HOSPITAL | Decide on a match |

**`POST /organ-requests/:id/match`** runs `sp_find_organ_matches`:

```json
{
  "matchCount": 4,
  "algorithm": "Weighted score: blood 40%, urgency 25%, medical priority 20%, location 10%, age 5% (weights read from matching_config).",
  "disclaimer": "Simplified academic simulation; not a clinical allocation decision.",
  "request": { "status": "MATCH_FOUND", "matches": [ … ] }
}
```

Each match carries `compatibilityScore` plus the five sub-scores and a
human-readable `matchReason`. Blood-incompatible organs are excluded outright.

**Match decision transitions:**

```
PROPOSED  → ACCEPTED | REJECTED | CANCELLED
ACCEPTED  → ALLOCATED | REJECTED | CANCELLED
ALLOCATED → COMPLETED | CANCELLED
COMPLETED | REJECTED | CANCELLED → (terminal)
```

`ALLOCATED` re-reads the organ under `FOR UPDATE`, refuses if another centre took
it (**409**), marks it ALLOCATED and cancels every other PROPOSED match for that
organ. `COMPLETED` marks the organ TRANSPLANTED and closes the request.

**Organ request workflow:**

```
PENDING → MATCHING → MATCH_FOUND → ALLOCATED → TRANSPLANT_COMPLETED
                                 ↘ REJECTED | CANCELLED | EXPIRED
```

---

## 7. Directory and administration

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/users` | ADMIN | Paginated users (never includes `password_hash`) |
| GET | `/users/:id` | ADMIN | One user |
| PATCH | `/users/:id/status` | ADMIN | PENDING / ACTIVE / SUSPENDED / REJECTED |
| DELETE | `/users/:id` | ADMIN | Refused (409) if the user has donation history |
| GET | `/donors` | ADMIN, BLOOD_BANK, HOSPITAL | Donor directory (`v_donor_activity_summary`) |
| GET | `/recipients` | ADMIN, HOSPITAL, TRANSPLANT_CENTER | Patient directory |
| GET | `/hospitals` | any | Hospital list |
| GET | `/blood-banks` | any | Blood bank list with stock counts |
| GET | `/transplant-centers` | any | Centre list with organs held |
| PATCH | `/hospitals/:id/status` | ADMIN | Approve / suspend |
| PATCH | `/blood-banks/:id/status` | ADMIN | Approve / suspend |
| PATCH | `/transplant-centers/:id/status` | ADMIN | Approve / suspend |
| GET | `/audit-logs` | ADMIN | Filter by `action`, `entityName`, `source` |

Approving a user with `status=ACTIVE` also activates their linked institution row.

---

## 8. Notifications

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/notifications` | any | Own notifications (`?unread=true` to filter) |
| GET | `/notifications/unread-count` | any | Badge count — served from `idx_notif_user_read` |
| PATCH | `/notifications/read-all` | any | Mark all own as read |
| PATCH | `/notifications/:id/read` | any | Mark one as read (403 if it belongs to someone else) |

---

## 9. Analytics

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/analytics/public` | **public** | Landing-page statistics (aggregates only) |
| GET | `/analytics/overview` | any | Dashboard tiles + recent audit activity |
| GET | `/analytics/blood?months=6` | any | By group, by city, donations/month, requests/month, most requested, status breakdown, wastage |
| GET | `/analytics/organs` | any | Availability by type, requests by urgency, pledge stats |
| GET | `/analytics/hospitals` | ADMIN, HOSPITAL, TRANSPLANT_CENTER | `v_hospital_request_summary` |
| GET | `/analytics/top-donors?limit=10` | ADMIN, BLOOD_BANK | Ranked donors |

Every figure is computed by SQL aggregation in the database.

---

## 10. Worked example — a complete blood request

```bash
BASE=http://localhost:4000/api

# 1. Sign in as a hospital
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"hospital@bon.health","password":"Password@123"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')

# 2. Check what is available for an A+ patient needing red cells
curl -s "$BASE/blood/availability?recipientBloodGroupId=3&componentId=2" \
  -H "Authorization: Bearer $TOKEN"

# 3. Raise the request
ID=$(curl -s -X POST $BASE/blood/requests -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"bloodGroupId":3,"componentId":2,"unitsRequired":2,"urgency":"URGENT",
       "patientName":"Demo Patient","requiredBy":"2026-09-30"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["bloodRequestId"])')

# 4. Preview the units the allocator would take
curl -s "$BASE/blood/requests/$ID/match" -H "Authorization: Bearer $TOKEN"

# 5. Allocate (transactional)
curl -s -X POST "$BASE/blood/requests/$ID/allocate" -H "Authorization: Bearer $TOKEN"

# 6. Fulfil — walks units RESERVED → ISSUED → TRANSFUSED
curl -s -X PATCH "$BASE/blood/requests/$ID/status" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"FULFILLED"}'

# 7. An illegal transition is refused with 409
curl -s -X PATCH "$BASE/blood/requests/$ID/status" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"PENDING"}'
```
