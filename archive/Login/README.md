# Image Authenticity Pipeline

A comprehensive image authenticity detection system that analyzes images for potential manipulation, finds similar images online, and provides fraud risk assessments.

## Features

- **CLIP-based semantic analysis** - Understands image content semantically
- **Perceptual hashing (pHash)** - Detects pixel-level similarities
- **Multi-patch analysis** - Detects cropped or modified regions
- **Reverse image search** - Finds similar images on the web via Google
- **Risk scoring** - Provides fraud likelihood assessment
- **Visualization** - Highlights matching regions in images

## Quick Start

### 1. Install Dependencies

```bash
cd pipeline
pip install -r requirements.txt
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` and add your:
- `SERPER_API_KEY` - Get free API key at https://serper.dev
- `DATABASE_URL` - PostgreSQL connection string (optional for basic use)

### 3. Start Redis (Optional - for caching)

```bash
redis-server
```

### 4. Run the Pipeline

#### Option A: Command Line Interface

```bash
# Analyze a single image
python cli.py analyze path/to/image.jpg

# Start API server
python cli.py serve
```

#### Option B: API Server (FastAPI)

```bash
# Start the server
python -m uvicorn app.api.server:app --reload --host 0.0.0.0 --port 8000
```

Then access:
- API Docs: http://localhost:8000/docs
- Health Check: http://localhost:8000/health

#### Option C: Batch Processing

```bash
# Process images from database
python main.py
```

## API Endpoints

### POST /analyze
Analyze an image for authenticity.

```bash
curl -X POST http://localhost:8000/analyze \
  -F "file=@path/to/image.jpg"
```

Response:
```json
{
  "score": 92.5,
  "label": "EXACT MATCH",
  "risk": 85,
  "fraud_likelihood": "HIGH",
  "explanation": "Very high semantic similarity | Images nearly identical at pixel level",
  "source": "https://example.com/image.jpg"
}
```

### POST /ingest
Ingest an image into the database for future comparison.

```bash
curl -X POST http://localhost:8000/ingest \
  -F "file=@path/to/image.jpg"
```

### GET /health
Health check endpoint.

## How It Works

1. **Input Image** - User provides an image to analyze
2. **Caption Generation** - BLIP model generates descriptive captions
3. **Reverse Search** - Captions used to search Google Images via Serper API
4. **Download** - Top matching images are downloaded
5. **Feature Extraction** - CLIP embeddings and pHash computed for all images
6. **Comparison** - Full image and patch-level comparisons performed
7. **Scoring** - Combined CLIP + pHash scores calculated
8. **Risk Assessment** - Fraud likelihood determined
9. **Output** - Results with explanation and visualization

## Scoring System

| Score Range | Label | Interpretation |
|-------------|-------|----------------|
| 90-100% | EXACT MATCH | Nearly identical image found |
| 80-89% | STRONG MATCH | Strong similarity, possible reuse |
| 70-79% | PARTIAL MATCH | Moderate similarity |
| <70% | WEAK | Low confidence match |

## Project Structure

```
pipeline/
├── app/
│   ├── api/
│   │   └── server.py      # FastAPI server
│   ├── pipeline.py        # Main pipeline logic
│   ├── embedder.py        # CLIP embedding extraction
│   ├── phash.py           # Perceptual hashing
│   ├── search.py          # Reverse image search
│   ├── downloader.py      # Image downloader
│   ├── comparator.py      # Similarity comparison
│   ├── analyzer.py        # Risk score calculation
│   ├── visualizer.py      # Result visualization
│   ├── validator.py       # Image validation
│   ├── extraction.py      # Feature extraction
│   ├── metadata.py        # EXIF/metadata extraction
│   └── db.py              # Database operations
├── cli.py                 # Command line interface
├── main.py                # Batch processing script
├── requirements.txt       # Python dependencies
└── .env.example          # Environment template
```

## Requirements

- Python 3.9+
- Redis (optional, for caching)
- PostgreSQL (optional, for database features)
- Serper API key (for reverse image search)

## License

MIT
