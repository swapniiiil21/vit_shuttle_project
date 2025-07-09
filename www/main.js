// main.js
// This script contains the frontend logic for the VIT Vellore Smart Shuttle app.
// It handles UI updates, navigation, data fetching from the Python backend (via Eel),
// and Firebase authentication and Firestore operations. The map is now an embedded iframe.

// Global check: Ensure Eel is defined before attempting to use it.
if (typeof eel === 'undefined') {
    console.error("CRITICAL ERROR: Eel is not defined. Please ensure eel.js is loaded correctly by the Eel framework.");
    document.body.innerHTML = `
        <div class="fixed inset-0 bg-red-100 text-red-800 flex flex-col items-center justify-center p-8 text-center z-[9999]">
            <h1 class="text-3xl font-bold mb-4">Application Failed to Load</h1>
            <p class="text-lg mb-2">It seems like the communication layer (Eel) between the application and your browser is not functioning.</p>
            <p class="text-md">Please ensure the Python backend is running correctly and your browser settings allow \`localhost\` to connect.</p>
            <p class="text-sm mt-4">Check your browser's console (F12) for more specific errors.</p>
        </div>
    `;
    throw new Error("Eel not found, cannot proceed.");
}

// Global Firebase variables (will be populated once initialized)
let firebaseApp, db, auth;
let userId = null;
let isAuthenticated = false;
let isAuthReady = false; // Flag to indicate if Firebase Auth state has been determined
let recaptchaVerifier;
let confirmationResult;

// Firebase config. This object is used as a robust fallback.
// In Canvas, __firebase_config is usually provided, but this ensures projectId is always there.
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBq33TMTSrHTRMxDbOLjO0XF6T9lG7YfVU", 
    authDomain: "vit-shuttle.firebaseapp.com",
    projectId: "vit-shuttle", 
    storageBucket: "vit-shuttle.firebasestorage.app",
    messagingSenderId: "276191184820",
    appId: "1:276191184820:web:c0d96f9a8a619503d794e1", 
    measurementId: "G-PJ3H6V5WCD" 
};

// Use __app_id from Canvas if available, otherwise fallback to a default ID.
const FIRESTORE_APP_ID_FOR_PATHS = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'; 


let allStopsData = []; 
// Map variables are now irrelevant for the iframe, but kept for clarity if future changes revert to Leaflet
let map = null; 
let shuttleMarkers = {}; 
let stopMarkers = {}; 

// Chart instances for Analytics tab to prevent re-creation
let dailyRidershipChartInstance = null;
let popularityChartInstance = null;

// For commute visualization animation
let animationFrameId = null;
let dashOffset = 0; // For animating dashed lines

// --- Custom Leaflet Icons for Shuttles and Stops ---
// These functions are no longer directly used as the map is an iframe,
// but kept for compatibility if leaflet map functionality is re-introduced.
const createShuttleIcon = (statusColor, routeName, passengers) => {
    // console.warn("createShuttleIcon: This function is not used when the map is an iframe.");
    return null; // Return null as no custom Leaflet icon will be created
};

const createStopIcon = (stopName) => {
    // console.warn("createStopIcon: This function is not used when the map is an iframe.");
    return null; // Return null as no custom Leaflet icon will be created
};

/**
 * Generic function to display messages in a given HTML element.
 * @param {HTMLElement} element - The DOM element to display the message in.
 * @param {string} message - The message text.
 * @param {string} type - 'success', 'error', or 'info'.
 */
function showCustomMessage(element, message, type) {
    if (!element) {
        console.warn(`showCustomMessage: Target element is null for message "${message}".`);
        return;
    }
    element.classList.remove('hidden', 'bg-green-100', 'text-green-800', 'bg-red-100', 'text-red-800', 'bg-blue-100', 'text-blue-800');
    element.classList.remove('bg-yellow-50', 'text-yellow-800'); // Add yellow for info type

    if (type === 'success') {
        element.classList.add('bg-green-100', 'text-green-800');
    } else if (type === 'error') {
        element.classList.add('bg-red-100', 'text-red-800');
    } else if (type === 'info') {
        element.classList.add('bg-blue-100', 'text-blue-800');
    } else { // default to info if type is unrecognized
        element.classList.add('bg-blue-100', 'text-blue-800');
    }
    
    element.textContent = message;
    element.classList.remove('hidden');
    // For error messages, do not auto-hide, let user close or navigate
    if (type !== 'error') {
        setTimeout(() => element.classList.add('hidden'), 5000); // Hide after 5 seconds
    }
}


// --- Core Helper Functions (Defined globally for universal accessibility) ---

/**
 * Initializes Firebase services (Auth and Firestore).
 * Handles initial anonymous or custom token sign-in.
 */
async function initializeFirebase() {
    console.log("initializeFirebase: Starting Firebase initialization process.");
    try {
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        let finalFirebaseConfig = FIREBASE_CONFIG; // Start with the default hardcoded config

        // Attempt to parse and use the Canvas-provided config if it exists and is valid
        if (typeof __firebase_config !== 'undefined' && __firebase_config) {
            try {
                const parsedConfig = JSON.parse(__firebase_config);
                // Ensure parsed config actually contains projectId before using it
                if (parsedConfig && parsedConfig.projectId) {
                    finalFirebaseConfig = parsedConfig;
                    console.log("initializeFirebase: Using Firebase config from Canvas environment.");
                } else {
                    console.warn("initializeFirebase: Canvas Firebase config found but missing projectId. Using default config.");
                }
            } catch (parseError) {
                console.error("initializeFirebase: Error parsing __firebase_config from Canvas. Using default config.", parseError);
            }
        } else {
            console.warn("initializeFirebase: __firebase_config not found in Canvas environment. Using default config.");
        }
       
        firebaseApp = window.initializeApp(finalFirebaseConfig);
        db = window.getFirestore(firebaseApp);
        auth = window.getAuth(firebaseApp);
        console.log("initializeFirebase: Firebase App, Firestore, and Auth instances created.");

        // IMPORTANT: Set up onAuthStateChanged listener first
        window.onAuthStateChanged(auth, async (user) => {
            console.log("onAuthStateChanged: Firebase Auth state changed. User object:", user ? user.uid : "null");
            if (user) {
                userId = user.uid;
                isAuthenticated = true;
                console.log("onAuthStateChanged: User is authenticated. User ID:", userId);
                const userIdDisplay = document.getElementById('user-id-display');
                if (userIdDisplay) userIdDisplay.textContent = userId;
                
                const loginButton = document.getElementById('login-button');
                if (loginButton) {
                    loginButton.textContent = "Logout";
                    loginButton.classList.remove('bg-vit-gold', 'text-vit-blue');
                    loginButton.classList.add('bg-red-500', 'hover:bg-red-600', 'text-white');
                }

                // Fetch user profile and bookings once authenticated
                await fetchUserProfile(userId); 
                fetchMyBookings(user); 
            } else {
                userId = null;
                isAuthenticated = false;
                console.log("onAuthStateChanged: User is NOT authenticated (signed out or anonymous).");
                const userIdDisplay = document.getElementById('user-id-display');
                if (userIdDisplay) userIdDisplay.textContent = 'Not authenticated';

                const loginButton = document.getElementById('login-button');
                if (loginButton) {
                    loginButton.textContent = "Login/Sign-up";
                    loginButton.classList.remove('bg-red-500', 'hover:bg-red-600', 'text-white');
                    loginButton.classList.add('bg-vit-gold', 'text-vit-blue');
                }
                
                const myBookingsList = document.getElementById('my-bookings-list');
                if (myBookingsList) {
                    myBookingsList.innerHTML = '<li class="text-center text-gray-500 text-lg p-4 bg-yellow-50 rounded-md border border-yellow-200">Please <span class="font-bold text-vit-blue cursor-pointer" onclick="document.getElementById(\'login-button\').click()">Login/Sign-up</span> with your phone number to see your persistent bookings. Anonymous bookings may not persist across browser sessions.</li>';
                }
            }
            isAuthReady = true; // Mark auth as ready AFTER the initial check is complete
            console.log("onAuthStateChanged: isAuthReady set to true.");
        });

        // Attempt initial sign-in *after* the listener is set up
        try {
            if (initialAuthToken) {
                console.log("initializeFirebase: Attempting sign-in with custom token (from Python).");
                await window.signInWithCustomToken(auth, initialAuthToken);
                console.log("initializeFirebase: Initial sign-in attempt: Custom token successful.");
            } else {
                console.log("initializeFirebase: No custom token found. Attempting anonymous sign-in.");
                await window.signInAnonymously(auth);
                console.log("initializeFirebase: Initial sign-in attempt: Anonymous successful.");
            }
        } catch (authError) {
            console.error("initializeFirebase: Initial authentication attempt failed:", authError);
            // Even if initial sign-in fails, the onAuthStateChanged listener will eventually set isAuthReady
            // No need to set isAuthReady=true here immediately, as the listener handles it.
        }

    } catch (error) {
        console.error("initializeFirebase: Caught error during Firebase setup:", error);
        showCustomMessage(document.body, `Critical Error: Firebase failed to initialize. ${error.message}`, 'error');
        throw error; 
    }
    console.log("initializeFirebase: Firebase initialization function completed.");
}

/**
 * Displays messages in the authentication modal.
 * @param {string} message - The message to display.
 * @param {string} type - 'success', 'error', or 'info' for styling.
 */
function displayAuthMessage(message, type) {
    const authMessageDiv = document.getElementById('auth-message');
    showCustomMessage(authMessageDiv, message, type);
}

/**
 * Fetches user profile data (name, phone) from Firestore to pre-fill booking form.
 * @param {string} uid - The user's Firebase UID.
 */
