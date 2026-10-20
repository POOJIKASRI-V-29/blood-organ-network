import ApiError from '../utils/ApiError.js';

/**
 * Validate req.body / req.query / req.params against a zod schema and REPLACE
 * the original with the parsed result.  Downstream handlers therefore work with
 * typed, coerced, whitelisted data -- never raw client input.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }
    if (source === 'query') {
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }
    return next();
  };
}

export const validateBody   = (schema) => validate(schema, 'body');
export const validateQuery  = (schema) => validate(schema, 'query');
export const validateParams = (schema) => validate(schema, 'params');
