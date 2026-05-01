"""audit_dbs.py - Audit all DB references and schemas in the Trinetra project."""
import sqlite3
import os
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent

print("=" * 60)
print("TRINETRA DB AUDIT REPORT")
print("=" * 60)

# 1. Find all .db files
print("\n[1] All .db files found:")
db_files = list(REPO_ROOT.rglob("*.db"))
for db in db_files:
    exists = "[EXISTS]" if db.exists() else "[MISSING]"
    size = db.stat().st_size if db.exists() else 0
    print(f"  {exists} {db} ({size:,} bytes)")

# 2. Find all code references to veridex.db
print("\n[2] Code references to 'veridex.db':")
for py_file in REPO_ROOT.rglob("*.py"):
    try:
        text = py_file.read_text(encoding="utf-8", errors="ignore")
        if "veridex.db" in text:
            for i, line in enumerate(text.splitlines(), 1):
                if "veridex.db" in line:
                    print(f"  {py_file}:{i}  {line.strip()}")
    except Exception:
        pass

# 3. Find all DATABASE_URL / DB_PATH references
print("\n[3] DATABASE_URL / DB_PATH / sqlite:// references:")
for py_file in REPO_ROOT.rglob("*.py"):
    try:
        text = py_file.read_text(encoding="utf-8", errors="ignore")
        for i, line in enumerate(text.splitlines(), 1):
            if any(k in line for k in ["DATABASE_URL", "DB_PATH", "sqlite://"]):
                print(f"  {py_file}:{i}  {line.strip()}")
    except Exception:
        pass

# 4. Schema analysis of each .db file
print("\n[4] Schema analysis:")
for db in db_files:
    if not db.exists():
        continue
    print(f"\n  --- {db.relative_to(REPO_ROOT)} ---")
    try:
        conn = sqlite3.connect(str(db))
        cursor = conn.cursor()
        
        # Get all tables
        cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = cursor.fetchall()
        
        if not tables:
            print("  [NO TABLES]")
            continue
            
        for table_name, table_sql in tables:
            print(f"\n  Table: {table_name}")
            if table_sql:
                for line in table_sql.splitlines():
                    print(f"    {line}")
            else:
                # Get columns via PRAGMA
                cursor.execute(f"PRAGMA table_info({table_name})")
                cols = cursor.fetchall()
                for col in cols:
                    print(f"    {col}")
            
            # Row count
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            print(f"    -> {count} rows")
            
        conn.close()
    except Exception as e:
        print(f"  [ERROR] {e}")

print("\n" + "=" * 60)
print("END OF AUDIT")
print("=" * 60)
