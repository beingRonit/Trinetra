from dotenv import load_dotenv
import os
if os.path.exists('.env'):
    load_dotenv()

import psycopg2

SUPABASE_URI = os.getenv("SUPABASE_URI")
if not SUPABASE_URI:
    raise ValueError("SUPABASE_URI not set in .env")

conn = psycopg2.connect(SUPABASE_URI)
cursor = conn.cursor()

try:
    cursor.execute("ALTER TABLE protected_assets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()")
    print("Added created_at column")
except Exception as e:
    print(f"created_at: {e}")

try:
    cursor.execute("ALTER TABLE protected_assets ADD COLUMN IF NOT EXISTS is_augmented BOOLEAN DEFAULT FALSE")
    print("Added is_augmented column")
except Exception as e:
    print(f"is_augmented: {e}")

conn.commit()
cursor.close()
conn.close()
print("Done")