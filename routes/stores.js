const express = require('express');
const { pool } = require('../config/database');
const { 
  authenticateToken, 
  requireAdmin, 
  requireStoreOwner,
  requireAdminOrNormalUser,
  checkStoreOwnership 
} = require('../middleware/auth');
const { 
  validateStoreCreation, 
  validateStoreUpdate 
} = require('../middleware/validation');

const router = express.Router();

// @route   GET /api/stores
// @desc    Get all stores
// @access  Private
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      sortBy = 'name', 
      sortOrder = 'asc',
      search = '',
      searchBy = 'name'
    } = req.query;

    const offset = (page - 1) * limit;
    const validSortFields = ['name', 'email', 'address', 'average_rating', 'total_ratings', 'created_at'];
    const validSortOrders = ['asc', 'desc'];
    const validSearchFields = ['name', 'address'];

    // Validate parameters
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    const order = validSortOrders.includes(sortOrder.toLowerCase()) ? sortOrder.toUpperCase() : 'ASC';
    const searchField = validSearchFields.includes(searchBy) ? searchBy : 'name';

    // Build query based on user role
    let query = `
      SELECT s.id, s.name, s.email, s.address, s.average_rating, s.total_ratings, s.created_at,
             u.name as owner_name
    `;
    
    // Add user's rating if normal user
    if (req.user.role === 'NORMAL_USER') {
      query += `, r.rating as user_rating`;
    }
    
    query += `
      FROM stores s
      LEFT JOIN users u ON s.owner_id = u.id
    `;
    
    if (req.user.role === 'NORMAL_USER') {
      query += ` LEFT JOIN ratings r ON s.id = r.store_id AND r.user_id = $1`;
    }
    
    query += ` WHERE 1=1`;
    
    const queryParams = req.user.role === 'NORMAL_USER' ? [req.user.id] : [];
    let paramCount = queryParams.length;

    // Add search filter
    if (search) {
      paramCount++;
      query += ` AND LOWER(s.${searchField}) LIKE LOWER($${paramCount})`;
      queryParams.push(`%${search}%`);
    }

    // Filter by owner for store owners
    if (req.user.role === 'STORE_OWNER') {
      paramCount++;
      query += ` AND s.owner_id = $${paramCount}`;
      queryParams.push(req.user.id);
    }

    // Add sorting
    query += ` ORDER BY s.${sortField} ${order}`;

    // Add pagination
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    queryParams.push(limit);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    queryParams.push(offset);

    const result = await pool.query(query, queryParams);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM stores s WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (search) {
      countParamCount++;
      countQuery += ` AND LOWER(s.${searchField}) LIKE LOWER($${countParamCount})`;
      countParams.push(`%${search}%`);
    }

    if (req.user.role === 'STORE_OWNER') {
      countParamCount++;
      countQuery += ` AND s.owner_id = $${countParamCount}`;
      countParams.push(req.user.id);
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalStores = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalStores / limit);

    res.json({
      stores: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalStores,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get stores error:', error);
    res.status(500).json({ message: 'Server error fetching stores' });
  }
});

// @route   GET /api/stores/:id
// @desc    Get store by ID
// @access  Private
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const storeId = req.params.id;
    
    let query = `
      SELECT s.id, s.name, s.email, s.address, s.average_rating, s.total_ratings, s.created_at,
             u.name as owner_name, u.id as owner_id
    `;
    
    const queryParams = [storeId];
    
    // Add user's rating if normal user
    if (req.user.role === 'NORMAL_USER') {
      query += `, r.rating as user_rating`;
    }
    
    query += `
      FROM stores s
      LEFT JOIN users u ON s.owner_id = u.id
    `;
    
    if (req.user.role === 'NORMAL_USER') {
      query += ` LEFT JOIN ratings r ON s.id = r.store_id AND r.user_id = $2`;
      queryParams.push(req.user.id);
    }
    
    query += ` WHERE s.id = $1`;

    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    // Check if store owner is accessing their own store
    if (req.user.role === 'STORE_OWNER' && result.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ store: result.rows[0] });
  } catch (error) {
    console.error('Get store error:', error);
    res.status(500).json({ message: 'Server error fetching store' });
  }
});

// @route   POST /api/stores
// @desc    Create new store (Admin only)
// @access  Private (Admin)
router.post('/', authenticateToken, requireAdmin, validateStoreCreation, async (req, res) => {
  try {
    const { name, email, address, ownerId } = req.body;

    // Check if store email already exists
    const existingStore = await pool.query(
      'SELECT id FROM stores WHERE email = $1',
      [email]
    );

    if (existingStore.rows.length > 0) {
      return res.status(400).json({ message: 'Store already exists with this email' });
    }

    // If ownerId provided, verify the user exists and is a store owner
    if (ownerId) {
      const ownerCheck = await pool.query(
        'SELECT id, role FROM users WHERE id = $1',
        [ownerId]
      );

      if (ownerCheck.rows.length === 0) {
        return res.status(400).json({ message: 'Owner not found' });
      }

      if (ownerCheck.rows[0].role !== 'STORE_OWNER') {
        return res.status(400).json({ message: 'User must be a store owner' });
      }

      // Check if owner already has a store
      const existingOwnerStore = await pool.query(
        'SELECT id FROM stores WHERE owner_id = $1',
        [ownerId]
      );

      if (existingOwnerStore.rows.length > 0) {
        return res.status(400).json({ message: 'Store owner already has a store' });
      }
    }

    // Create store
    const result = await pool.query(
      `INSERT INTO stores (name, email, address, owner_id) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, name, email, address, owner_id, average_rating, total_ratings, created_at`,
      [name, email, address, ownerId || null]
    );

    const store = result.rows[0];

    res.status(201).json({
      message: 'Store created successfully',
      store
    });
  } catch (error) {
    console.error('Create store error:', error);
    res.status(500).json({ message: 'Server error creating store' });
  }
});

