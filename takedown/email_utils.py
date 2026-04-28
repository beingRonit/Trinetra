# email_utils.py

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

EMAIL = os.getenv("EMAIL")
APP_PASSWORD = os.getenv("APP_PASSWORD")


def build_email_body(url, asset_id, confidence):
    return f"""
Dear Sir/Madam,

We are writing to inform you of a potential instance of unauthorized image usage detected by our monitoring system.

Details of the identified content are as follows:

URL: {url}
Asset ID: {asset_id}
Match Confidence: {confidence*100:.2f}%

This content appears to match a protected digital asset. We kindly request that you review the material and take appropriate action if necessary.

If you believe this notification has been sent in error or the usage is authorized, no action is required.

Thank you for your time and cooperation.

Best regards,  
TRINETRA Monitoring System  

---
This is an automated message generated for asset protection purposes.
"""


def send_email(to_email, url, asset_id, confidence):
    if not EMAIL or not APP_PASSWORD:
        print("❌ Missing email credentials in .env")
        return

    subject = "Notice of Potential Unauthorized Image Usage"

    body = build_email_body(url, asset_id, confidence)

    try:
        # Create message container
        msg = MIMEMultipart()
        msg["From"] = EMAIL
        msg["To"] = to_email
        msg["Subject"] = subject

        # Attach text body
        msg.attach(MIMEText(body, "plain"))

        print(f"📧 Sending email to: {to_email}")

        # Send via Gmail SMTP
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(EMAIL, APP_PASSWORD)
            server.send_message(msg)

        print("✅ Email sent successfully")

        # 🔥 Log success
        with open("email_log.txt", "a") as f:
            f.write(f"{datetime.now()} | SENT | {to_email} | {url}\n")

    except Exception as e:
        print("❌ Failed to send email:", e)

        # 🔥 Log failure
        with open("email_log.txt", "a") as f:
            f.write(f"{datetime.now()} | FAILED | {to_email} | {url} | {e}\n")