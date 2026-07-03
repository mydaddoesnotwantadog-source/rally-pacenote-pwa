// gps_engine.js

// Simple 2D Kinematic Kalman Filter for GPS
class GPSKalmanFilter {
    constructor() {
        this.initialized = false;
        this.lastTime = 0;
        
        // State: [lat, lon, v_lat, v_lon]
        // Velocity in degrees per second (very small numbers)
        this.state = [0, 0, 0, 0];
        
        // Covariance Matrix
        this.P = [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
        ];
        
        // Process Noise (how much we trust the model vs measurements)
        this.Q = 0.001; 
        
        // Measurement Noise (based on GPS accuracy)
        this.R = 0.01; 
    }

    reset() {
        this.initialized = false;
    }

    update(lat, lon, speed, heading, accuracy, timestamp) {
        if (!this.initialized) {
            this.state = [lat, lon, 0, 0];
            this.lastTime = timestamp;
            this.initialized = true;
            return { lat, lon };
        }

        const dt = (timestamp - this.lastTime) / 1000.0; // seconds
        if (dt <= 0) return { lat: this.state[0], lon: this.state[1] };
        this.lastTime = timestamp;

        // Predict Step
        this.state[0] += this.state[2] * dt;
        this.state[1] += this.state[3] * dt;

        this.P[0][0] += dt * dt * this.P[2][2] + this.Q;
        this.P[1][1] += dt * dt * this.P[3][3] + this.Q;
        this.P[2][2] += this.Q;
        this.P[3][3] += this.Q;

        // Measurement Step
        const headingRad = heading * Math.PI / 180;
        const vLat = (speed * Math.cos(headingRad)) / 111320;
        const vLon = (speed * Math.sin(headingRad)) / (111320 * Math.cos(lat * Math.PI / 180));

        // Adapt R based on GPS reported accuracy
        const dynamicR = this.R * (accuracy / 5.0); 

        const K_pos = this.P[0][0] / (this.P[0][0] + dynamicR);
        const K_vel = this.P[2][2] / (this.P[2][2] + dynamicR * 2);

        // Update State
        this.state[0] = this.state[0] + K_pos * (lat - this.state[0]);
        this.state[1] = this.state[1] + K_pos * (lon - this.state[1]);
        this.state[2] = this.state[2] + K_vel * (vLat - this.state[2]);
        this.state[3] = this.state[3] + K_vel * (vLon - this.state[3]);

        // Update Covariance
        this.P[0][0] = (1 - K_pos) * this.P[0][0];
        this.P[1][1] = (1 - K_pos) * this.P[1][1];
        this.P[2][2] = (1 - K_vel) * this.P[2][2];
        this.P[3][3] = (1 - K_vel) * this.P[3][3];

        return {
            lat: this.state[0],
            lon: this.state[1]
        };
    }

    updateAcceleration(accelForward, accelRight, heading, timestamp) {
        if (!this.initialized) return;
        const dt = (timestamp - this.lastTime) / 1000.0;
        if (dt <= 0 || dt > 1.0) return; // Ignore large gaps or zero time
        this.lastTime = timestamp;

        // Convert forward/right acceleration (m/s^2) to lat/lon acceleration using current heading
        const headingRad = heading * Math.PI / 180;
        
        // Very basic rotation matrix. Assuming forward is positive Y.
        const aY = accelForward;
        const aX = accelRight;

        const aLatMs = aY * Math.cos(headingRad) - aX * Math.sin(headingRad);
        const aLonMs = aY * Math.sin(headingRad) + aX * Math.cos(headingRad);

        // Convert m/s^2 to degrees/sec^2
        const aLat = aLatMs / 111320;
        const aLon = aLonMs / (111320 * Math.cos(this.state[0] * Math.PI / 180));

        // Predict Step with acceleration
        // state[0] = lat + v*dt + 0.5*a*dt^2
        this.state[0] += this.state[2] * dt + 0.5 * aLat * dt * dt;
        this.state[1] += this.state[3] * dt + 0.5 * aLon * dt * dt;
        
        // state[2] = v_lat + a_lat*dt
        this.state[2] += aLat * dt;
        this.state[3] += aLon * dt;

        // P = F*P*F^T + Q
        this.P[0][0] += dt * dt * this.P[2][2] + this.Q;
        this.P[1][1] += dt * dt * this.P[3][3] + this.Q;
        this.P[2][2] += this.Q;
        this.P[3][3] += this.Q;
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
    const x0 = pLon * Math.cos(pLat * Math.PI / 180);
    const y0 = pLat;
    
    const x1 = aLon * Math.cos(aLat * Math.PI / 180);
    const y1 = aLat;
    
    const x2 = bLon * Math.cos(bLat * Math.PI / 180);
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

    // 2. Soft Snap to Route
    const snapResult = snapToRoute(filtered.lat, filtered.lon, routeData);

    return {
        lat: snapResult.lat,
        lon: snapResult.lon,
        speed: rawSpeed, 
        heading: snapResult.status === 'SNAPPED' ? snapResult.heading : rawHeading,
        status: snapResult.status,
        rawLat: rawLat,
        rawLon: rawLon
    };
}

export function processAccelerationUpdate(accelForward, accelRight, heading, timestamp) {
    kf.updateAcceleration(accelForward, accelRight, heading, timestamp);
}
