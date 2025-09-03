// ------- Map + tiles -------
const map = L.map('map', { zoomControl: true }).setView([21.2375, 81.6400], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// ------- Utilities: loading + toasts -------
const overlay = document.getElementById('loading-overlay');
function showLoading(msg = 'Loading…') {
  overlay?.classList.add('show');
  const text = overlay?.querySelector('.loading-text');
  if (text) text.textContent = msg;
}
function hideLoading() {
  overlay?.classList.remove('show');
}

const toastContainer = document.getElementById('toast-container');
function showToast(message, type = 'info', timeout = 3500) {
  if (!toastContainer) return alert(message);
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 200);
  }, timeout);
}

// ------- Icons -------
const userIcon = L.icon({
  iconUrl: '/static/images/location-icon.png',
  iconSize: [35, 35],
  iconAnchor: [17, 34],
  popupAnchor: [0, -30]
});

function facilityEmoji(type) {
  switch (type) {
    case 'hospital': return '🏥';
    case 'police': return '👮';
    case 'fire_station': return '🚒';
    case 'atm': return '🏧';
    default: return '📍';
  }
}
function facilityColor(type) {
  switch (type) {
    case 'hospital': return '#ef5350';
    case 'police': return '#42a5f5';
    case 'fire_station': return '#ff7043';
    case 'atm': return '#ab47bc';
    default: return '#90a4ae';
  }
}
function createFacilityIcon(type) {
  const color = facilityColor(type);
  const emoji = facilityEmoji(type);
  return L.divIcon({
    className: 'facility-div-icon',
    html: `
      <div style="
        background:${color};
        color:#fff;
        width:32px;height:32px;
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        box-shadow: 0 6px 16px rgba(0,0,0,0.35);
        border:2px solid rgba(255,255,255,0.7);
        font-size:16px;">
        ${emoji}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18]
  });
}

// ------- Colors for zones -------
function colorForRating(rate) {
  if (rate <= 200) return 'green';
  if (rate <= 320) return 'yellow';
  return 'red';
}

// ------- Info Box -------
function renderInfoBox(d) {
  const box = document.getElementById('info-box');
  const content = document.getElementById('info-content');
  const color = d.bar_color || colorForRating(d.crime_rate_per_100k || 0);
  const max = Math.max(1, d.max_crime_rate || 500);
  const pct = Math.min(100, Math.max(0, (d.crime_rate_per_100k / max) * 100));

  content.innerHTML = `
    <h3>${d.locality || 'Unknown'}${d.district ? `, ${d.district}` : ''}</h3>
    <p><b>Crime Rate:</b> ${d.crime_rate_per_100k} per 100k</p>
    <p><b>Total Crimes:</b> ${d.total_crimes}</p>
    <p><b>Safety:</b> ${d.safety_level}</p>
    <div class="bar"><div class="bar-fill" style="width:${pct}%; background:${color}"></div></div>
    <p style="margin-top:6px; color:#8a8a8a">Nearest locality • ${d.distance_km ?? 'N/A'} km</p>
  `;
  box.hidden = false;
}
document.getElementById('info-close')?.addEventListener('click', () => {
  document.getElementById('info-box').hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const box = document.getElementById('info-box');
    if (!box.hidden) box.hidden = true;
  }
});

// ------- Live tracking -------
let liveMarker = null;
let accuracyCircle = null;
let zonesLayer = null;
let lastLocalityKey = null;
const ZONE_RADIUS = 1550; // meters

// fetch all zones once
let allZones = [];

async function fetchZones() {
  if (allZones.length > 0) return allZones;
  showLoading('Loading zones…');
  try {
    const r = await fetch('/zones');
    allZones = await r.json();
    return allZones;
  } catch (e) {
    console.error('Failed to fetch zones:', e);
    showToast('Failed to load zones.', 'error');
    return [];
  } finally {
    hideLoading();
  }
}

function getZoneForLocation(lat, lon, zones) {
  for (let z of zones) {
    const distance = map.distance([lat, lon], [z.latitude, z.longitude]);
    if (distance <= ZONE_RADIUS) return z;
  }
  return null;
}

async function fetchCrimeInfo(lat, lon) {
  const r = await fetch(`/crime-info?lat=${lat}&lon=${lon}`);
  if (!r.ok) throw new Error('crime-info failed');
  return r.json();
}

async function onLocation(lat, lon, accuracy) {
  const currentLoc = [lat, lon];

  if (!liveMarker) liveMarker = L.marker(currentLoc, { icon: userIcon }).addTo(map);
  else liveMarker.setLatLng(currentLoc);

  if (!accuracyCircle) {
    accuracyCircle = L.circle(currentLoc, {
      radius: accuracy || 25,
      color: '#136aec',
      fillColor: '#136aec',
      fillOpacity: 0.15
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(currentLoc).setRadius(accuracy || 25);
  }

  const zones = await fetchZones();
  const zone = getZoneForLocation(lat, lon, zones);

  if (zone) {
    const key = `${zone.locality}|${zone.district}`;
    if (key !== lastLocalityKey) {
      lastLocalityKey = key;
      renderInfoBox(zone);
      liveMarker.bindPopup(
        `<b>${zone.locality}, ${zone.district}</b><br>
         Crime Rate: ${zone.crime_rate_per_100k}<br>
         Total Crimes: ${zone.total_crimes}<br>
         Safety: ${zone.safety_level}`
      ).openPopup();
    }
  }
}

// ------- Start live tracking -------
function startTracking() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported on this device.', 'warn');
    return;
  }
  navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude, accuracy } = pos.coords;
      map.setView([latitude, longitude], Math.max(map.getZoom(), 15));
      onLocation(latitude, longitude, accuracy);
    },
    err => {
      console.warn('Location error:', err.message);
      showToast('Unable to access location. Using default view.', 'warn');
      map.setView([21.2514, 81.6296], 13);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

// ------- Draw zones -------
async function drawZones() {
  if (!window.__CRIME_MAP__?.showZones) return;
  try {
    const zones = await fetchZones();
    zonesLayer?.remove();
    zonesLayer = L.layerGroup().addTo(map);

    zones.forEach(z => {
      const rate = Number(z.crime_rate_per_100k || 0);
      const color = colorForRating(rate);

      const circle = L.circle([z.latitude, z.longitude], {
        radius: ZONE_RADIUS,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.25
      }).addTo(zonesLayer);

      circle.bindPopup(
        `<b>${z.locality}, ${z.district}</b><br>
         Crime Rate: ${rate} per 100k<br>
         Total Crimes: ${z.total_crimes}<br>
         Safety: ${z.safety_level}`
      );
    });
  } catch (e) {
    console.error('Failed to load zones:', e);
    showToast('Failed to draw zones.', 'error');
  }
}

// ===================================================
// 🚨 EXTRA FEATURES 🚨
// ===================================================

// Layer group for facility markers
let facilityLayer = L.layerGroup().addTo(map);

// Nearby Facilities (multiple types, always finds nearest)
async function loadNearbyFacilities(lat, lon, type = "hospital") {
  facilityLayer.clearLayers();

  // City bounding box (Raipur approx)
  const bbox = "21.15,81.60,21.30,81.65";

  const query = `
    [out:json][timeout:25];
    node[amenity=${type}](${bbox});
    out;`;
  const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);

  showLoading('Finding nearest ' + type.replace('_',' ') + '…');
  try {
    const r = await fetch(url);
    const data = await r.json();

    if (!data.elements || !data.elements.length) {
      showToast(`No ${type.replace('_',' ')} found in the city.`, 'warn');
      return;
    }

    // Find nearest
    let nearest = null;
    let minDist = Infinity;
    data.elements.forEach(fac => {
      const d = map.distance([lat, lon], [fac.lat, fac.lon]);
      if (d < minDist) {
        minDist = d;
        nearest = fac;
      }
    });

    const marker = L.marker([nearest.lat, nearest.lon], { icon: createFacilityIcon(type) });
    marker.bindPopup(
      `<b>${nearest.tags?.name || type.replace('_',' ').toUpperCase()}</b><br>${type.replace('_',' ')}<br>Distance: ${(minDist/1000).toFixed(2)} km`
    );
    facilityLayer.addLayer(marker);

    // Focus map gently
    map.flyTo([nearest.lat, nearest.lon], Math.max(15, map.getZoom()), { duration: 0.6 });

    showToast('Nearest ' + type.replace('_',' ') + ' located.', 'success');
  } catch (e) {
    console.error("Failed to load nearest facility:", e);
    showToast('Unable to load facilities right now.', 'error');
  } finally {
    hideLoading();
  }
}

// Called by HTML button/dropdown
function reloadFacilities() {
  if (!liveMarker) return showToast("User location not found yet!", 'warn');
  const type = document.getElementById("facility-type").value;
  const { lat, lng } = liveMarker.getLatLng();
  loadNearbyFacilities(lat, lng, type);
}

// Emergency Contact Button
const sosBtn = L.control({ position: "topright" });
sosBtn.onAdd = function () {
  const btn = L.DomUtil.create("button", "sos-btn");
  btn.innerHTML = "📞 SOS";
  btn.setAttribute('title', 'Call emergency services (100)');
  btn.onclick = () => window.location.href = "tel:100";
  return btn;
};
sosBtn.addTo(map);

// Live Traffic Layer
const trafficLayer = L.tileLayer(
  "https://{s}.tile.opentraffic.io/{z}/{x}/{y}.png",
  { attribution: "Traffic Data © OpenTraffic" }
);

const trafficToggle = L.control({ position: "topright" });
trafficToggle.onAdd = function () {
  const btn = L.DomUtil.create("button", "traffic-btn");
  btn.innerHTML = "🚦 Traffic";
  btn.setAttribute('title', 'Toggle live traffic');
  let active = false;
  btn.onclick = () => {
    if (active) {
      map.removeLayer(trafficLayer);
      active = false;
      btn.classList.remove('active');
    } else {
      trafficLayer.addTo(map);
      active = true;
      btn.classList.add('active');
    }
  };
  return btn;
};
trafficToggle.addTo(map);

// Weather Overlay
async function showWeather(lat, lon) {
  const API_KEY = "YOUR_OPENWEATHER_API_KEY";
  if (!API_KEY || API_KEY === "YOUR_OPENWEATHER_API_KEY") return; // Skip if not configured
  try {
    const r = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`);
    const data = await r.json();

    L.popup()
      .setLatLng([lat, lon])
      .setContent(`🌦 <b>${data.weather?.[0]?.main ?? 'Weather'}</b><br>🌡 ${Math.round(data.main?.temp)}°C`)
      .openOn(map);
  } catch(e) {
    console.error("Weather fetch failed:", e);
  }
}

