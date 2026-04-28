# Setup

## Quick Start
```bash
git clone <repo>
cd MediaGuard-AI
python -m venv venv
source venv/bin/activate
pip install -r dapp/requirements.txt
cp .env.example .env
# edit .env
python test_env_loading.py
cd dapp && python main.py
# http://localhost:8000
```

## Troubleshooting
**Models slow?** First run downloads 1.3GB (5-10 mins). Cached after.
**DB error?** Check SUPABASE_URI in .env
**Serper failing?** Check API key + quota