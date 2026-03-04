// fetch-usgs-data.js
const mysql = require('mysql2/promise');
require('dotenv').config();

const BATCH_SIZE = 1000;

// Calculate date 5 years ago
const START_DATE = new Date();
START_DATE.setFullYear(START_DATE.getFullYear() - 5);

async function createConnection() {
  return await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
  });
}

async function createTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS earthquakes (
      id VARCHAR(50) PRIMARY KEY,
      time DATETIME NOT NULL,
      latitude DECIMAL(10, 6) NOT NULL,
      longitude DECIMAL(10, 6) NOT NULL,
      depth DECIMAL(10, 2) NOT NULL,
      magnitude DECIMAL(3, 1) NOT NULL,
      place VARCHAR(255),
      type VARCHAR(50),
      INDEX idx_time (time),
      INDEX idx_magnitude (magnitude),
      INDEX idx_depth (depth)
    )
  `);
}

async function fetchUSGSData(startTime, endTime) {
  // Format dates as YYYY-MM-DD
  const formattedStartTime = startTime.toISOString().split('T')[0];
  const formattedEndTime = endTime.toISOString().split('T')[0];
  
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${formattedStartTime}&endtime=${formattedEndTime}&minmagnitude=1`;
  
  try {
    console.log(`Fetching data from ${formattedStartTime} to ${formattedEndTime}...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.features;
  } catch (error) {
    console.error('Error fetching data:', error);
    throw error; // Re-throw to handle in calling function
  }
}

async function insertBatch(connection, earthquakes) {
  if (earthquakes.length === 0) return;

  const query = `
    INSERT IGNORE INTO earthquakes 
    (id, time, latitude, longitude, depth, magnitude, place, type) 
    VALUES ?
  `;

  const values = earthquakes.map(eq => [
    eq.id,
    new Date(eq.properties.time).toISOString().slice(0, 19).replace('T', ' '),
    eq.geometry.coordinates[1],
    eq.geometry.coordinates[0],
    eq.geometry.coordinates[2],
    eq.properties.mag,
    eq.properties.place,
    eq.properties.type
  ]);

  try {
    const [result] = await connection.query(query, [values]);
    console.log(`Inserted ${result.affectedRows} records`);
  } catch (error) {
    console.error('Error inserting batch:', error);
    throw error;
  }
}

async function main() {
  const connection = await createConnection();
  try {
    await createTable(connection);

    let totalRecords = 0;
    const currentDate = new Date();
    
    // Fetch data in 1-month chunks
    for (let date = new Date(START_DATE); date < currentDate; date.setMonth(date.getMonth() + 1)) {
      try {
        const endDate = new Date(date);
        endDate.setMonth(endDate.getMonth() + 1);
        if (endDate > currentDate) {
          endDate.setTime(currentDate.getTime());
        }
        
        const earthquakes = await fetchUSGSData(date, endDate);
        console.log(`Found ${earthquakes.length} earthquakes for ${date.toISOString().split('T')[0]}`);
        
        // Insert in batches
        for (let i = 0; i < earthquakes.length; i += BATCH_SIZE) {
          const batch = earthquakes.slice(i, i + BATCH_SIZE);
          await insertBatch(connection, batch);
          totalRecords += batch.length;
          console.log(`Progress: ${totalRecords} total records inserted`);
        }

        // Add a small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to process data for ${date.toISOString().split('T')[0]}:`, error);
        // Continue with next chunk despite error
        continue;
      }
    }

    console.log('Data import completed successfully!');
    
    // Log statistics
    const [[{ count }]] = await connection.query('SELECT COUNT(*) as count FROM earthquakes');
    const [[{ min_mag, max_mag }]] = await connection.query(
      'SELECT MIN(magnitude) as min_mag, MAX(magnitude) as max_mag FROM earthquakes'
    );
    console.log(`
      Import Statistics:
      - Total earthquakes: ${count}
      - Magnitude range: ${min_mag} to ${max_mag}
      - Date range: ${START_DATE.toISOString().split('T')[0]} to ${currentDate.toISOString().split('T')[0]}
    `);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.end();
  }
}

main().catch(console.error);