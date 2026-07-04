// gps_engine.js

// 2D Kinematic Kalman Filter for GPS (Cartesian space)
class GPSKalmanFilter {
    constructor() {
        this.initialized = false;
        this.lastTime = 0;
        this.originLat = 0;
        this.originLon = 0;
        this.cosLat = 1;
        
        // State: [x, y, vx, vy] in METERS and M/S
        this.state = [0, 0, 0, 0];
        
        this.P = [
            [10, 0, 0, 0],
            [0, 10, 0, 0],
            [0, 0, 10, 0],
            [0, 0, 0, 10]
        ];
        
        // Process noise variance for acceleration (m/s^2)
        this.varAccel = 2.0; 
    }

    reset() {
        this.initialized = false;
    }

    update(lat, lon, speed, heading, accuracy, timestamp) {
        if (!this.initialized) {
            this.originLat = lat;
            this.originLon = lon;
            this.cosLat = Math.cos(lat * Math.PI / 180);
            this.state = [0, 0, 0, 0];
            this.lastTime = timestamp;
            this.initialized = true;
            return { lat, lon };
        }

        const dt = (timestamp - this.lastTime) / 1000.0;
        if (dt <= 0) return this.getLatLng();
        this.lastTime = timestamp;

        // Convert current GPS to local meters
        const z_x = (lon - this.originLon) * 111320 * this.cosLat;
        const z_y = (lat - this.originLat) * 111320;

        // Process Noise Matrix Q (discrete white noise acceleration model)
        const dt2 = dt * dt;
        const dt3 = dt2 * dt;
        const dt4 = dt3 * dt;
        const varA = this.varAccel;
        
        const q11 = 0.25 * dt4 * varA;
        const q13 = 0.5 * dt3 * varA;
        const q33 = dt2 * varA;

        // Predict Step
        this.state[0] += this.state[2] * dt;
        this.state[1] += this.state[3] * dt;
        
        this.P[0][0] += dt2 * this.P[2][2] + 2 * dt * this.P[0][2] + q11;
        this.P[1][1] += dt2 * this.P[3][3] + 2 * dt * this.P[1][3] + q11;
        
        this.P[0][2] += dt * this.P[2][2] + q13;
        this.P[2][0] = this.P[0][2];
        this.P[1][3] += dt * this.P[3][3] + q13;
        this.P[3][1] = this.P[1][3];

        this.P[2][2] += q33;
        this.P[3][3] += q33;

        // Measurement Noise R
        const R_pos = Math.max((accuracy || 10), 2.0);
        const r_var = R_pos * R_pos;

        // Kalman Gain
        const S_x = this.P[0][0] + r_var;
        const S_y = this.P[1][1] + r_var;

        const K_x0 = this.P[0][0] / S_x;
        const K_x2 = this.P[2][0] / S_x;
        
        const K_y1 = this.P[1][1] / S_y;
        const K_y3 = this.P[3][1] / S_y;

        // Measurement Update
        const y_x = z_x - this.state[0];
        const y_y = z_y - this.state[1];

        this.state[0] += K_x0 * y_x;
        this.state[2] += K_x2 * y_x;
        
        this.state[1] += K_y1 * y_y;
        this.state[3] += K_y3 * y_y;

        // Covariance Update
        const P00 = this.P[0][0];
        const P02 = this.P[0][2];
        this.P[0][0] -= K_x0 * P00;
        this.P[0][2] -= K_x0 * P02;
        this.P[2][0] = this.P[0][2];
        this.P[2][2] -= K_x2 * P02;

        const P11 = this.P[1][1];
        const P13 = this.P[1][3];
        this.P[1][1] -= K_y1 * P11;
        this.P[1][3] -= K_y1 * P13;
        this.P[3][1] = this.P[1][3];
        this.P[3][3] -= K_y3 * P13;
        
        return this.getLatLng();
    }

