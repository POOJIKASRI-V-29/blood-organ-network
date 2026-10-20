import { PAGINATION } from '../config/constants.js';

/**
 * Parse ?page & ?limit into safe integers.
 *
 * LIMIT/OFFSET cannot be bound as prepared-statement parameters in MySQL, so
 * these values are coerced to bounded integers here and interpolated only after
 * that coercion.  Nothing user-supplied reaches the SQL string by any other route.
 */
export function getPagination(queryParams) {
  const page = Math.max(1, Number.parseInt(queryParams.page, 10) || 1);
  const requested = Number.parseInt(queryParams.limit, 10) || PAGINATION.defaultLimit;
  const limit = Math.min(PAGINATION.maxLimit, Math.max(1, requested));
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Turn a caller-supplied sort key into a safe ORDER BY fragment by looking it
 * up in an allow-list.  An unknown key falls back to the default -- the raw
 * string is never placed into SQL.
 */
export function getSort(queryParams, allowedColumns, defaultColumn, defaultDir = 'DESC') {
  const requested = String(queryParams.sortBy ?? '');
  const column = Object.prototype.hasOwnProperty.call(allowedColumns, requested)
    ? allowedColumns[requested]
    : defaultColumn;

  const requestedDir = String(queryParams.sortDir ?? '').toLowerCase();
  const direction = requestedDir === 'asc' ? 'ASC'
    : requestedDir === 'desc' ? 'DESC'
    : defaultDir;

  // The return value already includes the direction -- callers must NOT append
  // another one.
  return `${column} ${direction}`;
}
