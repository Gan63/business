from flask import Flask, render_template, jsonify, request
import os
import pandas as pd
import pickle
from io import BytesIO
from rag_service import rag_service

app = Flask(__name__)

# Module-level constants (used by scoring, upload, and predict)
SOURCE_FREQ_MAP = {'Live Chat': 0.37, 'Call': 0.35, 'Website': 0.24, 'Existing Customer': 0.03, 'Campaign': 0.01}
LOCATION_FREQ_MAP = {'Other Locations': 0.45, 'Bangalore': 0.25, 'Chennai': 0.15, 'Hyderabad': 0.1, 'Delhi': 0.05}

# Start with an empty list (User will upload data)
mock_leads = []

# Load ML model (handle gracefully if not present during build)
model = None
try:
    model_path = 'models/final_xgb_model.pkl'
    if os.path.exists(model_path):
        with open(model_path, 'rb') as f:
            model = pickle.load(f)
        print("ML model loaded successfully")
except Exception as e:
    print(f"Warning: Could not load ML model: {e}")

def preprocess_lead(lead_data):
    """Apply mapping logic to input data with NaN handling"""
    processed = lead_data.copy()
    
    # Clean NaN values
    for k, v in processed.items():
        if pd.isna(v):
            processed[k] = ''
    
    # Source mapping
    source = str(processed.get('Source', ''))
    if any(x in source for x in ['Live Chat', 'Chat']):
        processed['Source'] = 'Live Chat'
    elif any(x in source for x in ['Existing', 'Client', 'CRM']):
        processed['Source'] = 'Existing Customer'
    elif any(x in source for x in ['Website', 'Website-Direct']):
        processed['Source'] = 'Website'
    elif any(x in source for x in ['Campaign', 'SMS', 'E-mail']):
        processed['Source'] = 'Campaign'
        
    # Location mapping
    loc = str(processed.get('Location', ''))
    # Keep original location if not matching common buckets
    if any(x in loc.upper() for x in ['USA','UK','AUSTRALIA','SINGAPORE','MALAYSIA','EUROPE','UAE']):
        processed['Location'] = 'Forgin'
    elif any(x in loc.upper() for x in ['TRIVANDRUM','KOLKATA','HOWRAH']):
        processed['Location'] = 'Other Locations'
        
    # Product_ID mapping
    pid = str(processed.get('Product_ID', ''))
    try:
        # Try to find a numeric Product ID
        numeric_pid = ''.join(filter(str.isdigit, pid))
        processed['Product_ID_Num'] = float(numeric_pid) if numeric_pid else 15.0
    except:
        processed['Product_ID_Num'] = 15.0
        
    return processed

@app.route('/api/categories')
def get_categories():
    """Extract unique labels from the current data set"""
    if not mock_leads:
        return jsonify({
            "Product_ID": [],
            "Source": ["Website", "Call", "Live Chat", "Campaign", "Existing Customer"],
            "Location": ["Bangalore", "Mumbai", "Chennai", "Hyderabad", "Delhi"],
            "Delivery_Mode": ["Mode-1", "Mode-2", "Mode-3", "Mode-4", "Mode-5"]
        })
    
    df = pd.DataFrame(mock_leads)
    return jsonify({
        "Product_ID": sorted(df['Product_ID'].unique().tolist()) if 'Product_ID' in df else [],
        "Source": sorted(df['Source'].unique().tolist()) if 'Source' in df else [],
        "Location": sorted(df['Location'].unique().tolist()) if 'Location' in df else [],
        "Delivery_Mode": sorted(df['Delivery_Mode'].unique().tolist()) if 'Delivery_Mode' in df else []
    })

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/superstore.html')
@app.route('/superstore')
def superstore():
    return render_template('superstore.html')

