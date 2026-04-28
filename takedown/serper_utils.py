import requests
import os
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("SERPER_API_KEY")

def search_contact(domain):
    url = "https://google.serper.dev/search"

    query = f"{domain} contact email OR abuse email OR copyright"

    headers = {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json"
    }

    try:
        res = requests.post(url, headers=headers, json={"q": query})
        return res.json()
    except:
        return {}