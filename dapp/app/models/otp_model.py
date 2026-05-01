"""
OTP SQLAlchemy model for persistent OTP storage.
Replaces the in-memory _otp_store dict to survive restarts and avoid race conditions.
"""
from sqlalchemy import Column, String, DateTime, Integer
from sqlalchemy.orm import declarative_base
from datetime import datetime, timezone

Base = declarative_base()


class OTPRecord(Base):
    __tablename__ = "otp_records"

    email = Column(String, primary_key=True, index=True)
    otp_hash = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    cooldown_until = Column(DateTime(timezone=True), nullable=False)
    attempts = Column(Integer, default=0, nullable=False)

    def is_expired(self, now: datetime) -> bool:
        return self.expires_at <= now

    def is_cooldown_active(self, now: datetime) -> bool:
        return self.cooldown_until > now

    def is_locked_out(self) -> bool:
        return self.attempts >= 5
