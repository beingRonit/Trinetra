import cv2
import numpy as np
import os


def create_comparison_placeholder(output_dir: str = None) -> str:
    """Creates a placeholder comparison image when no match is found."""
    if output_dir is None:
        output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "output")
    os.makedirs(output_dir, exist_ok=True)

    h, w = 300, 600
    img = np.ones((h, w, 3), dtype=np.uint8) * 128
    cv2.putText(img, "No Match Found", (150, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

    output_path = os.path.join(output_dir, "comparison.jpg")
    cv2.imwrite(output_path, img)
    return output_path


def highlight_best_patch(input_path, match_path, grid_size, patch_index):
    """
    Draws a bounding box on the input image showing the best matching region.
    Saves a side-by-side comparison image.
    """
    output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "output")
    os.makedirs(output_dir, exist_ok=True)

    img1 = cv2.imread(input_path) if os.path.exists(input_path) else None
    img2 = cv2.imread(match_path) if os.path.exists(match_path) else None

    if img1 is None or img2 is None:
        return create_comparison_placeholder(output_dir)

    h, w = img1.shape[:2]

    patch_h = h // grid_size
    patch_w = w // grid_size

    row = patch_index // grid_size
    col = patch_index % grid_size

    x1 = col * patch_w
    y1 = row * patch_h
    x2 = x1 + patch_w
    y2 = y1 + patch_h

    img1_copy = img1.copy()
    cv2.rectangle(img1_copy, (x1, y1), (x2, y2), (0, 255, 0), 3)

    img2_resized = cv2.resize(img2, (w, h))

    combined = cv2.hconcat([img1_copy, img2_resized])

    output_path = os.path.join(output_dir, "comparison.jpg")
    cv2.imwrite(output_path, combined)

    return output_path


def create_full_image_comparison(input_path, match_path):
    """
    Saves a side-by-side comparison without highlighting a crop region.
    The scan prioritizes the full-image vector, so the visualization should
    show the complete source and match images.
    """
    output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "output")
    os.makedirs(output_dir, exist_ok=True)

    img1 = cv2.imread(input_path) if os.path.exists(input_path) else None
    img2 = cv2.imread(match_path) if os.path.exists(match_path) else None

    if img1 is None or img2 is None:
        return create_comparison_placeholder(output_dir)

    h, w = img1.shape[:2]
    img2_resized = cv2.resize(img2, (w, h))
    combined = cv2.hconcat([img1, img2_resized])

    output_path = os.path.join(output_dir, "comparison.jpg")
    cv2.imwrite(output_path, combined)

    return output_path
