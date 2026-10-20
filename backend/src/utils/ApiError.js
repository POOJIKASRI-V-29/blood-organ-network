/**
 * An error that carries an HTTP status code.  Anything thrown that is NOT an
 * ApiError is treated as an unexpected server fault and its details are hidden
 * from the client (see middleware/errorHandler.js).
 */
export default class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'Invalid request', details)   { return new ApiError(400, message, details); }
  static unauthorized(message = 'Authentication required')  { return new ApiError(401, message); }
  static forbidden(message = 'You do not have permission to perform this action') { return new ApiError(403, message); }
  static notFound(message = 'Resource not found')           { return new ApiError(404, message); }
  static conflict(message = 'Conflicts with the current state of the resource') { return new ApiError(409, message); }
  static unprocessable(message, details)                    { return new ApiError(422, message, details); }
  static internal(message = 'Internal server error')        { return new ApiError(500, message); }
}
