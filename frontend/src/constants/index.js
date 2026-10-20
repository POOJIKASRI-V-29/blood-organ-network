export const ROLES = {
  ADMIN: 'ADMIN', DONOR: 'DONOR', RECIPIENT: 'RECIPIENT',
  HOSPITAL: 'HOSPITAL', BLOOD_BANK: 'BLOOD_BANK', TRANSPLANT_CENTER: 'TRANSPLANT_CENTER',
};

export const ROLE_LABELS = {
  ADMIN: 'Administrator', DONOR: 'Donor', RECIPIENT: 'Recipient',
  HOSPITAL: 'Hospital', BLOOD_BANK: 'Blood Bank', TRANSPLANT_CENTER: 'Transplant Centre',
};

/** Badge colour per status value, shared by every table in the app. */
export const STATUS_TONE = {
  ACTIVE: 'green', PENDING: 'amber', SUSPENDED: 'red', REJECTED: 'red',
  AVAILABLE: 'green', RESERVED: 'blue', ISSUED: 'violet', TRANSFUSED: 'slate',
  EXPIRED: 'red', DISCARDED: 'red', QUARANTINED: 'amber',
  MATCHING: 'blue', MATCHED: 'blue', ALLOCATED: 'violet', FULFILLED: 'green',
  CANCELLED: 'slate', MATCH_FOUND: 'blue', TRANSPLANT_COMPLETED: 'green',
  PROPOSED: 'blue', ACCEPTED: 'violet', COMPLETED: 'green',
  PASSED: 'green', FAILED: 'red',
  ELIGIBLE: 'green', TEMPORARILY_INELIGIBLE: 'amber', INELIGIBLE: 'red',
  CONSENTED: 'green', WITHDRAWN: 'slate', UNDER_EVALUATION: 'amber',
  VIABLE: 'green', NOT_VIABLE: 'red', CLEARED: 'green', NOT_CLEARED: 'red',
  LIVING: 'green', DECEASED: 'slate',
  ROUTINE: 'slate', URGENT: 'amber', CRITICAL: 'red',
  INFO: 'blue', SUCCESS: 'green', WARNING: 'amber',
};

export const URGENCIES = ['ROUTINE', 'URGENT', 'CRITICAL'];

export const MEDICAL_DISCLAIMER =
  'The matching and allocation mechanisms in this academic project are simplified simulations ' +
  'intended to demonstrate database and software engineering concepts and must not be used for ' +
  'real-world medical decision-making.';

/** Chart palette -- kept in one place so every chart reads as one system. */
export const CHART_COLORS = ['#cf2048', '#178385', '#6366f1', '#d97706', '#0ea5e9', '#7c3aed', '#059669', '#db2777'];
