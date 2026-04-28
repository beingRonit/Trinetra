from sqlalchemy import Column, String, Integer, Float, Boolean
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class FeedbackEntry(Base):
    __tablename__ = "feedback"

    id               = Column(Integer, primary_key=True, index=True)
    image_hash       = Column(String, index=True)
    image_path       = Column(String, nullable=True)
    original_score   = Column(Float)
    user_label       = Column(String)   # CORRECT | WRONG
    meta_score       = Column(Float)
    forensic_score   = Column(Float)
    classifier_score = Column(Float)
    similarity_score= Column(Float)
    trained          = Column(Boolean, default=False)