async function fetchUserProfile(uid) {
    console.log("fetchUserProfile: Attempting to fetch profile for UID:", uid);
    if (!db || !uid) {
        console.log("fetchUserProfile: Firestore (db) not initialized or UID missing. Skipping profile fetch.");
        return;
    }
    try {
        const userDocRef = window.doc(db, `artifacts/${FIRESTORE_APP_ID_FOR_PATHS}/users/${uid}/profile/details`);
        const userDocSnap = await window.getDoc(userDocRef);
        const bookingNameInput = document.getElementById('booking-name');
        const bookingPhoneInput = document.getElementById('booking-phone');
        const authNameInput = document.getElementById('auth-name'); // For auth modal

        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            if (bookingNameInput && userData.name) {
                bookingNameInput.value = userData.name;
            }
            if (bookingPhoneInput && userData.phone) {
                bookingPhoneInput.value = userData.phone;
            }
            if (authNameInput && userData.name) { // Also populate name in auth modal if present
                authNameInput.value = userData.name;
            }
            console.log("fetchUserProfile: User profile fetched successfully for UID:", uid, "Data:", userData);
        } else {
            console.log("fetchUserProfile: No existing user profile found for UID:", uid, ". Will use default/new input values.");
        }
    } catch (error) {
        console.error("fetchUserProfile: Error fetching user profile:", error);
    }
}

/**
 * Saves user profile data (name, phone) to Firestore.
 * @param {string} uid - The user's Firebase UID.
 * @param {string} name - The user's name.
 * @param {string} phone - The user's phone number.
 */
async function saveUserProfile(uid, name, phone) {
    console.log("saveUserProfile: Attempting to save profile for UID:", uid);
    if (!db || !uid) {
        console.warn("saveUserProfile: Firestore (db) not initialized or UID missing. Skipping profile save.");
        return;
    }
    try {
        const userDocRef = window.doc(db, `artifacts/${FIRESTORE_APP_ID_FOR_PATHS}/users/${uid}/profile/details`);
        await window.setDoc(userDocRef, { name: name, phone: phone }, { merge: true }); // Merge to avoid overwriting other fields
        console.log("saveUserProfile: User profile saved successfully.");
    } catch (error) {
        console.error("saveUserProfile: Error saving user profile:", error);
        displayAuthMessage(`Error saving profile: ${error.message}`, 'error');
    }
}


/**
 * Activates a specific view and updates navigation highlighting.
 * @param {string} viewId - The ID of the view to activate (e.g., 'dashboard-view').
 */
function activateView(viewId) {
    console.log(`activateView: Attempting to activate view: ${viewId}`);
    const navLinks = document.querySelectorAll('.nav-link');
    const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
    const views = document.querySelectorAll('.view');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');

    // Remove active state from all navigation links first
    if (navLinks) {
        navLinks.forEach(link => link.classList.remove('active', 'text-vit-gold', 'font-bold'));
    }
    if (mobileNavLinks) {
        mobileNavLinks.forEach(link => link.classList.remove('active', 'text-vit-gold', 'font-bold'));
    }

    // Add active state to the current navigation link
    const currentNavLinks = document.querySelectorAll(`[data-view="${viewId}"]`);
    if (currentNavLinks) {
        currentNavLinks.forEach(link => {
            link.classList.add('active', 'text-vit-gold', 'font-bold');
        });
    } else {
        console.warn(`activateView: No navigation links found for data-view="${viewId}".`);
    }

    // Hide all views
    if (views) {
        views.forEach(view => {
            view.classList.add('hidden'); 
        });
    }

    // Show the target view
    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.classList.remove('hidden');
        console.log(`activateView: Showing view: ${viewId}`);
    } else {
        console.error(`activateView: Target view element not found for ID: ${viewId}. Check index.html IDs.`);
    }

    // Scroll to top of main content and hide mobile menu if active
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.scrollTop = 0; 
    if (mobileMenu) mobileMenu.classList.add('translate-x-full'); 
    if (mobileMenuOverlay) mobileMenuOverlay.classList.add('hidden'); 
    console.log("activateView: Mobile menu hidden.");

    // Specific logic for views
    if (viewId === 'book-shuttle-view') {
        const bookingStopSelect = document.getElementById('booking-stop-select');
        if (bookingStopSelect && bookingStopSelect.options.length <= 1) { // Check if dropdown is mostly empty
            console.log("activateView: Populating booking stops dropdown for 'book-shuttle-view'.");
            populateBookingStopsDropdown();
        }
    }

    if (viewId === 'analytics-view') {
        console.log("activateView: Rendering analytics charts for 'analytics-view'.");
        renderDailyRidershipChart();
        renderPopularityChart();
    } else if (viewId === 'my-commute-view') {
        console.log("activateView: Initializing My Commute view elements.");
        // Ensure dropdowns are populated when My Commute tab is opened
        populateFrequentRouteSelects(); 
        // Render the commute visualization when the My Commute tab is active
        renderCommuteVisualization();
    } else {
        // Stop animation if navigating away from My Commute view
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            console.log("Commute visualization animation stopped.");
        }
    }
    console.log(`activateView: View activation for ${viewId} completed.`);
}

/**
 * Initializes the Leaflet map on the dashboard.
 * This function is now a no-op as the map is an iframe.
 */
function initializeMap() {
    console.log("initializeMap: Skipping Leaflet map initialization. Map area is now an iframe.");
    // If you ever revert to a Leaflet map, uncomment the following:
    // const mapElement = document.getElementById('map');
    // if (mapElement && typeof L !== 'undefined') {
    //     if (map) {
    //         map.remove(); 
    //         console.log("initializeMap: Removed existing map instance.");
    //     }
    //     map = L.map('map').setView([12.9699, 79.1559], 15); // Centered around VIT Vellore
    //     L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    //         attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    //     }).addTo(map);
    //     console.log("initializeMap: Leaflet map initialized successfully.");
    // } else {
    //     console.error("initializeMap: Map element (#map) not found or Leaflet library (L) not loaded. Cannot initialize map.");
    //     if (mapElement) {
    //          mapElement.innerHTML = '<p class="text-red-500 text-center py-10">Error loading map: Leaflet library not loaded or map element missing.</p>';
    //     } else {
    //         console.warn("initializeMap: Could not find map element to display error message.");
    //     }
    // }
}

/**
 * Updates the Dashboard's Live Overview section with shuttle counts, avg wait time.
 * Shuttle map icon updates are no longer applicable with an iframe.
 */
async function updateDashboardLiveOverview() {
    console.log("updateDashboardLiveOverview: Starting update.");
    try {
        console.log("updateDashboardLiveOverview: Calling eel.get_live_shuttle_data()...");
        const liveData = await eel.get_live_shuttle_data()();
        console.log("updateDashboardLiveOverview: Received live data:", liveData);
        
        const activeShuttlesElem = document.getElementById('active-shuttles');
        const avgWaitTimeElem = document.getElementById('avg-wait-time');

        if (activeShuttlesElem) activeShuttlesElem.textContent = `${liveData.active_shuttles_count || 0}/${liveData.total_shuttles || 0}`;
        if (avgWaitTimeElem) avgWaitTimeElem.textContent = liveData.avg_wait_time || 'N/A';

        // NOTE: Shuttle markers on the Leaflet map are no longer updated as the map is an iframe.
        console.log("updateDashboardLiveOverview: Skipping Leaflet shuttle marker updates (map is iframe).");

    }
    catch (error) {
        console.error("Error updating dashboard live overview:", error);
        const activeShuttlesElem = document.getElementById('active-shuttles');
        const avgWaitTimeElem = document.getElementById('avg-wait-time');
        if (activeShuttlesElem) activeShuttlesElem.textContent = 'Error';
        if (avgWaitTimeElem) avgWaitTimeElem.textContent = 'Error';
        // Only show error on dashboard view itself if it's currently active.
        const dashboardView = document.getElementById('dashboard-view');
        if (dashboardView && !dashboardView.classList.contains('hidden')) {
            showCustomMessage(dashboardView.querySelector('.shadow-lg'), `Failed to load live shuttle data: ${error.message}`, 'error');
        }
    } finally {
        console.log("updateDashboardLiveOverview: Finished update.");
    }
}

/**
 * Draws map pin markers for each shuttle stop on the Leaflet map.
 * This function is no longer applicable as the map is an iframe.
 * @param {Array<Object>} stops - Array of stop objects with lat, lon.
 */
function drawStopMarkers(stops) {
    console.warn("drawStopMarkers: This function is not used when the map is an iframe.");
    // If you ever revert to a Leaflet map, uncomment the relevant code.
    // ... (original drawStopMarkers logic) ...
}

/**
 * Fetches shuttle stops from Python backend and populates dropdowns/lists.
 */
