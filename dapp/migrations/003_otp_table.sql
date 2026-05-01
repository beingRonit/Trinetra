-- Migration: Create otp_records table
-- Run this before starting the app for the first time after switching to DB-backed OTP.

CREATE TABLE IF NOT EXISTS otp_records (
    email        TEXT PRIMARY KEY,
    otp_hash     TEXT NOT NULL,
    created_at   DATETIME NOT NULL,
    expires_at   DATETIME NOT NULL,
    cooldown_until DATETIME NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_otp_records_email ON otp_records(email);
CREATE INDEX IF NOT EXISTS idx_otp_records_expires_at ON otp_records(expires_at);
