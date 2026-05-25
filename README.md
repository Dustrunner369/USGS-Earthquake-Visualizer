# USGS Earthquake Visualizer

An interactive web application that visualizes earthquake data from the USGS on a map. Users can filter earthquakes by time range, magnitude, and depth, draw polygon regions to isolate areas of interest, and save filter preferences when logged in.

## Tech Stack

- **Frontend:** HTML/CSS/JS, Mapbox GL JS, Turf.js
- **Backend:** Node.js, Express
- **Database:** PostgreSQL, MySQL
- **Auth:** Auth0
- **Hosting:** Render

## Getting Started

1. Install dependencies:
   ```sh
   npm install
   ```

2. Configure a `.env` file with your database, Auth0, and Mapbox credentials.

3. Load earthquake data into MySQL:
   ```sh
   mysql -u root -p earthquake_db < data.sql
   ```

4. Start the app:
   ```sh
   npm start
   ```