// @route   PUT /api/stores/:id
// @desc    Update store
// @access  Private (Admin or Store Owner)
router.put('/:id', authenticateToken, validateStoreUpdate, async (req, res) => {
  try {
    const storeId = req.params.id;
    const { name, email, address } = req.body;

    // Check if store exists
    const storeCheck = await pool.query(
      'SELECT id, owner_id FROM stores WHERE id = $1',
      [storeId]
    );
    
    if (storeCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    const store = storeCheck.rows[0];

    // Check permissions
    if (req.user.role === 'STORE_OWNER' && store.owner_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if email is already taken by another store
    if (email) {
      const emailCheck = await pool.query(
        'SELECT id FROM stores WHERE email = $1 AND id != $2',
        [email, storeId]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Email already exists' });
      }
    }

    // Build update query
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

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    paramCount++;
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(storeId);

    const query = `
      UPDATE stores 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING id, name, email, address, owner_id, average_rating, total_ratings, updated_at
    `;

    const result = await pool.query(query, values);
    
    res.json({
      message: 'Store updated successfully',
      store: result.rows[0]
    });
  } catch (error) {
    console.error('Update store error:', error);
    res.status(500).json({ message: 'Server error updating store' });
  }
});

// @route   DELETE /api/stores/:id
// @desc    Delete store (Admin only)
// @access  Private (Admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const storeId = req.params.id;

    // Check if store exists
    const storeCheck = await pool.query('SELECT id FROM stores WHERE id = $1', [storeId]);
    if (storeCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    // Delete store (cascade will handle ratings)
    await pool.query('DELETE FROM stores WHERE id = $1', [storeId]);

    res.json({ message: 'Store deleted successfully' });
  } catch (error) {
    console.error('Delete store error:', error);
    res.status(500).json({ message: 'Server error deleting store' });
  }
});

// @route   GET /api/stores/:id/ratings
// @desc    Get ratings for a store (Store Owner or Admin)
// @access  Private (Store Owner or Admin)
router.get('/:id/ratings', authenticateToken, checkStoreOwnership, async (req, res) => {
  try {
    const storeId = req.params.id;
    const { page = 1, limit = 10, sortBy = 'created_at', sortOrder = 'desc' } = req.query;

    const offset = (page - 1) * limit;
    const validSortFields = ['rating', 'created_at', 'user_name'];
    const validSortOrders = ['asc', 'desc'];

    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const order = validSortOrders.includes(sortOrder.toLowerCase()) ? sortOrder.toUpperCase() : 'DESC';

    const query = `
      SELECT r.id, r.rating, r.created_at, r.updated_at,
             u.name as user_name, u.email as user_email
      FROM ratings r
      JOIN users u ON r.user_id = u.id
      WHERE r.store_id = $1
      ORDER BY ${sortField === 'user_name' ? 'u.name' : 'r.' + sortField} ${order}
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [storeId, limit, offset]);

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM ratings WHERE store_id = $1',
      [storeId]
    );
    
    const totalRatings = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRatings / limit);

    res.json({
      ratings: result.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRatings,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get store ratings error:', error);
    res.status(500).json({ message: 'Server error fetching store ratings' });
  }
});

// @route   GET /api/stores/my-store
// @desc    Get store owner's store
// @access  Private (Store Owner)
router.get('/my-store', authenticateToken, requireStoreOwner, async (req, res) => {
  try {
    const query = `
      SELECT s.id, s.name, s.email, s.address, s.average_rating, s.total_ratings, s.created_at
      FROM stores s
      WHERE s.owner_id = $1
    `;

    const result = await pool.query(query, [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No store found for this owner' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get my store error:', error);
    res.status(500).json({ message: 'Server error fetching store' });
  }
});

// @route   GET /api/stores/my-store/ratings
// @desc    Get ratings for store owner's store
// @access  Private (Store Owner)
router.get('/my-store/ratings', authenticateToken, requireStoreOwner, async (req, res) => {
  try {
    const { page = 1, limit = 10, sort_by = 'created_at', sort_order = 'desc' } = req.query;

    // First get the store ID for this owner
    const storeResult = await pool.query(
      'SELECT id FROM stores WHERE owner_id = $1',
      [req.user.id]
    );

    if (storeResult.rows.length === 0) {
      return res.status(404).json({ message: 'No store found for this owner' });
    }

    const storeId = storeResult.rows[0].id;
    const offset = (page - 1) * limit;
    const validSortFields = ['rating', 'created_at', 'user_name', 'user_email'];
    const validSortOrders = ['asc', 'desc'];

    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const order = validSortOrders.includes(sort_order.toLowerCase()) ? sort_order.toUpperCase() : 'DESC';

    const query = `
      SELECT r.id, r.rating, r.created_at, r.updated_at,
             u.name as user_name, u.email as user_email
      FROM ratings r
      JOIN users u ON r.user_id = u.id
      WHERE r.store_id = $1
      ORDER BY ${sortField === 'user_name' || sortField === 'user_email' ? 'u.' + sortField.replace('user_', '') : 'r.' + sortField} ${order}
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [storeId, limit, offset]);

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM ratings WHERE store_id = $1',
      [storeId]
    );
    
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      ratings: result.rows,
      total,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        total,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get my store ratings error:', error);
    res.status(500).json({ message: 'Server error fetching store ratings' });
  }
});

module.exports = router;