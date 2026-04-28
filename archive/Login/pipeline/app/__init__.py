"""Pipeline app package.

Exports are loaded lazily so importing a submodule such as app.api.server does
not eagerly initialize every ML model in the package.
"""

from typing import Any


def __getattr__(name: str) -> Any:
    if name == "run_pipeline_async":
        from .pipeline import run_pipeline_async

        return run_pipeline_async
    if name == "extract_all_features":
        from .extraction import extract_all_features

        return extract_all_features
    if name in {"validate_image", "ImageValidationError"}:
        from .validator import ImageValidationError, validate_image

        return {"validate_image": validate_image, "ImageValidationError": ImageValidationError}[name]
    if name in {"find_existing_by_phash", "insert_image_features"}:
        from .db import find_existing_by_phash, insert_image_features

        return {
            "find_existing_by_phash": find_existing_by_phash,
            "insert_image_features": insert_image_features,
        }[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "run_pipeline_async",
    "extract_all_features",
    "validate_image",
    "ImageValidationError",
    "find_existing_by_phash",
    "insert_image_features",
]
