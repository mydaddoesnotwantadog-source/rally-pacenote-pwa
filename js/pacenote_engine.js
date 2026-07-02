// pacenote_engine.js
function haversineDistance(coord1, coord2) {
    const R = 6371e3; 
    const phi1 = coord1.lat * Math.PI / 180;
    const phi2 = coord2.lat * Math.PI / 180;
    const deltaPhi = (coord2.lat - coord1.lat) * Math.PI / 180;
    const deltaLambda = (coord2.lon - coord1.lon) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateBearing(start, end) {
    const startLat = start.lat * Math.PI / 180;
    const startLon = start.lon * Math.PI / 180;
    const endLat = end.lat * Math.PI / 180;
    const endLon = end.lon * Math.PI / 180;

    const y = Math.sin(endLon - startLon) * Math.cos(endLat);
    const x = Math.cos(startLat) * Math.sin(endLat) -
              Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLon - startLon);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; 
}

function getPacenote(angle) {
    const absAngle = Math.abs(angle);
    const direction = angle < 0 ? "Left" : "Right";
    
    if (absAngle < 15) return null;
    if (absAngle < 30) return `${direction} 6`;
    if (absAngle < 50) return `${direction} 5`;
    if (absAngle < 70) return `${direction} 4`;
    if (absAngle < 85) return `${direction} 3`;
    if (absAngle < 110) return `Square ${direction}`;
    if (absAngle < 140) return `${direction} 2`;
    if (absAngle < 160) return `${direction} 1`;
    return `${direction} Hairpin`;
}

export function generatePacenotes(route) {
    const pacenotes = [];
    let currentDistance = 0;

    for (let i = 1; i < route.length - 1; i++) {
        const prev = route[i - 1];
        const curr = route[i];
        const next = route[i + 1];

        currentDistance += haversineDistance(prev, curr);
        const bearingIn = calculateBearing(prev, curr);
        const bearingOut = calculateBearing(curr, next);

        let turnAngle = bearingOut - bearingIn;
        if (turnAngle > 180) turnAngle -= 360;
        if (turnAngle < -180) turnAngle += 360;

        const note = getPacenote(turnAngle);
        if (note) {
            pacenotes.push({
                index: i,
                lat: curr.lat,
                lon: curr.lon,
                distanceBeforeTurn: Math.round(currentDistance),
                angle: Math.round(turnAngle),
                callout: note
            });
            currentDistance = 0;
        }
    }
    return pacenotes;
}
