from PIL import Image
from clip_compare import compute_similarity, load_image_from_url

# Your local image
query_img = Image.open("test1.jpg").convert("RGB")

# Example Serper result image URL
test_url = "https://upload.wikimedia.org/wikipedia/commons/7/7a/Basketball.png"

candidate_img = load_image_from_url(test_url)

if candidate_img:
    score = compute_similarity(query_img, candidate_img)
    print(f"Similarity Score: {score:.4f}")
else:
    print("Failed to load candidate image")