async function populateStops() {
    console.log("populateStops: Initiating fetch for shuttle stops from Python backend via eel.get_shuttle_stops()...");
    const shuttleStopSelect = document.getElementById('shuttle-stop-select');
    const allStopsList = document.getElementById('all-stops-list');

    try {
        const stops = await eel.get_shuttle_stops()(); 
        console.log("populateStops: Raw data received from Python backend:", stops);
        
        if (stops === null || typeof stops === 'undefined' || !Array.isArray(stops)) {
            console.error("populateStops: Received null, undefined, or non-array for stops from backend. Check Python's get_shuttle_stops return.");
            if (shuttleStopSelect) shuttleStopSelect.innerHTML = '<option value="">Error Loading Stops</option>';
            if (allStopsList) allStopsList.innerHTML = `<li class="bg-red-100 text-red-700 p-4 rounded-xl shadow-md text-center">Error loading stops. Check Python console for backend errors.</li>`;
            allStopsData = []; 
            // Find the closest parent div of allStopsList or shuttleStopSelect for error message
            const errorContainer = allStopsList || shuttleStopSelect;
            if (errorContainer) showCustomMessage(errorContainer.closest('.view') || document.body, "Error: Unable to load shuttle stops data.", 'error');
            return;
        }

        allStopsData = stops; 
        
        // Clear existing options/list items before repopulating
        if (shuttleStopSelect) shuttleStopSelect.innerHTML = '<option value="">Select a Stop</option>'; 
        if (allStopsList) allStopsList.innerHTML = ''; 

        if (allStopsData.length === 0) {
            console.warn("populateStops: No stops found in data received from Python. The returned list was empty.");
            const li = document.createElement('li');
            li.className = 'bg-white p-4 rounded-xl shadow-md text-center text-gray-500';
            li.textContent = 'No stops found. Please ensure data simulation ran in Python.';
            if (allStopsList) allStopsList.appendChild(li);
            return;
        }

        console.log(`populateStops: Populating UI dropdowns and lists with ${allStopsData.length} stops.`);
        for (const stop of allStopsData) {
            if (shuttleStopSelect) {
                const optionDash = document.createElement('option');
                optionDash.value = stop.stop_id;
                optionDash.textContent = stop.name;
                shuttleStopSelect.appendChild(optionDash);
            }

            if (allStopsList) {
                const li = document.createElement('li');
                li.className = 'bg-white p-4 rounded-xl shadow-md flex items-center justify-between hover:shadow-lg transition duration-200 cursor-pointer';
                li.innerHTML = `
                    <div class="flex items-center">
                        <i data-lucide="map-pin" class="text-vit-blue mr-3 w-6 h-6"></i>
                        <div>
                            <p class="text-lg font-semibold text-gray-800">${stop.name}</p>
                            <p class="text-sm text-gray-600">Predicted Wait: <span class="font-medium" id="wait-${stop.stop_id}">Loading...</span></p>
                        </div>
                    </div>
                    <div class="text-right">
                        <p class="text-sm text-gray-500">Next Shuttle:</p>
                        <p class="text-md font-bold text-gray-400" id="next-arrival-${stop.stop_id}">Loading...</p>
                    </div>
                `;
                allStopsList.appendChild(li);
            }
        }
        lucide.createIcons(); 

        // drawStopMarkers(allStopsData); // No longer relevant with iframe map
        await updateAllStopDetails();
        console.log("populateStops: All stop details updated successfully.");

    } catch (error) {
        console.error("populateStops: Caught error during Eel call or DOM manipulation:", error);
        if (shuttleStopSelect) shuttleStopSelect.innerHTML = '<option value="">Error Loading Stops</option>';
        if (allStopsList) allStopsList.innerHTML = `<li class="bg-red-100 text-red-700 p-4 rounded-xl shadow-md text-center">A JavaScript error prevented stops from loading. Check browser console.</li>`;
        allStopsData = []; 
        const errorContainer = allStopsList || shuttleStopSelect;
        if (errorContainer) showCustomMessage(errorContainer.closest('.view') || document.body, `Error: Failed to fetch stops. ${error.message}`, 'error');
        throw error; 
    }
}

/**
 * Populates the "Select Pickup Stop" dropdown in the Book Shuttle view.
 */
function populateBookingStopsDropdown() {
    console.log("populateBookingStopsDropdown: Populating dropdown.");
    const bookingStopSelect = document.getElementById('booking-stop-select');
    if (!bookingStopSelect) {
        console.warn("populateBookingStopsDropdown: #booking-stop-select not found.");
        return;
    }
    bookingStopSelect.innerHTML = '<option value="">Select a Stop</option>';
    if (allStopsData.length > 0) {
        allStopsData.forEach(stop => {
            const option = document.createElement('option');
            option.value = stop.stop_id;
            option.textContent = stop.name;
            bookingStopSelect.appendChild(option);
        });
        console.log("populateBookingStopsDropdown: Stops populated successfully.");
    } else {
        console.warn("populateBookingStopsDropdown: allStopsData is empty. Cannot populate booking dropdown.");
        bookingStopSelect.innerHTML = '<option value="">No Stops Available</option>';
    }
}

/**
 * Populates the origin and destination selects in the "My Frequent Routes" section.
 */
function populateFrequentRouteSelects() {
    console.log("populateFrequentRouteSelects: Populating origin/destination dropdowns for frequent routes.");
    const frequentRouteOriginSelect = document.getElementById('frequent-route-origin');
    const frequentRouteDestinationSelect = document.getElementById('frequent-route-destination');

    if (!frequentRouteOriginSelect || !frequentRouteDestinationSelect) {
        console.warn("populateFrequentRouteSelects: One or both frequent route select elements not found.");
        return;
    }

    // Clear existing options
    frequentRouteOriginSelect.innerHTML = '<option value="">Select Origin Stop</option>';
    frequentRouteDestinationSelect.innerHTML = '<option value="">Select Destination Stop</option>';

    if (allStopsData.length > 0) {
        allStopsData.forEach(stop => {
            const optionOrigin = document.createElement('option');
            optionOrigin.value = stop.stop_id;
            optionOrigin.textContent = stop.name;
            frequentRouteOriginSelect.appendChild(optionOrigin);

            const optionDestination = document.createElement('option');
            optionDestination.value = stop.stop_id;
            optionDestination.textContent = stop.name;
            frequentRouteDestinationSelect.appendChild(optionDestination);
        });
        console.log("populateFrequentRouteSelects: Dropdowns populated successfully with stop data.");
    } else {
        console.warn("populateFrequentRouteSelects: allStopsData is empty. Cannot populate frequent route dropdowns.");
        frequentRouteOriginSelect.innerHTML = '<option value="">No Stops Available</option>';
        frequentRouteDestinationSelect.innerHTML = '<option value="">No Stops Available</option>';
    }
}


/**
 * Updates wait times and next arrivals for all stops in the list view (Stops View)
 * and populates the dashboard's "Next Upcoming Shuttles" list.
 */
async function updateAllStopDetails() {
    console.log("updateAllStopDetails: Starting update.");
    try {
        console.log("updateAllStopDetails: Calling eel.get_next_arrivals_for_all_stops()...");
        // Ensure eel.get_next_arrivals_for_all_stops is defined before calling
        if (typeof eel.get_next_arrivals_for_all_stops !== 'function') {
            console.error("Eel function 'get_next_arrivals_for_all_stops' is not exposed by Python backend.");
            const stopsView = document.getElementById('stops-view');
            if (stopsView && !stopsView.classList.contains('hidden')) {
                showCustomMessage(stopsView.querySelector('.shadow-md'), 'Error: Backend function for next arrivals is not available. Check Python console.', 'error');
            }
            return;
        }

        const nextArrivalsData = await eel.get_next_arrivals_for_all_stops()();
        console.log("updateAllStopDetails: Received next arrivals data:", nextArrivalsData);
        
        // Update details for individual stops on the "Stops" view
        nextArrivalsData.forEach(item => {
            const waitTimeSpan = document.getElementById(`wait-${item.stop_id}`);
            const nextArrivalSpan = document.getElementById(`next-arrival-${item.stop_id}`);

            if (waitTimeSpan) { 
                waitTimeSpan.textContent = item.predicted_wait_time;
                waitTimeSpan.className = `font-medium ${item.wait_time_class}`;
            }
            if (nextArrivalSpan) {
                nextArrivalSpan.textContent = item.next_arrival;
            }
        });

        const dashNextArrivalsList = document.getElementById('dash-next-arrivals-list');
        if (dashNextArrivalsList) { 
            dashNextArrivalsList.innerHTML = ''; 
            const displayCount = Math.min(nextArrivalsData.length, 5); 
            if (displayCount === 0) {
                const li = document.createElement('li');
                li.className = 'text-center text-gray-500';
                li.textContent = 'No upcoming shuttles.';
                dashNextArrivalsList.appendChild(li);
            } else {
                // Sort the data by predicted wait time for the dashboard list
                const sortedArrivals = [...nextArrivalsData].sort((a, b) => {
                    // Ensure the predicted_wait_time is a string like "X min"
                    const timeA = parseInt(a.predicted_wait_time.split(' ')[0]);
                    const timeB = parseInt(b.predicted_wait_time.split(' ')[0]);
                    return timeA - timeB;
                });

                sortedArrivals.slice(0, displayCount).forEach(stop => { 
                    const li = document.createElement('li');
                    li.className = 'flex justify-between items-center bg-gray-100 p-3 rounded-lg shadow-sm';
                    li.innerHTML = `
                        <div>
                            <p class="font-semibold text-gray-800">${stop.stop_name}</p>
                            <p class="text-sm text-gray-600">Next: ${stop.next_arrival}</p>
                        </div>
                        <span class="text-lg font-bold ${stop.wait_time_class}">${stop.predicted_wait_time}</span>
                    `;
                    dashNextArrivalsList.appendChild(li);
                });
            }
        }
        console.log("updateAllStopDetails: UI updated for all stops and dashboard list successfully.");

    } catch (error) {
        console.error("Error updating all stop details:", error);
        const allStopsList = document.getElementById('all-stops-list');
        if (allStopsList) {
            allStopsList.innerHTML = `<li class="bg-red-100 text-red-700 p-4 rounded-xl shadow-md text-center">Error updating stop details.</li>`;
            const errorContainer = allStopsList;
            if (errorContainer) showCustomMessage(errorContainer.closest('.view') || document.body, `Error: Failed to update stop details. ${error.message}`, 'error');
        }
        const dashNextArrivalsList = document.getElementById('dash-next-arrivals-list');
        if (dashNextArrivalsList) {
            dashNextArrivalsList.innerHTML = `<li class="text-center text-red-100">Error loading upcoming shuttles.</li>`;
        }
    } finally {
        console.log("updateAllStopDetails: Finished update.");
    }
}

/**
 * Displays a message in the booking message area.
 * @param {string} message - The message text.
 * @param {string} type - 'success', 'error', or 'info'.
 */
function displayBookingMessage(message, type) {
    const bookingMessageDiv = document.getElementById('booking-message');
    showCustomMessage(bookingMessageDiv, message, type);
}


/**
 * Adds a new shuttle booking to Firestore.
 * @param {string} stopId 
 * @param {string} date 
 * @param {string} time 
 * @param {number} passengers 
 * @param {string} name 
 * @param {string} phone 
 */
