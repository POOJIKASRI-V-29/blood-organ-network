/**
 * One response shape for the whole API, so the frontend never has to guess:
 *   success -> { success: true,  data, meta? }
 *   failure -> { success: false, error: { message, details? } }
 */
export function ok(res, data, meta) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(200).json(body);
}

export function created(res, data) {
  return res.status(201).json({ success: true, data });
}

export function noContent(res) {
  return res.status(204).send();
}

export function paginated(res, rows, { page, limit, total }) {
  return res.status(200).json({
    success: true,
    data: rows,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
}
