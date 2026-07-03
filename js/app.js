import { initDB, saveRouteOffline } from './route_manager.js';
import { generatePacenotes } from './pacenote_engine.js';
import { startDrive, stopDrive, setUIHandlers, setMetricState, playAudioCallout, setVolume, setActiveVoicePack } from './execution_engine.js';

// --- UI ELEMENTS ---
document.addEventListener('DOMContentLoaded', () => {
    const pager = document.getElementById('vertical-pager');
    const setupContent = document.getElementById('setup-screen-content');
    if (pager && setupContent) {
        pager.scrollTop = setupContent.offsetTop;
    }

    // Audio Preview Logic
    const stopDriveBtn = document.getElementById('stop-drive-btn');
    if (stopDriveBtn) {
        stopDriveBtn.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate(50);
            stopDrive();
            driveScreen.classList.remove('active');
            setupFlow.classList.add('active');
        });
    }

    // Drive View Toggle
    const toggleText = document.getElementById('toggle-text');
    const toggleMap = document.getElementById('toggle-map');
    const textUI = document.getElementById('drive-text-ui');
    const mapWrapper = document.getElementById('drive-map-wrapper');

    if (toggleText && toggleMap) {
        toggleText.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate(10);
            toggleText.classList.add('active');
            toggleMap.classList.remove('active');
            textUI.classList.remove('hidden');
            mapWrapper.classList.add('hidden');
        });
        
        toggleMap.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate(10);
            toggleMap.classList.add('active');
            toggleText.classList.remove('active');
            mapWrapper.classList.remove('hidden');
            textUI.classList.add('hidden');
            
            // Re-trigger resize to ensure Leaflet renders correctly
            window.dispatchEvent(new Event('resize'));
            setTimeout(() => {
                import('./execution_engine.js').then(module => {
                    if (module.invalidateDriveMap) module.invalidateDriveMap();
                });
            }, 50);
        });
    }

    const previewBtns = document.querySelectorAll('.preview-btn');
    previewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate(20);
            playAudioCallout(btn.dataset.callout);
        });
    });

    // Volume Slider Logic
    const volSlider = document.getElementById('master-volume');
    const volDisplay = document.getElementById('vol-display');
    if (volSlider) {
        volSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value).toFixed(1);
            volDisplay.textContent = val + 'x';
            setVolume(val);
        });
    }

    // Audio Store Logic
    const voiceCards = document.querySelectorAll('.voice-pack-card:not(.locked)');
    voiceCards.forEach(card => {
        card.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate(10);
            
            // UI Toggle
            document.querySelectorAll('.voice-pack-card').forEach(c => {
                c.classList.remove('active');
                if (!c.classList.contains('locked')) {
                    c.querySelector('.vp-status').textContent = '[ INSTALLED ]';
                }
            });
            
            card.classList.add('active');
            card.querySelector('.vp-status').textContent = '[ ACTIVE ]';
            
            // State Update
            setActiveVoicePack(card.dataset.pack);
        });
    });
});

const setupFlow = document.getElementById('setup-flow');
const driveScreen = document.getElementById('drive-screen');
const uploadStatus = document.getElementById('upload-status');
const startDriveBtn = document.getElementById('start-drive-btn');
const stopDriveBtn = document.getElementById('stop-drive-btn');
const clearRouteBtn = document.getElementById('clear-route-btn');

// --- STAT ELEMENTS ---
const statDist = document.getElementById('stat-dist');
const statTurns = document.getElementById('stat-turns');
const statAvg = document.getElementById('stat-avg');
const statHairpins = document.getElementById('stat-hairpins');

// Unit Toggle Elements
const unitToggleContainer = document.getElementById('unit-toggle');
const unitKmBtn = document.getElementById('unit-km');
const unitMiBtn = document.getElementById('unit-mi');

// --- APP STATE ---
let isMetric = true;
let wakeLock = null;
let currentRouteData = null;
let generatedNotes = null;
let map, routingControl;