def score_lead(lead_data):
    """Helper to score a single lead using the ML model"""
    processed_data = preprocess_lead(lead_data)
    score = 50
    status = 'Cold'

    if model:
        try:
            delivery_mode = processed_data.get('Delivery_Mode', 'Mode-1')
            features_dict = {
                'Product_ID': float(processed_data.get('Product_ID_Num', 15.0)),
                'Created_Month': 4,
                'Source_freq': SOURCE_FREQ_MAP.get(processed_data.get('Source', ''), 0.1),
                'Location_freq': LOCATION_FREQ_MAP.get(processed_data.get('Location', ''), 0.1),
                'Delivery_Mode_Mode-2': 1 if delivery_mode == 'Mode-2' else 0,
                'Delivery_Mode_Mode-3': 1 if delivery_mode == 'Mode-3' else 0,
                'Delivery_Mode_Mode-4': 1 if delivery_mode == 'Mode-4' else 0,
                'Delivery_Mode_Mode-5': 1 if delivery_mode == 'Mode-5' else 0
            }
            df = pd.DataFrame([features_dict])
            prob = model.predict_proba(df)[0]
            score = int(prob[1] * 100)

            if score >= 80: status = 'Hot'
            elif score >= 50: status = 'Warm'
        except Exception as e:
            print(f"Prediction error: {e}")

    return score, status

@app.route('/api/leads', methods=['GET', 'POST'])
def handle_leads():
    if request.method == 'POST':
        new_lead = request.json
        if 'id' not in new_lead:
            new_id = f"L-{1000 + len(mock_leads) + 1}"
            new_lead['id'] = new_id
        
        new_lead.setdefault('name', 'Unknown')
        new_lead.setdefault('company', 'Unknown')
        new_lead.setdefault('value', '$0')
        
        # Score it immediately for the response
        score, status = score_lead(new_lead)
        new_lead['score'] = score
        new_lead['status'] = status
        
        mock_leads.append(new_lead)
        return jsonify(new_lead), 201
        
    # GET logic — return cached scores from _score/_status (set at upload time)
    result = []
    for lead in mock_leads:
        lead_data = lead.copy()
        # Use pre-computed score/status if available (dynamic CSV uploads)
        if '_score' in lead_data:
            lead_data['score']  = lead_data['_score']
            lead_data['status'] = lead_data['_status']
            lead_data['id']     = lead_data.get('_id', '')
            lead_data['name']   = lead_data.get('_name', '')
        else:
            # Legacy: score on-the-fly for manually added leads
            sc, st = score_lead(lead_data)
            lead_data['score']  = sc
            lead_data['status'] = st
        result.append(lead_data)

    return jsonify(result)