    getLatLng() {
        return {
            lat: this.originLat + (this.state[1] / 111320),
            lon: this.originLon + (this.state[0] / (111320 * this.cosLat)),
            vx: this.state[2],
            vy: this.state[3]
        };
    }
}

// -----------------------------------------------------------------
// Geo-Math Helpers
// -----------------------------------------------------------------
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const dPhi = (lat2 - lat1) * Math.PI / 180;
    const dLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const lambda1 = lon1 * Math.PI / 180;
    const lambda2 = lon2 * Math.PI / 180;

    const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
              Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; 
}

// -----------------------------------------------------------------
// Soft Snapping Algorithm
// -----------------------------------------------------------------
function getClosestPointOnSegment(pLat, pLon, aLat, aLon, bLat, bLon) {
    // Project all points using the same reference latitude to avoid skew
    const cosLat = Math.cos(pLat * Math.PI / 180);
    
    const x0 = pLon * cosLat;
    const y0 = pLat;
    
    const x1 = aLon * cosLat;
    const y1 = aLat;
    
    const x2 = bLon * cosLat;
    const y2 = bLat;

    const dx = x2 - x1;
    const dy = y2 - y1;
    
    if (dx === 0 && dy === 0) return { lat: aLat, lon: aLon };

    const t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy);
    const tClamped = Math.max(0, Math.min(1, t));

    return {
        lat: aLat + tClamped * (bLat - aLat),
        lon: aLon + tClamped * (bLon - aLon)
    };
}

const MAX_SNAP_DISTANCE = 35; // meters

function snapToRoute(lat, lon, routeData) {
    if (!routeData || routeData.length < 2) return null;

    let closestPoint = null;
    let minDistance = Infinity;
    let segmentHeading = 0;

    for (let i = 0; i < routeData.length - 1; i++) {
        const A = routeData[i];
        const B = routeData[i + 1];

        const p = getClosestPointOnSegment(lat, lon, A.lat, A.lon, B.lat, B.lon);
        const dist = distanceMeters(lat, lon, p.lat, p.lon);

        if (dist < minDistance) {
            minDistance = dist;
            closestPoint = p;
            segmentHeading = calculateBearing(A.lat, A.lon, B.lat, B.lon);
        }
    }

    if (minDistance <= MAX_SNAP_DISTANCE && closestPoint) {
        return {
            lat: closestPoint.lat,
            lon: closestPoint.lon,
            heading: segmentHeading,
            status: 'SNAPPED',
            distanceOff: minDistance
        };
    }

    return {
        lat: lat,
        lon: lon,
        heading: null, // Use raw GPS heading
        status: 'RAW',
        distanceOff: minDistance
    };
}

// -----------------------------------------------------------------
// Engine Export
// -----------------------------------------------------------------
const kf = new GPSKalmanFilter();

export function resetGPSEngine() {
    kf.reset();
}

export function processGPSUpdate(position, routeData) {
    const coords = position.coords;
    const timestamp = position.timestamp || Date.now();
    
    const rawLat = coords.latitude;
    const rawLon = coords.longitude;
    const rawSpeed = coords.speed || 0;
    const rawHeading = coords.heading || 0;
    const accuracy = coords.accuracy || 10;

    // 1. Kalman Filter
    const filtered = kf.update(rawLat, rawLon, rawSpeed, rawHeading, accuracy, timestamp);
    
    // Calculate robust filtered speed in m/s
    const filteredSpeed = Math.sqrt(filtered.vx * filtered.vx + filtered.vy * filtered.vy);

    // 2. Soft Snap to Route
    const snapResult = snapToRoute(filtered.lat, filtered.lon, routeData);

    return {
        lat: snapResult.lat,
        lon: snapResult.lon,
        speed: filteredSpeed, // Replace raw OS speed with derived physics speed!
        heading: snapResult.status === 'SNAPPED' ? snapResult.heading : rawHeading,
        status: snapResult.status,
        rawLat: rawLat,
        rawLon: rawLon
    };
}