// --- INITIALIZATION ---
async function initApp() {
    console.log('[App] Initializing RallyNode PWA...');
    
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('/sw.js');
        } catch (err) {
            console.error('[App] Service Worker registration failed:', err);
        }
    }

    const updateNetworkUI = () => {
        const dot = document.getElementById('network-dot');
        const text = document.getElementById('network-text');
        if (navigator.onLine) {
            dot.className = 'dot online';
            text.textContent = 'SYS.ONLINE';
        } else {
            dot.className = 'dot';
            dot.style.backgroundColor = 'var(--accent-red)';
            text.textContent = 'SYS.OFFLINE';
        }
    };
    window.addEventListener('online', updateNetworkUI);
    window.addEventListener('offline', updateNetworkUI);
    updateNetworkUI();

    try {
        await initDB();
    } catch (e) {
        console.error('[App] Failed to init DB:', e);
    }

    // Setup Unit Toggle
    unitToggleContainer.addEventListener('click', () => {
        if (navigator.vibrate) navigator.vibrate(40);
        setUnits(!isMetric);
    });

    const sensorAuthBtn = document.getElementById('sensor-auth-btn');
    if (sensorAuthBtn) {
        sensorAuthBtn.addEventListener('click', async () => {
            if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
                try {
                    const permissionState = await DeviceMotionEvent.requestPermission();
                    if (permissionState === 'granted') {
                        sensorAuthBtn.style.color = 'var(--accent-green)';
                        sensorAuthBtn.style.borderColor = 'var(--accent-green)';
                        sensorAuthBtn.textContent = 'SNSR: OK';
                    } else {
                        sensorAuthBtn.style.color = 'var(--accent-red)';
                        sensorAuthBtn.style.borderColor = 'var(--accent-red)';
                    }
                } catch (e) {
                    console.warn(e);
                }
            } else {
                sensorAuthBtn.style.color = 'var(--accent-green)';
                sensorAuthBtn.style.borderColor = 'var(--accent-green)';
                sensorAuthBtn.textContent = 'SNSR: ON';
            }
        });
    }

    initMap();
}

function setUnits(toMetric) {
    isMetric = toMetric;
    setMetricState(isMetric);
    
    if (isMetric) {
        unitKmBtn.classList.add('active');
        unitMiBtn.classList.remove('active');
        document.querySelector('.speed-unit').textContent = 'KM/H';
        document.querySelector('.distance-unit').textContent = 'METERS TO';
        document.querySelectorAll('.stat-unit')[0].textContent = 'KM';
    } else {
        unitMiBtn.classList.add('active');
        unitKmBtn.classList.remove('active');
        document.querySelector('.speed-unit').textContent = 'MPH';
        document.querySelector('.distance-unit').textContent = 'YARDS TO';
        document.querySelectorAll('.stat-unit')[0].textContent = 'MI';
    }
    
    // Recalculate stats immediately if route exists
    if (currentRouteData && lastRouteSummary) {
        updateStatsUI(lastRouteSummary);
    }
}

// Global to hold route summary for instant unit recalculation
let lastRouteSummary = null;

