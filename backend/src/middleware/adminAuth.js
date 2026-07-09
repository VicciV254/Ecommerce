import { verifyToken } from '../config/auth.js';
import prisma from '../config/database.js';

export const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Get admin from database
    const admin = await prisma.admin.findUnique({
      where: { id: decoded.adminId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
      },
    });
    
    if (!admin) {
      return res.status(401).json({ error: 'Admin not found' });
    }
    
    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    next();
  };
};
