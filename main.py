import eel
import random
import time
import json 
import os 

# Initialize Eel
eel.init('www')

# --- Mock Data Generation Functions ---

def generate_shuttle_stops_data():
    """Generates a list of mock shuttle stops."""
    stops = [
        {"stop_id": "stop1", "name": "Main Gate", "latitude": 12.9699, "longitude": 79.1559},
        {"stop_id": "stop2", "name": "Academic Block", "latitude": 12.9710, "longitude": 79.1570},
        {"stop_id": "stop3", "name": "Library Block", "latitude": 12.9730, "longitude": 79.1580},
        {"stop_id": "stop4", "name": "Hostel Block A", "latitude": 12.9680, "longitude": 79.1540},
        {"stop_id": "stop5", "name": "Food Court", "latitude": 12.9705, "longitude": 79.1550},
        {"stop_id": "stop6", "name": "Sports Complex", "latitude": 12.9670, "longitude": 79.1565},
        {"stop_id": "stop7", "name": "Admin Block", "latitude": 12.9720, "longitude": 79.1560},
        {"stop_id": "stop8", "name": "Research Park", "latitude": 12.9740, "longitude": 79.1590},
    ]
    print("Generated mock stops data.")
    return stops

def generate_live_shuttle_data():
    """Generates mock live shuttle data."""
    active_shuttles = random.randint(3, 8)
    total_shuttles = 10
    avg_wait_time = f"{random.randint(2, 15)} min"
    
    # Mock shuttle positions (these won't be used by the iframe map but for completeness)
    shuttles = []
    for i in range(active_shuttles):
        shuttles.append({
            "shuttle_id": f"shuttle{i+1}",
            "latitude": 12.96 + random.uniform(-0.01, 0.01),
            "longitude": 79.15 + random.uniform(-0.01, 0.01),
            "route": f"Route {chr(65 + random.randint(0, 2))}", # A, B, or C
            "status": random.choice(["On Route", "Approaching", "At Stop"]),
            "passengers": random.randint(5, 25)
        })

    print("Generated mock live shuttle data.")
    return {
        "active_shuttles_count": active_shuttles,
        "total_shuttles": total_shuttles,
        "avg_wait_time": avg_wait_time,
        "shuttles": shuttles
    }

def generate_next_arrivals_data(stops_data):
    """Generates mock next arrival times and wait times for all stops."""
    arrivals_data = []
    for stop in stops_data:
        predicted_wait_min = random.randint(1, 20)
        
        wait_time_class = "text-green-600"
        if predicted_wait_min > 10:
            wait_time_class = "text-yellow-600"
        if predicted_wait_min > 15:
            wait_time_class = "text-red-600"
            
        # Simulate some stops having no immediate next arrival
        next_arrival_time = "No upcoming"
        if random.random() > 0.1: # 90% chance of having an arrival
            # Generate a realistic-looking time (e.g., HH:MM)
            current_hour = time.localtime().tm_hour
            current_minute = time.localtime().tm_min
            
            # Add a random offset for future time
            future_minute = current_minute + predicted_wait_min + random.randint(0, 5)
            future_hour = current_hour + (future_minute // 60)
            future_minute = future_minute % 60
            
            next_arrival_time = f"{future_hour:02d}:{future_minute:02d}"

        arrivals_data.append({
            "stop_id": stop["stop_id"],
            "stop_name": stop["name"],
            "predicted_wait_time": f"{predicted_wait_min} min",
            "wait_time_class": wait_time_class,
            "next_arrival": next_arrival_time
        })
    print("Generated mock next arrivals data.")
    return arrivals_data

def generate_stop_details_data(stop_id):
    """Generates mock detailed data for a specific stop."""
    stops = generate_shuttle_stops_data() # Reuse stop data
    selected_stop = next((s for s in stops if s["stop_id"] == stop_id), None)

    if selected_stop:
        predicted_wait_min = random.randint(1, 20)
        current_load_percentage = random.randint(10, 100) # 10-100% load
        
        details = {
            "stop_id": stop_id,
            "name": selected_stop["name"],
            "predicted_wait_time": f"{predicted_wait_min} min",
            "current_load_percentage": current_load_percentage,
            "next_arrival_shuttle_id": f"S{random.randint(101, 199)}",
            "last_shuttle_time": "14:30" # Mock value
        }
        print(f"Generated mock details for stop: {stop_id}")
        return details
    print(f"No mock details found for stop: {stop_id}")
    return None

# --- Eel Exposed Functions ---

@eel.expose
def get_shuttle_stops():
    """Returns mock data for all shuttle stops."""
    return generate_shuttle_stops_data()

@eel.expose
def get_live_shuttle_data():
    """Returns mock live shuttle data."""
    return generate_live_shuttle_data()

@eel.expose
def get_next_arrivals_for_all_stops():
    """Returns mock next arrival times for all stops."""
    stops = generate_shuttle_stops_data()
    return generate_next_arrivals_data(stops)

@eel.expose
def get_stop_details(stop_id):
    """Returns mock detailed data for a specific stop."""
    return generate_stop_details_data(stop_id)

@eel.expose
def ask_campus_ai(prompt):
    """
    Simulates calling an AI model for campus information.
    In a real scenario, this would integrate with a large language model API.
    """
    print(f"Python backend received AI prompt: {prompt}")
    # Simulate a delay for AI processing
    time.sleep(random.uniform(1, 3)) 
    
    # Simple rule-based mock responses for common campus questions
    if "library" in prompt.lower():
        return "The central library (Knowledge Resource Centre) is located near the Main Academic Block and is accessible to all students and faculty. It's a great place for research and studying."
    elif "food" in prompt.lower() or "dining" in prompt.lower():
        return "VIT Vellore has multiple food courts (Foodys, Green Food Court) offering a variety of cuisines, including North Indian, South Indian, and fast food options. There are also several canteens and cafes across the campus."
    elif "hostel" in prompt.lower() or "accommodation" in prompt.lower():
        return "VIT Vellore provides excellent hostel facilities for both male and female students, with various amenities. Each block typically has a warden and support staff."
    elif "sports" in prompt.lower():
        return "The sports complex at VIT Vellore is well-equipped with facilities for cricket, football, basketball, badminton, tennis, and a swimming pool. Students are encouraged to participate in various sports activities."
    elif "admission" in prompt.lower():
        return "For admission-related queries, please visit the official VIT website (admissions section) or contact the admissions office directly. Information on programs, eligibility, and application procedures is available there."
    elif "location" in prompt.lower() or "where is" in prompt.lower():
         return "VIT Vellore is located in Vellore, Tamil Nadu, India. The campus is spread over a vast area and is well-connected by road."
    else:
        return "I can provide information about campus facilities like the library, food courts, hostels, and sports complex. What specific information are you looking for?"

# --- Eel Start Configuration ---

# Start the Eel web server, specifying Safari as the browser mode
try:
    print("Attempting to start Eel in Safari mode.")
    # For Safari, just specify mode='safari'
    eel.start('index.html', size=(1200, 800), mode='safari')
except Exception as e:
    print(f"Eel failed to start: {e}")
    print("Please ensure Safari is installed and set as the default browser or is properly configured on your system.")
    print("Ensure the 'www' directory exists with index.html.")

