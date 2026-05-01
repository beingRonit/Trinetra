"""
ORM models matching the actual veridex.db schema (after audit).
The live DB has additional columns (model_label, risk_score, confidence, is_correct)
beyond the original minimal model.
"""
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime
from sqlalchemy.orm import declarative_base
from datetime import datetime

Base = declarative_base()


class FeedbackEntry(Base):
    __tablename__ = "feedback"

    id                = Column(Integer, primary_key=True, index=True)
    image_hash        = Column(String, nullable=False, index=True)
    image_path        = Column(String, nullable=True)
    original_score    = Column(Float, nullable=False)
    user_label        = Column(String, nullable=False)
    model_label       = Column(String, nullable=True)
    risk_score        = Column(Integer, nullable=True)
    confidence        = Column(String, nullable=True)
    meta_score        = Column(Float, default=0.0)
    forensic_score    = Column(Float, default=0.0)
    classifier_score  = Column(Float, default=0.0)
    similarity_score  = Column(Float, default=0.0)
    is_correct        = Column(Boolean, nullable=True)
    trained           = Column(Boolean, default=False)
    created_at        = Column(DateTime, default=datetime.utcnow)
