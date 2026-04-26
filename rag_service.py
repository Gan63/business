import os
from google import genai
import pandas as pd
import json
import requests

class RAGService:
    def __init__(self):
        # Gemini Config
        self.google_api_key = os.environ.get("GOOGLE_API_KEY")
        if self.google_api_key:
            self.gemini_client = genai.Client(api_key=self.google_api_key)
            self.gemini_model_name = 'gemini-1.5-flash'
        else:
            self.gemini_client = None
        # OpenRouter Config
        self.openrouter_api_key = ""
        self.openrouter_url = "https://openrouter.ai/api/v1/chat/completions"

    def get_leads_context(self, leads):
        """Convert lead data into a textual context for the LLM."""
        context = "Here is the current lead intelligence data for Ficzon Report:\n\n"
        for lead in leads:
            context += f"Lead ID: {lead.get('id')}\n"
            context += f"Name: {lead.get('name')}\n"
            context += f"Company: {lead.get('company')}\n"
            context += f"Value: {lead.get('value')}\n"
            context += f"Source: {lead.get('Source')}\n"
            context += f"Location: {lead.get('Location')}\n"
            context += f"Score: {lead.get('score')}\n"
            context += f"Status: {lead.get('status')}\n"
            context += "-------------------\n"
        return context

    def query_openrouter(self, prompt):
        """Call OpenRouter API."""
        headers = {
            "Authorization": f"Bearer {self.openrouter_api_key}",
            "HTTP-Referer": "http://localhost:5000", # Optional but good practice
            "X-Title": "Ficzon Report",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": "meta-llama/llama-3.1-8b-instruct:free", # Using a free model by default
            "messages": [
                {"role": "user", "content": prompt}
            ]
        }
        
        try:
            response = requests.post(self.openrouter_url, headers=headers, data=json.dumps(payload))
            response.raise_for_status()
            return response.json()['choices'][0]['message']['content']
        except Exception as e:
            return f"OpenRouter Error: {str(e)}"

    def query(self, user_query, leads):
        """Query the RAG model with lead context."""
        context = self.get_leads_context(leads)
        
        prompt = f"""
        You are an expert AI Business Analyst and Data Scientist.

        Your task is to analyze a dataset uploaded by a user (company data), clean it, generate insights, and produce a complete business case report along with dashboard recommendations.

        IMPORTANT RULES:
        - Work ONLY with the provided dataset context.
        - If data is missing or unclear, make reasonable assumptions and clearly state them.
        - Be structured, professional, and business-focused.
        - Focus on actionable insights, not just description.

        DATA CONTEXT:
        {context}

        USER REQUEST:
        {user_query}


        STEP 1: DATA CLEANING & PREPROCESSING
        - Identify missing values, duplicates, inconsistencies
        - Suggest cleaning steps (handle nulls, fix formats, remove errors)
        - Standardize categorical values
        - Mention assumptions made

        STEP 2: EXPLORATORY DATA ANALYSIS (EDA)
        - Dataset overview (rows, columns, types)
        - Key variables and their importance
        - Summary statistics
        - Category distributions
        - Trends, patterns, and correlations

        STEP 3: KEY BUSINESS INSIGHTS
        - Highlight important findings
        - Identify high-performing and low-performing segments
        - Detect anomalies or unusual patterns
        - Explain what drives performance

        STEP 4: DASHBOARD DESIGN (VERY IMPORTANT)
        Suggest a professional dashboard with:
        - KPIs (e.g., total leads, avg score, conversion rate)
        - Charts to include:
            * Bar chart (category comparison)
            * Pie chart (distribution)
            * Line chart (trend over time if available)
            * Heatmap (correlation if applicable)
        - Filters (date, category, region, etc.)
        - Tools suggestion (Power BI / Tableau)

        STEP 5: BUSINESS IMPACT ANALYSIS
        - What does this mean for the company?
        - Revenue or growth opportunities
        - Risks and problem areas

        STEP 6: ACTIONABLE RECOMMENDATIONS
        - 4–6 practical strategies
        - Process improvements
        - Targeting / segmentation improvements
        - Data-driven decision suggestions

        STEP 7: EXECUTIVE SUMMARY
        - Short summary for management (non-technical)
        - Key takeaway in simple language

        OUTPUT FORMAT:
        Use clear headings and bullet points. Keep it structured and easy to read.

        FINAL ANSWER:
        """
        
        # Prioritize OpenRouter if key is available, else fallback to Gemini
        if self.openrouter_api_key:
            return self.query_openrouter(prompt)
        elif self.gemini_client:
            try:
                response = self.gemini_client.models.generate_content(
                    model=self.gemini_model_name,
                    contents=prompt
                )
                return response.text
            except Exception as e:
                return f"Gemini Error: {str(e)}"
        else:
            return "AI Error: No API keys configured. Please set GOOGLE_API_KEY or OPENROUTER_API_KEY in your environment."

# Singleton instance
rag_service = RAGService()
