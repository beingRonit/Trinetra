"""
merge-dbs.py — One-time migration to consolidate all veridex DB state
into the canonical path: <project_root>/data/veridex.db

What it does:
  1. Creates the canonical DB at data/veridex.db (if not exists)
  2. Opens old DBs: veridex/veridex.db, veridex/app/storage/runtime_feedback/runtime_feedback.db
  3. Compares schemas, prints diffs
  4. Merges rows from old DBs into canonical DB, skipping duplicates by primary key
  5. Prints summary of rows merged per table

Safety:
  - Never drops or overwrites data in the canonical DB
  - Prints every action; no silent failures
  - Run with --dry-run to preview without writing

Usage:
  python scripts/merge-dbs.py            # Run merge
  python scripts/merge-dbs.py --dry-run  # Preview only
"""
import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CANONICAL_DB = REPO_ROOT / "data" / "veridex.db"
OLD_VERIDEX_DB = REPO_ROOT / "veridex" / "veridex.db"
RUNTIME_FEEDBACK_DB = REPO_ROOT / "veridex" / "app" / "storage" / "runtime_feedback" / "runtime_feedback.db"

# ── Schema definitions (source of truth from audit) ──
CANONICAL_SCHEMA = {
    "feedback": """
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_hash TEXT NOT NULL,
            image_path TEXT,
            original_score REAL NOT NULL,
            user_label TEXT NOT NULL,
            model_label TEXT,
            risk_score INTEGER,
            confidence TEXT,
            meta_score REAL DEFAULT 0,
            forensic_score REAL DEFAULT 0,
            classifier_score REAL DEFAULT 0,
            similarity_score REAL DEFAULT 0,
            is_correct BOOLEAN,
            trained BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """,
    "runtime_feedback": """
        CREATE TABLE IF NOT EXISTS runtime_feedback (
            image_id TEXT PRIMARY KEY,
            image_hash TEXT NOT NULL,
            prediction TEXT NOT NULL,
            user_feedback TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            confidence_score REAL NOT NULL,
            ai_probability REAL,
            real_probability REAL,
            classifier_score INTEGER NOT NULL,
            image_path TEXT NOT NULL
        )
    """,
}


def get_tables(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    return [r[0] for r in cursor.fetchall()]


def table_exists(conn, table):
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cursor.fetchone() is not None


def get_columns(conn, table):
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table})")
    return {r[1]: r[2] for r in cursor.fetchall()}  # name -> type


def print_schema_diff(label, table, src_cols, dst_cols):
    print(f"\n  [{label}] Table '{table}' schema diff:")
    all_cols = set(list(src_cols.keys()) + list(dst_cols.keys()))
    for col in sorted(all_cols):
        s_type = src_cols.get(col, "[MISSING]")
        d_type = dst_cols.get(col, "[MISSING]")
        if s_type == d_type:
            print(f"    OK  {col}: {s_type}")
        else:
            print(f"    DIFF {col}: src={s_type}  dst={d_type}")


def merge_table(src_conn, dst_conn, table, dry_run=False):
    """Merge rows from src into dst, skipping duplicates by PK."""
    if not table_exists(dst_conn, table):
        print(f"    [WARN] Table '{table}' not in canonical DB — creating it")
        if not dry_run:
            dst_conn.executescript(CANONICAL_SCHEMA[table])
            dst_conn.commit()
        else:
            print(f"    [DRY RUN] Would create table '{table}'")
            return 0

    dst_cols = get_columns(dst_conn, table)
    src_cols = get_columns(src_conn, table)

    if not src_cols:
        print(f"    [SKIP] Table '{table}' not in source DB")
        return 0

    # Print schema diff
    print_schema_diff("SRC->DST", table, src_cols, dst_cols)

    # Get PK column
    cursor = src_conn.cursor()
    cursor.execute(f"PRAGMA table_info({table})")
    pk_col = next((r[1] for r in cursor.fetchall() if r[5]), None)  # r[5] = pk flag

    # Fetch source rows
    cursor.execute(f"SELECT * FROM {table}")
    src_rows = cursor.fetchall()

    if not src_rows:
        print(f"    [EMPTY] No rows to merge from '{table}'")
        return 0

    desc = cursor.description
    if desc is None:
        print(f"    [ERROR] Cannot get column names for '{table}'")
        return 0
    col_names = [d[0] for d in desc]

    # Build insert using only columns that exist in dst
    dst_col_list = list(dst_cols.keys())
    placeholders = ",".join(["?"] * len(dst_col_list))
    insert_sql = f"INSERT OR IGNORE INTO {table} ({','.join(dst_col_list)}) VALUES ({placeholders})"

    merged = 0
    skipped = 0

    for row in src_rows:
        row_dict = dict(zip(col_names, row))

        # Check if row already exists (by PK if available)
        if pk_col and pk_col in row_dict and row_dict[pk_col] is not None:
            check_cursor = dst_conn.cursor()
            check_cursor.execute(
                f"SELECT 1 FROM {table} WHERE {pk_col}=?", (row_dict[pk_col],)
            )
            if check_cursor.fetchone():
                skipped += 1
                continue

        # Insert using only columns that exist in dst
        values = tuple(row_dict.get(col) for col in dst_col_list)
        if not dry_run:
            try:
                dst_conn.execute(insert_sql, values)
                merged += 1
            except sqlite3.Error as e:
                print(f"    [ERROR] Failed to insert row {row_dict}: {e}")
                skipped += 1
        else:
            merged += 1  # Count in dry-run

    if not dry_run:
        dst_conn.commit()

    print(f"    Merged {merged} rows into '{table}' (skipped {skipped} duplicates)")
    return merged


