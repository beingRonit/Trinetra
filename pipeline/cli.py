#!/usr/bin/env python3
"""
Image Authenticity Pipeline - CLI Interface

Usage:
    python cli.py analyze <image_path>  - Analyze an image for authenticity
    python cli.py serve                  - Start the API server
"""

import sys
import os
import asyncio
import argparse
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.pipeline import run_pipeline_async
from app.validator import validate_image, ImageValidationError


def analyze_image(image_path: str):
    """Analyze a single image and print results"""

    if not os.path.exists(image_path):
        print(f"Error: File not found: {image_path}")
        return None

    print(f"\n{'='*60}")
    print(f"IMAGE AUTHENTICITY ANALYSIS")
    print(f"{'='*60}")
    print(f"Input: {image_path}")
    print("-"*60)

    try:
        # Validate the image first
        with open(image_path, "rb") as f:
            validation = validate_image(f)
        print(f"Image size: {validation['width']}x{validation['height']}")
        print(f"Format: {validation['mime']}")
        print("-"*60)

        # Run the pipeline
        print("Running analysis pipeline...")
        print("  - Generating captions...")
        print("  - Searching for similar images...")
        print("  - Computing similarity scores...")
        print()

        results = asyncio.run(run_pipeline_async(image_path))

        if not results:
            print("\nNo matching images found online.")
            print("This image may be unique or original.")
            return None

        best = results[0]

        # Display results
        print(f"\n{'='*60}")
        print("RESULTS")
        print(f"{'='*60}")

        print(f"\n  MATCH SCORE:    {best['final']:.1f}%")
        print(f"  LABEL:          {best['label']}")
        print(f"  RISK LEVEL:     {best['risk']}/100 ({best['fraud']})")
        print(f"  SOURCE:         {best.get('source', 'Unknown')}")

        print(f"\n  CLIP Score:     {best['clip']:.2%}")
        print(f"  pHash Score:    {best['phash']:.2%}")

        print(f"\n  EXPLANATION:")
        print(f"    {best['explanation']}")

        if best.get('visual'):
            print(f"\n  VISUALIZATION:  {best['visual']}")

        # Show top matches if available
        if len(results) > 1:
            print(f"\n{'='*60}")
            print("TOP MATCHES")
            print(f"{'='*60}")
            for i, r in enumerate(results[:5], 1):
                print(f"  {i}. {r['final']:.1f}% - {r.get('source', 'Unknown')}")

        print(f"\n{'='*60}")

        # Interpretation
        print("\nINTERPRETATION:")
        if best['final'] >= 90:
            print("  This image appears to be an EXACT or NEAR-EXACT match")
            print("  to an image found online.")
        elif best['final'] >= 75:
            print("  Strong similarity detected. Image may be modified/reused.")
        elif best['final'] >= 60:
            print("  Moderate similarity. Further investigation recommended.")
        else:
            print("  Low similarity. Image appears to be unique or heavily modified.")

        print(f"{'='*60}\n")

        return best

    except ImageValidationError as e:
        print(f"\nValidation Error: {e}")
        return None
    except Exception as e:
        print(f"\nError during analysis: {e}")
        import traceback
        traceback.print_exc()
        return None


def main():
    parser = argparse.ArgumentParser(
        description="Image Authenticity Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python cli.py analyze photo.jpg     - Analyze an image
  python cli.py serve                 - Start API server on port 8003
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Analyze command
    analyze_parser = subparsers.add_parser("analyze", help="Analyze an image for authenticity")
    analyze_parser.add_argument("image", help="Path to the image file")

    # Serve command
    serve_parser = subparsers.add_parser("serve", help="Start the API server")
    serve_parser.add_argument("--port", type=int, default=8003, help="Port to run server on")
    serve_parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")

    args = parser.parse_args()

    if args.command == "analyze":
        analyze_image(args.image)
    elif args.command == "serve":
        from app.api.server import app
        import uvicorn
        print(f"Starting API server on {args.host}:{args.port}")
        uvicorn.run(app, host=args.host, port=args.port)
    else:
        parser.print_help()
        print("\nAvailable commands:")
        print("  analyze <image>  - Analyze an image for authenticity")
        print("  serve            - Start the API server")


if __name__ == "__main__":
    main()
