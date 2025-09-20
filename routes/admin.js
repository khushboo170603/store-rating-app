const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { 
  validateUserRegistration, 
  validateStoreCreation,
  validateUserUpdate 
} = require('../middleware/validation');

const router = express.Router();

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard statistics
// @access  Private (Admin)
router.get('/dashboard', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'NORMAL_USER') as normal_users,
        (SELECT COUNT(*) FROM users WHERE role = 'STORE_OWNER') as store_owners,
        (SELECT COUNT(*) FROM users WHERE role = 'SYSTEM_ADMIN') as admin_users,
        (SELECT COUNT(*) FROM stores) as total_stores,
        (SELECT COUNT(*) FROM ratings) as total_ratings,
        (SELECT COALESCE(AVG(rating), 0) FROM ratings) as average_rating,
        (SELECT COUNT(*) FROM stores WHERE total_ratings > 0) as stores_with_ratings
    `);

    // Get recent activities
    const recentUsers = await pool.query(`
      SELECT id, name, email, role, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 5
    `);

    const recentStores = await pool.query(`
      SELECT s.id, s.name, s.email, s.average_rating, s.total_ratings, s.created_at,
             u.name as owner_name
      FROM stores s
      LEFT JOIN users u ON s.owner_id = u.id
      ORDER BY s.created_at DESC
      LIMIT 5
    `);

    const recentRatings = await pool.query(`
      SELECT r.id, r.rating, r.created_at,
             u.name as user_name,
             s.name as store_name
      FROM ratings r
      JOIN users u ON r.user_id = u.id
      JOIN stores s ON r.store_id = s.id
      ORDER BY r.created_at DESC
      LIMIT 10
    `);

    res.json({
      stats: {
        ...stats.rows[0],
        average_rating: parseFloat(stats.rows[0].average_rating).toFixed(1)
      },
      recentActivities: {
        users: recentUsers.rows,
        stores: recentStores.rows,
        ratings: recentRatings.rows
      }
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ message: 'Server error fetching dashboard data' });
  }
});

// @route   POST /api/admin/users
// @desc    Create new user (Admin only)
// @access  Private (Admin)
router.post('/users', authenticateToken, requireAdmin, validateUserRegistration, async (req, res) => {
  try {
    const { name, email, password, address, role = 'NORMAL_USER' } = req.body;

    // Validate role
    const validRoles = ['SYSTEM_ADMIN', 'NORMAL_USER', 'STORE_OWNER'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role specified' });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (name, email, password, address, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, name, email, address, role, created_at`,
      [name, email, hashedPassword, address, role]
    );

    const user = result.rows[0];

    res.status(201).json({
      message: 'User created successfully',
      user
    });
  } catch (error) {
    console.error('Admin create user error:', error);
    res.status(500).json({ message: 'Server error creating user' });
  }
});

