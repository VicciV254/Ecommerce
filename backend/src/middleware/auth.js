import { isCustomerToken, verifyToken } from '../config/auth.js';
import prisma from '../config/database.js';
import { userAccessError, userSessionSelect } from '../utils/account.js';

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    if (!isCustomerToken(decoded)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: userSessionSelect,
    });
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    const denied = userAccessError(user);
    if (denied) {
      return res.status(403).json(denied);
    }
    
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }
    
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    if (!isCustomerToken(decoded)) {
      req.user = null;
      return next();
    }
    
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: userSessionSelect,
    });
    
    req.user = user && !userAccessError(user) ? user : null;
    next();
  } catch (error) {
    next(error);
  }
};
