from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from secrets import randbelow
import hashlib
import os
import smtplib
import ssl
from threading import Lock
from pathlib import Path

import jwt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
      return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
      line = raw_line.strip()
      if not line or line.startswith("#") or "=" not in line:
        continue
      key, value = line.split("=", 1)
      values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _auth_settings() -> dict[str, str]:
    repo_root = Path(__file__).resolve().parents[4]
    dapp_env = _read_env_file(repo_root / "dapp" / ".env")
    smtp_username = os.getenv("SMTP_USERNAME") or dapp_env.get("SMTP_USERNAME", "")

    return {
      "APP_AUTH_SECRET": os.getenv("APP_AUTH_SECRET") or dapp_env.get("APP_AUTH_SECRET", ""),
      "SMTP_HOST": os.getenv("SMTP_HOST") or dapp_env.get("SMTP_HOST") or ("smtp.gmail.com" if smtp_username else ""),
      "SMTP_PORT": os.getenv("SMTP_PORT") or dapp_env.get("SMTP_PORT") or "587",
      "SMTP_USERNAME": smtp_username,
      "SMTP_PASSWORD": os.getenv("SMTP_PASSWORD") or dapp_env.get("SMTP_PASSWORD", ""),
      "SMTP_FROM_EMAIL": os.getenv("SMTP_FROM_EMAIL") or dapp_env.get("SMTP_FROM_EMAIL") or smtp_username,
      "SMTP_FROM_NAME": os.getenv("SMTP_FROM_NAME") or dapp_env.get("SMTP_FROM_NAME") or "TRINETRA Security",
      "SMTP_USE_TLS": os.getenv("SMTP_USE_TLS") or dapp_env.get("SMTP_USE_TLS") or "true",
      "SMTP_USE_SSL": os.getenv("SMTP_USE_SSL") or dapp_env.get("SMTP_USE_SSL") or "false",
      "SMTP_TIMEOUT_SECONDS": os.getenv("SMTP_TIMEOUT_SECONDS") or dapp_env.get("SMTP_TIMEOUT_SECONDS") or "40",
      "OTP_EXPIRY_MINUTES": os.getenv("OTP_EXPIRY_MINUTES") or dapp_env.get("OTP_EXPIRY_MINUTES") or "10",
      "OTP_COOLDOWN_SECONDS": os.getenv("OTP_COOLDOWN_SECONDS") or dapp_env.get("OTP_COOLDOWN_SECONDS") or "45",
    }


AUTH_SETTINGS = _auth_settings()
APP_AUTH_SECRET = AUTH_SETTINGS["APP_AUTH_SECRET"]
SMTP_HOST = AUTH_SETTINGS["SMTP_HOST"]
SMTP_PORT = int(AUTH_SETTINGS["SMTP_PORT"])
SMTP_USERNAME = AUTH_SETTINGS["SMTP_USERNAME"]
SMTP_PASSWORD = AUTH_SETTINGS["SMTP_PASSWORD"]
SMTP_FROM_EMAIL = AUTH_SETTINGS["SMTP_FROM_EMAIL"] or SMTP_USERNAME
SMTP_FROM_NAME = AUTH_SETTINGS["SMTP_FROM_NAME"]
SMTP_USE_TLS = AUTH_SETTINGS["SMTP_USE_TLS"].lower() == "true"
SMTP_USE_SSL = AUTH_SETTINGS["SMTP_USE_SSL"].lower() == "true"
SMTP_TIMEOUT_SECONDS = int(AUTH_SETTINGS["SMTP_TIMEOUT_SECONDS"])
OTP_EXPIRY_MINUTES = int(AUTH_SETTINGS["OTP_EXPIRY_MINUTES"])
OTP_COOLDOWN_SECONDS = int(AUTH_SETTINGS["OTP_COOLDOWN_SECONDS"])

_otp_store: dict[str, dict] = {}
_otp_lock = Lock()


class SendOtpRequest(BaseModel):
    email: str


class VerifyOtpRequest(BaseModel):
    email: str
    otp: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_otp() -> str:
    return f"{randbelow(1_000_000):06d}"


def _normalize_email(email: str) -> str:
    normalized = email.lower().strip()
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    return normalized


def _hash_otp(email: str, otp: str) -> str:
    return hashlib.sha256(f"{email.lower()}:{otp}".encode("utf-8")).hexdigest()


