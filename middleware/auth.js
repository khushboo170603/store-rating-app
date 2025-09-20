const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// Verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user details from database
    const userResult = await pool.query(
      'SELECT id, name, email, role FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid token - user not found' });
    }

    req.user = userResult.rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    console.error('Auth middleware error:', error);
    return res.status(500).json({ message: 'Server error during authentication' });
  }
};

// Role-based authorization middleware
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Insufficient permissions.' 
      });
    }

    next();
  };
};

// Check if user is system admin
const requireAdmin = authorizeRoles('SYSTEM_ADMIN');

// Check if user is store owner
const requireStoreOwner = authorizeRoles('STORE_OWNER');

// Check if user is normal user
const requireNormalUser = authorizeRoles('NORMAL_USER');

// Check if user is admin or store owner
const requireAdminOrStoreOwner = authorizeRoles('SYSTEM_ADMIN', 'STORE_OWNER');

// Check if user is admin or normal user
const requireAdminOrNormalUser = authorizeRoles('SYSTEM_ADMIN', 'NORMAL_USER');

// Middleware to check if store owner is accessing their own store
const checkStoreOwnership = async (req, res, next) => {
  try {
    const storeId = req.params.storeId || req.body.storeId;
    
    if (!storeId) {
      return res.status(400).json({ message: 'Store ID required' });
    }

    // If user is admin, allow access
    if (req.user.role === 'SYSTEM_ADMIN') {
      return next();
    }

    // If user is store owner, check if they own the store
    if (req.user.role === 'STORE_OWNER') {
      const storeResult = await pool.query(
        'SELECT owner_id FROM stores WHERE id = $1',
        [storeId]
      );

      if (storeResult.rows.length === 0) {
        return res.status(404).json({ message: 'Store not found' });
      }

      if (storeResult.rows[0].owner_id !== req.user.id) {
        return res.status(403).json({ 
          message: 'Access denied. You can only access your own store.' 
        });
      }
    }

    next();
  } catch (error) {
    console.error('Store ownership check error:', error);
    return res.status(500).json({ message: 'Server error during authorization' });
  }
};

module.exports = {
  authenticateToken,
  authorizeRoles,
  requireAdmin,
  requireStoreOwner,
  requireNormalUser,
  requireAdminOrStoreOwner,
  requireAdminOrNormalUser,
  checkStoreOwnership
};