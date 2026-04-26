# RAG Project

A Retrieval-Augmented Generation (RAG) pipeline for processing documents (PDF/JSON), chunking, embedding, storing in vector DB, retrieving, and generating responses with LLM.

## Structure
- `data/`: Sample data files
- `rag/`: Core RAG components
- `main.py`: Entry point
- `.env`: Environment variables

## Setup
1. Install dependencies: `pip install langchain chromadb sentence-transformers pypdf json dotenv openai`
2. Set API keys in `.env`
3. Run `python main.py`

