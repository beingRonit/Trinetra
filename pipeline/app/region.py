from PIL import Image

def extract_patches(path, grid=2):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    pw, ph = w // grid, h // grid

    patches = []
    for i in range(grid):
        for j in range(grid):
            patches.append(img.crop((i*pw, j*ph, (i+1)*pw, (j+1)*ph)))

    return patches


def extract_regions(data: bytes, grid: int = 2):
    img = Image.open(__import__("io").BytesIO(data)).convert("RGB")
    w, h = img.size
    pw, ph = w // grid, h // grid

    region_embeddings = []
    from .embedder import get_embedding_from_image

    for i in range(grid):
        for j in range(grid):
            patch = img.crop((i * pw, j * ph, (i + 1) * pw, (j + 1) * ph))
            emb = get_embedding_from_image(patch)
            region_embeddings.append(emb.cpu().numpy().tolist()[0])

    return region_embeddings
