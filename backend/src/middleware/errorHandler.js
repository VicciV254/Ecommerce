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
  
  res.status(statusCode).json({ error: message });
};

export const notFound = (req, res) => {
  res.status(404).json({ error: 'Route not found' });
};
