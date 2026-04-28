import logging
import logging.config
from typing import Dict, Any
import os

def get_logging_config() -> Dict[str, Any]:
    level = os.getenv("LOG_LEVEL", "INFO")
    
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "standard": {
                "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S"
            },
            "detailed": {
                "format": "%(asctime)s [%(levelname)s] %(name)s:%(funcName)s:%(lineno)d - %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S"
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "level": level,
                "formatter": "standard",
                "stream": "ext://sys.stdout"
            },
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "level": level,
                "formatter": "detailed",
                "filename": "logs/app.log",
                "maxBytes": 10485760,
                "backupCount": 5
            }
        },
        "root": {
            "level": level,
            "handlers": ["console", "file"]
        },
        "loggers": {
            "uvicorn": {"level": "INFO"},
            "transformers": {"level": "WARNING"},
            "torch": {"level": "WARNING"}
        }
    }

def setup_logging():
    os.makedirs("logs", exist_ok=True)
    config = get_logging_config()
    logging.config.dictConfig(config)
    logging.getLogger(__name__).info("Logging init")