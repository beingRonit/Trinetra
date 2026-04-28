import re
import requests
from urllib.parse import urlparse, urljoin

EMAIL_REGEX = r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+"

def extract_domain(url):
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"

def extract_emails(text):
    return list(set(re.findall(EMAIL_REGEX, text)))

def fetch_page(url):
    try:
        res = requests.get(url, timeout=5)
        if res.status_code == 200:
            return res.text
    except:
        return ""
    return ""

def find_contact_email(target_url):
    domain = extract_domain(target_url)

    print(f"🔍 Searching emails on: {domain}")

    # homepage
    html = fetch_page(domain)
    emails = extract_emails(html)
    if emails:
        return emails[0]

    # common pages
    paths = ["/contact", "/contact-us", "/about", "/support"]

    for path in paths:
        page_url = urljoin(domain, path)
        html = fetch_page(page_url)
        emails = extract_emails(html)
        if emails:
            return emails[0]

    # fallback
    domain_name = urlparse(domain).netloc

    return f"info@{domain_name}"