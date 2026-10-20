import ApiError from '../utils/ApiError.js';

export default function notFound(req, _res, next) {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}`));
}
