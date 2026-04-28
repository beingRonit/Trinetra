#!/usr/bin/env python3
"""VERIDEX CLI - Interactive terminal based image analysis"""

import requests
import os
import sys

API_KEY = "your-secret-key-here"
API_URL = "http://localhost:8003/analyze"
FEEDBACK_URL = "http://localhost:8003/feedback"


def analyze_image(image_path: str, verbose: bool = False):
    if not os.path.exists(image_path):
        print(f"\nError: File not found: {image_path}")
        return
    
    print(f"\n[+] Analyzing: {image_path}")
    print(f"[+] Sending to {API_URL}...")
    
    try:
        with open(image_path, "rb") as f:
            response = requests.post(
                API_URL,
                files={"file": f},
                headers={"X-API-Key": API_KEY},
                timeout=60
            )
    except Exception as e:
        print(f"Error: Could not connect to server: {e}")
        print("Make sure the server is running: python run.py")
        return
    
    if response.status_code != 200:
        print(f"Error: {response.status_code} - {response.text}")
        return
    
    r = response.json()
    
    print("\n" + "="*50)
    print(" VERIDEX DETECTION RESULT")
    print("="*50)
    print(f"  Status      : {r.get('label', 'N/A')}")
    print(f"  Risk Score : {r.get('risk_score', 0)}/100")
    print(f"  Confidence : {r.get('confidence', 'N/A')}")
    print("-"*50)
    print(f"  Reasons:")
    for reason in r.get('reason', []):
        print(f"    - {reason}")
    print("-"*50)
    if verbose:
        print(f"  Breakdown:")
        bd = r.get('component_breakdown', {})
        print(f"    - Metadata  : {bd.get('metadata', r.get('meta_score', 'N/A'))}")
        print(f"    - Forensics : {bd.get('forensics', r.get('forensic_score', 'N/A'))}")
        print(f"    - Classifier: {bd.get('classifier', r.get('classifier_score', 'N/A'))}")
        print(f"    - Similarity : {bd.get('similarity', r.get('similarity_score', 'N/A'))}")
    print("="*50)
    
    return r


def get_feedback(result: dict, detection_label: str) -> bool:
    print("\nIs this detection correct?")
    
    is_suspicious_or_fake = detection_label in ["SUSPICIOUS", "FAKE"]
    
    if is_suspicious_or_fake:
        print("  [y] Yes, it's AI/Fake")
        print("  [n] No, it's Real")
    else:
        print("  [y] Yes, it's Real")
        print("  [n] No, it's AI/Fake")
    
    print("  [s] Skip")
    
    choice = input("Your choice (y/n/s): ").strip().lower()
    
    if choice not in ['y', 'n', 's']:
        print("  - Invalid, skipped\n")
        return False
    
    if choice == 's':
        print("  - Skipped\n")
        return False
    
    user_label = 'CORRECT' if choice == 'y' else 'WRONG'
    
    try:
        resp = requests.post(
            FEEDBACK_URL,
            data={
                "image_hash": result.get('image_hash', ''),
                "original_score": result.get('risk_score', 0),
                "user_label": user_label,
                "meta_score": result.get('meta_score', 0),
                "forensic_score": result.get('forensic_score', 0),
                "classifier_score": result.get('classifier_score', 0),
                "similarity_score": result.get('similarity_score', 0)
            },
            timeout=10
        )
        if resp.status_code == 200:
            result = resp.json()
            
            # Check if training was triggered
            training = result.get('training')
            if training and training.get('triggered'):
                if training.get('success'):
                    print(f"  - Feedback saved: {user_label}")
                    print(f"  - Training triggered: {training.get('message', 'Training complete!')}")
                    print(f"  - Samples used: {training.get('samples_used', 0)}")
                else:
                    print(f"  - Feedback saved: {user_label}")
                    print(f"  - Training status: {training.get('message', 'Failed')}")
            else:
                pending = training.get('pending_samples', 0) if training else 0
                needed = training.get('samples_needed', 5) if training else 5
                print(f"  - Feedback saved: {user_label}")
                print(f"  - {pending} feedback(s) | {needed} more needed for training")
            return True
        else:
            print(f"  - Feedback failed: {resp.status_code}\n")
            return False
    except Exception as e:
        print(f"  - Error: {e}\n")
        return False


def main():
    print("\n" + "="*52)
    print("█    █  ██████  █████   ███  █████   ██████  █    █")
    print("█    █  █       █    █   █   █    █  █        █  █ ")
    print("█    █  █████   █████    █   █    █  █████     ██  ")
    print(" █  █   █       █   █    █   █    █  █        █  █ ")
    print("  ██    ██████  █    █  ███  █████   ██████  █    █")
    print("="*52)
    print("Type 'quit' or 'q' to exit\n")
    
    while True:
        try:
            image_path = input("Enter image path: ").strip().strip('"').strip("'")
            image_path = os.path.normpath(image_path)
        except EOFError:
            break
        
        if not image_path:
            continue
        
        if image_path.lower() in ['quit', 'q', 'exit']:
            print("\nGoodbye!")
            break
        
        if not os.path.exists(image_path):
            print(f"\nError: File not found: {image_path}")
            continue
        
        result = analyze_image(image_path)
        
        if result:
            feedback_saved = get_feedback(result, result.get('label', ''))
            if feedback_saved:
                print("\nGoodbye!")
                break
        
        print()


if __name__ == "__main__":
    main()