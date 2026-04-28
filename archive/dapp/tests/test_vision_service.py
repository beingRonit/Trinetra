import pytest
from PIL import Image
from dapp.app.services.vision_service import vision_service

@pytest.fixture
def test_img():
    return Image.new('RGB', (224, 224), color='blue')

@pytest.mark.unit
def test_caption(test_img):
    caption = vision_service.generate_caption(test_img)
    assert isinstance(caption, str)
    assert len(caption) > 0

@pytest.mark.unit
def test_domain(test_img):
    domain = vision_service.detect_domain(test_img)
    assert domain in vision_service.domain_labels

@pytest.mark.unit
def test_similarity(test_img):
    img2 = Image.new('RGB', (224, 224), color='red')
    sim = vision_service.compute_similarity(test_img, img2)
    assert 0 <= sim <= 1

@pytest.mark.unit
def test_singleton():
    from dapp.app.services.vision_service import VisionService
    s1 = VisionService()
    s2 = VisionService()
    assert s1 is s2