async function bookShuttle(stopId, date, time, passengers, name, phone) { 
    if (!db || !auth || !isAuthReady) {
        displayBookingMessage('Firebase not ready. Please wait a moment and try again, or sign in.', 'error');
        console.log("bookShuttle: Aborting. Firebase not fully initialized or auth not ready.");
        return;
    }
    if (!isAuthenticated || !userId) {
        displayBookingMessage('Please sign in to book a shuttle.', 'error');
        console.log("bookShuttle: Aborting. User not authenticated. isAuthReady:", isAuthReady, "isAuthenticated:", isAuthenticated, "userId:", userId);
        return;
    }

    try {
        const bookingsCollectionPath = `artifacts/${FIRESTORE_APP_ID_FOR_PATHS}/users/${userId}/bookings`;
        const bookingsCollectionRef = window.collection(db, bookingsCollectionPath);

        console.log("bookShuttle: Attempting to add booking to Firestore path:", bookingsCollectionPath); 

        await window.addDoc(bookingsCollectionRef, {
            stop_id: stopId,
            date: date,
            time: time,
            passengers: parseInt(passengers),
            name: name,
            phone: phone,
            timestamp: new Date().toISOString(), 
            status: 'Confirmed' 
        });
        displayBookingMessage('Shuttle booked successfully!', 'success');
        const bookShuttleForm = document.getElementById('book-shuttle-form');
        if (bookShuttleForm) bookShuttleForm.reset(); 
        console.log("bookShuttle: Booking added successfully to Firestore.");
    } catch (e) {
        console.error("Error adding booking document to Firestore: ", e);
        displayBookingMessage(`Error booking shuttle: ${e.message}. Please try again.`, 'error');
    }
}

/**
 * Displays a confirmation dialog for booking cancellation.
 * @param {string} bookingIdToDelete - The ID of the booking to be cancelled.
 */
