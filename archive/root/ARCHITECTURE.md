# MediaGuard AI - Architecture

## Components
- **Frontend** (React) - UI
- **FastAPI** - orchestration
- **Vision Service** - CLIP + BLIP
- **Search Service** - Serper
- **Database** - Supabase

## Data Flow
Upload -> Caption (BLIP 1s) -> Domain (CLIP 0.5s) -> Search (Serper 2s) -> Compare (CLIP 1s/match) -> Store -> Display

## Models
| Model | Size | Time | Purpose |
|-------|------|------|---------|
| CLIP ViT-B/32 | 338MB | 500ms | Embeddings |
| BLIP | 990MB | 1s | Captions |

## Env Vars
- SUPABASE_URI
- SERPER_API_KEY
- LOG_LEVEL