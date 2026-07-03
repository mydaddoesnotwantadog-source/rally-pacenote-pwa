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

let activeVoicePack = 'tts'; // default
let globalVolume = 1.0;
const samirPlayer = new Audio();
let audioCtx = null;
let gainNode = null;
let sourceNode = null;

let driveMap = null;
let lastHeading = 0;

export function setVolume(vol) {
    globalVolume = parseFloat(vol);
    if (gainNode) {
        gainNode.gain.value = globalVolume;
    }
}

export function setActiveVoicePack(packId) {
    activeVoicePack = packId;
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

    // Initialize Drive Map if needed
    if (!driveMap) {
        driveMap = L.map('drive-map', {
            zoomControl: false,
            dragging: false,
            touchZoom: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false
        }).setView([0, 0], 18);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CartoDB',
            maxZoom: 20
        }).addTo(driveMap);
    }
    
    // Clear previous layers
    driveMap.eachLayer((layer) => {
        if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
            driveMap.removeLayer(layer);
        }
    });

    // Draw route polyline
    const routeCoords = routeData.coordinates.map(c => [c.lat, c.lng]);
    L.polyline(routeCoords, {
        color: 'rgba(255, 255, 255, 0.4)',
        weight: 8,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(driveMap);

    // Draw pacenotes with severity color coding
    // 1-2=Green (Flat/Easy), 3-4=Yellow (Medium), 5-6=Red (Sharp), 7=Black (Hairpin)
    upcomingPacenotes.forEach(note => {
        let color = '#00FF00'; 
        if (note.severityRank === 3 || note.severityRank === 4) color = '#FFA500';
        else if (note.severityRank === 5 || note.severityRank === 6) color = '#FF0000';
        else if (note.severityRank >= 7) color = '#000000';

        L.circleMarker([note.lat, note.lon], {
            radius: 8,
            fillColor: color,
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(driveMap);
    });

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

    // Update Drive Map Camera
    if (driveMap) {
        driveMap.panTo([coords.latitude, coords.longitude], { animate: true, duration: 0.5 });
        
        let heading = coords.heading;
        if (heading === null || isNaN(heading)) {
            heading = lastHeading; // Keep last heading when stopped
        } else {
            lastHeading = heading;
        }
        
        const mapContainer = document.getElementById('drive-map');
        if (mapContainer) {
            // Rotate opposite to heading to keep forward=UP, translate down for trailing view
            mapContainer.style.transform = `rotate(${-heading}deg) translateY(15vh)`;
        }
    }

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

export async function playAudioCallout(calloutText) {
    if (activeVoicePack === 'samir') {
        await playSamirCallout(calloutText);
        return;
    }

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

const samirMap = {
    6: 'easy',
    5: 'fast',
    4: 'medium',
    3: 'k',
    2: 'k',
    1: '90',
    'Square': '90',
    'Hairpin': 'hairpin'
};

async function playSamirCallout(text) {
    // Parse the text, e.g. "Left 4 Long Tightens 2 Don't Cut"
    const words = text.split(' ');
    const audioQueue = [];

    let direction = null;
    let severity = null;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const lower = word.toLowerCase();

        if (lower === 'left' || lower === 'right') {
            direction = lower;
            // The next word should be the severity
            if (i + 1 < words.length) {
                severity = words[i + 1];
                let mapped = samirMap[severity];
                if (mapped) {
                    audioQueue.push(`audio/samir/${mapped}_${direction}1.ogg`);
                    i++; // skip severity word
                } else if (severity.toLowerCase() === 'hairpin') {
                    audioQueue.push(`audio/samir/hairpin_${direction}1.ogg`);
                    i++;
                } else {
                    // Fallback just in case
                }
            }
        } else if (lower === 'long') {
            audioQueue.push('audio/samir/long1.ogg');
        } else if (lower === 'tightens') {
            audioQueue.push('audio/samir/tightens1.ogg');
            // Check next for severity
            if (i + 1 < words.length) {
                const nextSev = words[i + 1];
                let mapped = samirMap[nextSev];
                if (mapped) {
                    // It tightens to a severity, just play the new severity corner?
                    // Samir audio just has "tightens1.ogg". If we want we can also play the new severity.
                    // For now, let's just say "Tightens" and optionally the new curve.
                    // "tightens 2" -> "tightens1.ogg" followed by "k_left1.ogg" if we still remember direction.
                    if (direction && mapped) {
                        audioQueue.push(`audio/samir/${mapped}_${direction}1.ogg`);
                    }
                    i++;
                }
            }
        } else if (lower === 'opens') {
            audioQueue.push('audio/samir/wideout1.ogg');
            if (i + 1 < words.length) {
                const nextSev = words[i + 1];
                let mapped = samirMap[nextSev];
                if (mapped && direction) {
                    audioQueue.push(`audio/samir/${mapped}_${direction}1.ogg`);
                    i++;
                }
            }
        } else if (lower === "don't" && words[i+1]?.toLowerCase() === 'cut') {
            audioQueue.push('audio/samir/dontcut1.ogg');
            i++;
        } else if (lower === 'finish' && words[i+1]?.toLowerCase() === 'line') {
            audioQueue.push('audio/samir/finish.ogg');
            i++;
        }
    }

    // Init Web Audio API dynamically on first play to satisfy browser auto-play policies
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = audioCtx.createGain();
        gainNode.gain.value = globalVolume;
        gainNode.connect(audioCtx.destination);
        
        sourceNode = audioCtx.createMediaElementSource(samirPlayer);
        sourceNode.connect(gainNode);
    }

    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    // Play queue sequentially
    for (const src of audioQueue) {
        await new Promise((resolve) => {
            samirPlayer.src = src;
            samirPlayer.onended = resolve;
            samirPlayer.onerror = resolve; // Skip missing files gracefully
            samirPlayer.play().catch(resolve);
        });
    }
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
