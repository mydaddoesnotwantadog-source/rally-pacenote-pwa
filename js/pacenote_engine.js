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

function getSeverity(angle) {
    const absAngle = Math.abs(angle);
    if (absAngle < 15) return null;
    if (absAngle < 30) return 6;
    if (absAngle < 50) return 5;
    if (absAngle < 70) return 4;
    if (absAngle < 85) return 3;
    if (absAngle < 110) return 'Square';
    if (absAngle < 140) return 2;
    if (absAngle < 160) return 1;
    return 'Hairpin';
}

const severityRank = {
    6: 1, 5: 2, 4: 3, 3: 4, 'Square': 5, 2: 6, 1: 7, 'Hairpin': 8
};

export function generatePacenotes(route) {
    const pacenotes = [];
    const rawNodes = [];
    
    // Pass 1: Raw angle and distance generation
    for (let i = 1; i < route.length - 1; i++) {
        const prev = route[i - 1];
        const curr = route[i];
        const next = route[i + 1];

        const dist = haversineDistance(prev, curr);
        const bearingIn = calculateBearing(prev, curr);
        const bearingOut = calculateBearing(curr, next);

        let turnAngle = bearingOut - bearingIn;
        if (turnAngle > 180) turnAngle -= 360;
        if (turnAngle < -180) turnAngle += 360;

        rawNodes.push({
            index: i,
            lat: curr.lat,
            lon: curr.lon,
            distance: dist, // distance from prev to curr
            angle: turnAngle,
            direction: Math.abs(turnAngle) < 15 ? 'Straight' : (turnAngle < 0 ? 'Left' : 'Right')
        });
    }

    // Pass 2: Curve Clustering
    const clusters = [];
    let currentCluster = null;

    for (let i = 0; i < rawNodes.length; i++) {
        const node = rawNodes[i];
        
        if (node.direction === 'Straight') {
            if (currentCluster) {
                clusters.push(currentCluster);
                currentCluster = null;
            }
            continue;
        }

        if (!currentCluster) {
            currentCluster = {
                direction: node.direction,
                nodes: [node],
                totalAngle: node.angle,
                totalDistance: 0
            };
        } else {
            // If same direction and nodes are densely packed (< 40m apart)
            if (node.direction === currentCluster.direction && node.distance < 40) {
                currentCluster.nodes.push(node);
                currentCluster.totalAngle += node.angle;
                currentCluster.totalDistance += node.distance;
            } else {
                clusters.push(currentCluster);
                currentCluster = {
                    direction: node.direction,
                    nodes: [node],
                    totalAngle: node.angle,
                    totalDistance: 0
                };
            }
        }
    }
    if (currentCluster) clusters.push(currentCluster);

    // Pass 3 & 4: Evaluate and Construct
    let prevClusterEndIndex = 0;

    for (const cluster of clusters) {
        let distToStart = 0;
        for (let i = prevClusterEndIndex + 1; i <= cluster.nodes[0].index; i++) {
            distToStart += haversineDistance(route[i-1], route[i]);
        }

        let maxRank = 0;
        let startRank = 0;
        let endRank = 0;
        
        let startSeverity = null;
        let maxSeverity = null;
        let endSeverity = null;
        let hasDontCut = false;

        for (let i = 0; i < cluster.nodes.length; i++) {
            const node = cluster.nodes[i];
            const sev = getSeverity(node.angle);
            if (!sev) continue;
            
            const rank = severityRank[sev] || 0;
            
            if (startSeverity === null) { 
                startRank = rank; 
                startSeverity = sev; 
            }
            if (rank >= maxRank) { 
                maxRank = rank; 
                maxSeverity = sev; 
            }
            endRank = rank; 
            endSeverity = sev;

            if (rank >= 5 && node.distance < 25) {
                hasDontCut = true;
            }
        }

        if (maxRank === 0 || startSeverity === null) {
            prevClusterEndIndex = cluster.nodes[cluster.nodes.length - 1].index;
            continue;
        }

        // Base Callout uses ENTRY severity
        let calloutStr = `${cluster.direction} ${startSeverity}`;

        // Long / Short
        if (cluster.totalDistance > 80) calloutStr += ' Long';
        else if (cluster.totalDistance < 15 && maxRank >= 5) calloutStr += ' Short';

        // Tightens / Opens
        if (maxRank > startRank) {
            calloutStr += ` Tightens ${maxSeverity}`;
        } else if (endRank < maxRank && endRank < startRank - 1) { 
            calloutStr += ` Opens ${endSeverity}`;
        }

        // Hazards
        if (hasDontCut) calloutStr += " Don't Cut";

        pacenotes.push({
            index: cluster.nodes[0].index,
            lat: cluster.nodes[0].lat,
            lon: cluster.nodes[0].lon,
            distanceBeforeTurn: Math.round(distToStart),
            angle: cluster.totalAngle,
            callout: calloutStr
        });

        prevClusterEndIndex = cluster.nodes[cluster.nodes.length - 1].index;
    }
    return pacenotes;
}