//path finder feature

// ===================================================
// 🚗 Route Finder Feature
// ===================================================
let routingControl = null;

async function routeToDestination() {
  const input = document.getElementById("dest-input");
  if (!input) return showToast("Destination input missing in HTML!", "error");
  const place = input.value.trim();
  if (!place) return showToast("Enter a destination!", "warn");

  if (!liveMarker) {
    return showToast("User location not available yet!", "warn");
  }

  const { lat, lng } = liveMarker.getLatLng();

  showLoading("Finding route to " + place + "…");
  try {
    // Geocode destination with Nominatim
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.length) {
      showToast("No results found for: " + place, "error");
      return;
    }

    const dest = data[0];
    const destCoords = [parseFloat(dest.lat), parseFloat(dest.lon)];

    // Remove old route
    if (routingControl) {
      map.removeControl(routingControl);
    }

    // Add new route
    routingControl = L.Routing.control({
      waypoints: [
        L.latLng(lat, lng),
        L.latLng(destCoords[0], destCoords[1])
      ],
      lineOptions: {
        styles: [{ color: 'blue', weight: 5, opacity: 0.7 }]
      },
      routeWhileDragging: false,
      addWaypoints: false,
      showAlternatives: true,
      collapsible: true,
      geocoder: L.Control.Geocoder.nominatim()
    }).addTo(map);

    showToast("Route loaded successfully!", "success");
  } catch (err) {
    console.error("Routing error:", err);
    showToast("Failed to fetch route!", "error");
  } finally {
    hideLoading();
  }
}
// ===================================================
// Boot
// ===================================================
startTracking();
drawZones();

// Load default facilities & weather
navigator.geolocation.getCurrentPosition(pos => {
  const { latitude, longitude } = pos.coords;
  loadNearbyFacilities(latitude, longitude, "hospital");
  showWeather(latitude, longitude);
});