function confirmCancelBooking(bookingIdToDelete) {
    // Using a custom modal-like approach instead of native confirm()
    const confirmationModal = document.createElement('div');
    confirmationModal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
    confirmationModal.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-xl text-center max-w-sm mx-auto">
            <h3 class="text-xl font-semibold mb-4 text-gray-800">Confirm Cancellation</h3>
            <p class="mb-6 text-gray-700">Are you sure you want to cancel this booking?</p>
            <div class="flex justify-center space-x-4">
                <button id="cancel-confirm-yes" class="bg-red-500 text-white px-5 py-2 rounded-md hover:bg-red-600 transition duration-200">Yes, Cancel</button>
                <button id="cancel-confirm-no" class="bg-gray-300 text-gray-800 px-5 py-2 rounded-md hover:bg-gray-400 transition duration-200">No, Keep</button>
            </div>
        </div>
    `;
    document.body.appendChild(confirmationModal);

    document.getElementById('cancel-confirm-yes').addEventListener('click', async () => {
        confirmationModal.remove();
        await cancelBooking(bookingIdToDelete);
    });

    document.getElementById('cancel-confirm-no').addEventListener('click', () => {
        confirmationModal.remove();
        console.log("Booking cancellation aborted by user.");
    });
}

/**
 * Deletes a booking from Firestore.
 * @param {string} bookingId - The ID of the booking to delete.
 */
async function cancelBooking(bookingId) {
    console.log("cancelBooking: Attempting to cancel booking with ID:", bookingId);
    if (!db || !auth || !isAuthReady) {
        displayBookingMessage('Firebase not ready. Please wait a moment and try again to cancel.', 'error');
        console.log("cancelBooking: Aborting. Firebase not fully initialized or auth not ready.");
        return;
    }
    if (!isAuthenticated || !userId) {
        displayBookingMessage('Please sign in to cancel bookings.', 'error');
        console.log("cancelBooking: Aborting. User not authenticated.");
        return;
    }
    try {
        const bookingDocPath = `artifacts/${FIRESTORE_APP_ID_FOR_PATHS}/users/${userId}/bookings/${bookingId}`;
        console.log("cancelBooking: Deleting document at path:", bookingDocPath);
        await window.deleteDoc(window.doc(db, bookingDocPath));
        displayBookingMessage('Booking cancelled successfully!', 'success');
        // The onSnapshot listener in fetchMyBookings will automatically update the UI
        console.log("cancelBooking: Booking deleted successfully from Firestore.");
    } catch (error) {
        console.error("cancelBooking: Error deleting booking:", error);
        displayBookingMessage(`Error cancelling booking: ${error.message}`, 'error');
    }
}

/**
 * Fetches and displays user's bookings from Firestore in real-time.
 * Called by onAuthStateChanged whenever auth state changes.
 * @param {Object} currentUser - The Firebase User object.
 */
window.fetchMyBookings = async (currentUser) => { 
    const currentUserId = currentUser ? currentUser.uid : userId;
    console.log("fetchMyBookings: Called with currentUserId:", currentUserId);
    const myBookingsList = document.getElementById('my-bookings-list');

    // Wait until Firebase is fully initialized and auth state is determined
    if (!isAuthReady || !db || !auth) { 
        console.log("fetchMyBookings: Firebase not fully ready (isAuthReady, db, or auth is null). Deferring fetchMyBookings.");
        // Retry shortly. Use a specific flag `isAuthReady` to avoid infinite loops if Firebase never loads.
        setTimeout(() => window.fetchMyBookings(currentUser), 200); 
        return;
    }

    if (!currentUserId) { // If auth is ready but no user (anonymous/signed out)
        console.log("fetchMyBookings: Auth ready but no current user. Not fetching persistent bookings.");
        if (myBookingsList) myBookingsList.innerHTML = '<li class="text-center text-gray-500 text-lg p-4 bg-yellow-50 rounded-md border border-yellow-200">Please <span class="font-bold text-vit-blue cursor-pointer" onclick="document.getElementById(\'login-button\').click()">Login/Sign-up</span> with your phone number to see your persistent bookings. Anonymous bookings may not persist across browser sessions.</li>';
        return;
    }
    
    // Ensure allStopsData is populated before trying to display stop names
    if (allStopsData.length === 0) {
        console.log("fetchMyBookings: allStopsData is empty. Awaiting populateStops completion before displaying bookings.");
        if (myBookingsList) myBookingsList.innerHTML = '<li class="text-center text-gray-500">Loading your bookings... (Awaiting shuttle stop data)</li>';
        setTimeout(() => window.fetchMyBookings(currentUser), 500); // Wait for stops to load
        return;
    }
    console.log("fetchMyBookings: allStopsData is available. Proceeding to fetch bookings from Firestore.");

    if (myBookingsList) myBookingsList.innerHTML = '<li class="text-center text-gray-500">Loading your bookings...</li>';

    try {
        const bookingsCollectionPath = `artifacts/${FIRESTORE_APP_ID_FOR_PATHS}/users/${currentUserId}/bookings`;
        const bookingsCollectionRef = window.collection(db, bookingsCollectionPath);
        
        console.log("fetchMyBookings: Attempting to set up onSnapshot listener for path:", bookingsCollectionPath); 

        // Use onSnapshot for real-time updates. No orderBy in query to avoid index issues, sort in JS.
        window.onSnapshot(bookingsCollectionRef, (snapshot) => {
            console.log("onSnapshot: Callback triggered for bookings. Documents in snapshot:", snapshot.docs.length);
            if (myBookingsList) myBookingsList.innerHTML = ''; // Clear existing list

            if (snapshot.empty) {
                if (myBookingsList) myBookingsList.innerHTML = '<li class="text-center text-gray-500">No bookings found for this user.</li>';
                console.log("onSnapshot: No bookings found for user:", currentUserId);
                return;
            }

            const bookings = [];
            snapshot.forEach((doc) => {
                bookings.push({ id: doc.id, ...doc.data() });
            });

            // Sort bookings in memory by timestamp (newest first)
            bookings.sort((a, b) => {
                const dateA = new Date(a.timestamp);
                const dateB = new Date(b.timestamp);
                return dateB - dateA;
            });

            bookings.forEach((booking) => {
                const bookingId = booking.id;
                // Safely find stop name, handling cases where it might not be found immediately
                const stopName = allStopsData.find(s => s.stop_id === booking.stop_id)?.name || `Unknown Stop (${booking.stop_id})`; 
                
                const li = document.createElement('li');
                li.className = 'bg-gray-100 p-3 rounded-lg shadow-sm flex items-center justify-between hover:bg-gray-200 transition duration-200';
                li.innerHTML = `
                    <div>
                        <p class="font-semibold text-gray-800">Stop: ${stopName}</p>
                        <p class="text-sm text-gray-600">Date: ${booking.date} at ${booking.time}</p>
                        <p class="text-xs text-gray-500">Passengers: ${booking.passengers} | Booked By: ${booking.name || 'N/A'} | Status: ${booking.status}</p>
                    </div>
                    <button class="cancel-booking-btn bg-red-500 text-white px-3 py-1 rounded-md text-sm hover:bg-red-600 transition duration-200">Cancel</button>
                `;
                if (myBookingsList) myBookingsList.appendChild(li);
            });

            // Re-attach event listeners for newly rendered cancel buttons
            document.querySelectorAll('.cancel-booking-btn').forEach(button => {
                button.addEventListener('click', (e) => {
                    const bookingIdToDelete = e.target.dataset.bookingId;
                    confirmCancelBooking(bookingIdToDelete);
                });
            });
            console.log("onSnapshot: Bookings UI rendered successfully.");

        }, (error) => {
            console.error("fetchMyBookings: Error listening to bookings:", error);
            if (myBookingsList) myBookingsList.innerHTML = `<li class="text-center text-red-500">Error loading bookings: ${error.message}</li>`;
            showCustomMessage(myBookingsList.closest('div') || document.body, `Error: Failed to load bookings. ${error.message}`, 'error');
        });
    } catch (error) {
        console.error("fetchMyBookings: Error setting up onSnapshot listener:", error);
        if (myBookingsList) myBookingsList.innerHTML = `<li class="text-center text-red-500">Error initializing booking listener: ${error.message}</li>`;
        showCustomMessage(myBookingsList.closest('div') || document.body, `Error: Failed to initialize booking listener. ${error.message}`, 'error');
    }
};

/**
 * Generates mock data for charts.
 * @returns {Object} An object containing mock ridership and popularity data.
 */
function generateMockChartData() {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const ridershipData = days.map(() => Math.floor(Math.random() * 200) + 100); // 100-300 riders
    
    const stops = [
        'Main Gate', 'Academic Block', 'Library', 'Hostel A', 
        'Food Court', 'Sports Complex', 'Research Park', 'Admin Block'
    ];
    // Assign random popularity percentages that sum up to 100
    const popularityRaw = stops.map(() => Math.random());
    const total = popularityRaw.reduce((sum, val) => sum + val, 0);
    const popularityData = popularityRaw.map(val => ((val / total) * 100).toFixed(1)); // Percentage

    return {
        ridershipLabels: days,
        ridershipData: ridershipData,
        popularityLabels: stops,
        popularityData: popularityData
    };
}


/**
 * Renders the Daily Ridership Bar Chart using Chart.js.
 */
function renderDailyRidershipChart() {
    console.log("renderDailyRidershipChart: Rendering daily ridership chart.");
    const canvas = document.getElementById('ridership-chart');
    if (!canvas) {
        console.warn("renderDailyRidershipChart: Canvas element #ridership-chart not found.");
        return;
    }

    // Destroy existing chart instance if it exists
    if (dailyRidershipChartInstance) {
        dailyRidershipChartInstance.destroy();
        console.log("renderDailyRidershipChart: Destroyed existing ridership chart instance.");
    }

    const mockData = generateMockChartData();

    const ctx = canvas.getContext('2d');
    dailyRidershipChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: mockData.ridershipLabels,
            datasets: [{
                label: 'Daily Ridership',
                data: mockData.ridershipData,
                backgroundColor: [
                    'rgba(0, 51, 102, 0.8)', // VIT Blue
                    'rgba(0, 51, 102, 0.7)',
                    'rgba(0, 51, 102, 0.6)',
                    'rgba(0, 51, 102, 0.7)',
                    'rgba(0, 51, 102, 0.8)',
                    'rgba(0, 51, 102, 0.7)',
                    'rgba(0, 51, 102, 0.6)'
                ],
                borderColor: [
                    'rgba(0, 51, 102, 1)',
                    'rgba(0, 51, 102, 1)',
                    'rgba(0, 51, 102, 1)',
                    'rgba(0, 51, 102, 1)',
                    'rgba(0, 51, 102, 1)',
                    'rgba(0, 51, 102, 1)',
                    'rgba(0, 51, 102, 1)'
                ],
                borderWidth: 1,
                borderRadius: 5,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Daily Ridership Trends',
                    font: {
                        size: 16
                    },
                    color: '#003366'
                },
                legend: {
                    display: false // Hide dataset legend
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Riders',
                        color: '#4A5568'
                    },
                    ticks: {
                        color: '#4A5568'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Day of the Week',
                        color: '#4A5568'
                    },
                    ticks: {
                        color: '#4A5568'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
    console.log("renderDailyRidershipChart: Daily ridership chart rendered.");
}

/**
 * Renders the Most Popular Stops Pie Chart using Chart.js.
 */
function renderPopularityChart() {
    console.log("renderPopularityChart: Rendering most popular stops chart.");
    const canvas = document.getElementById('popularity-chart');
    if (!canvas) {
        console.warn("renderPopularityChart: Canvas element #popularity-chart not found.");
        return;
    }

    // Destroy existing chart instance if it exists
    if (popularityChartInstance) {
        popularityChartInstance.destroy();
        console.log("renderPopularityChart: Destroyed existing popularity chart instance.");
    }

    const mockData = generateMockChartData();

    // Generate distinct colors for pie chart segments
    const backgroundColors = [
        '#003366', // VIT Blue
        '#FFD700', // VIT Gold
        '#4CAF50', // Green
        '#2196F3', // Blue
        '#FF9800', // Orange
        '#9C27B0', // Purple
        '#F44336', // Red
        '#795548'  // Brown
    ];
    const borderColors = backgroundColors.map(color => color); // Opaque border


    const ctx = canvas.getContext('2d');
    popularityChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: mockData.popularityLabels,
            datasets: [{
                label: 'Popularity (%)',
                data: mockData.popularityData,
                backgroundColor: backgroundColors.slice(0, mockData.popularityLabels.length),
                borderColor: borderColors.slice(0, mockData.popularityLabels.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Most Popular Stops (Simulated)',
                    font: {
                        size: 16
                    },
                    color: '#003366'
                },
                legend: {
                    position: 'right', // Place legend on the right for pie chart
                    labels: {
                        color: '#4A5568'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += context.parsed + '%';
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
    console.log("renderPopularityChart: Most popular stops chart rendered.");
}


/**
 * Initializes chart libraries (if used) and renders initial charts.
 */
function initializeCharts() {
    console.log("initializeCharts: Initializing charts.");
    renderDailyRidershipChart();
    renderPopularityChart();
}


/**
 * Displays a custom message inside the selected stop info box.
 * @param {string} message - The message to display.
 * @param {string} type - 'success', 'error', 'info'.
 */
function displaySelectedStopInfoMessage(message, type) {
    const selectedStopInfo = document.getElementById('selected-stop-info');
    showCustomMessage(selectedStopInfo, message, type);
}

/**
 * Updates the selected stop's details on the dashboard.
 * @param {string} stopId - The ID of the selected stop.
 */
async function updateSelectedStopDetails(stopId) {
    console.log("updateSelectedStopDetails: Updating details for stop ID:", stopId);
    const selectedStop = allStopsData.find(s => s.stop_id === stopId);
    const selectedStopInfoDiv = document.getElementById('selected-stop-info');
    const stopNameDisplay = document.getElementById('stop-name-display');
    const predictedWaitTimeDisplay = document.getElementById('predicted-wait-time-display');
    const currentLoadBar = document.getElementById('current-load-bar');
    const currentLoadText = document.getElementById('current-load-text');
    const bookFromStopButton = document.getElementById('book-from-stop-button');

    if (!selectedStop) {
        console.warn("updateSelectedStopDetails: Selected stop not found in data.");
        if (selectedStopInfoDiv) selectedStopInfoDiv.classList.add('hidden');
        if (bookFromStopButton) bookFromStopButton.classList.add('hidden');
        displaySelectedStopInfoMessage('No data available for this stop.', 'info');
        return;
    }

    try {
        // Ensure eel.get_stop_details is defined before calling
        if (typeof eel.get_stop_details !== 'function') {
            console.error("Eel function 'get_stop_details' is not exposed by Python backend.");
            displaySelectedStopInfoMessage('Error: Backend function for stop details is not available. Please check Python console.', 'error');
            return;
        }

        console.log(`updateSelectedStopDetails: Calling eel.get_stop_details(${stopId})...`);
        const stopDetails = await eel.get_stop_details(stopId)();
        console.log("updateSelectedStopDetails: Received stop details from Python:", stopDetails);

        if (!stopDetails) {
            console.warn("updateSelectedStopDetails: No details returned from Python for stop:", stopId);
            displaySelectedStopInfoMessage('Could not load detailed information for this stop. The Python backend might not be providing this data.', 'error');
            return;
        }

        if (stopNameDisplay) stopNameDisplay.textContent = stopDetails.name;
        if (predictedWaitTimeDisplay) predictedWaitTimeDisplay.textContent = stopDetails.predicted_wait_time || 'N/A';
        
        let loadPercentage = stopDetails.current_load_percentage || 0;
        if (currentLoadText) currentLoadText.textContent = `${loadPercentage}% occupancy`;
        if (currentLoadBar) {
            currentLoadBar.style.width = `${loadPercentage}%`;
            if (loadPercentage < 50) {
                currentLoadBar.className = 'h-2.5 rounded-full bg-green-500';
            } else if (loadPercentage < 80) {
                currentLoadBar.className = 'h-2.5 rounded-full bg-yellow-500';
            } else {
                currentLoadBar.className = 'h-2.5 rounded-full bg-red-500';
            }
        }
        
        if (selectedStopInfoDiv) selectedStopInfoDiv.classList.remove('hidden');
        if (bookFromStopButton) bookFromStopButton.classList.remove('hidden');

    } catch (error) {
        console.error("updateSelectedStopDetails: Error fetching stop details from Eel:", error);
        displaySelectedStopInfoMessage(`Failed to load stop details: ${error.message}. Please check backend logs.`, 'error');
    }
}


// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOMContentLoaded: All HTML parsed and DOM tree built.");

    // Set current year in footer
    const currentYearElem = document.getElementById('current-year');
    if (currentYearElem) currentYearElem.textContent = new Date().getFullYear();

    // Initialize Firebase
    // This is async and sets isAuthReady flag on completion of auth state check
    await initializeFirebase();
    console.log("DOMContentLoaded: Firebase initialization awaited. isAuthReady will be set by onAuthStateChanged.");

    // Initialize Leaflet map (this is now a no-op as map is iframe)
    initializeMap(); 
    console.log("DOMContentLoaded: Leaflet map initialization (or skip) awaited.");

    // Core data loading and UI updates, dependent on Firebase readiness.
    // Use a setTimeout to ensure initializeFirebase has a chance to set isAuthReady
    // onAuthStateChanged might fire asynchronously AFTER initial DOMContentLoaded execution completes.
    const startInitialDataLoad = async () => {
        if (!isAuthReady || !db || !auth) {
            console.log("Initial data load deferred: Firebase Auth/DB not ready yet. Retrying in 100ms.");
            setTimeout(startInitialDataLoad, 100);
            return;
        }
        console.log("Initial data load started: Firebase Auth and DB are ready.");

        try {
            // Populate stops data and then update UI elements that depend on it
            await populateStops();
            console.log("DOMContentLoaded: Stops data populated.");
            // Populate frequent route selects immediately after allStopsData is ready
            populateFrequentRouteSelects(); 

            // Initial Dashboard live overview update
            await updateDashboardLiveOverview();
            console.log("DOMContentLoaded: Initial dashboard live overview updated.");

            // Set up periodic updates for live data
            setInterval(async () => {
                console.log("Interval: Running periodic dashboard and stop details update.");
                await updateDashboardLiveOverview();
                await updateAllStopDetails();
            }, 15000); // Update every 15 seconds

            // Initialize charts once all data and Firebase are ready
            initializeCharts();
            console.log("DOMContentLoaded: Initial charts rendered.");

            // Generate initial commute history
            generateMockCommuteHistory();
            console.log("DOMContentLoaded: Initial commute history generated.");

            // Render initial commute visualization
            renderCommuteVisualization();
            console.log("DOMContentLoaded: Initial commute visualization rendered.");


        } catch (error) {
            console.error("Error during initial data load:", error);
            showCustomMessage(document.body, `Failed to load initial data. Please check Python backend and console for errors. ${error.message}`, 'error');
        }
    };
    // Start the process
    startInitialDataLoad();


    // Navigation and Mobile Menu Event Listeners (always attach immediately)
    document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const viewId = e.target.dataset.view;
            activateView(viewId);
        });
    });

    document.getElementById('mobile-menu-button').addEventListener('click', () => {
        const mobileMenu = document.getElementById('mobile-menu');
        const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
        if (mobileMenu && mobileMenuOverlay) {
            mobileMenu.classList.remove('translate-x-full');
            mobileMenu.classList.add('translate-x-0');
            mobileMenuOverlay.classList.remove('hidden');
        }
    });

    document.getElementById('close-mobile-menu').addEventListener('click', () => {
        const mobileMenu = document.getElementById('mobile-menu');
        const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
        if (mobileMenu && mobileMenuOverlay) {
            mobileMenu.classList.remove('translate-x-0');
            mobileMenu.classList.add('translate-x-full');
            mobileMenuOverlay.classList.add('hidden');
        }
    });

    document.getElementById('mobile-menu-overlay').addEventListener('click', () => {
        const mobileMenu = document.getElementById('mobile-menu');
        const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
        if (mobileMenu && mobileMenuOverlay) {
            mobileMenu.classList.remove('translate-x-0');
            mobileMenu.classList.add('translate-x-full');
            mobileMenuOverlay.classList.add('hidden');
        }
    });

    // Login/Auth Modal Event Listeners
    const loginButton = document.getElementById('login-button');
    const authModal = document.getElementById('auth-modal');
    const closeAuthModalButton = document.getElementById('close-auth-modal');
    const phoneInput = document.getElementById('phone-input');
    const sendOtpButton = document.getElementById('send-otp-button');
    const otpSection = document.getElementById('otp-section');
    const otpInput = document.getElementById('otp-input');
    const verifyOtpButton = document.getElementById('verify-otp-button');
    const recaptchaContainer = document.getElementById('recaptcha-container');
    const authNameInput = document.getElementById('auth-name');


    if (loginButton) {
        loginButton.addEventListener('click', () => {
            if (isAuthenticated) {
                // Logout logic
                if (auth) {
                    window.signOut(auth).then(() => {
                        console.log("User signed out.");
                        displayAuthMessage('You have been logged out.', 'info');
                        // UI will update via onAuthStateChanged listener
                    }).catch((error) => {
                        console.error("Error signing out:", error);
                        displayAuthMessage(`Error during logout: ${error.message}`, 'error');
                    });
                }
            } else {
                // Show login modal
                if (authModal && phoneInput && otpInput && authNameInput && otpSection && sendOtpButton && recaptchaContainer) {
                    authModal.classList.remove('hidden');
                    phoneInput.value = '';
                    otpInput.value = '';
                    authNameInput.value = '';
                    otpSection.classList.add('hidden');
                    displayAuthMessage('', 'info'); // Clear previous messages
                    sendOtpButton.disabled = true;
                    sendOtpButton.textContent = "Send OTP";

                    // Render reCAPTCHA
                    if (recaptchaVerifier) {
                        recaptchaVerifier.clear(); // Clear previous instance if any
                    }
                    if (auth) { // Ensure auth is initialized before creating RecaptchaVerifier
                        recaptchaVerifier = new window.RecaptchaVerifier(recaptchaContainer, {
                            'size': 'normal',
                            'callback': (response) => {
                                console.log("reCAPTCHA solved!");
                                sendOtpButton.disabled = false;
                            },
                            'expired-callback': () => {
                                console.warn("reCAPTCHA expired. Please re-verify.");
                                sendOtpButton.disabled = true;
                                displayAuthMessage("reCAPTCHA expired. Please re-verify.", 'error');
                            }
                        }, auth);
                        recaptchaVerifier.render().then((widgetId) => {
                            window.recaptchaWidgetId = widgetId;
                            console.log("reCAPTCHA rendered with widgetId:", widgetId);
                        }).catch(error => {
                            console.error("Error rendering reCAPTCHA:", error);
                            displayAuthMessage(`Error loading reCAPTCHA: ${error.message}`, 'error');
                        });
                    } else {
                        console.error("Firebase Auth not initialized, cannot render reCAPTCHA.");
                        displayAuthMessage("Firebase Auth not ready. Cannot proceed with login.", 'error');
                    }
                } else {
                    console.error("Missing one or more auth modal elements.");
                }
            }
        });
    } else {
        console.warn("Element #login-button not found.");
    }


    if (closeAuthModalButton) {
        closeAuthModalButton.addEventListener('click', () => {
            if (authModal && phoneInput && otpInput && authNameInput && otpSection) {
                authModal.classList.add('hidden');
                if (recaptchaVerifier) {
                    recaptchaVerifier.clear();
                    console.log("reCAPTCHA cleared on modal close.");
                }
                // Clear form fields
                phoneInput.value = '';
                otpInput.value = '';
                authNameInput.value = '';
                otpSection.classList.add('hidden');
                displayAuthMessage('', 'info'); // Clear any messages
            }
        });
    } else {
        console.warn("Element #close-auth-modal not found.");
    }

    if (sendOtpButton) {
        sendOtpButton.addEventListener('click', async () => {
            const phoneNumber = phoneInput.value.trim();
            if (!phoneNumber) {
                displayAuthMessage("Please enter your phone number.", 'error');
                return;
            }
            if (!auth || !recaptchaVerifier) {
                displayAuthMessage("Firebase Auth or reCAPTCHA not ready. Please try again.", 'error');
                console.error("sendOtpButton: Auth or reCAPTCHA not initialized.");
                return;
            }

            displayAuthMessage("Sending OTP...", 'info');
            sendOtpButton.disabled = true;

            try {
                // signInWithPhoneNumber takes the RecaptchaVerifier instance directly
                confirmationResult = await window.signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
                if (otpSection) otpSection.classList.remove('hidden');
                displayAuthMessage("OTP sent! Please enter the code.", 'success');
                sendOtpButton.textContent = "Resend OTP"; // Change text for subsequent sends
            } catch (error) {
                console.error("Error sending OTP:", error);
                displayAuthMessage(`Error sending OTP: ${error.message}`, 'error');
                sendOtpButton.disabled = false; // Re-enable button
                sendOtpButton.textContent = "Send OTP";
                if (recaptchaVerifier) {
                    recaptchaVerifier.clear(); // Clear reCAPTCHA on send error
                    recaptchaVerifier.render().then((widgetId) => {
                        window.recaptchaWidgetId = widgetId;
                    });
                }
            }
        });
    } else {
        console.warn("Element #send-otp-button not found.");
    }

    if (verifyOtpButton) {
        verifyOtpButton.addEventListener('click', async () => {
            const otpCode = otpInput.value.trim();
            if (!otpCode) {
                displayAuthMessage("Please enter the OTP.", 'error');
                return;
            }
            if (!confirmationResult) {
                displayAuthMessage("No OTP sent. Please request an OTP first.", 'error');
                return;
            }

            displayAuthMessage("Verifying OTP...", 'info');
            verifyOtpButton.disabled = true;

            try {
                const userCredential = await confirmationResult.confirm(otpCode);
                const user = userCredential.user;
                console.log("User signed in:", user.uid);
                displayAuthMessage("Login successful!", 'success');

                // Save or update user profile with name and phone number
                const userName = authNameInput.value.trim();
                if (user && userName) {
                    await saveUserProfile(user.uid, userName, phoneInput.value.trim());
                }

                setTimeout(() => {
                    if (authModal) authModal.classList.add('hidden');
                    // UI update will be handled by onAuthStateChanged listener
                }, 1000);

            } catch (error) {
                console.error("Error verifying OTP:", error);
                displayAuthMessage(`Error verifying OTP: ${error.message}`, 'error');
                verifyOtpButton.disabled = false;
            }
        });
    } else {
        console.warn("Element #verify-otp-button not found.");
    }

    // Dashboard Stop Select Change Listener
    const shuttleStopSelect = document.getElementById('shuttle-stop-select');
    if (shuttleStopSelect) {
        shuttleStopSelect.addEventListener('change', async (e) => {
            const selectedStopId = e.target.value;
            if (selectedStopId) {
                await updateSelectedStopDetails(selectedStopId);
            } else {
                // Hide details if "Select a Stop" is chosen
                const selectedStopInfoDiv = document.getElementById('selected-stop-info');
                const bookFromStopButton = document.getElementById('book-from-stop-button');
                if (selectedStopInfoDiv) selectedStopInfoDiv.classList.add('hidden');
                if (bookFromStopButton) bookFromStopButton.classList.add('hidden');
            }
        });
    } else {
        console.warn("Element #shuttle-stop-select not found. Dashboard stop selection won't work.");
    }

    // Book from here button on Dashboard
    const bookFromStopButton = document.getElementById('book-from-stop-button');
    if (bookFromStopButton) {
        bookFromStopButton.addEventListener('click', () => {
            if (!shuttleStopSelect) {
                console.error("bookFromStopButton click: #shuttle-stop-select not found.");
                displaySelectedStopInfoMessage("Internal error: Stop selection element missing.", 'error');
                return;
            }
            const selectedStopId = shuttleStopSelect.value;
            if (selectedStopId) {
                activateView('book-shuttle-view');
                const bookingStopSelect = document.getElementById('booking-stop-select');
                if (bookingStopSelect) {
                    bookingStopSelect.value = selectedStopId;
                }
            } else {
                displaySelectedStopInfoMessage("Please select a stop first to book.", 'info');
            }
        });
    } else {
        console.warn("Element #book-from-stop-button not found.");
    }

    // Book Shuttle Form Submission
    const bookShuttleForm = document.getElementById('book-shuttle-form');
    if (bookShuttleForm) {
        bookShuttleForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('booking-name')?.value;
            const phone = document.getElementById('booking-phone')?.value;
            const stopId = document.getElementById('booking-stop-select')?.value;
            const date = document.getElementById('booking-date')?.value;
            const time = document.getElementById('booking-time')?.value;
            const passengers = document.getElementById('booking-passengers')?.value;

            if (!name || !phone || !stopId || !date || !time || !passengers) {
                displayBookingMessage('Please fill in all booking details.', 'error');
                return;
            }

            await bookShuttle(stopId, date, time, passengers, name, phone);
        });
    } else {
        console.warn("Element #book-shuttle-form not found.");
    }


    // --- My Commute Tab Enhancements Event Listeners ---
    const addFrequentRouteButton = document.getElementById('add-frequent-route');
    const frequentRouteNameInput = document.getElementById('frequent-route-name');
    const frequentRouteOriginSelect = document.getElementById('frequent-route-origin');
    const frequentRouteDestinationSelect = document.getElementById('frequent-route-destination');
    const frequentRoutesList = document.getElementById('frequent-routes-list');
    const commuteMessageContainer = document.getElementById('commute-message-container'); // New element for messages


    // Add Frequent Route Button Listener
    if (addFrequentRouteButton) {
        addFrequentRouteButton.addEventListener('click', () => {
            console.log("Add Frequent Route button clicked.");
            const routeName = frequentRouteNameInput?.value.trim();
            const originId = frequentRouteOriginSelect?.value;
            const destinationId = frequentRouteDestinationSelect?.value;

            if (!routeName || !originId || !destinationId) {
                showCustomMessage(commuteMessageContainer, 'Please fill all fields to add a frequent route.', 'error');
                console.warn("Missing fields for frequent route.");
                return;
            }

            if (originId === destinationId) {
                showCustomMessage(commuteMessageContainer, 'Origin and Destination cannot be the same for a frequent route.', 'error');
                console.warn("Origin and Destination are the same.");
                return;
            }

            const originName = allStopsData.find(s => s.stop_id === originId)?.name || originId;
            const destinationName = allStopsData.find(s => s.stop_id === destinationId)?.name || destinationId;

            const li = document.createElement('li');
            li.className = 'bg-gray-100 p-3 rounded-lg flex justify-between items-center shadow-sm hover:bg-gray-200 transition duration-200';
            li.innerHTML = `
                <div>
                    <p class="font-semibold text-gray-800">${routeName}</p>
                    <p class="text-sm text-gray-600">${originName} &rarr; ${destinationName}</p>
                </div>
                <button class="remove-frequent-route-btn bg-red-500 text-white px-3 py-1 rounded-md text-sm hover:bg-red-600 transition duration-200">Remove</button>
            `;
            if (frequentRoutesList) {
                // Check if the "No frequent routes added yet." placeholder exists and remove it
                const placeholder = frequentRoutesList.querySelector('.text-center.text-gray-500');
                if (placeholder && placeholder.textContent.includes("No frequent routes added yet.")) {
                    placeholder.remove();
                }
                frequentRoutesList.appendChild(li);
            }
            
            // Add event listener for the new remove button
            li.querySelector('.remove-frequent-route-btn')?.addEventListener('click', (e) => {
                const itemToRemove = e.target.closest('li');
                if (itemToRemove) {
                    itemToRemove.remove();
                    showCustomMessage(commuteMessageContainer, 'Route removed.', 'info');
                    // If list becomes empty, re-add placeholder
                    if (frequentRoutesList && frequentRoutesList.children.length === 0) {
                        const emptyLi = document.createElement('li');
                        emptyLi.className = 'text-center text-gray-500';
                        emptyLi.textContent = 'No frequent routes added yet.';
                        frequentRoutesList.appendChild(emptyLi);
                    }
                }
            });

            showCustomMessage(commuteMessageContainer, 'Frequent route added successfully!', 'success');
            // Clear form fields
            if (frequentRouteNameInput) frequentRouteNameInput.value = '';
            if (frequentRouteOriginSelect) frequentRouteOriginSelect.value = '';
            if (frequentRouteDestinationSelect) frequentRouteDestinationSelect.value = '';
        });
    } else {
        console.warn("Element #add-frequent-route not found.");
    }

    // Mock Commute History
    const commuteHistoryList = document.getElementById('commute-history-list');
    const generateMockCommuteHistory = () => {
        if (!commuteHistoryList) {
            console.warn("generateMockCommuteHistory: #commute-history-list not found.");
            return;
        }
        commuteHistoryList.innerHTML = ''; // Clear existing
        const historyItems = [
            { date: '2025-06-12', from: 'Hostel Block A', to: 'Academic Block', time: '08:15 AM' },
            { date: '2025-06-11', from: 'Library Block', to: 'Food Court', time: '01:00 PM' },
            { date: '2025-06-10', from: 'Main Gate', to: 'Sports Complex', time: '06:30 PM' },
            { date: '2025-06-09', from: 'Academic Block', to: 'Hostel Block A', time: '05:00 PM' },
        ];
        
        if (historyItems.length === 0) {
            const li = document.createElement('li');
            li.className = 'text-center text-gray-500';
            li.textContent = 'No commute history recorded yet.';
            commuteHistoryList.appendChild(li);
        } else {
            historyItems.forEach(item => {
                const li = document.createElement('li');
                li.className = 'bg-gray-100 p-3 rounded-lg shadow-sm hover:bg-gray-200 transition duration-200';
                li.innerHTML = `
                    <p class="font-semibold text-gray-800">${item.date}</p>
                    <p class="text-sm text-gray-600">${item.from} &rarr; ${item.to} at ${item.time}</p>
                `;
                commuteHistoryList.appendChild(li);
            });
        }
        console.log("Mock commute history generated.");
    };
    // Initial call to generate history
    generateMockCommuteHistory();


    // --- Campus AI Assistant Event Listeners ---
    // The main button for the AI assistant is now the parent card for better UX.
    const openCampusAiButtonCard = document.getElementById('open-campus-ai-button-card');
    const campusAiModal = document.getElementById('campus-ai-modal');
    const closeCampusAiModalButton = document.getElementById('close-campus-ai-modal');
    const campusAiQuestionInput = document.getElementById('campus-ai-question');
    const getCampusAiAnswerButton = document.getElementById('get-campus-ai-answer-button');
    const aiLoadingSpinner = document.getElementById('ai-loading-spinner');
    const aiButtonText = document.getElementById('ai-button-text');
    const campusAiAnswerDiv = document.getElementById('campus-ai-answer');
    const campusAiMessageDiv = document.getElementById('campus-ai-message');


    if (openCampusAiButtonCard) { // Listen on the card itself
        openCampusAiButtonCard.addEventListener('click', () => {
            if (campusAiModal) campusAiModal.classList.remove('hidden');
            if (campusAiQuestionInput) campusAiQuestionInput.value = ''; // Clear previous question
            if (campusAiAnswerDiv) campusAiAnswerDiv.innerHTML = '<p class="text-gray-500">Your answer will appear here...</p>'; // Reset answer
            if (campusAiMessageDiv) campusAiMessageDiv.classList.add('hidden'); // Hide any previous messages
        });
    } else {
        console.warn("Element #open-campus-ai-button-card not found.");
    }

    if (closeCampusAiModalButton) {
        closeCampusAiModalButton.addEventListener('click', () => {
            if (campusAiModal) campusAiModal.classList.add('hidden');
            if (campusAiQuestionInput) campusAiQuestionInput.value = '';
            if (campusAiAnswerDiv) campusAiAnswerDiv.innerHTML = '<p class="text-gray-500">Your answer will appear here...</p>';
            if (campusAiMessageDiv) campusAiMessageDiv.classList.add('hidden');
            if (aiLoadingSpinner) aiLoadingSpinner.classList.add('hidden'); // Ensure spinner is hidden on close
            if (aiButtonText) aiButtonText.textContent = "Get Answer"; // Reset button text
            if (getCampusAiAnswerButton) getCampusAiAnswerButton.disabled = false; // Enable button
        });
    } else {
        console.warn("Element #close-campus-ai-modal not found.");
    }

    if (getCampusAiAnswerButton) {
        getCampusAiAnswerButton.addEventListener('click', () => {
            if (campusAiQuestionInput) {
                const question = campusAiQuestionInput.value;
                askCampusAIAssistant(question);
            } else {
                console.error("askCampusAIAssistant: campusAiQuestionInput is null.");
                if (campusAiMessageDiv) showCustomMessage(campusAiMessageDiv, "Error: Question input element not found.", 'error');
            }
        });
    } else {
        console.warn("Element #get-campus-ai-answer-button not found.");
    }

    if (campusAiQuestionInput) {
        campusAiQuestionInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { // Check for Enter key without Shift
                e.preventDefault(); // Prevent new line
                if (getCampusAiAnswerButton) getCampusAiAnswerButton.click(); // Trigger button click
            }
        });
    } else {
        console.warn("Element #campus-ai-question not found.");
    }

});


/**
 * Calls the Gemini API to get an answer to a campus-related question.
 * @param {string} question - The user's question about the campus.
 */
async function askCampusAIAssistant(question) {
    // Get references to elements within the modal
    const campusAiQuestionInput = document.getElementById('campus-ai-question');
    const getCampusAiAnswerButton = document.getElementById('get-campus-ai-answer-button');
    const aiLoadingSpinner = document.getElementById('ai-loading-spinner');
    const aiButtonText = document.getElementById('ai-button-text');
    const campusAiAnswerDiv = document.getElementById('campus-ai-answer');
    const campusAiMessageDiv = document.getElementById('campus-ai-message');

    // --- IMPORTANT: Replace "YOUR_GEMINI_API_KEY_HERE" with your actual Gemini API Key ---
    const GEMINI_API_KEY = "AIzaSyBSNveoEK7grEcCWDV_16MilvdKcELtytE"; 
    // If you plan to deploy this, ensure your API key is managed securely (e.g., environment variables, backend proxy).
    // For local development with Eel, direct insertion is okay for quick testing.

    if (!question.trim()) {
        if(campusAiMessageDiv) showCustomMessage(campusAiMessageDiv, "Please enter a question.", 'error');
        return;
    }

    if(aiLoadingSpinner) aiLoadingSpinner.classList.remove('hidden');
    if(aiButtonText) aiButtonText.textContent = "Getting Answer...";
    if(getCampusAiAnswerButton) getCampusAiAnswerButton.disabled = true;
    if(campusAiAnswerDiv) campusAiAnswerDiv.innerHTML = '<p class="text-gray-500">Thinking...</p>';
    if(campusAiMessageDiv) campusAiMessageDiv.classList.add('hidden'); // Hide any previous messages at start of new query

    try {
        let chatHistory = [];
        // Provide context about VIT Vellore campus for better answers
        chatHistory.push({ role: "user", parts: [{ text: `You are a helpful assistant providing information about VIT Vellore campus. Answer the following question about VIT Vellore. Be concise and direct: ${question}` }] });
        
        const payload = { contents: chatHistory };
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`; // Use the inserted API key

        console.log("Calling Gemini API with payload:", payload);
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Gemini API HTTP Error: ${response.status} - ${response.statusText}`, errorBody);
            // Attempt to parse errorBody as JSON if it looks like one
            try {
                const errorJson = JSON.parse(errorBody);
                if(errorJson.error && errorJson.error.message) {
                    throw new Error(`API call failed: ${errorJson.error.message} (Code: ${response.status})`);
                }
            } catch (parseError) {
                // If it's not JSON, or parsing fails, use the raw text.
                throw new Error(`API call failed with status ${response.status}. Body: ${errorBody}`);
            }
        }

        const result = await response.json();
        console.log("Gemini API raw response:", result);

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const text = result.candidates[0].content.parts[0].text;
            if(campusAiAnswerDiv) campusAiAnswerDiv.innerHTML = `<p>${text}</p>`;
            if(campusAiMessageDiv) showCustomMessage(campusAiMessageDiv, "Answer received!", 'success');
        } else {
            console.error("Gemini API response structure unexpected or no candidates:", result);
            if(campusAiAnswerDiv) campusAiAnswerDiv.innerHTML = `<p class="text-red-500">Sorry, I couldn't get an answer. The AI response was empty or malformed. Please try rephrasing your question.</p>`;
            if(campusAiMessageDiv) showCustomMessage(campusAiMessageDiv, "Failed to get an answer.", 'error');
        }
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        if(campusAiAnswerDiv) campusAiAnswerDiv.innerHTML = `<p class="text-red-500">An error occurred while fetching the answer: ${error.message}</p>`;
        if(campusAiMessageDiv) showCustomMessage(campusAiMessageDiv, `Error: ${error.message}`, 'error');
    } finally {
        if(aiLoadingSpinner) aiLoadingSpinner.classList.add('hidden');
        if(aiButtonText) aiButtonText.textContent = "Get Answer";
        if(getCampusAiAnswerButton) getCampusAiAnswerButton.disabled = false;
    }
}


