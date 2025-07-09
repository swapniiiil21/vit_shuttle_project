# engine/data_simulator.py
import pandas as pd
import numpy as np
import datetime
import os

# Define the path for the data folder relative to where main.py will be run
# It will create 'data' folder at the same level as 'main.py'
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')

def create_simulated_data():
    """
    Generates simulated historical data for shuttle stops, academic calendar,
    ridership, and weather, saving them as CSV files in the 'data' folder.
    This function ensures data is consistent for forecasting model training.
    """
    # Ensure data directory exists
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

    print("Generating shuttle stops data...")
    # 1. Shuttle Stops Data - UPDATED WITH APPROXIMATE PERCENTAGE POSITIONS FOR 3D-ISH MAP
    # These map_x_percent and map_y_percent are crucial for placing icons correctly on the UI map.
    # They are estimated based on the layout of a typical campus map.
    # Top/Left refers to percentage from top-left corner of the image.
    stops = {
        'stop_id': ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10', 's11', 's12'],
        'name': [
            'Main Gate', 'Academic Block A (MB)', 'Academic Block B (TT)', 'Hostel Block G (MH)', 'Central Library', 
            'Sports Complex', 'Admin Block', 'Food Court', 'Technology Tower Ext', 'Auditorium',
            'SJT Block', 'New Hostel (SB)' 
        ],
        # Placeholder lat/lon (actual values aren't strictly used for icon positioning on the static map)
        'latitude': [12.9691, 12.9715, 12.9730, 12.9680, 12.9700, 12.9675, 12.9725, 12.9705, 12.9710, 12.9700, 12.9735, 12.9685],
        'longitude': [79.1550, 79.1570, 79.1585, 79.1530, 79.1560, 79.1520, 79.1575, 79.1540, 79.1565, 79.1555, 79.1590, 79.1535],
        'capacity_proxy': [0.8, 1.0, 0.9, 0.7, 0.6, 0.5, 0.85, 0.75, 0.95, 0.8, 0.7, 0.65], 
        # These are carefully estimated percentage positions (from top-left of the image)
        # to align with major buildings/points on the 3D map based on common VIT campus maps.
        'map_x_percent': [22, 58, 72, 28, 48, 15, 66, 45, 52, 40, 78, 25], 
        'map_y_percent': [75, 30, 36, 68, 45, 85, 42, 52, 40, 58, 30, 72] 
    }
    df_stops = pd.DataFrame(stops)
    df_stops.to_csv(os.path.join(DATA_DIR, 'shuttle_stops.csv'), index=False)
    print("Shuttle stops data generated.")

    print("Generating academic calendar data...")
    # 2. Academic Calendar (Simulated for a few months)
    start_date = datetime.date(2024, 7, 1)
    end_date = datetime.date(2024, 12, 31) # Simulate 6 months of data
    dates = pd.date_range(start=start_date, end=end_date, freq='D')

    academic_calendar_data = []
    for date in dates:
        is_holiday = False
        is_exam_period = False
        event = ""
        # Simulate some holidays/events
        if date.month == 8 and date.day == 15:
            is_holiday = True
            event = "Independence Day"
        elif date.month == 10 and date.day in [24, 25]:
            is_holiday = True
            event = "Diwali Break"
        elif date.month == 11 and date.day >= 20 and date.day <= 30:
            is_exam_period = True
            event = "End Sem Exams"
        elif date.month == 9 and date.day in [5]:
            is_holiday = True
            event = "Teacher's Day (Reduced Activity)"
        
        academic_calendar_data.append({
            'date': date.strftime('%Y-%m-%d'),
            'is_holiday': is_holiday,
            'is_exam_period': is_exam_period,
            'event': event
        })
    df_calendar = pd.DataFrame(academic_calendar_data)
    df_calendar.to_csv(os.path.join(DATA_DIR, 'academic_calendar.csv'), index=False)
    print("Academic calendar data generated.")

    print("Generating historical ridership data...")
    # 3. Historical Ridership Data (Simulated)
    ridership_data = []
    for date in dates:
        for hour in range(6, 23): # 6 AM to 10 PM operating hours
            for stop_id in df_stops['stop_id']:
                # Base ridership
                base_ridership = np.random.randint(5, 20) 

                # Adjust for time of day (peak hours)
                # Morning commute, lunch, evening activity
                if 8 <= hour < 10 or 13 <= hour < 15 or 17 <= hour < 19: 
                    base_ridership = np.random.randint(20, 50) 
                
                # Adjust for weekend
                if date.weekday() >= 5: # Saturday or Sunday
                    base_ridership = np.random.randint(2, 15) # Lower ridership
                
                # Adjust for holidays/exams based on calendar info
                calendar_info = df_calendar[df_calendar['date'] == date.strftime('%Y-%m-%d')].iloc[0]
                if calendar_info['is_holiday']:
                    base_ridership = np.random.randint(1, 10) # Very low on holidays
                elif calendar_info['is_exam_period']:
                    # Higher ridership near academic blocks during exams, slightly lower elsewhere
                    if any(x in df_stops[df_stops['stop_id'] == stop_id]['name'].iloc[0].lower() for x in ['academic', 'block', 'sjt', 'tt', 'admin']):
                        base_ridership = np.random.randint(30, 70) 
                    else:
                        base_ridership = np.random.randint(10, 30) 

                ridership_data.append({
                    'timestamp': datetime.datetime(date.year, date.month, date.day, hour, np.random.randint(0, 59), np.random.randint(0, 59)).strftime('%Y-%m-%d %H:%M:%S'),
                    'stop_id': stop_id,
                    'passengers_entering': max(1, base_ridership + np.random.randint(-5, 5)), # Ensure at least 1 passenger
                    'passengers_exiting': max(1, np.random.randint(1, base_ridership // 2 + 5)) # Exiting passengers are typically fewer
                })
    df_ridership = pd.DataFrame(ridership_data)
    df_ridership.to_csv(os.path.join(DATA_DIR, 'historical_ridership.csv'), index=False)
    print("Historical ridership data generated.")

    print("Generating historical weather data...")
    # 4. Historical Weather Data (Simple simulation for 6 months)
    weather_data = []
    for date in dates:
        for hour in range(24):
            temp = np.random.uniform(25, 35) # Typical Vellore temperatures
            rainfall = 0.0
            if np.random.rand() < 0.15: # 15% chance of rain
                rainfall = np.random.uniform(0.5, 10.0) # Light to moderate rain
            
            weather_data.append({
                'timestamp': datetime.datetime(date.year, date.month, date.day, hour, 0, 0).strftime('%Y-%m-%d %H:%M:%S'),
                'temperature': temp,
                'rainfall_mm': rainfall
            })
    df_weather = pd.DataFrame(weather_data)
    df_weather.to_csv(os.path.join(DATA_DIR, 'historical_weather.csv'), index=False)
    print("Historical weather data generated.")
