from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Canonical DB path: <project_root>/data/veridex.db
# Resolved relative to this file so it works on any machine without hardcoded paths.
# veridex/app/db/database.py -> parents[3] = Trinetra/
PROJECT_ROOT = Path(__file__).resolve().parents[3]
CANONICAL_DB_PATH = PROJECT_ROOT / "data" / "veridex.db"
DATABASE_URL = f"sqlite:///{CANONICAL_DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)