@app.route('/api/leads/<lead_id>', methods=['PUT', 'DELETE'])
def update_lead(lead_id):
    global mock_leads
    # Support both _id (dynamic uploads) and id (legacy)
    lead_idx = next(
        (i for i, item in enumerate(mock_leads)
         if item.get('_id') == lead_id or item.get('id') == lead_id),
        None
    )

    if lead_idx is None:
        return jsonify({"error": "Lead not found"}), 404

    if request.method == 'PUT':
        update_data = request.json
        mock_leads[lead_idx].update(update_data)
        return jsonify(mock_leads[lead_idx])

    if request.method == 'DELETE':
        mock_leads.pop(lead_idx)
        return jsonify({"success": True})

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    try:
        global mock_leads
        file_bytes = BytesIO(file.read())
        if file.filename.endswith('.csv'):
            # Try multiple encodings to handle Windows/Latin-1 encoded files
            encodings_to_try = ['utf-8', 'latin-1', 'windows-1252', 'iso-8859-1']
            df_input = None
            for encoding in encodings_to_try:
                try:
                    file_bytes.seek(0)
                    df_input = pd.read_csv(file_bytes, encoding=encoding)
                    print(f"Successfully read CSV with encoding: {encoding}")
                    break
                except (UnicodeDecodeError, Exception):
                    continue
            if df_input is None:
                file_bytes.seek(0)
                df_input = pd.read_csv(file_bytes, encoding='utf-8', errors='replace')
        else:
            df_input = pd.read_excel(file_bytes)
            
        print(f"Processing file: {file.filename} with {len(df_input)} rows")

        # --- Auto-detect column roles from actual CSV headers ---
        all_cols = list(df_input.columns)

        def find_col(candidates):
            for c in all_cols:
                if c.strip().lower() in [x.lower() for x in candidates]:
                    return c
            return None

        col_source   = find_col(['source', 'traffic source', 'lead source', 'channel'])
        col_location = find_col(['location', 'city', 'region', 'area', 'state'])
        col_delivery = find_col(['delivery_mode', 'mode', 'delivery mode', 'plan', 'tier'])
        col_product  = find_col(['product_id', 'product id', 'product', 'pid'])
        col_name     = find_col(['name', 'lead name', 'customer', 'full name', 'contact'])
        col_company  = find_col(['company', 'organization', 'org', 'firm', 'business'])
        col_value    = find_col(['value', 'deal value', 'amount', 'revenue', 'price'])

        # Categorical columns for charts (object dtype, <= 30 unique values)
        chart_cols = [c for c in all_cols
                      if df_input[c].dtype == object and df_input[c].nunique() <= 30
                      and c not in [col_name, col_company, col_value]]

        results = []
        hot_count = warm_count = cold_count = total_score = 0
        mock_leads = []

        for i, row in df_input.iterrows():
            lead_data = row.to_dict()
            processed = preprocess_lead(lead_data)

            score = 50
            status = 'Cold'

            if model:
                try:
                    delivery_mode = str(lead_data.get(col_delivery, 'Mode-1')) if col_delivery else 'Mode-1'
                    src_val  = str(lead_data.get(col_source, '')) if col_source else ''
                    loc_val  = str(lead_data.get(col_location, '')) if col_location else ''
                    pid_val  = float(lead_data.get(col_product, 15.0)) if col_product else 15.0
                    features = {
                        'Product_ID': pid_val,
                        'Created_Month': 4,
                        'Source_freq': SOURCE_FREQ_MAP.get(src_val, 0.1),
                        'Location_freq': LOCATION_FREQ_MAP.get(loc_val, 0.1),
                        'Delivery_Mode_Mode-2': 1 if delivery_mode == 'Mode-2' else 0,
                        'Delivery_Mode_Mode-3': 1 if delivery_mode == 'Mode-3' else 0,
                        'Delivery_Mode_Mode-4': 1 if delivery_mode == 'Mode-4' else 0,
                        'Delivery_Mode_Mode-5': 1 if delivery_mode == 'Mode-5' else 0
                    }
                    pred_df = pd.DataFrame([features])
                    prob = model.predict_proba(pred_df)[0]
                    score = int(prob[1] * 100)
                    if score >= 80:
                        status = 'Hot'; hot_count += 1
                    elif score >= 50:
                        status = 'Warm'; warm_count += 1
                    else:
                        cold_count += 1
                except:
                    cold_count += 1

            total_score += score

            # Keep ALL original CSV columns + add system fields
            ui_lead = {k: ('' if (isinstance(v, float) and pd.isna(v)) else v)
                       for k, v in lead_data.items()}
            ui_lead['_id']     = f"L-{1000 + i}"
            ui_lead['_score']  = score
            ui_lead['_status'] = status
            ui_lead['_name']   = str(lead_data.get(col_name, f"Lead {i}")) if col_name else f"Lead {i}"

            results.append(ui_lead)
            mock_leads.append(ui_lead)

        report = {
            "summary": {
                "total_leads": len(results),
                "hot_leads": hot_count,
                "warm_leads": warm_count,
                "cold_leads": cold_count,
                "avg_score": round(total_score / len(results), 2) if results else 0
            },
            "columns": all_cols,
            "chart_cols": chart_cols,
            "col_map": {
                "name": col_name, "company": col_company,
                "value": col_value, "source": col_source, "location": col_location
            },
            "data": results
        }

        return jsonify(report)

    except Exception as e:
        print(f"CRITICAL UPLOAD ERROR: {e}")
        import traceback; traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/summary')
