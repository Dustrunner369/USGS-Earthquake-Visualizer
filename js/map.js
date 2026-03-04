

mapboxgl.accessToken = process.env.MAPBOX_KEY;

const map = new mapboxgl.Map({
   container: "map",
   style: "mapbox://styles/mapbox/streets-v12",
   center: [0, 20],
   zoom: 2,
});

map.addControl(new mapboxgl.NavigationControl());

let draw;

function updateAreaSelection(e) {
   const data = draw.getAll();
   if (data.features.length > 0) {
      const polygon = data.features[0];
      const bounds = turf.bbox(polygon);
      filters.bounds = {
         west: bounds[0],
         south: bounds[1],
         east: bounds[2],
         north: bounds[3],
      };
      console.log("Selected area bounds:", filters.bounds);
   } else {
      filters.bounds = null;
      console.log("No area selected");
   }
}
let earthquakeData = [];

// Add to the filters object at the top
let filters = {
   startTime: null,
   endTime: null,
   minMagnitude: null,
   maxMagnitude: null,
   minDepth: null,
   maxDepth: null,
   maxEarthquakes: 1000,
   bounds: null,
   clusterRadius: 50  // Add this line
};

// Setup UI elements
const startTimeInput = document.getElementById("start-time");
const endTimeInput = document.getElementById("end-time");
const minMagnitudeInput = document.getElementById("min-magnitude");
const maxMagnitudeInput = document.getElementById("max-magnitude");
const minDepthInput = document.getElementById("min-depth");
const maxDepthInput = document.getElementById("max-depth");
const maxEarthquakesInput = document.getElementById("max-earthquakes");
const applyFiltersButton = document.getElementById("apply-filters");
const loadingOverlay = document.querySelector(".loading-overlay");
const earthquakeCount = document.getElementById("earthquake-count");
const clusterRadiusInput = document.getElementById("cluster-radius");
const clusterRadiusValue = document.getElementById("cluster-radius-value");

const clusterRadiusDropdown = document.getElementById("cluster-radius");

clusterRadiusDropdown.addEventListener("change", (e) => {
   filters.clusterRadius = parseInt(e.target.value);
   updateFilters();
});

// Style the dropdown to look cool
clusterRadiusDropdown.style.cssText = `
   padding: 10px;
   font-size: 16px;
   background-color:rgba(53, 92, 130, 0.65);
   color: white;
   border: white;
   border-radius: 8px;
   box-shadow: 0 4px 8px rgba(40, 40, 40, 0.37);
   cursor: pointer;
   transition: all 0.3s ease-in-out;
`;

clusterRadiusDropdown.addEventListener("mouseover", () => {
   clusterRadiusDropdown.style.backgroundColor = "#2e5d7c";
});
clusterRadiusDropdown.addEventListener("mouseout", () => {
   clusterRadiusDropdown.style.backgroundColor = "#1e3d5c";
});

function getMagnitudeColor(magnitude) {
   const mag = parseFloat(magnitude) || 0;
   if (mag >= 7) return "#FF0000";
   if (mag >= 6) return "#FF4500";
   if (mag >= 5) return "#FFA500";
   if (mag >= 4) return "#FFD700";
   if (mag >= 3) return "#FFFF00";
   return "#90EE90";
}

function getMagnitudeRadius(magnitude) {
   return Math.max(4, Math.min(15, magnitude * 2));
}

function formatDate(dateStr) {
   const date = new Date(dateStr);
   return date.toLocaleString();
}

async function loadSQLData() {
   try {
      loadingOverlay.classList.add("active");
        console.log('Attempting to fetch data.sql...');
      const response = await fetch("data.sql");
      if (!response.ok) {
         throw new Error(`HTTP error! status: ${response.status}`);
      }
      const sqlContent = await response.text();
        console.log('SQL content received, length:', sqlContent.length);
      earthquakeData = parseSQLData(sqlContent);
      console.log(`Loaded ${earthquakeData.length} earthquakes from SQL file`);
      updateFilters();
   } catch (error) {
      console.error("Detailed error loading SQL file:", error);
      alert("Error loading earthquake data. Please try again later.");
   } finally {
      loadingOverlay.classList.remove("active");
   }
}

