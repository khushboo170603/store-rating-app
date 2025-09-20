const express = require('express');
const { pool } = require('../config/database');
const { 
  authenticateToken, 
  requireNormalUser,
  requireAdmin 
} = require('../middleware/auth');
const { validateRating } = require('../middleware/validation');

const router = express.Router();

// @route   POST /api/ratings
// @desc    Submit a rating for a store
// @access  Private (Normal User)
router.post('/', authenticateToken, requireNormalUser, validateRating, async (req, res) => {
  try {
    const { storeId, rating, comment } = req.body;
    const userId = req.user.id;

    // Check if store exists
    const storeCheck = await pool.query('SELECT id FROM stores WHERE id = $1', [storeId]);
    if (storeCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    // Check if user has already rated this store
    const existingRating = await pool.query(
      'SELECT id FROM ratings WHERE user_id = $1 AND store_id = $2',
      [userId, storeId]
    );

    if (existingRating.rows.length > 0) {
      return res.status(400).json({ 
        message: 'You have already rated this store. Use PUT to update your rating.' 
      });
    }

    // Insert new rating
    const result = await pool.query(
      `INSERT INTO ratings (user_id, store_id, rating, comment) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, user_id, store_id, rating, comment, created_at`,
      [userId, storeId, rating, comment]
    );

    const newRating = result.rows[0];

    res.status(201).json({
      message: 'Rating submitted successfully',
      rating: newRating
    });
  } catch (error) {
    console.error('Submit rating error:', error);
    res.status(500).json({ message: 'Server error submitting rating' });
  }
});

// @route   PUT /api/ratings/:storeId
// @desc    Update user's rating for a store
// @access  Private (Normal User)
router.put('/:storeId', authenticateToken, requireNormalUser, validateRating, async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const { rating, comment } = req.body;
    const userId = req.user.id;

    // Check if store exists
    const storeCheck = await pool.query('SELECT id FROM stores WHERE id = $1', [storeId]);
    if (storeCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    // Check if user has rated this store
    const existingRating = await pool.query(
      'SELECT id FROM ratings WHERE user_id = $1 AND store_id = $2',
      [userId, storeId]
    );

    if (existingRating.rows.length === 0) {
      return res.status(404).json({ 
        message: 'You have not rated this store yet. Use POST to submit a new rating.' 
      });
    }

    // Update rating
    const result = await pool.query(
      `UPDATE ratings 
       SET rating = $1, comment = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $3 AND store_id = $4
       RETURNING id, user_id, store_id, rating, comment, created_at, updated_at`,
      [rating, comment, userId, storeId]
    );

    const updatedRating = result.rows[0];

    res.json({
      message: 'Rating updated successfully',
      rating: updatedRating
    });
  } catch (error) {
    console.error('Update rating error:', error);
    res.status(500).json({ message: 'Server error updating rating' });
  }
});

// @route   GET /api/ratings/user/:userId
// @desc    Get all ratings by a user (Admin only)
// @access  Private (Admin)
router.get('/user/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    const { page = 1, limit = 10, sortBy = 'created_at', sortOrder = 'desc' } = req.query;

    const offset = (page - 1) * limit;
    const validSortFields = ['rating', 'created_at', 'store_name'];
    const validSortOrders = ['asc', 'desc'];

    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const order = validSortOrders.includes(sortOrder.toLowerCase()) ? sortOrder.toUpperCase() : 'DESC';

    // Check if user exists
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const query = `
      SELECT r.id, r.rating, r.created_at, r.updated_at,
             s.name as store_name, s.id as store_id
      FROM ratings r
      JOIN stores s ON r.store_id = s.id
      WHERE r.user_id = $1
      ORDER BY ${sortField === 'store_name' ? 's.name' : 'r.' + sortField} ${order}
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [userId, limit, offset]);

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM ratings WHERE user_id = $1',
      [userId]
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
    console.error('Get user ratings error:', error);
    res.status(500).json({ message: 'Server error fetching user ratings' });
  }
});

// @route   GET /api/ratings/my-ratings
// @desc    Get current user's ratings
// @access  Private (Normal User)
router.get('/my-ratings', authenticateToken, requireNormalUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, sortBy = 'created_at', sortOrder = 'desc' } = req.query;

    const offset = (page - 1) * limit;
    const validSortFields = ['rating', 'created_at', 'store_name'];
    const validSortOrders = ['asc', 'desc'];

    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const order = validSortOrders.includes(sortOrder.toLowerCase()) ? sortOrder.toUpperCase() : 'DESC';

    const query = `
      SELECT r.id, r.rating, r.comment, r.created_at, r.updated_at,
             s.name as store_name, s.id as store_id, s.address as store_address,
             s.average_rating as store_average_rating
      FROM ratings r
      JOIN stores s ON r.store_id = s.id
      WHERE r.user_id = $1
      ORDER BY ${sortField === 'store_name' ? 's.name' : 'r.' + sortField} ${order}
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [userId, limit, offset]);

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM ratings WHERE user_id = $1',
      [userId]
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
    console.error('Get my ratings error:', error);
    res.status(500).json({ message: 'Server error fetching your ratings' });
  }
});

