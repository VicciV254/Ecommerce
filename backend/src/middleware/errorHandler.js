export const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  
  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with this unique field already exists' });
  }

  if (err.code === 'P2003') {
    return res.status(409).json({ error: 'The referenced record is unavailable or still in use' });
  }
  
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }
  
  // Validation errors
  if (err.name === 'ZodError') {
    const details = err.issues.map(({ path, message }) => ({ path: path.join('.'), message }));
    return res.status(400).json({ error: details.map((item) => `${item.path || 'Request'}: ${item.message}`).join('; '), details });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }
  
  // Default error
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  
  res.status(statusCode).json({ error: message, ...(err.statusCode && err.code && { code: err.code }) });
};

export const notFound = (req, res) => {
  res.status(404).json({ error: 'Route not found' });
};

/** Fixed answers for a body the parsers refuse, by status; the parser's own message can quote the body. */
const BODY_REFUSALS = new Map([
  [400, 'The request body could not be read. Send it as valid JSON.'],
  [413, 'The request body is too large.'],
  [415, "The request body's encoding is not supported."],
]);

/**
 * For the body parsers on the app (`app.js`), which run ahead of the API router and so before `errorHandler`: a body
 * they refuse gets a JSON answer instead of Express's HTML error page. Any other error passes on unchanged.
 */
export const requestBodyErrorHandler = (err, req, res, next) => {
  const message = typeof err.type === 'string' ? BODY_REFUSALS.get(err.status) : undefined;
  if (!message) return next(err);
  res.status(err.status).json({ error: message, code: 'REQUEST_BODY_INVALID' });
};