def main():
    parser = argparse.ArgumentParser(description="Merge veridex DBs into canonical path")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    dry_run = args.dry_run
    if dry_run:
        print("[DRY RUN] No changes will be written.\n")

    print("=" * 60)
    print("VERIDEX DB MERGE — Canonical path:", CANONICAL_DB)
    print("=" * 60)

    # 1. Ensure canonical DB exists with correct schema
    CANONICAL_DB.parent.mkdir(parents=True, exist_ok=True)
    canon_conn = sqlite3.connect(str(CANONICAL_DB))
    try:
        for table, ddl in CANONICAL_SCHEMA.items():
            if not table_exists(canon_conn, table):
                print(f"\n  Creating table '{table}' in canonical DB...")
                if not dry_run:
                    canon_conn.executescript(ddl)
                    canon_conn.commit()
                else:
                    print(f"  [DRY RUN] Would create table '{table}'")

        # 2. Print canonical schema
        print("\n[Canonical DB Schema]:")
        for table in CANONICAL_SCHEMA:
            cols = get_columns(canon_conn, table)
            if cols:
                print(f"  {table}: {list(cols.keys())}")
            else:
                print(f"  {table}: [NOT CREATED]")

        total_merged = 0

        # 3. Merge from old veridex/veridex.db
        if OLD_VERIDEX_DB.exists():
            print(f"\n{'=' * 50}")
            print(f"MERGING FROM: {OLD_VERIDEX_DB}")
            print(f"{'=' * 50}")
            src_conn = sqlite3.connect(str(OLD_VERIDEX_DB))
            try:
                tables = get_tables(src_conn)
                print(f"  Tables found: {tables}")
                for table in tables:
                    if table in ("sqlite_sequence", "sqlite_master"):
                        continue
                    if table not in CANONICAL_SCHEMA:
                        print(f"  [SKIP] Table '{table}' not in canonical schema")
                        continue
                    print(f"\n  Merging table: {table}")
                    n = merge_table(src_conn, canon_conn, table, dry_run)
                    total_merged += n
            finally:
                src_conn.close()
        else:
            print(f"\n[SKIP] Old DB not found: {OLD_VERIDEX_DB}")

        # 4. Merge from runtime_feedback.db
        if RUNTIME_FEEDBACK_DB.exists():
            print(f"\n{'=' * 50}")
            print(f"MERGING FROM: {RUNTIME_FEEDBACK_DB}")
            print(f"{'=' * 50}")
            src_conn = sqlite3.connect(str(RUNTIME_FEEDBACK_DB))
            try:
                tables = get_tables(src_conn)
                print(f"  Tables found: {tables}")
                for table in tables:
                    if table not in CANONICAL_SCHEMA:
                        print(f"  [SKIP] Table '{table}' not in canonical schema")
                        continue
                    print(f"\n  Merging table: {table}")
                    n = merge_table(src_conn, canon_conn, table, dry_run)
                    total_merged += n
            finally:
                src_conn.close()
        else:
            print(f"\n[SKIP] Runtime feedback DB not found: {RUNTIME_FEEDBACK_DB}")

        # 5. Summary
        print(f"\n{'=' * 60}")
        print(f"MERGE SUMMARY")
        print(f"{'=' * 60}")
        for table in CANONICAL_SCHEMA:
            if table_exists(canon_conn, table):
                cursor = canon_conn.cursor()
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                count = cursor.fetchone()[0]
                print(f"  {table}: {count} rows")
            else:
                print(f"  {table}: [NOT CREATED]")
        print(f"\nTotal rows merged: {total_merged}")
        print(f"Canonical DB: {CANONICAL_DB}")
        print(f"{'=' * 60}")

    finally:
        canon_conn.close()

    if dry_run:
        print("\n[DRY RUN COMPLETE] Re-run without --dry-run to apply changes.")


if __name__ == "__main__":
    main()
