# engine/forecaster.py
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
import joblib
import os
import datetime

# Define paths for data and model relative to where main.py will be run
# It will load data from 'data' folder and save models to 'models' folder.
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'models', 'ridership_forecaster_model.joblib')

def train_forecasting_model():
    """
    Trains a RandomForestRegressor model to predict passenger demand
    based on historical ridership, time, and academic calendar features.
    Saves the trained model to the 'models' folder.
    This ensures the model is persistent across runs.
    """
    # Ensure models directory exists
    model_dir = os.path.dirname(MODEL_PATH)
    if not os.path.exists(model_dir):
        os.makedirs(model_dir)

    try:
        df_ridership = pd.read_csv(os.path.join(DATA_DIR, 'historical_ridership.csv'))
        df_calendar = pd.read_csv(os.path.join(DATA_DIR, 'academic_calendar.csv'))
        
        # Convert timestamps to datetime objects
        df_ridership['timestamp'] = pd.to_datetime(df_ridership['timestamp'])
        df_calendar['date'] = pd.to_datetime(df_calendar['date'])
        
        # Merge ridership with calendar data to incorporate holiday/exam features
        df_ridership['date_only'] = df_ridership['timestamp'].dt.normalize()
        df_merged = pd.merge(df_ridership, df_calendar, left_on='date_only', right_on='date', how='left')
        
        # Feature Engineering: Extract time-based features
        df_merged['hour'] = df_merged['timestamp'].dt.hour
        df_merged['day_of_week'] = df_merged['timestamp'].dt.dayofweek # Monday=0, Sunday=6
        df_merged['month'] = df_merged['timestamp'].dt.month
        df_merged['day_of_year'] = df_merged['timestamp'].dt.dayofyear
        df_merged['is_weekend'] = df_merged['day_of_week'].apply(lambda x: 1 if x >= 5 else 0)
        
        # Convert boolean flags to integer (0 or 1) for machine learning
        df_merged['is_holiday'] = df_merged['is_holiday'].astype(int)
        df_merged['is_exam_period'] = df_merged['is_exam_period'].astype(int)

        # One-hot encode stop_id to use it as a categorical feature
        df_merged = pd.get_dummies(df_merged, columns=['stop_id'], prefix='stop')
        
        # Define features (X) and target (y) for the model
        # Select all relevant features including the one-hot encoded stop_ids
        features = ['hour', 'day_of_week', 'month', 'day_of_year', 'is_weekend', 'is_holiday', 'is_exam_period'] + \
                   [col for col in df_merged.columns if col.startswith('stop_')]
        target = 'passengers_entering' # Predicting the number of passengers entering the shuttle

        # Handle cases where some one-hot encoded columns might be missing if data is sparse (unlikely with simulator)
        # Ensure all feature columns are numerical.
        X = df_merged[features].fillna(0) # Fill NaN from merges if any, though unlikely here
        y = df_merged[target]
        
        # Split data for training and testing (good practice for model validation)
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        # Train a RandomForestRegressor model
        # n_estimators: number of trees in the forest. n_jobs=-1 uses all available CPU cores.
        model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
        model.fit(X_train, y_train)
        
        # Evaluate the model on the test set
        y_pred = model.predict(X_test)
        mae = mean_absolute_error(y_test, y_pred)
        print(f"Model trained. Mean Absolute Error on test set: {mae:.2f} passengers.")
        
        # Save the trained model and the list of features (crucial for consistent predictions)
        joblib.dump({'model': model, 'features': features}, MODEL_PATH)
        print(f"Forecasting model and features saved to {MODEL_PATH}")

    except FileNotFoundError as e:
        print(f"Error: Required data file not found: {e}. Please ensure data_simulator.py has been run and created the necessary CSVs in {DATA_DIR}.")
    except Exception as e:
        print(f"An unexpected error occurred during model training: {e}")