function parseSQLData(sqlContent) {
   const earthquakes = [];
   // Updated regex to handle MySQL dump format with possible line breaks and multiple values
   const regex = /INSERT INTO `earthquakes` VALUES\s*(\([^;]+\)(?:\s*,\s*\([^;]+\))*);/g;
   let matches;

   while ((matches = regex.exec(sqlContent)) !== null) {
      if (matches[1]) {
         // Split multiple value groups if present
         const valueGroups = matches[1].split("),(").map((group) => {
            // Clean up surrounding parentheses
            return group.replace(/^\(|\)$/g, "");
         });

         for (const valueGroup of valueGroups) {
            // Use regex to properly split values respecting quotes
            const values = valueGroup.split(/,(?=(?:(?:[^']*'){2})*[^']*$)/).map((val) => {
               val = val.trim();
               // Remove surrounding quotes if they exist
               if (val.startsWith("'") && val.endsWith("'")) {
                  val = val.slice(1, -1);
               }
               return val;
            });

            // Create earthquake object (matching your MySQL schema)
            const earthquake = {
               id: values[0],
               time: values[1],
               latitude: parseFloat(values[2]),
               longitude: parseFloat(values[3]),
               depth: parseFloat(values[4]),
               magnitude: parseFloat(values[5]),
               place: values[6] || "Unknown Location",
               type: values[7] || "earthquake",
            };

            // Validate the parsed data
            if (!isNaN(earthquake.latitude) && !isNaN(earthquake.longitude) && !isNaN(earthquake.magnitude) && earthquake.id) {
               earthquakes.push(earthquake);
            }
         }
      }
   }
   return earthquakes;
}

function createPopupContent(properties) {
   return `
        <div class="earthquake-popup">
            <h3>${properties.place || "Unknown Location"}</h3>
            <p><span class="magnitude">Magnitude: ${parseFloat(properties.magnitude).toFixed(1)}</span></p>
            <p>Depth: ${parseFloat(properties.depth).toFixed(2)} km</p>
            <p>Time: ${formatDate(properties.time)}</p>
            <p>Type: ${properties.type || "earthquake"}</p>
        </div>
    `;
}

function animateCounter(element, target) {
   const start = parseInt(element.textContent);
   const duration = 1000;
   const step = 30;
   const increment = (target - start) / (duration / step);

   let current = start;
   const timer = setInterval(() => {
      current += increment;
      if ((increment > 0 && current >= target) || (increment < 0 && current <= target)) {
         element.textContent = target;
         clearInterval(timer);
      } else {
         element.textContent = Math.round(current);
      }
   }, step);
}

function updateMap(filteredData) {
   // Remove existing layers and source in the correct order
   const layers = ["earthquake-circles", "clusters", "cluster-count"];
   layers.forEach((layer) => {
      if (map.getLayer(layer)) {
         map.removeLayer(layer);
      }
   });

   if (map.getSource("earthquakes")) {
      map.removeSource("earthquakes");
   }

   // Add the filtered data as a source
   // Modify the addSource part to include the dynamic cluster radius
   map.addSource("earthquakes", {
      type: "geojson",
      data: {
          type: "FeatureCollection",
          features: filteredData.map((eq) => ({
              type: "Feature",
              geometry: {
                  type: "Point",
                  coordinates: [eq.longitude, eq.latitude],
              },
              properties: {
                  ...eq,
                  magnitude: parseFloat(eq.magnitude),
                  depth: parseFloat(eq.depth),
              },
          })),
      },
      cluster: true,
      clusterMaxZoom: 4,
      clusterRadius: filters.clusterRadius, // Use the filter value here
  });

   // Add circles layer for earthquakes
   map.addLayer({
      id: "earthquake-circles",
      type: "circle",
      source: "earthquakes",
      filter: ["!", ["has", "point_count"]],
      paint: {
         "circle-color": ["match", ["floor", ["get", "magnitude"]], 7, "#FF0000", 6, "#FF4500", 5, "#FFA500", 4, "#FFD700", 3, "#FFFF00", "#90EE90"],
         "circle-radius": ["interpolate", ["linear"], ["get", "magnitude"], 0, 4, 8, 15],
         "circle-opacity": 0.8,
         "circle-stroke-width": 1,
         "circle-stroke-color": "#fff",
      },
   });

   // Add clustered circles
   map.addLayer({
      id: "clusters",
      type: "circle",
      source: "earthquakes",
      filter: ["has", "point_count"],
      paint: {
         "circle-color": ["step", ["get", "point_count"], "#51bbd6", 100, "#f1f075", 750, "#f28cb1"],
         "circle-radius": ["step", ["get", "point_count"], 20, 100, 30, 750, 40],
      },
   });

   // Add cluster count labels
   map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "earthquakes",
      filter: ["has", "point_count"],
      layout: {
         "text-field": "{point_count_abbreviated}",
         "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
         "text-size": 12,
      },
   });

   // Add popup on click
   map.on("click", "earthquake-circles", (e) => {
      const coordinates = e.features[0].geometry.coordinates.slice();
      const properties = e.features[0].properties;

      new mapboxgl.Popup().setLngLat(coordinates).setHTML(createPopupContent(properties)).addTo(map);
   });

   // Change cursor on hover
   map.on("mouseenter", "earthquake-circles", () => {
      map.getCanvas().style.cursor = "pointer";
   });
   map.on("mouseleave", "earthquake-circles", () => {
      map.getCanvas().style.cursor = "";
   });

   // Handle clicks on clusters
   map.on("click", "clusters", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
      const clusterId = features[0].properties.cluster_id;
      map.getSource("earthquakes").getClusterExpansionZoom(clusterId, (err, zoom) => {
         if (err) return;

         map.easeTo({
            center: features[0].geometry.coordinates,
            zoom: zoom,
         });
      });
   });
}

