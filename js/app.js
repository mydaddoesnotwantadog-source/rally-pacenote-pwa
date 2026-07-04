import { initDB, saveRouteOffline } from './route_manager.js';
import { generatePacenotes } from './pacenote_engine.js';
import { startDrive, stopDrive, setUIHandlers, setMetricState, playAudioCallout, setVolume, setActiveVoicePack, invalidateDriveMap } from './execution_engine.js';

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
const uploadStatus = document.getElementById('upload-status') || { textContent: '' };
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
    map = L.map('map', { 
        preferCanvas: true,
        zoomControl: false,
        dragging: true,
        touchZoom: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        rotate: true,
        touchRotate: true
    }).setView([39.8283, -98.5795], 4);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    let userMarker = null;
    
    // Auto-detect USA to default to Imperial
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz.startsWith('America/') && !tz.includes('Argentina') && !tz.includes('Santiago') && !tz.includes('Sao_Paulo') && !tz.includes('Bogota') && !tz.includes('Lima')) {
        // Technically Canada is metric, but for simplicity we'll check if they are en-US language too
        if (navigator.language === 'en-US') {
            setUnits(false); // MI
        }
    }

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

    let isUserExitedFullscreen = false;

    function enterFullscreenMap() {
        const mapContainer = document.querySelector('.map-container');
        const bottomSheet = document.getElementById('setup-bottom-sheet');
        const verticalPager = document.getElementById('vertical-pager');
        const setupScreen = document.getElementById('setup-screen-content');

        if (mapContainer.classList.contains('map-fullscreen')) return;

        mapContainer.classList.add('map-fullscreen');
        bottomSheet.classList.add('fullscreen-mode');
        verticalPager.classList.add('no-scroll');
        setupScreen.classList.add('fullscreen-active');
        
        document.querySelector('.system-status').style.opacity = '0';
        document.getElementById('unit-toggle').style.opacity = '0';
        document.querySelector('.map-overlay').style.opacity = '0';
        
        setTimeout(() => {
            document.querySelector('.system-status').style.visibility = 'hidden';
            document.getElementById('unit-toggle').style.visibility = 'hidden';
            document.querySelector('.map-overlay').style.visibility = 'hidden';
        }, 400);

        // Continuously invalidate size during CSS transition for smooth animation
        let startTime = Date.now();
        function animateMap() {
            map.invalidateSize();
            if (Date.now() - startTime < 450) {
                requestAnimationFrame(animateMap);
            }
        }
        animateMap();
    }

    function exitFullscreenMap() {
        const mapContainer = document.querySelector('.map-container');
        const bottomSheet = document.getElementById('setup-bottom-sheet');
        const verticalPager = document.getElementById('vertical-pager');
        const setupScreen = document.getElementById('setup-screen-content');

        mapContainer.classList.remove('map-fullscreen');
        bottomSheet.classList.remove('fullscreen-mode');
        bottomSheet.classList.remove('expanded');
        verticalPager.classList.remove('no-scroll');
        setupScreen.classList.remove('fullscreen-active');
        
        document.querySelector('.system-status').style.visibility = 'visible';
        document.getElementById('unit-toggle').style.visibility = 'visible';
        document.querySelector('.map-overlay').style.visibility = 'visible';
        
        setTimeout(() => {
            document.querySelector('.system-status').style.opacity = '1';
            document.getElementById('unit-toggle').style.opacity = '1';
            document.querySelector('.map-overlay').style.opacity = '1';
        }, 10);

        // Continuously invalidate size during CSS transition for smooth animation
        let startTime = Date.now();
        function animateMap() {
            map.invalidateSize();
            if (Date.now() - startTime < 450) {
                requestAnimationFrame(animateMap);
            }
        }
        animateMap();
    }

    routingControl.on('waypointschanged', function(e) {
        const waypoints = e.waypoints.filter(w => w.latLng !== null);
        
        if (waypoints.length >= 1) {
            if (!isUserExitedFullscreen) {
                enterFullscreenMap();
            }
        } else {
            isUserExitedFullscreen = false; // Reset if all waypoints cleared
            exitFullscreenMap();
        }
    });

    map.on('click', function(e) {
        const waypoints = routingControl.getWaypoints().filter(wp => wp.latLng !== null);
        waypoints.push(L.Routing.waypoint(e.latlng));
        routingControl.setWaypoints(waypoints);
    });

    setupBottomSheetLogic(() => {
        isUserExitedFullscreen = true;
        exitFullscreenMap();
    }, () => {
        // When user manually pulls down the map expand handle
        enterFullscreenMap();
    });
}