/**
 * Renders a simulated commute visualization (heatmap) on a canvas.
 */
function renderCommuteVisualization() {
    console.log("renderCommuteVisualization: Starting to render commute visualization.");
    const canvas = document.getElementById('commute-visualization-canvas');
    if (!canvas) {
        console.warn("renderCommuteVisualization: Canvas element #commute-visualization-canvas not found.");
        return;
    }

    const ctx = canvas.getContext('2d');
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    // Set canvas dimensions to be responsive (important for hi-res drawing)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Stop any existing animation loop
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    // Define approximate pixel coordinates for key stops on our conceptual campus map
    // These are relative to the canvas and need to be consistent.
    const stopPositions = {
        'Main Gate': { x: width * 0.15, y: height * 0.85 },
        'Academic Block': { x: width * 0.45, y: height * 0.25 },
        'Library Block': { x: width * 0.60, y: height * 0.35 },
        'Hostel Block A': { x: width * 0.25, y: height * 0.65 },
        'Food Court': { x: width * 0.70, y: height * 0.50 },
        'Sports Complex': { x: width * 0.85, y: height * 0.70 },
        'Admin Block': { x: width * 0.40, y: height * 0.15 },
        'Research Park': { x: width * 0.75, y: height * 0.10 }
    };

    // Define some mock frequent commute routes with intensity
    const frequentCommutes = [
        { from: 'Hostel Block A', to: 'Academic Block', intensity: 5 }, // High frequency
        { from: 'Main Gate', to: 'Food Court', intensity: 3 },
        { from: 'Academic Block', to: 'Library Block', intensity: 4 },
        { from: 'Research Park', to: 'Admin Block', intensity: 2 },
        { from: 'Sports Complex', to: 'Hostel Block A', intensity: 1 },
        { from: 'Library Block', to: 'Main Gate', intensity: 2.5 }
    ];

    // Animation Loop
    const animateCommute = () => {
        // Clear canvas for each frame
        ctx.clearRect(0, 0, width, height);

        // Fill background
        ctx.fillStyle = '#f0f4f8'; // Light background for the "map"
        ctx.fillRect(0, 0, width, height);

        // Mock "campus" area for context (simple rectangle)
        ctx.strokeStyle = '#a0aec0';
        ctx.lineWidth = 2;
        ctx.strokeRect(50, 50, width - 100, height - 100);
        ctx.fillStyle = '#e2e8f0'; // Lighter fill for campus area
        ctx.fillRect(50, 50, width - 100, height - 100);

        // Draw commute paths
        frequentCommutes.forEach(commute => {
            const startPos = stopPositions[commute.from];
            const endPos = stopPositions[commute.to];

            if (startPos && endPos) {
                ctx.beginPath();
                ctx.moveTo(startPos.x, startPos.y);
                
                // Draw a slightly curved line for better visual separation if paths cross
                const controlPointX = (startPos.x + endPos.x) / 2 + (endPos.y - startPos.y) * 0.1;
                const controlPointY = (startPos.y + endPos.y) / 2 - (endPos.x - startPos.x) * 0.1;
                ctx.quadraticCurveTo(controlPointX, controlPointY, endPos.x, endPos.y);

                // Set line properties based on intensity
                const lineWidth = 2 + (commute.intensity * 0.8); // Thicker for higher intensity
                const opacity = 0.4 + (commute.intensity * 0.1); // Darker for higher intensity
                ctx.strokeStyle = `rgba(0, 51, 102, ${opacity})`; // VIT Blue with varying opacity
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round'; // Rounded line caps

                // Apply dashed line animation
                ctx.setLineDash([20, 10]); // Dash length 20, space 10
                ctx.lineDashOffset = -dashOffset; // Animate the offset
                ctx.stroke();

                // Draw arrow head (simple triangle)
                // Need to draw the arrowhead AFTER applying lineDashOffset, so it appears solid.
                ctx.setLineDash([]); // Reset line dash for solid arrow head
                const angle = Math.atan2(endPos.y - startPos.y, endPos.x - startPos.x);
                const arrowSize = 6;
                ctx.save();
                ctx.translate(endPos.x, endPos.y);
                ctx.rotate(angle);
                ctx.fillStyle = `rgba(0, 51, 102, ${opacity})`;
                ctx.beginPath();
                ctx.moveTo(-arrowSize, arrowSize / 2);
                ctx.lineTo(0, 0);
                ctx.lineTo(-arrowSize, -arrowSize / 2);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        });

        // Draw stops as circles (on top of paths)
        for (const stopName in stopPositions) {
            const pos = stopPositions[stopName];
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2); // Circle for stop
            ctx.fillStyle = '#003366'; // VIT Blue for stops
            ctx.fill();
            ctx.strokeStyle = '#FFD700'; // VIT Gold border
            ctx.lineWidth = 2;
            ctx.stroke();

            // Add stop label
            ctx.fillStyle = '#333';
            ctx.font = '10px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(stopName, pos.x, pos.y + 12);
        }

        // Update dash offset for animation
        dashOffset = (dashOffset + 0.5) % 200; // Adjust speed and cycle length

        // Add a simple legend (always drawn on top)
        const legendX = width * 0.05;
        const legendY = height * 0.05;
        ctx.fillStyle = '#333';
        ctx.font = '12px Inter';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Legend:', legendX, legendY);

        // High Traffic
        ctx.strokeStyle = `rgba(0, 51, 102, 0.9)`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(legendX + 5, legendY + 20);
        ctx.lineTo(legendX + 45, legendY + 20);
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.fillText('High Traffic', legendX + 55, legendY + 15);

        // Low Traffic
        ctx.strokeStyle = `rgba(0, 51, 102, 0.4)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(legendX + 5, legendY + 40);
        ctx.lineTo(legendX + 45, legendY + 40);
        ctx.stroke();
        ctx.fillStyle = '#333';
        ctx.fillText('Low Traffic', legendX + 55, legendY + 35);


        animationFrameId = requestAnimationFrame(animateCommute);
    };

    // Start the animation
    animateCommute();
    console.log("renderCommuteVisualization: Commute visualization animation started.");
}