function fetchAndDisplayEarthquakes() {
   try {
      loadingOverlay.classList.add("active");

      // Filter the loaded data
      let filteredEarthquakes = earthquakeData.filter((eq) => {
         const eqTime = new Date(eq.time);
         if (filters.startTime && eqTime < new Date(filters.startTime)) return false;
         if (filters.endTime && eqTime > new Date(filters.endTime)) return false;
         if (filters.minMagnitude && eq.magnitude < filters.minMagnitude) return false;
         if (filters.maxMagnitude && eq.magnitude > filters.maxMagnitude) return false;
         if (filters.minDepth && eq.depth < filters.minDepth) return false;
         if (filters.maxDepth && eq.depth > filters.maxDepth) return false;

         // Bounds check for polygon tool(delete if not working)
         if (filters.bounds) {
            if (eq.longitude < filters.bounds.west || eq.longitude > filters.bounds.east || eq.latitude < filters.bounds.south || eq.latitude > filters.bounds.north) {
               return false;
            }
         }

         return true;
      });

      filteredEarthquakes = filteredEarthquakes.slice(0, filters.maxEarthquakes);

      updateMap(filteredEarthquakes);
      animateCounter(earthquakeCount, filteredEarthquakes.length);
   } catch (error) {
      console.error("Error displaying earthquakes:", error);
   } finally {
      loadingOverlay.classList.remove("active");
   }
}

function updateFilters() {
   filters = {
      startTime: startTimeInput.value || null,
      endTime: endTimeInput.value || null,
      minMagnitude: minMagnitudeInput.value ? parseFloat(minMagnitudeInput.value) : null,
      maxMagnitude: maxMagnitudeInput.value ? parseFloat(maxMagnitudeInput.value) : null,
      minDepth: minDepthInput.value ? parseFloat(minDepthInput.value) : null,
      maxDepth: maxDepthInput.value ? parseFloat(maxDepthInput.value) : null,
      maxEarthquakes: maxEarthquakesInput.value ? parseInt(maxEarthquakesInput.value) : 1000,
      bounds: filters.bounds,
      clusterRadius: parseInt(clusterRadiusDropdown.value)  // <---- Insert this line
   };

   fetchAndDisplayEarthquakes();
}

async function saveUserPreferences() {
    // Only save if user is authenticated
    if (!auth0Client || !(await auth0Client.isAuthenticated())) {
        console.log('User not authenticated, skipping preference save');
        return;
    }

    const token = await auth0Client.getTokenSilently();
    console.log("[DEBUG] Access Token save:", token);
    
    const preferences = {
        startTime: startTimeInput.value,
        endTime: endTimeInput.value,
        minMagnitude: parseFloat(minMagnitudeInput.value),
        maxMagnitude: parseFloat(maxMagnitudeInput.value),
        minDepth: parseFloat(minDepthInput.value),
        maxDepth: parseFloat(maxDepthInput.value),
        maxEarthquakes: parseInt(maxEarthquakesInput.value)
    };

    try {
        const response = await fetch('http://localhost:3000/api/preferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(preferences)
        });

        if (!response.ok) {
            throw new Error('Failed to save preferences');
        }

        console.log('Preferences saved successfully');
    } catch (error) {
        console.error('Error saving preferences:', error);
    }
}