function setupBottomSheetLogic(onExitFullscreen, onEnterFullscreen) {
    const bottomSheet = document.getElementById('setup-bottom-sheet');
    const dragHandle = document.querySelector('.drag-handle-container');
    const expandHandle = document.getElementById('map-expand-handle');
    const mapContainer = document.querySelector('.map-container');
    
    if (!bottomSheet || !dragHandle) return;

    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    let startMapHeight = 0;

    // BOTTOM SHEET SWIPE UP TO EXIT
    dragHandle.addEventListener('touchstart', (e) => {
        if (!mapContainer.classList.contains('map-fullscreen')) return;
        isDragging = true;
        startY = e.touches[0].clientY;
        
        startMapHeight = mapContainer.offsetHeight;
        mapContainer.style.transition = 'none';
    });

    dragHandle.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        let delta = currentY - startY;
        
        // Only allow swiping UP (negative delta) to exit fullscreen
        if (delta > 0) delta = 0; 
        
        mapContainer.style.height = (startMapHeight + delta) + 'px';
        if (typeof map !== 'undefined') map.invalidateSize();
    });

    dragHandle.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        mapContainer.style.transition = 'all 0.4s cubic-bezier(0.25, 1, 0.5, 1)';

        let delta = currentY - startY;
        
        if (delta < -50 && onExitFullscreen) {
            mapContainer.style.height = '';
            onExitFullscreen();
        } else {
            mapContainer.style.height = ''; // Reverts to CSS map-fullscreen class height
        }
    });

    // MAP OVERLAY SWIPE DOWN TO EXPAND
    if (expandHandle) {
        let expandStartY = 0;
        let expandCurrentY = 0;
        let isExpandDragging = false;
        let startMapHeightExpand = 0;

        expandHandle.addEventListener('touchstart', (e) => {
            isExpandDragging = true;
            expandStartY = e.touches[0].clientY;
            startMapHeightExpand = mapContainer.offsetHeight;
            
            mapContainer.style.transition = 'none';
        });

        expandHandle.addEventListener('touchmove', (e) => {
            if (!isExpandDragging) return;
            // Prevent pull-to-refresh or scrolling
            e.preventDefault();
            expandCurrentY = e.touches[0].clientY;
            
            let delta = expandCurrentY - expandStartY;
            if (delta < 0) delta = 0; // only drag down
            
            mapContainer.style.height = (startMapHeightExpand + delta) + 'px';
            mapContainer.style.flex = 'none';
            if (typeof map !== 'undefined') map.invalidateSize();
        }, { passive: false });

        expandHandle.addEventListener('touchend', (e) => {
            if (!isExpandDragging) return;
            isExpandDragging = false;
            
            let delta = expandCurrentY - expandStartY;
            
            mapContainer.style.transition = 'all 0.4s cubic-bezier(0.25, 1, 0.5, 1)';
            
            if ((delta > 20 || delta === 0) && onEnterFullscreen) {
                mapContainer.style.height = '';
                mapContainer.style.flex = '';
                onEnterFullscreen();
            } else {
                mapContainer.style.height = startMapHeightExpand + 'px';
                setTimeout(() => {
                    mapContainer.style.height = '';
                    mapContainer.style.flex = '';
                }, 400);
            }
        });
    }
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
let holdTimer = null;
let holdActive = false;
let driveViewMode = 'MAP'; // Default to map

// View Toggle Handlers
const toggleTextBtn = document.getElementById('toggle-text');
const toggleMapBtn = document.getElementById('toggle-map');
const driveTextUI = document.getElementById('drive-text-ui');
const driveMapUI = document.getElementById('drive-map-ui');

function setDriveView(mode) {
    driveViewMode = mode;
    if (mode === 'MAP') {
        toggleMapBtn.classList.add('active');
        toggleTextBtn.classList.remove('active');
        driveTextUI.classList.add('hidden');
        driveMapUI.classList.remove('hidden');
        // Force drive map to calculate correct size
        setTimeout(() => {
            // Signal execution engine to invalidate its map
            invalidateDriveMap();
        }, 50);
    } else {
        toggleTextBtn.classList.add('active');
        toggleMapBtn.classList.remove('active');
        driveMapUI.classList.add('hidden');
        driveTextUI.classList.remove('hidden');
    }
}

toggleTextBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate(20);
    setDriveView('TXT');
});

toggleMapBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate(20);
    setDriveView('MAP');
});

function cancelHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdActive = false;
    startDriveBtn.classList.remove('holding');
}

function startDriveHold() {
    if (startDriveBtn.disabled) return;
    if (holdActive) return;
    
    // Set up perimeter exact dimension for SVG stroke
    const p = (startDriveBtn.offsetWidth + startDriveBtn.offsetHeight) * 2;
    startDriveBtn.style.setProperty('--perimeter', p);
    startDriveBtn.offsetHeight; // Force reflow
    
    holdActive = true;
    startDriveBtn.classList.add('holding');
    
    if (navigator.vibrate) navigator.vibrate(50);

    holdTimer = setTimeout(() => {
        if (!holdActive) return;
        executeDriveTransition();
    }, 700);
}

startDriveBtn.addEventListener('mousedown', startDriveHold);
startDriveBtn.addEventListener('touchstart', (e) => {
    // Prevent default to avoid simulating mousedown
    e.preventDefault();
    startDriveHold();
}, { passive: false });

startDriveBtn.addEventListener('mouseup', cancelHold);
startDriveBtn.addEventListener('mouseleave', cancelHold);
startDriveBtn.addEventListener('touchend', cancelHold);
startDriveBtn.addEventListener('touchcancel', cancelHold);

async function executeDriveTransition() {
    if (!currentRouteData || !generatedNotes) return;
    cancelHold(); // Reset button

    if (navigator.vibrate) navigator.vibrate([100, 50, 100]); // Haptic success

    if (wakeLock === null && 'wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(console.warn);
    }

    // Default to MAP mode
    setDriveView('MAP');

    // Smooth CSS-only Transition
    setupFlow.classList.remove('active');
    driveScreen.classList.add('active');
    
    setTimeout(() => {
        window.dispatchEvent(new Event('resize')); // Fix for any canvas/maps
    }, 500); // Wait for transition to complete

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
}

stopDriveBtn.addEventListener('click', () => {
    stopDrive();
    if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });

    driveScreen.classList.remove('active');
    setupFlow.classList.add('active');
    
    setTimeout(() => {
        map.invalidateSize();
    }, 500); // Wait for transition to complete
});

// Boot
initApp();
