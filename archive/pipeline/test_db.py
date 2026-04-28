from app.db import fetch_media_files

rows = fetch_media_files(limit=5)
print(rows)