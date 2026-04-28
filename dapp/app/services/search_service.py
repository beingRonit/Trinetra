import requests
import os
from typing import List, Dict, Any
import logging
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_DAPP_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(dotenv_path=_DAPP_ROOT / ".env")

class SearchService:
    def __init__(self):
        self.api_key = os.getenv("SERPER_API_KEY")
        self.base_url = "https://google.serper.dev/images"
        self.timeout = 10
        self.enabled = bool(self.api_key)

        if not self.api_key:
            logger.warning("SERPER_API_KEY not set - web search disabled")
    
    def search(self, query: str, num: int = 5) -> List[Dict[str, Any]]:
        try:
            logger.info(f"Searching: {query}")
            
            response = requests.post(
                self.base_url,
                json={"q": query, "num": num},
                headers={"X-API-KEY": self.api_key, "Content-Type": "application/json"},
                timeout=self.timeout
            )
            
            if response.status_code != 200:
                raise Exception(f"Serper error {response.status_code}")
            
            results = response.json().get("images", [])
            logger.info(f"Found {len(results)} results")
            return results
            
        except requests.Timeout:
            logger.error("Serper timeout")
            raise
        except Exception as e:
            logger.error(f"Search failed: {e}")
            raise
    
    def download_image(self, url: str) -> bytes:
        try:
            resp = requests.get(url, timeout=5)
            if "image" not in resp.headers.get("Content-Type", ""):
                raise ValueError("Not image")
            return resp.content
        except Exception as e:
            logger.error(f"Download failed: {e}")
            raise

search_service = SearchService()
