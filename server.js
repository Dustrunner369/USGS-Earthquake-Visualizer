const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs').promises;
require('dotenv').config();

const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");

// PostgreSQL connection pool
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render's PostgreSQL
  }
});

// Track DB availability
let dbAvailable = false;

// Test database connection
pgPool.connect((err, client, release) => {
  if (err) {
    console.warn('PostgreSQL unavailable — preferences will be disabled:', err.message);
  } else {
    console.log('Successfully connected to PostgreSQL database');
    dbAvailable = true;
    release();
  }
});

const app = express();

// CORS Configuration
app.use(cors({
  origin: true,  // Allow all origins since we're using Auth0
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));

app.use(express.json());
app.use(express.static(__dirname));

// JWT Authentication Middleware
const jwtCheck = jwt({
    secret: jwksRsa.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
    }),
    audience: process.env.AUTH0_AUDIENCE,
    issuer: `https://${process.env.AUTH0_DOMAIN}/`,
    algorithms: ['RS256']
});

const mysql = require('mysql2/promise');

// Create a connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'earthquake_db',
    port: process.env.DB_PORT || '3306',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

//Initialize Database
const initializeDatabase = async () => {
  if (!dbAvailable) {
    console.warn('Skipping database initialization — PostgreSQL is unavailable');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id VARCHAR(255) PRIMARY KEY,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        min_magnitude FLOAT,
        max_magnitude FLOAT,
        min_depth FLOAT,
        max_depth FLOAT,
        max_earthquakes INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
};

// Unprotected routes
app.get('/config', (req, res) => {
  res.json({  
    mapboxKey: process.env.MAPBOX_KEY,
    auth0: {
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      appUrl: process.env.APP_URL
    }
  });
});

// Serve the SQL file for public access
app.get('/data.sql', async (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'data.sql'));
  } catch (error) {
    console.error('Error serving SQL file:', error);
    res.status(500).json({ error: 'Error serving data file' });
  }
});

// Protected Routes - User Preferences
app.get('/api/preferences', jwtCheck, async (req, res) => {
  if (!dbAvailable) {
    return res.json({});
  }
  const userId = req.auth.sub;

  try {
    const result = await pgPool.query(
      'SELECT * FROM user_preferences WHERE user_id = $1',
      [userId]
    );
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/preferences', jwtCheck, async (req, res) => {
  if (!dbAvailable) {
    return res.status(503).json({ error: 'Database unavailable — preferences cannot be saved at this time' });
  }
  const userId = req.auth.sub;
  const { startTime, endTime, minMagnitude, maxMagnitude, minDepth, maxDepth, maxEarthquakes } = req.body;

  try {
    const query = `
      INSERT INTO user_preferences
      (user_id, start_time, end_time, min_magnitude, max_magnitude, min_depth, max_depth, max_earthquakes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        min_magnitude = EXCLUDED.min_magnitude,
        max_magnitude = EXCLUDED.max_magnitude,
        min_depth = EXCLUDED.min_depth,
        max_depth = EXCLUDED.max_depth,
        max_earthquakes = EXCLUDED.max_earthquakes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pgPool.query(query, [
      userId,
      startTime,
      endTime,
      minMagnitude,
      maxMagnitude,
      minDepth,
      maxDepth,
      maxEarthquakes
    ]);

    console.log('[DEBUG] Preferences saved successfully:', result.rows[0]);
    res.json({ message: 'Preferences saved successfully', data: result.rows[0] });
  } catch (error) {
    console.error('[ERROR] Database error while saving preferences:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Generic Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.name === 'UnauthorizedError') {
    res.status(401).json({ error: 'Invalid token' });
  } else {
    res.status(500).json({ error: 'Something broke!' });
  }
});

// Catch-all route should be LAST
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initializeDatabase();
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  if (dbAvailable) {
    await pgPool.end();
    console.log('PostgreSQL pool has ended');
  }
  pool.end(() => {
    console.log('MySQL pool has ended');
    process.exit(0);
  });
});