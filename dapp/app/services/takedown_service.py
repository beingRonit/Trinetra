import re
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from urllib.parse import urlparse

import requests

from app.core.config import settings
from app.repositories.asset_repo import asset_repo
from app.repositories.scan_repo import scan_repo


class TakedownService:
    def _get_domain(self, url: str) -> str:
        return urlparse(url).netloc

    def _search_contact(self, domain: str) -> dict:
        if not settings.SERPER_API_KEY:
            return {}

        try:
            response = requests.post(
                "https://google.serper.dev/search",
                headers={
                    "X-API-KEY": settings.SERPER_API_KEY,
                    "Content-Type": "application/json",
                },
                json={"q": f"{domain} contact email OR abuse email OR copyright"},
                timeout=10,
            )
            return response.json() if response.ok else {}
        except Exception:
            return {}

    def _extract_emails(self, results: dict) -> list[str]:
        emails: set[str] = set()
        for item in results.get("organic", []):
            text = f"{item.get('title', '')} {item.get('snippet', '')}"
            emails.update(re.findall(r"[\w\.-]+@[\w\.-]+", text))
        return sorted(emails)

    def _pick_best_email(self, emails: list[str]) -> str | None:
        for email in emails:
            lowered = email.lower()
            if "abuse" in lowered or "support" in lowered or "legal" in lowered:
                return email
        return emails[0] if emails else None

    def _build_email_body(self, target_url: str, asset_id: str, confidence: float) -> str:
        return f"""
Dear Sir/Madam,

We are writing to inform you of a potential instance of unauthorized image usage detected by our monitoring system.

Details of the identified content are as follows:

URL: {target_url}
Asset ID: {asset_id}
Match Confidence: {confidence * 100:.2f}%

This content appears to match a protected digital asset. We kindly request that you review the material and take appropriate action if necessary.

If you believe this notification has been sent in error or the usage is authorized, no action is required.

Thank you for your time and cooperation.

Best regards,
TRINETRA Monitoring System

---
This is an automated message generated for asset protection purposes.
""".strip()

    def _send_email(self, to_email: str, target_url: str, asset_id: str, confidence: float) -> None:
        if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
            raise ValueError("SMTP credentials are not configured")

        subject = "Notice of Potential Unauthorized Image Usage"
        body = self._build_email_body(target_url, asset_id, confidence)

        msg = MIMEMultipart()
        msg["From"] = settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        if settings.SMTP_USE_TLS:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.starttls()
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.send_message(msg)
        else:
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.send_message(msg)

    async def trigger_for_media(self, media_id: str, user_id: str) -> dict:
        asset = await asset_repo.get_by_id(media_id)
        if not asset or asset.user_id != user_id:
            raise ValueError("Asset not found")

        scan = await scan_repo.get_latest_complete(media_id)
        if not scan or not scan.matches:
            raise ValueError("No completed scan with matches found for this asset")

        best_match = max(scan.matches, key=lambda match: match.similarity_score)
        target_url = best_match.url
        if not target_url:
            raise ValueError("No target URL found for takedown")

        domain = self._get_domain(target_url)
        contact_results = self._search_contact(domain)
        emails = self._extract_emails(contact_results)
        contact_email = self._pick_best_email(emails)

        if not contact_email:
            raise ValueError("No contact email found for the matched domain")

        self._send_email(
            to_email=contact_email,
            target_url=target_url,
            asset_id=media_id,
            confidence=best_match.similarity_score,
        )

        return {
            "status": "sent",
            "asset_id": media_id,
            "target_url": target_url,
            "contact_email": contact_email,
            "confidence": best_match.similarity_score,
            "sent_at": datetime.utcnow().isoformat(),
        }


takedown_service = TakedownService()