// --- MAP & ROUTING ---
function initMap() {
    map = L.map('map', { zoomControl: false }).setView([39.8283, -98.5795], 4);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    let userMarker = null;

    if (navigator.geolocation) {
        navigator.geolocation.watchPosition((pos) => {
            const latlng = [pos.coords.latitude, pos.coords.longitude];
            const heading = pos.coords.heading || 0;
            
            if (!userMarker) {
                map.setView(latlng, 13);
                userMarker = L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'user-location-marker',
                        html: `<div class="user-dot"></div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    }),
                    interactive: false,
                    zIndexOffset: 1000
                }).addTo(map);
            } else {
                userMarker.setLatLng(latlng);
            }
        }, (err) => {
            console.warn('[App] Geolocation error:', err);
        }, { enableHighAccuracy: true, maximumAge: 0 });
    }

    routingControl = L.Routing.control({
        waypoints: [],
        routeWhileDragging: true,
        showAlternatives: false,
        fitSelectedRoutes: true,
        show: false,
        addWaypoints: true,
        lineOptions: {
            styles: [{ color: 'var(--accent-red)', opacity: 0.9, weight: 6 }]
        },
        createMarker: function(i, wp, nWps) {
            // Create draggable markers with custom automotive minimalist numbered pins
            const markerClass = i === 0 ? 'start-pin' : (i === nWps - 1 ? 'end-pin' : 'way-pin');
            const pinNumber = (i + 1).toString().padStart(2, '0');
            
            const marker = L.marker(wp.latLng, {
                draggable: true,
                icon: L.divIcon({
                    className: `auto-pin ${markerClass}`,
                    html: `<div class="pin-content">
                             <span class="pin-number">${pinNumber}</span>
                             <div class="pin-dot"></div>
                           </div>`,
                    iconSize: [24, 40],
                    iconAnchor: [12, 40]
                })
            });
            marker.on('click', () => {
                const waypoints = routingControl.getWaypoints();
                // Ensure we don't delete if there are less than 2 points left
                if (waypoints.filter(w => w.latLng !== null).length > 2) {
                    waypoints.splice(i, 1);
                    routingControl.setWaypoints(waypoints);
                }
            });
            return marker;
        }
    }).addTo(map);

    setTimeout(() => {
        map.invalidateSize();
    }, 250);

    routingControl.on('routesfound', async function(e) {
        uploadStatus.textContent = 'ANALYZING...';
        
        const routes = e.routes;
        const route = routes[0];
        const coordinates = route.coordinates.map(c => ({ lat: c.lat, lon: c.lng }));

        try {
            generatedNotes = generatePacenotes(coordinates);
            currentRouteData = coordinates;


            // Save summary for toggle switching
            lastRouteSummary = route.summary;
            updateStatsUI(lastRouteSummary);

            // Save the dynamic route offline
            const routeId = 'route_' + Date.now();
            await saveRouteOffline(routeId, 'Custom Route', coordinates);
            
            uploadStatus.textContent = `READY`;
            startDriveBtn.disabled = false;
        } catch (err) {
            uploadStatus.textContent = 'SYS.ERROR';
            console.error(err);
        }
    });

    map.on('click', function(e) {
        const waypoints = routingControl.getWaypoints().filter(wp => wp.latLng !== null);
        waypoints.push(L.Routing.waypoint(e.latlng));
        routingControl.setWaypoints(waypoints);
    });
}

function updateStatsUI(summary) {
    if (!generatedNotes) return;
    
    const totalMeters = summary.totalDistance;
    const distFormatted = isMetric 
        ? (totalMeters / 1000).toFixed(1) 
        : (totalMeters / 1609.34).toFixed(1);
    
    const totalTurns = generatedNotes.length;
    
    let hairpinCount = 0;
    let angleSum = 0;
    
    generatedNotes.forEach(note => {
        const noteName = note.callout.toLowerCase();
        if (noteName.includes('hairpin')) {
            hairpinCount++;
            angleSum += 8;
        } else if (noteName.includes('square')) {
            angleSum += 7;
        } else {
            const match = noteName.match(/\d/);
            if (match) angleSum += parseInt(match[0]);
        }
    });

    const avgTightness = totalTurns > 0 ? (angleSum / totalTurns).toFixed(1) : 0;

    statDist.textContent = distFormatted;
    statTurns.textContent = totalTurns;
    statAvg.textContent = avgTightness;
    statHairpins.textContent = hairpinCount;
}

clearRouteBtn.addEventListener('click', () => {
    routingControl.setWaypoints([]);
    currentRouteData = null;
    generatedNotes = null;
    
    statDist.textContent = '--';
    statTurns.textContent = '--';
    statAvg.textContent = '--';
    statHairpins.textContent = '0';
    
    startDriveBtn.disabled = true;
    uploadStatus.textContent = 'AWAITING INPUT...';
});

// --- DRIVE ENGINE ---
startDriveBtn.addEventListener('click', async () => {
    if (!currentRouteData || !generatedNotes) return;

    if (wakeLock === null && 'wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(console.warn);
    }

    setupFlow.classList.remove('active');
    setTimeout(() => {
        setupFlow.style.display = 'none';
        driveScreen.style.display = 'flex';
        setTimeout(() => {
            driveScreen.classList.add('active');
            window.dispatchEvent(new Event('resize')); // Fix for any canvas/maps
        }, 50);
    }, 400); // Increased to match CSS 0.4s animation time

    setUIHandlers({
        onSpeedUpdate: (speed) => {
            document.getElementById('current-speed').textContent = speed;
        },
        onDistanceUpdate: (dist, unit) => {
            document.getElementById('distance-to-turn').textContent = dist;
            if (unit) document.getElementById('distance-unit').textContent = unit;
        },
        onCalloutTrigger: (callout) => {
            const el = document.getElementById('current-callout');
            el.textContent = callout;
            el.style.color = 'var(--text-primary)';
            setTimeout(() => el.style.color = 'var(--accent-red)', 200);
        },
        onNextUpdate: (nextCallout) => {
            document.getElementById('next-callout').textContent = nextCallout;
        },
        onGPSStatusUpdate: (status) => {
            const statusEl = document.getElementById('gps-status-indicator');
            if (statusEl) {
                statusEl.textContent = `GPS: ${status}`;
                if (status === 'SNAPPED') {
                    statusEl.style.color = 'var(--accent-green)';
                } else {
                    statusEl.style.color = 'var(--accent-red)';
                }
            }
        }
    });

    startDrive(currentRouteData, generatedNotes);
});

stopDriveBtn.addEventListener('click', () => {
    stopDrive();
    if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });

    driveScreen.classList.remove('active');
    setTimeout(() => {
        driveScreen.style.display = 'none';
        setupFlow.style.display = 'flex';
        setTimeout(() => {
            setupFlow.classList.add('active');
            // FIX: Force Leaflet to recalculate map size now that container is visible again
            map.invalidateSize();
        }, 50);
    }, 400); // Increased to match CSS 0.4s animation time
});

// Boot
initApp();
