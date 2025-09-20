const bcrypt = require('bcryptjs');
const { pool, initializeDatabase } = require('../config/database');
require('dotenv').config();

const initDB = async () => {
  try {
    console.log('🚀 Starting database initialization...');
    
    // Initialize database tables
    await initializeDatabase();
    console.log('✅ Database tables created successfully');
    
    // Check if admin user already exists
    const adminCheck = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [process.env.ADMIN_EMAIL]
    );
    
    if (adminCheck.rows.length > 0) {
      console.log('ℹ️  Admin user already exists');
    } else {
      // Create default admin user
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, saltRounds);
      
      await pool.query(
        `INSERT INTO users (name, email, password, address, role) 
         VALUES ($1, $2, $3, $4, 'system_admin')`,
        [
          process.env.ADMIN_NAME,
          process.env.ADMIN_EMAIL,
          hashedPassword,
          'System Administrator Address - Default Location'
        ]
      );
      
      console.log('✅ Default admin user created successfully');
      console.log(`📧 Admin Email: ${process.env.ADMIN_EMAIL}`);
      console.log(`🔑 Admin Password: ${process.env.ADMIN_PASSWORD}`);
    }
    
    // Create sample data if needed
    await createSampleData();
    
    console.log('🎉 Database initialization completed successfully!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
};

const createSampleData = async () => {
  try {
    // Check if sample data already exists
    const userCount = await pool.query('SELECT COUNT(*) FROM users WHERE role != \'system_admin\'');
    
    if (parseInt(userCount.rows[0].count) > 0) {
      console.log('ℹ️  Sample data already exists');
      return;
    }
    
    console.log('📝 Creating sample data...');
    
    // Create sample store owners
    const storeOwners = [
      {
        name: 'John Smith - Store Owner One',
        email: 'storeowner1@example.com',
        password: 'StoreOwner@123',
        address: '123 Main Street, Downtown Business District, City Center, State 12345'
      },
      {
        name: 'Sarah Johnson - Store Owner Two',
        email: 'storeowner2@example.com',
        password: 'StoreOwner@456',
        address: '456 Oak Avenue, Shopping Mall Complex, Retail District, State 67890'
      }
    ];
    
    const saltRounds = 12;
    const createdOwners = [];
    
    for (const owner of storeOwners) {
      const hashedPassword = await bcrypt.hash(owner.password, saltRounds);
      const result = await pool.query(
        `INSERT INTO users (name, email, password, address, role) 
         VALUES ($1, $2, $3, $4, 'store_owner') RETURNING id`,
        [owner.name, owner.email, hashedPassword, owner.address]
      );
      createdOwners.push(result.rows[0].id);
    }
    
    // Create sample stores
    const stores = [
      {
        name: 'Premium Electronics Store - Best Tech Solutions',
        email: 'contact@premiumelectronics.com',
        address: '123 Main Street, Downtown Business District, Electronics Hub, State 12345',
        ownerId: createdOwners[0]
      },
      {
        name: 'Fashion Forward Boutique - Trendy Clothing Store',
        email: 'info@fashionforwardboutique.com',
        address: '456 Oak Avenue, Shopping Mall Complex, Fashion District, State 67890',
        ownerId: createdOwners[1]
      },
      {
        name: 'Gourmet Food Market - Fresh Organic Products',
        email: 'orders@gourmetfoodmarket.com',
        address: '789 Pine Road, Organic Market Square, Food District, State 11111',
        ownerId: null
      }
    ];
    
    const createdStores = [];
    for (const store of stores) {
      const result = await pool.query(
        `INSERT INTO stores (name, email, address, owner_id) 
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [store.name, store.email, store.address, store.ownerId]
      );
      createdStores.push(result.rows[0].id);
    }
    
    // Create sample normal users
    const normalUsers = [
      {
        name: 'Alice Cooper - Regular Customer One',
        email: 'alice.cooper@example.com',
        password: 'Customer@123',
        address: '321 Elm Street, Residential Area, Suburb District, State 22222'
      },
      {
        name: 'Bob Wilson - Regular Customer Two',
        email: 'bob.wilson@example.com',
        password: 'Customer@456',
        address: '654 Maple Drive, Family Neighborhood, Residential Zone, State 33333'
      },
      {
        name: 'Carol Davis - Regular Customer Three',
        email: 'carol.davis@example.com',
        password: 'Customer@789',
        address: '987 Cedar Lane, Apartment Complex, Urban Area, State 44444'
      }
    ];
    
    const createdUsers = [];
    for (const user of normalUsers) {
      const hashedPassword = await bcrypt.hash(user.password, saltRounds);
      const result = await pool.query(
        `INSERT INTO users (name, email, password, address, role) 
         VALUES ($1, $2, $3, $4, 'normal_user') RETURNING id`,
        [user.name, user.email, hashedPassword, user.address]
      );
      createdUsers.push(result.rows[0].id);
    }
    
    // Create sample ratings
    const ratings = [
      { userId: createdUsers[0], storeId: createdStores[0], rating: 5 },
      { userId: createdUsers[0], storeId: createdStores[1], rating: 4 },
      { userId: createdUsers[1], storeId: createdStores[0], rating: 4 },
      { userId: createdUsers[1], storeId: createdStores[2], rating: 5 },
      { userId: createdUsers[2], storeId: createdStores[1], rating: 3 },
      { userId: createdUsers[2], storeId: createdStores[2], rating: 4 }
    ];
    
    for (const rating of ratings) {
      await pool.query(
        'INSERT INTO ratings (user_id, store_id, rating) VALUES ($1, $2, $3)',
        [rating.userId, rating.storeId, rating.rating]
      );
    }
    
    console.log('✅ Sample data created successfully');
    console.log('\n📋 Sample Login Credentials:');
    console.log('\n👤 Store Owners:');
    console.log('   Email: storeowner1@example.com | Password: StoreOwner@123');
    console.log('   Email: storeowner2@example.com | Password: StoreOwner@456');
    console.log('\n👥 Normal Users:');
    console.log('   Email: alice.cooper@example.com | Password: Customer@123');
    console.log('   Email: bob.wilson@example.com | Password: Customer@456');
    console.log('   Email: carol.davis@example.com | Password: Customer@789');
    
  } catch (error) {
    console.error('❌ Error creating sample data:', error);
    throw error;
  }
};

// Run initialization if this file is executed directly
if (require.main === module) {
  initDB()
    .then(() => {
      console.log('\n🎯 Database setup complete! You can now start the server.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Database setup failed:', error);
      process.exit(1);
    });
}

module.exports = { initDB };