// @route   POST /api/admin/stores
// @desc    Create new store (Admin only)
// @access  Private (Admin)
router.post('/stores', authenticateToken, requireAdmin, validateStoreCreation, async (req, res) => {
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

    // Get owner details if exists
    let storeWithOwner = store;
    if (ownerId) {
      const ownerResult = await pool.query(
        'SELECT name as owner_name FROM users WHERE id = $1',
        [ownerId]
      );
      storeWithOwner = {
        ...store,
        owner_name: ownerResult.rows[0]?.owner_name || null
      };
    }

    res.status(201).json({
      message: 'Store created successfully',
      store: storeWithOwner
    });
  } catch (error) {
    console.error('Admin create store error:', error);
    res.status(500).json({ message: 'Server error creating store' });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users with advanced filtering (Admin only)
// @access  Private (Admin)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      sortBy = 'name', 
      sortOrder = 'asc',
      search = '',
      searchBy = 'name',
      role = '',
      dateFrom = '',
      dateTo = ''
    } = req.query;

    const offset = (page - 1) * limit;
    const validSortFields = ['name', 'email', 'address', 'role', 'created_at'];
    const validSortOrders = ['asc', 'desc'];
    const validSearchFields = ['name', 'email', 'address'];

    // Validate parameters
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    const order = validSortOrders.includes(sortOrder.toLowerCase()) ? sortOrder.toUpperCase() : 'ASC';
    const searchField = validSearchFields.includes(searchBy) ? searchBy : 'name';

    // Build query
    let query = `
      SELECT u.id, u.name, u.email, u.address, u.role, u.created_at,
             CASE 
               WHEN u.role = 'STORE_OWNER' THEN s.average_rating
               ELSE NULL 
             END as store_rating,
             CASE 
               WHEN u.role = 'STORE_OWNER' THEN s.name
               ELSE NULL 
             END as store_name
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

    // Add date filters
    if (dateFrom) {
      paramCount++;
      query += ` AND u.created_at >= $${paramCount}`;
      queryParams.push(dateFrom);
    }

    if (dateTo) {
      paramCount++;
      query += ` AND u.created_at <= $${paramCount}`;
      queryParams.push(dateTo + ' 23:59:59');
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

    const result = await pool.query(query, queryParams);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM users u WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (search) {
      countParamCount++;
      countQuery += ` AND LOWER(u.${searchField}) LIKE LOWER($${countParamCount})`;
      countParams.push(`%${search}%`);
    }

    if (role) {
      countParamCount++;
      countQuery += ` AND u.role = $${countParamCount}`;
      countParams.push(role);
    }

    if (dateFrom) {
      countParamCount++;
      countQuery += ` AND u.created_at >= $${countParamCount}`;
      countParams.push(dateFrom);
    }

    if (dateTo) {
      countParamCount++;
      countQuery += ` AND u.created_at <= $${countParamCount}`;
      countParams.push(dateTo + ' 23:59:59');
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
      },
      filters: {
        search,
        searchBy,
        role,
        dateFrom,
        dateTo,
        sortBy,
        sortOrder
      }
    });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
});

// @route   GET /api/admin/stores
// @desc    Get all stores with advanced filtering (Admin only)
// @access  Private (Admin)
router.get('/stores', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      sortBy = 'name', 
      sortOrder = 'asc',
      search = '',
      searchBy = 'name',
      minRating = '',
      maxRating = '',
      dateFrom = '',
      dateTo = ''
    } = req.query;

    const offset = (page - 1) * limit;
    const validSortFields = ['name', 'email', 'address', 'average_rating', 'total_ratings', 'created_at'];
    const validSortOrders = ['asc', 'desc'];
    const validSearchFields = ['name', 'email', 'address'];

    // Validate parameters
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
    const order = validSortOrders.includes(sortOrder.toLowerCase()) ? sortOrder.toUpperCase() : 'ASC';
    const searchField = validSearchFields.includes(searchBy) ? searchBy : 'name';

    // Build query
    let query = `
      SELECT s.id, s.name, s.email, s.address, s.average_rating, s.total_ratings, s.created_at,
             u.name as owner_name, u.id as owner_id, u.email as owner_email
      FROM stores s
      LEFT JOIN users u ON s.owner_id = u.id
      WHERE 1=1
    `;
    
    const queryParams = [];
    let paramCount = 0;

    // Add search filter
    if (search) {
      paramCount++;
      query += ` AND LOWER(s.${searchField}) LIKE LOWER($${paramCount})`;
      queryParams.push(`%${search}%`);
    }

    // Add rating filters
    if (minRating) {
      paramCount++;
      query += ` AND s.average_rating >= $${paramCount}`;
      queryParams.push(parseFloat(minRating));
    }

    if (maxRating) {
      paramCount++;
      query += ` AND s.average_rating <= $${paramCount}`;
      queryParams.push(parseFloat(maxRating));
    }

    // Add date filters
    if (dateFrom) {
      paramCount++;
      query += ` AND s.created_at >= $${paramCount}`;
      queryParams.push(dateFrom);
    }

    if (dateTo) {
      paramCount++;
      query += ` AND s.created_at <= $${paramCount}`;
      queryParams.push(dateTo + ' 23:59:59');
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

    // Transform the data to match frontend expectations
    const transformedStores = result.rows.map(store => ({
      id: store.id,
      name: store.name,
      email: store.email,
      address: store.address,
      average_rating: store.average_rating,
      total_ratings: store.total_ratings,
      created_at: store.created_at,
      owner: {
        id: store.owner_id,
        name: store.owner_name,
        email: store.owner_email
      }
    }));

    // Get total count with same filters
    let countQuery = 'SELECT COUNT(*) FROM stores s WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (search) {
      countParamCount++;
      countQuery += ` AND LOWER(s.${searchField}) LIKE LOWER($${countParamCount})`;
      countParams.push(`%${search}%`);
    }

    if (minRating) {
      countParamCount++;
      countQuery += ` AND s.average_rating >= $${countParamCount}`;
      countParams.push(parseFloat(minRating));
    }

    if (maxRating) {
      countParamCount++;
      countQuery += ` AND s.average_rating <= $${countParamCount}`;
      countParams.push(parseFloat(maxRating));
    }

    if (dateFrom) {
      countParamCount++;
      countQuery += ` AND s.created_at >= $${countParamCount}`;
      countParams.push(dateFrom);
    }

    if (dateTo) {
      countParamCount++;
      countQuery += ` AND s.created_at <= $${countParamCount}`;
      countParams.push(dateTo + ' 23:59:59');
    }

    const countResult = await pool.query(countQuery, countParams);
    const totalStores = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalStores / limit);

    res.json({
      stores: transformedStores,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalStores,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      filters: {
        search,
        searchBy,
        minRating,
        maxRating,
        dateFrom,
        dateTo,
        sortBy,
        sortOrder
      }
    });
  } catch (error) {
    console.error('Admin get stores error:', error);
    res.status(500).json({ message: 'Server error fetching stores' });
  }
});

// @route   GET /api/admin/store-owners
// @desc    Get available store owners for assignment
// @access  Private (Admin)
router.get('/store-owners', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.address
      FROM users u
      LEFT JOIN stores s ON u.id = s.owner_id
      WHERE u.role = 'STORE_OWNER' AND s.id IS NULL
      ORDER BY u.name
    `);

    res.json({ storeOwners: result.rows });
  } catch (error) {
    console.error('Get store owners error:', error);
    res.status(500).json({ message: 'Server error fetching store owners' });
  }
});

module.exports = router;