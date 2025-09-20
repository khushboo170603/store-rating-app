const express = require('express');
const { pool } = require('../config/database');
const { 
  authenticateToken, 
  requireAdmin, 
  requireAdminOrNormalUser 
} = require('../middleware/auth');
const { validateUserUpdate, validateSearch } = require('../middleware/validation');

const router = express.Router();

// @route   GET /api/users
// @desc    Get all users (Admin only)
// @access  Private (Admin)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      sortBy = 'name', 
      sortOrder = 'asc',
      search = '',
      searchBy = 'name',
      role = ''
    } = req.query;

    const offset = (page - 1) * limit;
    const validSortFields = ['name', 'email', 'address', 'role', 'created_at'];
    const validSortOrders = ['asc', 'desc'];
    const validSearchFields = ['name', 'email', 'address', 'role'];

    // Validate sort parameters
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    const order = validSortOrders.includes(sortOrder.toLowerCase()) ? sortOrder.toUpperCase() : 'ASC';
    const searchField = validSearchFields.includes(searchBy) ? searchBy : 'name';

    // Build query
    let query = `
      SELECT u.id, u.name, u.email, u.address, u.role, u.created_at,
             CASE 
               WHEN u.role = 'STORE_OWNER' THEN s.average_rating
               ELSE NULL 
             END as store_rating
      FROM users u
      LEFT JOIN stores s ON u.id = s.owner_id AND u.role = 'STORE_OWNER'
      WHERE 1=1
    `;
    
    const queryParams = [];
    let paramCount = 0;

    // Add search filter
    if (search) {
      paramCount++;
      query += ` AND LOWER(u.${searchField}) LIKE LOWER($${paramCount})`;
      queryParams.push(`%${search}%`);
    }

    // Add role filter
    if (role) {
      paramCount++;
      query += ` AND u.role = $${paramCount}`;
      queryParams.push(role);
    }

    // Add sorting
    query += ` ORDER BY u.${sortField} ${order}`;

    // Add pagination
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(limit);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    // Execute query
    const result = await pool.query(query, queryParams);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) FROM users WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (search) {
      countParamCount++;
      countQuery += ` AND LOWER(${searchField}) LIKE LOWER($${countParamCount})`;
      countParams.push(`%${search}%`);
    }

    if (role) {
      countParamCount++;
      countQuery += ` AND role = $${countParamCount}`;
      countParams.push(role);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalUsers = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalUsers / limit);

    res.json({
      users: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalUsers,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
});

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private (Admin or own profile)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Check if user is admin or accessing their own profile
    if (req.user.role !== 'SYSTEM_ADMIN' && req.user.id !== parseInt(userId)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.address, u.role, u.created_at,
             CASE 
               WHEN u.role = 'STORE_OWNER' THEN s.average_rating
               ELSE NULL 
             END as store_rating,
             CASE 
               WHEN u.role = 'STORE_OWNER' THEN s.id
               ELSE NULL 
             END as store_id
      FROM users u
      LEFT JOIN stores s ON u.id = s.owner_id AND u.role = 'STORE_OWNER'
      WHERE u.id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error fetching user' });
  }
});

// @route   PUT /api/users/:id
// @desc    Update user (Admin only)
// @access  Private (Admin)
router.put('/:id', authenticateToken, requireAdmin, validateUserUpdate, async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, address, role } = req.body;

    // Check if user exists
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if email is already taken by another user
    if (email) {
      const emailCheck = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Email already exists' });
      }
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 0;

    if (name) {
      paramCount++;
      updates.push(`name = $${paramCount}`);
      values.push(name);
    }
    if (email) {
      paramCount++;
      updates.push(`email = $${paramCount}`);
      values.push(email);
    }
    if (address) {
      paramCount++;
      updates.push(`address = $${paramCount}`);
      values.push(address);
    }
    if (role) {
      paramCount++;
      updates.push(`role = $${paramCount}`);
      values.push(role);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    paramCount++;
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    const query = `
      UPDATE users 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING id, name, email, address, role, updated_at
    `;

    const result = await pool.query(query, values);
    
    res.json({
      message: 'User updated successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error updating user' });
  }
});

// @route   DELETE /api/users/:id
// @desc    Delete user (Admin only)
// @access  Private (Admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Prevent admin from deleting themselves
    if (req.user.id === parseInt(userId)) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    // Check if user exists
    const userCheck = await pool.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete user (cascade will handle related records)
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error deleting user' });
  }
});

// @route   GET /api/users/stats/dashboard
// @desc    Get user statistics for dashboard (Admin only)
// @access  Private (Admin)
router.get('/stats/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'NORMAL_USER') as normal_users,
        (SELECT COUNT(*) FROM users WHERE role = 'STORE_OWNER') as store_owners,
        (SELECT COUNT(*) FROM users WHERE role = 'SYSTEM_ADMIN') as admin_users,
        (SELECT COUNT(*) FROM stores) as total_stores,
        (SELECT COUNT(*) FROM ratings) as total_ratings
    `);

    res.json({ stats: stats.rows[0] });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Server error fetching statistics' });
  }
});

module.exports = router;