def _build_otp_email(email: str, otp: str) -> tuple[str, str, str]:
    subject = "Your TRINETRA login verification code"
    text = (
        f"TRINETRA Security Verification\n\n"
        f"Your one-time login code is: {otp}\n\n"
        f"This code will expire in {OTP_EXPIRY_MINUTES} minutes.\n"
        f"If you did not request this code, you can ignore this email."
    )
    html = f"""
    <!DOCTYPE html>
    <html lang="en">
      <body style="margin:0;padding:0;background:#0b0d10;font-family:Arial,sans-serif;color:#e8edf2;">
        <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
          <div style="border:1px solid #2d3840;background:#11161b;">
            <div style="padding:28px 28px 20px;border-bottom:1px solid #24303a;background:linear-gradient(180deg,#121920 0%,#0f1419 100%);">
              <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#8fa8b8;">TRINETRA Security</div>
              <h1 style="margin:14px 0 8px;font-size:26px;line-height:1.2;color:#f4f7fa;">Login Verification Code</h1>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#b8c4ce;">
                Use the one-time password below to complete your secure sign-in.
              </p>
            </div>
            <div style="padding:28px;">
              <div style="margin-bottom:16px;font-size:13px;color:#97a6b2;">Requested for</div>
              <div style="margin-bottom:24px;font-size:16px;color:#ffffff;">{email}</div>
              <div style="margin:24px 0;padding:20px;border:1px solid #304150;background:#0c1217;text-align:center;">
                <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8fa8b8;margin-bottom:10px;">One-Time Password</div>
                <div style="font-size:34px;letter-spacing:8px;font-weight:700;color:#9fd5e8;">{otp}</div>
              </div>
              <div style="font-size:14px;line-height:1.7;color:#c2cdd6;">
                This code expires in <strong>{OTP_EXPIRY_MINUTES} minutes</strong> and can be used only once.
              </div>
              <div style="margin-top:18px;font-size:13px;line-height:1.7;color:#8fa0ad;">
                If you did not request this login, no action is needed. Your account remains protected.
              </div>
            </div>
            <div style="padding:20px 28px;border-top:1px solid #24303a;color:#78909f;font-size:12px;line-height:1.6;">
              TRINETRA secure access notification<br/>
              This is an automated verification email.
            </div>
          </div>
        </div>
      </body>
    </html>
    """
    return subject, text, html


def _send_email(email: str, otp: str) -> None:
    if not all([APP_AUTH_SECRET, SMTP_HOST, SMTP_FROM_EMAIL]):
        raise HTTPException(status_code=500, detail="OTP email service is not configured")

    subject, text, html = _build_otp_email(email, otp)

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
    message["To"] = email
    message.attach(MIMEText(text, "plain", "utf-8"))
    message.attach(MIMEText(html, "html", "utf-8"))

    password = SMTP_PASSWORD.replace(" ", "") if SMTP_PASSWORD else ""
    ssl_context = ssl.create_default_context()

    try:
        if SMTP_USE_SSL:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS, context=ssl_context) as server:
                server.ehlo()
                if SMTP_USERNAME and password:
                    server.login(SMTP_USERNAME, password)
                server.sendmail(SMTP_FROM_EMAIL, [email], message.as_string())
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as server:
                server.ehlo()
                if SMTP_USE_TLS:
                    server.starttls(context=ssl_context)
                    server.ehlo()
                if SMTP_USERNAME and password:
                    server.login(SMTP_USERNAME, password)
                server.sendmail(SMTP_FROM_EMAIL, [email], message.as_string())
    except (TimeoutError, OSError, smtplib.SMTPException) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OTP email could not be sent. Check SMTP settings or try again. ({exc.__class__.__name__})",
        ) from exc


@router.post("/send-otp")
async def send_otp(payload: SendOtpRequest):
    email = _normalize_email(payload.email)
    now = _now()

    with _otp_lock:
        entry = _otp_store.get(email)
        if entry and entry["cooldown_until"] > now:
            retry_after = int((entry["cooldown_until"] - now).total_seconds())
            raise HTTPException(status_code=429, detail=f"Please wait {retry_after}s before requesting another OTP")

        otp = _generate_otp()
        _otp_store[email] = {
            "otp_hash": _hash_otp(email, otp),
            "expires_at": now + timedelta(minutes=OTP_EXPIRY_MINUTES),
            "cooldown_until": now + timedelta(seconds=OTP_COOLDOWN_SECONDS),
            "attempts": 0,
        }

    try:
        _send_email(email, otp)
    except HTTPException:
        with _otp_lock:
            current = _otp_store.get(email)
            if current and current["otp_hash"] == _hash_otp(email, otp):
                _otp_store.pop(email, None)
        raise

    return {
        "status": "sent",
        "email": email,
        "expires_in_minutes": OTP_EXPIRY_MINUTES,
    }


@router.post("/verify-otp")
async def verify_otp(payload: VerifyOtpRequest):
    email = _normalize_email(payload.email)
    otp = payload.otp.strip()
    now = _now()

    with _otp_lock:
        entry = _otp_store.get(email)
        if not entry:
            raise HTTPException(status_code=400, detail="No OTP request found for this email")
        if entry["expires_at"] <= now:
            _otp_store.pop(email, None)
            raise HTTPException(status_code=400, detail="OTP expired")

        entry["attempts"] += 1
        if entry["attempts"] > 5:
            _otp_store.pop(email, None)
            raise HTTPException(status_code=429, detail="Too many invalid attempts. Request a new OTP")

        if entry["otp_hash"] != _hash_otp(email, otp):
            raise HTTPException(status_code=400, detail="Invalid OTP")

        _otp_store.pop(email, None)

    if not APP_AUTH_SECRET:
        raise HTTPException(status_code=500, detail="APP_AUTH_SECRET is not configured")

    expires_at = now + timedelta(hours=12)
    token = jwt.encode(
        {
            "sub": email,
            "email": email,
            "token_type": "access",
            "aud": "trinetra-users",
            "iat": int(now.timestamp()),
            "exp": int(expires_at.timestamp()),
        },
        APP_AUTH_SECRET,
        algorithm="HS256",
    )

    return {
        "status": "verified",
        "access_token": token,
        "token_type": "bearer",
        "user": {"email": email},
        "expires_at": expires_at.isoformat(),
    }
