from urllib.parse import urlparse
from serper_utils import search_contact
from scraper import extract_from_serper
from email_utils import send_email

def get_domain(url):
    return urlparse(url).netloc


def pick_best_email(emails):
    for e in emails:
        if "abuse" in e or "support" in e:
            return e
    return emails[0] if emails else None


def trigger_takedown(url, asset_id, confidence):
    print("\n🚨 Triggering takedown...")

    domain = get_domain(url)
    results = search_contact(domain)
    emails = extract_from_serper(results)

    if not emails:
        print("❌ No emails found")
        return

    target = pick_best_email(emails)

    print(f"📧 Sending to: {target}")

    send_email(target, url, asset_id, confidence)

    print("✅ Email sent")