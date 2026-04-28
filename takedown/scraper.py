import re

def extract_from_serper(results):
    emails = []

    for item in results.get("organic", []):
        text = item.get("title", "") + item.get("snippet", "")
        found = re.findall(r"[\w\.-]+@[\w\.-]+", text)
        emails.extend(found)

    return list(set(emails))