// @route   DELETE /api/ratings/:storeId
// @desc    Delete user's rating for a store
// @access  Private (Normal User)
router.delete('/:storeId', authenticateToken, requireNormalUser, async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const userId = req.user.id;

    // Check if rating exists
    const ratingCheck = await pool.query(
      'SELECT id FROM ratings WHERE user_id = $1 AND store_id = $2',
      [userId, storeId]
    );

    if (ratingCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Rating not found' });
    }

    // Delete rating
    await pool.query(
      'DELETE FROM ratings WHERE user_id = $1 AND store_id = $2',
      [userId, storeId]
    );

    res.json({ message: 'Rating deleted successfully' });
  } catch (error) {
    console.error('Delete rating error:', error);
    res.status(500).json({ message: 'Server error deleting rating' });
  }
});

// @route   GET /api/ratings/store/:storeId
// @desc    Get all ratings for a specific store
// @access  Private
router.get('/store/:storeId', authenticateToken, async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const { page = 1, limit = 10, sortBy = 'created_at', sortOrder = 'desc' } = req.query;

    const offset = (page - 1) * limit;
    const validSortFields = ['rating', 'created_at', 'user_name'];
    const validSortOrders = ['asc', 'desc'];

    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const order = validSortOrders.includes(sortOrder.toLowerCase()) ? sortOrder.toUpperCase() : 'DESC';

    // Check if store exists
    const storeCheck = await pool.query('SELECT id FROM stores WHERE id = $1', [storeId]);
    if (storeCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Store not found' });
    }

    const query = `
      SELECT r.id, r.rating, r.created_at, r.updated_at,
             u.name as user_name
      FROM ratings r
      JOIN users u ON r.user_id = u.id
      WHERE r.store_id = $1
      ORDER BY ${sortField === 'user_name' ? 'u.name' : 'r.' + sortField} ${order}
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [storeId, limit, offset]);

    // Get total count and average rating
    const statsResult = await pool.query(`
      SELECT COUNT(*) as total_ratings, 
             COALESCE(AVG(rating), 0) as average_rating
      FROM ratings 
      WHERE store_id = $1
    `, [storeId]);
    
    const stats = statsResult.rows[0];
    const totalRatings = parseInt(stats.total_ratings);
    const totalPages = Math.ceil(totalRatings / limit);

    res.json({
      ratings: result.rows,
      stats: {
        totalRatings,
        averageRating: parseFloat(stats.average_rating).toFixed(1)
      },
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

// @route   GET /api/ratings/stats
// @desc    Get rating statistics (Admin only)
// @access  Private (Admin)
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_ratings,
        AVG(rating) as overall_average_rating,
        COUNT(DISTINCT store_id) as stores_with_ratings,
        COUNT(DISTINCT user_id) as users_who_rated,
        (
          SELECT COUNT(*) 
          FROM (
            SELECT rating, COUNT(*) as count 
            FROM ratings 
            GROUP BY rating 
            ORDER BY count DESC 
            LIMIT 1
          ) most_common
        ) as most_common_rating_count
    `);

    // Get rating distribution
    const distributionResult = await pool.query(`
      SELECT rating, COUNT(*) as count
      FROM ratings
      GROUP BY rating
      ORDER BY rating
    `);

    res.json({
      stats: {
        ...stats.rows[0],
        overall_average_rating: parseFloat(stats.rows[0].overall_average_rating || 0).toFixed(1)
      },
      distribution: distributionResult.rows
    });
  } catch (error) {
    console.error('Get rating stats error:', error);
    res.status(500).json({ message: 'Server error fetching rating statistics' });
  }
});

module.exports = router;