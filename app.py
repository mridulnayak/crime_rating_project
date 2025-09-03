from flask import Flask, render_template, request, jsonify
import sqlite3
from geopy.distance import geodesic
import os

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "crime_data.db")

app = Flask(__name__, static_folder="static", template_folder="templates")

def rows_to_dicts(rows, cols):
  return [dict(zip(cols, r)) for r in rows]

def get_all_zones():
  with sqlite3.connect(DB_PATH) as conn:
    c = conn.cursor()
    c.execute("""SELECT locality, district, latitude, longitude,
                        crime_rate_per_100k, total_crimes, safety_level
                 FROM crime_data""")
    rows = c.fetchall()
  cols = ["locality","district","latitude","longitude",
          "crime_rate_per_100k","total_crimes","safety_level"]
  return rows_to_dicts(rows, cols)

def find_nearest(lat, lon, max_distance_km=1.0):
    zones = get_all_zones()
    best, best_dist = None, float("inf")
    for z in zones:
        try:
            d = geodesic((lat, lon), (float(z["latitude"]), float(z["longitude"]))).km
        except Exception:
            continue
        if d < best_dist:
            best, best_dist = z, d
    
    # Only return if within acceptable distance
    if best and best_dist <= max_distance_km:
        return best, best_dist
    return None, None


@app.route("/")
def index():
  return render_template("index.html")

@app.route("/zones")
def zones():
  try:
    return jsonify(get_all_zones())
  except Exception as e:
    return jsonify({"error": str(e)}), 500
  
@app.route("/crime-info")
def crime_info():
  lat = request.args.get("lat", type=float)
  lon = request.args.get("lon", type=float)
  if lat is None or lon is None:
    return jsonify({"error": "lat and lon required"}), 400

  try:
    nearest, dist_km = find_nearest(lat, lon)
    if not nearest:
      return jsonify({"error": "No data available"}), 404

    rating = float(nearest.get("crime_rate_per_100k", 0.0))

    # color thresholds (adjust for your dataset)
    if rating <= 200:
      bar_color = "green"
    elif rating <= 320:
      bar_color = "orange"
    else:
      bar_color = "red"

    # compute a relative bar out of 10 against DB max
    with sqlite3.connect(DB_PATH) as conn:
      c = conn.cursor()
      c.execute("SELECT MAX(crime_rate_per_100k) FROM crime_data")
      max_rating = c.fetchone()[0] or 500.0

    filled = int((rating / max_rating) * 10) if max_rating > 0 else 0
    filled = min(max(filled, 0), 10)
    bar = "█" * filled + "-" * (10 - filled)

    result = {
      "locality": nearest.get("locality"),
      "district": nearest.get("district"),
      "crime_rate_per_100k": rating,
      "total_crimes": int(nearest.get("total_crimes", 0)),
      "safety_level": nearest.get("safety_level"),
      "distance_km": round(dist_km or 0.0, 3),
      "bar": bar,
      "bar_color": bar_color,
      "max_crime_rate": max_rating
    }
    return jsonify(result)
  except Exception as e:
    return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
  if not os.path.exists(DB_PATH):
    print("crime_data.db not found — run setup_db.py first.")
  app.run(host='0.0.0.0', port=5000, debug=True)

