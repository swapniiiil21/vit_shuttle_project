# engine/api_endpoints.py
import eel
import pandas as pd
import os
import datetime
import random
from . import forecaster # Import the forecaster module for predictions

# Define the path for the data folder relative to where main.py will be run
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')

@eel.expose
def get_shuttle_stops():
    """Returns a list of all shuttle stops with their IDs, names, and map positions."""
    try:
        df_stops = pd.read_csv(os.path.join(DATA_DIR, 'shuttle_stops.csv'))
        # Convert DataFrame to a list of dictionaries for easier JavaScript consumption
        stops_list = df_stops[['stop_id', 'name', 'map_x_percent', 'map_y_percent']].to_dict(orient='records')
        return stops_list
    except FileNotFoundError:
        print(f"Error: shuttle_stops.csv not found at {DATA_DIR}. Please ensure data_simulator.py has been run.")
        return []
    except Exception as e:
        print(f"Error fetching shuttle stops: {e}")
        return []

@eel.expose
def get_live_shuttle_data():
    """
    Simulates live shuttle data including their current positions (using map_x/y_percent from stops)
    and provides overall campus statistics like active shuttles and avg. wait time.
    """
    num_active_shuttles = random.randint(3, 6) # Simulate 3 to 6 active shuttles
    
    # Load stop data to use their actual map positions for shuttle placement
    stops_df = pd.read_csv(os.path.join(DATA_DIR, 'shuttle_stops.csv'))
    
    shuttles = []
    # Ensure stops_df is not empty before attempting to sample
    if not stops_df.empty:
        # Get 2-3 random stop_ids to place shuttles
        active_stop_ids = stops_df['stop_id'].sample(min(num_active_shuttles, len(stops_df))).tolist()

        for i in range(num_active_shuttles):
            # Assign shuttle to one of the selected random stops
            if i < len(active_stop_ids):
                current_stop_id = active_stop_ids[i]
                random_stop = stops_df[stops_df['stop_id'] == current_stop_id].iloc[0]
            else:
                # If more shuttles than selected stops, pick from any stop
                random_stop = stops_df.sample(1).iloc[0]
            
            shuttles.append({
                'id': f'shuttle-{i+1}',
                # Use the map_x_percent and map_y_percent from the stop data for precise placement on the UI map
                'top_percent': random_stop['map_y_percent'], 
                'left_percent': random_stop['map_x_percent'],
                'status_color': random.choice(['#003366', '#00eaff', '#00aaff']), # VIT blue, electric blue, light blue
                'route_name': random.choice(['Route A', 'Route B', 'Route C']),
                'passengers_on_board': random.randint(5, 40) # Simulated passenger count on board
            })

    # Simulate current average wait time for the dashboard
    # This could be an average of `forecaster.predict_wait_time` calls for all stops
    avg_wait_time_min = random.randint(5, 12) 

    return {
        'active_shuttles_count': num_active_shuttles,
        'total_shuttles': 6, # Fixed total for display
        'avg_wait_time': f"{avg_wait_time_min} min",
        'shuttle_locations': shuttles
    }

@eel.expose
def get_predicted_wait_time_for_stop(stop_id):
    """
    Calls the forecaster module to get predicted wait time and load for a specific stop.
    """
    print(f"Requesting prediction for stop_id: {stop_id}")
    prediction_result = forecaster.predict_wait_time(stop_id, datetime.datetime.now())
    return prediction_result

@eel.expose
def get_next_arrivals_for_all_stops():
    """
    Generates a list of simulated next arrival times for a few stops.
    It leverages the forecaster to get a demand-based estimated wait time for each stop.
    """
    stops = get_shuttle_stops() # Get all defined stops
    arrivals_list = []
    current_time = datetime.datetime.now()

    # Ensure stops list is not empty before sorting/iterating
    if not stops:
        print("No stops available for next arrivals simulation.")
        return []

    # Sort stops to ensure some consistency in demo order
    stops.sort(key=lambda x: x['name']) 

    for i, stop in enumerate(stops):
        # Use forecaster to get a demand-based predicted wait time for the next shuttle
        prediction = forecaster.predict_wait_time(stop['stop_id'], current_time)
        
        # Simulate next arrival time. We add some random minutes + a factor based on demand.
        # This makes the arrival time seem 'dynamic' based on the prediction.
        base_arrival_offset = random.randint(1, 10) # Base minutes
        demand_factor_minutes = prediction['predicted_ridership'] // 5 # Higher demand -> slightly longer estimated interval
        
        arrival_time = current_time + datetime.timedelta(minutes=base_arrival_offset + demand_factor_minutes)
        arrival_time_str = arrival_time.strftime('%I:%M %p') # Format as HH:MM AM/PM

        arrivals_list.append({
            'stop_id': stop['stop_id'], # Include stop_id for accurate frontend lookup
            'stop_name': stop['name'],
            'next_arrival': f"{arrival_time_str}",
            'predicted_wait_time': prediction['predicted_wait_time'],
            'current_load_status': prediction['load_status'],
            'wait_time_class': prediction['wait_time_class'] # Pass class for UI styling
        })
            
    return arrivals_list
