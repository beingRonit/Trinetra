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