def predict_wait_time(stop_id_val, current_timestamp=None):
    """
    Predicts passenger demand and estimates wait time for a given stop ID
    at a specific timestamp.
    """
    try:
        # Load the trained model and feature list
        model_data = joblib.load(MODEL_PATH)
        model = model_data['model']
        features = model_data['features']

        # Determine the timestamp for prediction (default to now if not provided)
        if current_timestamp is None:
            current_timestamp = datetime.datetime.now()
        else:
            current_timestamp = pd.to_datetime(current_timestamp)

        # Load academic calendar data to get holiday/exam flags for the prediction timestamp
        df_calendar = pd.read_csv(os.path.join(DATA_DIR, 'academic_calendar.csv'))
        df_calendar['date'] = pd.to_datetime(df_calendar['date'])
        
        current_date_only = current_timestamp.normalize()
        # Find calendar info for the current date
        calendar_info = df_calendar[df_calendar['date'] == current_date_only]
        
        is_holiday = 0
        is_exam_period = 0
        if not calendar_info.empty:
            is_holiday = int(calendar_info.iloc[0]['is_holiday'])
            is_exam_period = int(calendar_info.iloc[0]['is_exam_period'])

        # Create input features for the model prediction
        input_data = {
            'hour': current_timestamp.hour,
            'day_of_week': current_timestamp.dayofweek,
            'month': current_timestamp.month,
            'day_of_year': current_timestamp.dayofyear,
            'is_weekend': 1 if current_timestamp.dayofweek >= 5 else 0,
            'is_holiday': is_holiday,
            'is_exam_period': is_exam_period,
        }
        
        # Add one-hot encoded stop_id features. All feature columns from training must be present.
        feature_dict = {col: 0 for col in features} # Initialize all features to 0
        feature_dict.update(input_data) # Update with specific timestamp features
        feature_dict[f'stop_{stop_id_val}'] = 1 # Set the specific stop_id to 1

        input_df = pd.DataFrame([feature_dict])
        
        # Ensure the order of columns in the input DataFrame matches the order used during training
        input_df = input_df[features] 

        # Predict ridership (passengers_entering) using the loaded model
        predicted_ridership = model.predict(input_df)[0]
        
        # Ensure ridership prediction is not negative
        predicted_ridership = max(0, int(predicted_ridership))
        
        # Simple heuristic to estimate wait time and load status based on predicted ridership.
        # In a real scenario, this would involve shuttle schedules, capacities, and real-time positions.
        if predicted_ridership < 15:
            wait_time_min = np.random.randint(2, 6) # Low demand, short wait
            load_status = "Low"
            load_percentage = np.random.randint(10, 30)
            wait_time_class = "text-green-600"
        elif 15 <= predicted_ridership < 35:
            wait_time_min = np.random.randint(5, 12) # Medium demand, moderate wait
            load_status = "Medium"
            load_percentage = np.random.randint(40, 70)
            wait_time_class = "text-yellow-600"
        else: # High demand
            wait_time_min = np.random.randint(10, 20)
            load_status = "High"
            load_percentage = np.random.randint(75, 95)
            wait_time_class = "text-red-600"
            
        return {
            'predicted_ridership': predicted_ridership,
            'predicted_wait_time': f"{wait_time_min} min",
            'load_status': load_status,
            'load_percentage': load_percentage,
            'wait_time_class': wait_time_class # Class for UI styling
        }
    except FileNotFoundError:
        print(f"Error: Model file not found at {MODEL_PATH}. Please run train_forecasting_model() first.")
        return {
            'predicted_ridership': 0,
            'predicted_wait_time': "N/A",
            'load_status': "Error",
            'load_percentage': 0,
            'wait_time_class': "text-gray-500"
        }
    except Exception as e:
        print(f"An error occurred during prediction: {e}")
        return {
            'predicted_ridership': 0,
            'predicted_wait_time': "Error",
            'load_status': "Error",
            'load_percentage': 0,
            'wait_time_class': "text-gray-500"
        }
