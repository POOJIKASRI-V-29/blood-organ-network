import ApiError from '../utils/ApiError.js';
import { isProduction } from '../config/env.js';

/** Translate MySQL driver errors into meaningful HTTP responses. */
function translateDatabaseError(error) {
  switch (error.code) {
    case 'ER_DUP_ENTRY':
      return new ApiError(409, 'That value is already registered and must be unique.');
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return new ApiError(400, 'A referenced record does not exist (foreign key constraint).');
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return new ApiError(409, 'This record is still referenced by other records and cannot be removed.');
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return new ApiError(400, 'A value violates a database CHECK constraint.');
    case 'ER_BAD_NULL_ERROR':
      return new ApiError(400, 'A required field was left empty.');
    case 'ER_SIGNAL_EXCEPTION':
      // Raised by our own triggers/procedures via SIGNAL SQLSTATE '45000'.
      return new ApiError(409, error.sqlMessage ?? 'The database rejected this operation.');
    case 'ER_LOCK_WAIT_TIMEOUT':
      return new ApiError(409, 'The record is locked by another operation. Please retry.');
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
      return new ApiError(503, 'The database is unavailable.');
    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export default function errorHandler(error, req, res, _next) {
  // A CORS rejection is a configuration mismatch, not a server fault -- say so
  // plainly instead of letting it fall through as a generic 500.
  if (error?.isCorsRejection) {
    return res.status(403).json({
      success: false,
      error: {
        message: error.message,
        details: [{
          field: 'CORS_ORIGIN',
          message: 'Add this origin to CORS_ORIGIN in backend/.env (comma-separated), then restart the API.',
        }],
      },
    });
  }

  let apiError = error instanceof ApiError ? error : translateDatabaseError(error);

  if (!apiError) {
    console.error('[unhandled]', error);
    apiError = ApiError.internal();
  }

  if (apiError.statusCode >= 500 && !isProduction) {
    console.error('[error]', error);
  }

  const body = {
    success: false,
    error: {
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
    },
  };

  // Stack traces are never sent to clients; they go to the server log only.
  if (!isProduction && apiError.statusCode >= 500) {
    body.error.stack = error.stack;
  }

  res.status(apiError.statusCode).json(body);
}
