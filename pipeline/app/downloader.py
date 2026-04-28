import os
import uuid
import aiohttp
import asyncio
from .config import TEMP_DIR

async def fetch(session, url):
    try:
        async with session.get(url) as resp:
            if resp.status != 200:
                return None

            if "image" not in resp.headers.get("Content-Type", ""):
                return None

            data = await resp.read()
            path = os.path.join(TEMP_DIR, f"{uuid.uuid4().hex}.jpg")

            with open(path, "wb") as f:
                f.write(data)

            return path
    except:
        return None

async def download_images_async(urls):
    connector = aiohttp.TCPConnector(limit=10)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [fetch(session, u) for u in urls]
        res = await asyncio.gather(*tasks)

    return [r for r in res if r]