def data_summary():
    """Return a rich summary of the currently loaded dataset"""
    if not mock_leads:
        return jsonify({"empty": True, "message": "No data loaded. Upload a CSV to see the summary."})

    df = pd.DataFrame(mock_leads)
    # Drop internal system columns
    sys_cols = [c for c in df.columns if c.startswith('_')]
    df_clean = df.drop(columns=sys_cols, errors='ignore')

    total = len(df_clean)
    num_cols = df_clean.select_dtypes(include='number').columns.tolist()
    cat_cols = df_clean.select_dtypes(include='object').columns.tolist()

    # Missing values per column
    missing = {
        col: int(df_clean[col].isnull().sum()) + int((df_clean[col] == '').sum())
        for col in df_clean.columns
    }

    # Top 5 values for categorical columns
    top_values = {}
    for col in cat_cols:
        vc = df_clean[col].value_counts().head(5)
        top_values[col] = [{'label': str(k), 'count': int(v)} for k, v in vc.items()]

    # Score distribution from _score field
    scores = [lead.get('_score', lead.get('score', 0)) for lead in mock_leads]
    hot   = sum(1 for s in scores if s >= 80)
    warm  = sum(1 for s in scores if 50 <= s < 80)
    cold  = sum(1 for s in scores if s < 50)
    avg_s = round(sum(scores) / len(scores), 1) if scores else 0

    return jsonify({
        "empty": False,
        "total_records": total,
        "total_columns": len(df_clean.columns),
        "numeric_columns": num_cols,
        "categorical_columns": cat_cols,
        "missing_values": missing,
        "top_values": top_values,
        "score_distribution": {
            "hot": hot, "warm": warm, "cold": cold, "avg": avg_s
        }
    })


@app.route('/api/chat', methods=['POST'])
def chat():
    user_msg = request.json.get('message', '').strip()
    user_msg_lower = user_msg.lower()
    
    # Calculate some stats for the chatbot
    total = len(mock_leads)
    hot_leads = []
    source_counts = {}
    
    # Scored leads for RAG context
    scored_leads_context = []
    for lead in mock_leads:
        score, status = score_lead(lead)
        l_copy = lead.copy()
        l_copy['score'] = score
        l_copy['status'] = status
        scored_leads_context.append(l_copy)
        
        if status == 'Hot': hot_leads.append(l_copy)
        s = lead.get('Source', 'Other')
        source_counts[s] = source_counts.get(s, 0) + 1
    
    best_source = max(source_counts, key=source_counts.get) if source_counts else "N/A"
    
    # Simple greetings and stats handling (Fast Path)
    if "hello" in user_msg_lower or "hi" in user_msg_lower:
        response = "Hello! I'm your Ficzon AI Analyst. I can help you understand your pipeline, identify hot leads, or analyze sources. What would you like to know?"
    elif user_msg_lower in ["how many leads", "total leads", "stats"]:
        response = f"We currently have a total of {total} leads in the pipeline. {len(hot_leads)} are classified as 'Hot'."
    else:
        # Advanced Path: Use RAG with Gemini
        response = rag_service.query(user_msg, scored_leads_context)
        
    return jsonify({"response": response})

@app.route('/api/predict', methods=['POST'])
def predict_single():
    data = request.json
    if not model:
        return jsonify({"error": "Model not loaded"}), 500
        
    try:
        processed = preprocess_lead(data)
        delivery_mode = processed.get('Delivery_Mode', 'Mode-1')
        
        features_dict = {
            'Product_ID': float(processed.get('Product_ID_Num', 15.0)),
            'Created_Month': 4,
            'Source_freq': SOURCE_FREQ_MAP.get(processed.get('Source'), 0.1),
            'Location_freq': LOCATION_FREQ_MAP.get(processed.get('Location'), 0.1),
            'Delivery_Mode_Mode-2': 1 if delivery_mode == 'Mode-2' else 0,
            'Delivery_Mode_Mode-3': 1 if delivery_mode == 'Mode-3' else 0,
            'Delivery_Mode_Mode-4': 1 if delivery_mode == 'Mode-4' else 0,
            'Delivery_Mode_Mode-5': 1 if delivery_mode == 'Mode-5' else 0
        }
        
        df = pd.DataFrame([features_dict])
        prob = model.predict_proba(df)[0]
        score = int(prob[1] * 100)
        
        status = 'Cold'
        if score >= 80: status = 'Hot'
        elif score >= 50: status = 'Warm'
        
        return jsonify({
            "score": score,
            "status": status
        })
    except Exception as e:
        print(f"Prediction error: {e}")
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
