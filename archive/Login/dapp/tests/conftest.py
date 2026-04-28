import pytest
from PIL import Image
from io import BytesIO

@pytest.fixture
def sample_image():
    return Image.new('RGB', (224, 224), color='red')

@pytest.fixture
def sample_image_bytes():
    img = Image.new('RGB', (224, 224), color='blue')
    buf = BytesIO()
    img.save(buf, format='JPEG')
    buf.seek(0)
    return buf.getvalue()

@pytest.fixture
def mock_serper_response():
    return {
        "images": [
            {
                "title": "Test Image",
                "source": "test.com",
                "imageUrl": "https://example.com/img.jpg",
                "link": "https://test.com"
            }
        ]
    }