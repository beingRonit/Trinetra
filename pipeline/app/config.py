import os
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")

load_dotenv(dotenv_path=ENV_PATH)

SERPER_API_KEY = os.getenv("SERPER_API_KEY")

TEMP_DIR = os.path.join(BASE_DIR, "data", "temp")
OUTPUT_DIR = os.path.join(BASE_DIR, "data", "output")

os.makedirs(OUTPUT_DIR, exist_ok=True)

TIMEOUT = 5
MAX_RESULTS = 25
DEBUG = False

EXACT_THRESHOLD = 90
STRONG_THRESHOLD = 80
POSSIBLE_THRESHOLD = 65
