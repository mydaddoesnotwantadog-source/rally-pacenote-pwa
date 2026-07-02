// execution_engine.js
let watchId = null;
let currentRoute = null;
let upcomingPacenotes = [];
let currentNoteIndex = 0;
let isMetric = true;
let previousDistance = Infinity;

let uiCallbacks = {};

// TTS Engine Setup
const synth = window.speechSynthesis;
let voices = [];
if (synth) {
    // Populate voices when they load
    synth.onvoiceschanged = () => { voices = synth.getVoices(); };
    voices = synth.getVoices();
}

export function setMetricState(state) {
    isMetric = state;
}

export function setUIHandlers(handlers) {
    uiCallbacks = handlers;
}

export function startDrive(routeData, pacenotesData) {
    currentRoute = routeData;
    upcomingPacenotes = pacenotesData;
    currentNoteIndex = 0;
    previousDistance = Infinity;

    if (uiCallbacks.onNextUpdate && upcomingPacenotes[0]) {
        uiCallbacks.onNextUpdate(upcomingPacenotes[0].callout);
    }

    if ('geolocation' in navigator) {
        watchId = navigator.geolocation.watchPosition(
            handleLocationUpdate,
            handleLocationError,
            { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );
    }
}

export function stopDrive() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

function handleLocationUpdate(position) {
    const coords = position.coords;
    const speedMs = coords.speed || 0;
    
    // 1 m/s = 3.6 km/h, 1 m/s = 2.23694 mph
    const speedFormatted = isMetric ? Math.round(speedMs * 3.6) : Math.round(speedMs * 2.23694);

    if (uiCallbacks.onSpeedUpdate) uiCallbacks.onSpeedUpdate(speedFormatted);

    if (currentNoteIndex >= upcomingPacenotes.length) {
        if (uiCallbacks.onCalloutTrigger) uiCallbacks.onCalloutTrigger('FINISH');
        stopDrive();
        return;
    }

    const nextNote = upcomingPacenotes[currentNoteIndex];
    
    const distanceToTurn = Math.round(calculateDistance(
        coords.latitude, coords.longitude,
        nextNote.lat, nextNote.lon
    ));

    let distValue, distUnit;
    if (isMetric) {
        if (distanceToTurn >= 1000) {
            distValue = (distanceToTurn / 1000).toFixed(2);
            distUnit = "KILOMETERS TO";
        } else {
            distValue = distanceToTurn;
            distUnit = "METERS TO";
        }
    } else {
        const distanceInYards = distanceToTurn * 1.09361;
        const distanceInMiles = distanceToTurn * 0.000621371;
        
        if (distanceInMiles >= 1) {
            distValue = distanceInMiles.toFixed(2);
            distUnit = "MILES TO";
        } else {
            distValue = Math.round(distanceInYards);
            distUnit = "YARDS TO";
        }
    }
    
    if (uiCallbacks.onDistanceUpdate) uiCallbacks.onDistanceUpdate(distValue, distUnit);

    // Dynamic trigger distance based on speed (min 80 meters to prevent missing tight apexes)
    const triggerDistance = Math.max(80, speedMs * 4);

    // Detect if we physically passed the turn (distance started increasing after getting close)
    const passedTurn = (distanceToTurn > previousDistance + 15) && (previousDistance < 150);

    if (distanceToTurn <= triggerDistance || passedTurn) {
        if (!passedTurn) {
            // Trigger audio warning before the turn
            if (uiCallbacks.onCalloutTrigger) uiCallbacks.onCalloutTrigger(nextNote.callout);
            playAudioCallout(nextNote.callout);
        } else {
            console.warn(`[Engine] Missed trigger radius for ${nextNote.callout}. Auto-advancing.`);
        }
        
        currentNoteIndex++;
        previousDistance = Infinity; // Reset for the next pacenote
        
        if (uiCallbacks.onNextUpdate && upcomingPacenotes[currentNoteIndex]) {
            uiCallbacks.onNextUpdate(upcomingPacenotes[currentNoteIndex].callout);
        } else if (uiCallbacks.onNextUpdate) {
            uiCallbacks.onNextUpdate('Finish Line');
        }
    } else {
        // Track the closest we've gotten to the current target
        if (distanceToTurn < previousDistance) {
            previousDistance = distanceToTurn;
        }
    }
}

function handleLocationError(error) {
    console.warn(`[Engine] Geolocation error: ${error.message}`);
}

export function playAudioCallout(calloutText) {
    if (!synth) return;

    // Use Web Speech API for the "Basic TTS" pack
    const utterance = new SpeechSynthesisUtterance(calloutText);
    
    // Tuning for urgent rally pace
    utterance.rate = 1.35; 
    utterance.pitch = 1.0;
    
    // Attempt to find a high-quality English voice, preferring concise synthetic ones
    if (voices.length > 0) {
        const preferredVoice = voices.find(v => v.lang.startsWith('en-') && (v.name.includes('Google') || v.name.includes('Siri'))) || voices.find(v => v.lang.startsWith('en-'));
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
    }
    
    // Play immediately
    synth.speak(utterance);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