async function loadUserPreferences() {
   if (!auth0Client || !(await auth0Client.isAuthenticated())) {
       console.log('[DEBUG] User not authenticated, skipping preference load');
       return;
   }

   const user = await auth0Client.getUser();
   console.log("[DEBUG] Authenticated User:", user);

   try {
       console.log('[DEBUG] Fetching user preferences...');
       const token = await auth0Client.getTokenSilently();
       console.log("[DEBUG] Access Token load:", token);

       const response = await fetch('http://localhost:3000/api/preferences', {
           headers: {
               'Authorization': `Bearer ${token}`
           }
       });

       if (!response.ok) {
           throw new Error('Failed to load preferences');
       }

       const preferences = await response.json();
       console.log('[DEBUG] Loaded preferences:', preferences);
   } catch (error) {
       console.error('[ERROR] Error loading preferences:', error);
   }
}


applyFiltersButton.addEventListener("click", updateFilters);

// Set default filter values
const endDate = new Date("2024-01-31");
const startDate = new Date("2019-01-31");

async function setDefaultFilters() {
   if (!auth0Client || !(await auth0Client.isAuthenticated())) {
       console.log('Setting default filters (user not authenticated)');
       startTimeInput.value = new Date('2019-01-31').toISOString().slice(0, 16);
       endTimeInput.value = new Date('2024-01-31').toISOString().slice(0, 16);
       minMagnitudeInput.value = "0";
       maxMagnitudeInput.value = "10";
       minDepthInput.value = "0";
       maxDepthInput.value = "1000";
       maxEarthquakesInput.value = "100000";
   }
}
setDefaultFilters();

/*const FourPointPolygon = {
   ...MapboxDraw.modes.draw_polygon,
   clickLimit: 4,
   onClick: function (state, e) {
      // Only add points if we're below the limit
      if (state.currentVertexPosition < this.clickLimit) {
         MapboxDraw.modes.draw_polygon.onClick.call(this, state, e);

         // If we've reached the limit, complete the polygon
         if (state.currentVertexPosition === this.clickLimit) {
            // Add the first point to close the polygon
            this.updateUIClasses({ mouse: "pointer" });
            state.line.addCoordinate(0, state.line.coordinates[0][0]);
            // Trigger the finish
            this.changeMode("simple_select", {
               featureIds: [state.polygon.id],
            });
            // Update the area selection and display
            updateAreaSelection();
            fetchAndDisplayEarthquakes();
         }
      }
   },
};*/
const FourPointPolygon = {
   ...MapboxDraw.modes.draw_polygon,
   clickLimit: 4,

   onClick: function (state, e) {
      // Only add points if we're below the limit
      if (state.currentVertexPosition < this.clickLimit) {
         // Call the parent's onClick to handle point addition
         MapboxDraw.modes.draw_polygon.onClick.call(this, state, e);

         // If we've reached the limit, complete the polygon
         if (state.currentVertexPosition === this.clickLimit) {
            this.changeMode("simple_select");
            updateAreaSelection();
         }
      }
   },

   onKeyUp: function (state, e) {
      if (e.keyCode === 13 && state.currentVertexPosition >= 3) {
         // Enter key and at least 3 points
         this.changeMode("simple_select");
         updateAreaSelection();
      }
   },
};

map.on("load", () => {
   loadSQLData();

   // Add drawing controls setup
   draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
         point: false,
         line_string: false,
         polygon: true,
         trash: true,
      },
      modes: {
         ...MapboxDraw.modes,
         draw_polygon: FourPointPolygon,
      },
   });

   map.addControl(draw);

   // Get button references
   const clearSelectionBtn = document.getElementById("clear-selection-btn");
   const polygonBtn = document.getElementById("polygon-btn");
   const zoomInBtn = document.getElementById("zoom-in-btn");
   const zoomOutBtn = document.getElementById("zoom-out");

   function setActiveButton(activeButton) {
      const buttons = [polygonBtn, clearSelectionBtn];
      buttons.forEach((button) => button.classList.remove("active-tool"));
      if (activeButton) {
         activeButton.classList.add("active-tool");
      }
   }

   // Add listener for when drawing is complete
   map.on("draw.create", () => {
      setActiveButton(null);
   });

   // Add button event listeners
   clearSelectionBtn.addEventListener("click", () => {
      draw.deleteAll();
      filters.bounds = null;
      setActiveButton(null);
   });

   polygonBtn.addEventListener("click", () => {
      draw.changeMode("draw_polygon");
      setActiveButton(polygonBtn);
   });

   zoomInBtn.addEventListener("click", () => map.zoomIn());
   zoomOutBtn.addEventListener("click", () => map.zoomOut());

   // Add drawing event listeners
   map.on("draw.create", updateAreaSelection);
   map.on("draw.delete", updateAreaSelection);
   map.on("draw.update", updateAreaSelection);
});
