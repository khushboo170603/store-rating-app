const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Database initialization function
const initializeDatabase = async () => {
  try {
    // Create tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(60) NOT NULL CHECK (LENGTH(name) >= 20 AND LENGTH(name) <= 60),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        address VARCHAR(400) NOT NULL CHECK (LENGTH(address) <= 400),
        role VARCHAR(20) NOT NULL DEFAULT 'normal_user' CHECK (role IN ('system_admin', 'normal_user', 'store_owner')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        name VARCHAR(60) NOT NULL CHECK (LENGTH(name) >= 20 AND LENGTH(name) <= 60),
        email VARCHAR(255) UNIQUE NOT NULL,
        address VARCHAR(400) NOT NULL CHECK (LENGTH(address) <= 400),
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        average_rating DECIMAL(2,1) DEFAULT 0.0,
        total_ratings INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, store_id)
      )
    `);

    // Add comment column if it doesn't exist (for existing databases)
    await pool.query(`
      ALTER TABLE ratings 
      ADD COLUMN IF NOT EXISTS comment TEXT
    `);

    // Create indexes for better performance
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_stores_name ON stores(name)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_stores_owner ON stores(owner_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_ratings_user_store ON ratings(user_id, store_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_ratings_store ON ratings(store_id)');

    // Create trigger to update store average rating
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_store_rating()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE stores 
        SET 
          average_rating = (
            SELECT COALESCE(AVG(rating), 0) 
            FROM ratings 
            WHERE store_id = COALESCE(NEW.store_id, OLD.store_id)
          ),
          total_ratings = (
            SELECT COUNT(*) 
            FROM ratings 
            WHERE store_id = COALESCE(NEW.store_id, OLD.store_id)
          )
        WHERE id = COALESCE(NEW.store_id, OLD.store_id);
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS rating_update_trigger ON ratings;
      CREATE TRIGGER rating_update_trigger
        AFTER INSERT OR UPDATE OR DELETE ON ratings
        FOR EACH ROW
        EXECUTE FUNCTION update_store_rating();
    `);

    console.log('Database tables created successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

module.exports = {
  pool,
  initializeDatabase
};