/** Role names -- these mirror the users.role ENUM exactly. */
export const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  DONOR: 'DONOR',
  RECIPIENT: 'RECIPIENT',
  HOSPITAL: 'HOSPITAL',
  BLOOD_BANK: 'BLOOD_BANK',
  TRANSPLANT_CENTER: 'TRANSPLANT_CENTER',
});

export const ALL_ROLES = Object.values(ROLES);

/**
 * Legal blood-request state transitions.
 * The database enforces blood UNIT transitions (trg_blood_units_before_update);
 * request-level workflow is enforced here, in one place, so controllers never
 * invent their own rules.
 */
export const BLOOD_REQUEST_TRANSITIONS = Object.freeze({
  PENDING:   ['MATCHING', 'MATCHED', 'ALLOCATED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  MATCHING:  ['MATCHED', 'ALLOCATED', 'PENDING', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  MATCHED:   ['ALLOCATED', 'PENDING', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  ALLOCATED: ['FULFILLED', 'CANCELLED'],
  FULFILLED: [],
  REJECTED:  [],
  CANCELLED: [],
  EXPIRED:   [],
});

export const ORGAN_REQUEST_TRANSITIONS = Object.freeze({
  PENDING:              ['MATCHING', 'MATCH_FOUND', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  MATCHING:             ['MATCH_FOUND', 'PENDING', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  MATCH_FOUND:          ['ALLOCATED', 'MATCHING', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  ALLOCATED:            ['TRANSPLANT_COMPLETED', 'CANCELLED'],
  TRANSPLANT_COMPLETED: [],
  REJECTED:             [],
  CANCELLED:            [],
  EXPIRED:              [],
});

export const ORGAN_MATCH_TRANSITIONS = Object.freeze({
  PROPOSED:  ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED:  ['ALLOCATED', 'REJECTED', 'CANCELLED'],
  ALLOCATED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  REJECTED:  [],
  CANCELLED: [],
});

export function canTransition(map, from, to) {
  return Boolean(map[from]?.includes(to));
}

export const URGENCY_LEVELS = ['ROUTINE', 'URGENT', 'CRITICAL'];

export const PAGINATION = Object.freeze({ defaultLimit: 20, maxLimit: 100 });

export const MEDICAL_DISCLAIMER =
  'The matching and allocation mechanisms in this academic project are simplified ' +
  'simulations intended to demonstrate database and software engineering concepts ' +
  'and must not be used for real-world medical decision-making.';
