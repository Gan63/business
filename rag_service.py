import os
from google import genai
import json
import requests


class RAGService:
    def __init__(self):
        # ==============================
        # Gemini Configuration
        # ==============================
        self.google_api_key = os.environ.get("GOOGLE_API_KEY")

        if self.google_api_key:
            self.gemini_client = genai.Client(api_key=self.google_api_key)

            # Use latest working model
            self.gemini_model_name = "gemini-2.0-flash"
        else:
            self.gemini_client = None

        # ==============================
        # OpenRouter Configuration
        # ==============================
        self.openrouter_api_key = os.environ.get("OPENROUTER_API_KEY", "")
        self.openrouter_url = "https://openrouter.ai/api/v1/chat/completions"

    # ==========================================
    # Convert Leads → Context
    # ==========================================
    def get_leads_context(self, leads):
        context = "Here is the current lead intelligence data for Ficzon Report:\n\n"

        for lead in leads:
            context += f"""
Lead ID: {lead.get('id')}
Name: {lead.get('name')}
Company: {lead.get('company')}
Value: {lead.get('value')}
Source: {lead.get('Source')}
Location: {lead.get('Location')}
Score: {lead.get('score')}
Status: {lead.get('status')}
-------------------
"""
        return context

    # ==========================================
    # OpenRouter API Call
    # ==========================================
    def query_openrouter(self, prompt):
        headers = {
            "Authorization": f"Bearer {self.openrouter_api_key}",
            "HTTP-Referer": "http://localhost:5000",
            "X-Title": "Ficzon Report",
            "Content-Type": "application/json"
        }

        payload = {
            "model": "meta-llama/llama-3.1-8b-instruct:free",
            "messages": [
                {"role": "user", "content": prompt}
            ]
        }

        try:
            response = requests.post(
                self.openrouter_url,
                headers=headers,
                data=json.dumps(payload)
            )
            response.raise_for_status()
            return response.json()['choices'][0]['message']['content']

        except Exception as e:
            return f"OpenRouter Error: {str(e)}"

    # ==========================================
    # Gemini API Call (FIXED)
    # ==========================================
    def query_gemini(self, prompt):
        try:
            response = self.gemini_client.models.generate_content(
                model=self.gemini_model_name,
                contents=[
                    {
                        "role": "user",
                        "parts": [{"text": prompt}]
                    }
                ]
            )

            return response.candidates[0].content.parts[0].text

        except Exception as e:
            return f"Gemini Error: {str(e)}"

    # ==========================================
    # Main Query Function
    # ==========================================
    def query(self, user_query, leads):
        context = self.get_leads_context(leads)

        prompt = f"""
You are an expert AI Business Analyst and Data Scientist.

Your task is to analyze a dataset uploaded by a user (company data), clean it,
generate insights, and produce a complete business case report along with dashboard recommendations.

IMPORTANT RULES:
- Work ONLY with the provided dataset context.
- If data is missing, make assumptions and mention them.
- Be structured and business-focused.
- Focus on actionable insights.

DATA CONTEXT:
{context}

USER REQUEST:
{user_query}


STEP 1: DATA CLEANING & PREPROCESSING
- Missing values, duplicates, inconsistencies
- Cleaning steps
- Standardization

STEP 2: EXPLORATORY DATA ANALYSIS
- Overview
- Key variables
- Trends & patterns

STEP 3: KEY BUSINESS INSIGHTS
- Important findings
- High/low performers
- Anomalies

STEP 4: DASHBOARD DESIGN
- KPIs
- Charts (Bar, Pie, Line, Heatmap)
- Filters
- Tools (Power BI / Tableau)

STEP 5: BUSINESS IMPACT

STEP 6: RECOMMENDATIONS

STEP 7: EXECUTIVE SUMMARY
"""

        # Priority: OpenRouter → Gemini
        if self.openrouter_api_key:
            return self.query_openrouter(prompt)

        elif self.gemini_client:
            return self.query_gemini(prompt)

        else:
            return "❌ No API key configured. Set GOOGLE_API_KEY or OPENROUTER_API_KEY."


# Singleton instance
rag_service = RAGService()