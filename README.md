<p align="center">
  <img src="frontend/src/assets/banner.png" alt="Trinetra — Media Asset Protection" width="100%">
</p>

<div align="center">
  <img src="frontend/src/assets/trinetra-logo-transparent.png" alt="Trinetra Logo" width="100">

```
████████╗██████╗ ██╗███╗   ██╗███████╗████████╗██████╗  █████╗ 
╚══██╔══╝██╔══██╗██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██╔══██╗
   ██║   ██████╔╝██║██╔██╗ ██║█████╗     ██║   ██████╔╝███████║
   ██║   ██╔══██╗██║██║╚██╗██║██╔══╝     ██║   ██╔══██╗██╔══██║
   ██║   ██║  ██║██║██║ ╚████║███████╗   ██║   ██║  ██║██║  ██║
   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝
```

### The open-source media fingerprinting and IP enforcement platform.

[![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Active-brightgreen?style=flat-square)]()

</div>

<br>

> **Upload your image once. Trinetra handles the rest.**
> **CLIP fingerprinting, web-scale reverse search, AI fake detection, and automated DMCA takedowns — in a single pipeline.**

No infrastructure to write. No ML setup beyond installing deps. Works across five decoupled services layered on [FastAPI](https://fastapi.tiangolo.com) and [React](https://reactjs.org).

## What is Trinetra?

You upload an image. Trinetra fingerprints it with CLIP embeddings and perceptual hashing, searches the web for copies, scores each match by how likely it's actual theft vs coincidence, checks if the image itself is AI-generated, and can fire off a DMCA notice — all without you doing anything else.

It's not magic. It's five services talking to each other, each doing one job well. The pipeline is deliberately kept pure (no DB access, no side effects) so it stays testable and predictable regardless of what the rest of the system is doing.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                FRONTEND  (React + Vite)                 │
│   Clerk Auth · Three.js · Framer Motion · Lucide Icons  │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / REST
┌────────────────────────▼────────────────────────────────┐
│              DAPP  (FastAPI Backend)                    │
│  Auth · Asset Mgmt · Scans · Reports · Takedowns        │
│  Protected Registry · Dashboard Analytics               │
└──────┬──────────────────────────────┬───────────────────┘
       │                              │
┌──────▼──────────┐        ┌──────────▼──────────────────┐
│   PIPELINE      │        │   VERIDEX  (AI Detector)    │
│  CLIP Embedder  │        │  CNN · ViT · MVSS-Net       │
│  pHash Engine   │        │  XGBoost Fusion             │
│  Region Extract │        │  Heatmap · Forensics        │
│  Web Search     │        │  Zero-Shot Classifier       │
│  Comparator     │        └─────────────────────────────┘
│  Analyzer       │
│  Visualizer     │        ┌─────────────────────────────┐
│  Notice Gen     │        │   TAKEDOWN  (Enforcement)   │
└─────────────────┘        │  Web Scraper · Contact Find │
                           │  Email Dispatch · CLIP Match│
                           └─────────────────────────────┘
```

---

## What it actually does

### 🔍 Fingerprinting

Three methods run in parallel. CLIP embeddings catch semantic similarity — two images that look related even if cropped, recolored, or stylistically altered. pHash catches direct copies that have been resized or compressed. Region extraction splits the image into sub-vectors, so if someone only stole a portion of your image, that still gets flagged.

Self-matches are filtered out using SHA-256 digest comparison and a near-identity threshold (CLIP ≥ 0.985 + pHash ≥ 0.95), so you don't get spammed with results pointing back at your own registered assets.

### 🌐 Web Search

Uses Serper (Google reverse image search under the hood) to find candidate URLs, downloads them asynchronously, then runs the full comparison stack against each one. The more specific the image, the better this works — generic stock-photo-style images will produce more noise.

### 🧠 Match Scoring

Each match gets a composite score from `CLIP × pHash weight × region overlap`, then a risk tier:

```
EXACT MATCH  →  HIGH RISK  →  MEDIUM  →  LOW  →  NO MATCH
```

Every result comes with a plain-English explanation of *why* it scored the way it did, and a recommended action: `TAKEDOWN`, `MONITOR`, or `IGNORE`.

### 🤖 Veridex — AI image detection

This runs as a separate sidecar service on port `8001`. It uses four models in an ensemble — a CNN, a ViT, MVSS-Net (trained for manipulation detection: splicing, inpainting, copy-move attacks), and XGBoost fusion across all outputs. There's also a zero-shot CLIP classifier for cases where the fine-tuned models are uncertain.

Results include a heatmap showing *which regions* look tampered with, not just a binary real/fake verdict. You can submit corrections at runtime via the feedback endpoint — those go into a staging area for retraining.

### 📋 DMCA Notices

`notice.py` generates the text. `contact_finder.py` tries to locate the site admin or hosting provider. `mailer.py` sends it. The evidence package includes the side-by-side comparison image and metadata. You can also trigger this manually from the dashboard if you want to review before sending.

### 🔐 Auth

Three modes: Clerk OAuth (social login), OTP via SMTP for email-based auth, and guest mode for demos. Sessions auto-expire after 10 minutes of inactivity. Backend uses JWT. The header it looks for is `X-Trinetra-User-Email`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Framer Motion, Three.js, Clerk |
| **UI Components** | Lucide Icons, custom shadcn-style components |
| **Backend** | Python 3.14, FastAPI, Uvicorn, SQLite |
| **ML Pipeline** | OpenCLIP, pHash, CNN, ViT, MVSS-Net, XGBoost |
| **Search** | Serper API |
| **Auth** | Clerk, JWT, OTP via SMTP |
| **Database** | SQLite with versioned SQL migrations |
| **Dev** | Makefile, `.bat` startup scripts, pytest, `lint_pipeline_purity.sh` |

---

## Project Structure

```
Trinetra/
├── dapp/                        # FastAPI backend
│   ├── app/
│   │   ├── api/routes/          # assets, auth, dashboard, scans, reports, takedown
│   │   ├── core/                # auth, config, db, storage, logging, errors
│   │   ├── models/              # OTP model
│   │   ├── pipeline/            # runner.py (pure fn: no DB, no side effects)
│   │   ├── repositories/        # asset_repo, scan_repo, report_repo, protected_registry
│   │   ├── schemas/             # contracts.py — canonical field names, enforced everywhere
│   │   ├── services/            # asset, scan, report, search, comparison, vision, takedown
│   │   └── workers/             # async task queue
│   ├── migrations/              # 001_init.sql → 003_otp_table.sql
│   └── requirements.txt
│
├── pipeline/                    # ML pipeline (standalone service)
│   ├── app/
│   │   ├── embedder.py          # CLIP extraction + caption generation
│   │   ├── phash.py             # Perceptual hash
│   │   ├── region.py            # Sub-image region vectors
│   │   ├── search.py            # Serper web search
│   │   ├── downloader.py        # Async candidate downloader
│   │   ├── comparator.py        # Cosine similarity
│   │   ├── analyzer.py          # Scoring, risk, fraud likelihood, explanation, action
│   │   ├── visualizer.py        # Side-by-side comparison image
│   │   ├── notice.py            # DMCA notice text
│   │   ├── enforcer.py          # Enforcement dispatch
│   │   ├── evidence.py          # Evidence package builder
│   │   ├── mailer.py            # SMTP send
│   │   ├── contact_finder.py    # Site admin contact lookup
│   │   └── api/server.py        # FastAPI server for this service
│   └── requirements.txt
│
├── veridex/                     # AI image authenticity detection
│   ├── app/
│   │   ├── models/              # cnn_classifier, vit_classifier, mvss_net, xgboost_fusion, zero_shot
│   │   ├── modules/             # classifier, forensics, fusion, similarity, metadata
│   │   ├── routes/              # analyze, heatmap, intelligence, feedback
│   │   ├── services/            # intelligence_engine, feedback_runtime
│   │   └── utils/               # hash, heatmap, image, score, training utils
│   └── data/train/              # training data: ai/ and real/
│
├── takedown/                    # Standalone enforcement scripts
│   ├── scraper.py
│   ├── contact_finder.py
│   ├── email_utils.py
│   ├── clip_compare.py
│   └── image_caption.py
│
├── frontend/                    # React + TypeScript SPA
│   ├── src/
│   │   ├── App.tsx              # BOOT → AUTH → DASHBOARD → SCAN / HISTORY / INTELLIGENCE
│   │   └── index.css
│   ├── components/ui/           # Button, EtheralShadow, FallingPattern, SignInFlow
│   └── dist/                    # Production build (served by pipeline server)
│
├── scripts/
│   ├── start-all.bat            # starts everything
│   ├── start-backend.bat
│   ├── start-pipeline.bat
│   ├── start-frontend.bat
│   ├── start-dev.ps1
│   ├── setup-venv.sh
│   ├── merge-dbs.py
│   └── audit_dbs.py
│
└── data/
    └── veridex.db
```

---

## Pipeline Flow

```
Upload Image
     │
     ▼
[CLIP Embedding]  ──┐
[pHash Compute]     ├──► Feature Extraction
[Region Vectors]  ──┘
     │
     ▼
[Serper Web Search]  →  candidate URLs
     │
     ▼
[Download Candidates]  (async)
     │
     ▼
[Compare All]
  ├── cosine_similarity (CLIP)
  ├── phash_similarity
  └── region overlap
     │
     ▼
[Score Matches]
  ├── match_score  (composite)
  ├── risk_score
  ├── fraud_likelihood
  └── action  (TAKEDOWN / MONITOR / IGNORE)
     │
     ├──► [Veridex]          →  AI/Real verdict + heatmap
     ├──► [Visualizer]       →  side-by-side comparison.jpg
     └──► [Notice Generator] →  DMCA text + email
```

---

## Getting Started

**Prerequisites:** Python 3.14+, Node.js 18+, Git.

### 1. Clone

```bash
git clone https://github.com/yourusername/trinetra.git
cd trinetra
```

### 2. Backend

```bash
cd Trinetra/dapp
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Linux/macOS
pip install -r requirements.txt
```

### 3. Pipeline

```bash
cd ../pipeline
pip install -r requirements.txt
```

### 4. Veridex

```bash
cd ../veridex
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt   # or: bash ../scripts/setup-venv.sh
```

### 5. Frontend

```bash
cd ../frontend
npm install
```

### 6. Environment variables

`dapp/.env`:
```env
SERPER_API_KEY=your_serper_key
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=yourpassword
CLERK_SECRET_KEY=your_clerk_secret
```

`frontend/.env.local`:
```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_BASE_URL=http://localhost:8000
```

### 7. Run

On Windows, just:
```bat
scripts\start-all.bat
```

Or start each service separately:
```bat
scripts\start-backend.bat      # dapp      → port 8000
scripts\start-pipeline.bat     # pipeline  → port 8002
scripts\start-frontend.bat     # frontend  → port 5173
```

Veridex starts automatically as a sidecar on port `8001` the first time the pipeline calls it. You don't need to start it manually.

---

## API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register with email + OTP |
| `POST` | `/api/auth/verify-otp` | Verify OTP, receive JWT |
| `POST` | `/api/auth/clerk` | Clerk OAuth token exchange |

### Assets
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/assets` | List registered assets |
| `POST` | `/api/assets` | Upload and register new asset |
| `DELETE` | `/api/assets/{id}` | Remove asset |

### Scans
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/scans` | Run a scan |
| `GET` | `/api/scans/{id}` | Get scan result |
| `GET` | `/api/scans` | Scan history |

### Reports & Takedowns
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/reports` | All reports |
| `POST` | `/api/takedown` | Trigger takedown for a match |
| `GET` | `/api/dashboard` | Dashboard stats |

### Pipeline — internal (port 8002)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/scan` | Run full ML pipeline |
| `GET` | `/api/visualization/{file}` | Get comparison image |

### Veridex — internal (port 8001)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/analyze` | Run AI/real detection |
| `GET` | `/heatmap/{id}` | Get manipulation heatmap |
| `POST` | `/feedback` | Submit correction for retraining |
| `GET` | `/health` | Health check |

---

## Canonical Field Names

`contracts.py` enforces these across every service. If you add a new module, use these — don't invent new names for the same concept.

| Use this | Not these | Reason |
|---|---|---|
| `storage_key` | `file_url`, `image_path`, `path`, `url` | Storage abstraction |
| `media_id` | `asset_id`, `image_id`, `file_id` | One ID per asset |
| `clip_embedding` | `visual_dna`, `vector`, `clip_vector` | Exact, unambiguous |
| `similarity_score` | `confidence`, `score`, `match_score` | Doesn't conflate with classifier confidence |
| `phash` | `hash`, `img_hash`, `pHash` | Consistent casing |

---

## App States

```
BOOT  →  AUTH  →  DASHBOARD
                      ├──  SCAN
                      ├──  HISTORY
                      ├──  INTELLIGENCE
                      ├──  PROTECT
                      └──  METADATA
```

Session times out after 10 minutes of inactivity and forces a sign-out.

---

## Testing

```bash
# Backend tests
cd Trinetra/dapp
pytest tests/

# Pipeline self-match calibration
cd Trinetra/pipeline
python -m pytest app/test_pipeline_self_match.py -v

# Analyzer score calibration
python app/test_analyzer_calibration.py

# Verify pipeline purity (no DB or storage side-effects in runner)
bash scripts/lint_pipeline_purity.sh
```

---

## Contributing

1. Fork and create a branch: `git checkout -b feature/your-thing`
2. Keep `runner.py` pure — no DB calls, no storage, no side effects. That's not negotiable.
3. Use the canonical field names from `contracts.py`. Don't add new aliases.
4. Write tests for any new pipeline module.
5. Open a PR and explain what changed and why it needed changing.

---

## License

MIT — see [LICENSE](LICENSE).