"""Unit tests for self-match detection in the Intelligence pipeline."""
import os
import tempfile
import pytest
from PIL import Image

from app.pipeline import compute_file_digest, is_self_match
from app.phash import get_phash, phash_similarity
from app.embedder import get_embedding
from app.comparator import cosine_similarity


class TestComputeFileDigest:
    """Tests for compute_file_digest function."""

    def test_same_file_same_digest(self):
        """Same file should produce identical digest."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            tmp_path = f.name
            img = Image.new("RGB", (100, 100), color="red")
            img.save(tmp_path, "JPEG")
        # File is now closed, compute digest
        digest1 = compute_file_digest(tmp_path)
        digest2 = compute_file_digest(tmp_path)
        os.unlink(tmp_path)
        assert digest1 == digest2

    def test_different_files_different_digest(self):
        """Different files should produce different digests."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f1:
            tmp_path1 = f1.name
            img1 = Image.new("RGB", (100, 100), color="red")
            img1.save(tmp_path1, "JPEG")

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f2:
            tmp_path2 = f2.name
            img2 = Image.new("RGB", (100, 100), color="blue")
            img2.save(tmp_path2, "JPEG")

        digest1 = compute_file_digest(tmp_path1)
        digest2 = compute_file_digest(tmp_path2)
        os.unlink(tmp_path1)
        os.unlink(tmp_path2)
        assert digest1 != digest2


class TestIsSelfMatch:
    """Tests for is_self_match predicate."""

    def test_exact_digest_match(self):
        """Exact file digest match should return True."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            tmp_path = f.name
            img = Image.new("RGB", (100, 100), color="red")
            img.save(tmp_path, "JPEG")
        digest = compute_file_digest(tmp_path)
        # File closed, now test
        result = is_self_match(digest, tmp_path, 0.95, 0.90)
        os.unlink(tmp_path)
        assert result is True

    def test_clip_phash_threshold_match(self):
        """CLIP >= 0.985 AND pHash >= 0.95 should return True."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            tmp_path = f.name
            img = Image.new("RGB", (100, 100), color="red")
            img.save(tmp_path, "JPEG")
        digest = compute_file_digest(tmp_path)
        # High CLIP and pHash should trigger self-match
        assert is_self_match(digest, tmp_path, 0.985, 0.95) is True
        assert is_self_match(digest, tmp_path, 0.99, 0.96) is True
        os.unlink(tmp_path)

    def test_clip_below_threshold(self):
        """CLIP < 0.985 should not trigger self-match via threshold."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f1:
            tmp_path1 = f1.name
            img1 = Image.new("RGB", (100, 100), color="red")
            img1.save(tmp_path1, "JPEG")
        digest1 = compute_file_digest(tmp_path1)

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f2:
            tmp_path2 = f2.name
            img2 = Image.new("RGB", (100, 100), color="blue")
            img2.save(tmp_path2, "JPEG")

        # CLIP below threshold, different digest -> not self-match
        result = is_self_match(digest1, tmp_path2, 0.98, 0.96)
        os.unlink(tmp_path1)
        os.unlink(tmp_path2)
        assert result is False

    def test_phash_below_threshold(self):
        """pHash < 0.95 should not trigger self-match via threshold."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f1:
            tmp_path1 = f1.name
            img1 = Image.new("RGB", (100, 100), color="red")
            img1.save(tmp_path1, "JPEG")
        digest1 = compute_file_digest(tmp_path1)

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f2:
            tmp_path2 = f2.name
            img2 = Image.new("RGB", (100, 100), color="blue")
            img2.save(tmp_path2, "JPEG")

        # pHash below threshold, different digest -> not self-match
        result = is_self_match(digest1, tmp_path2, 0.99, 0.94)
        os.unlink(tmp_path1)
        os.unlink(tmp_path2)
        assert result is False

    def test_both_thresholds_required(self):
        """Both CLIP and pHash must meet thresholds."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f1:
            tmp_path1 = f1.name
            img1 = Image.new("RGB", (100, 100), color="red")
            img1.save(tmp_path1, "JPEG")
        digest1 = compute_file_digest(tmp_path1)

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f2:
            tmp_path2 = f2.name
            img2 = Image.new("RGB", (100, 100), color="blue")
            img2.save(tmp_path2, "JPEG")

        # High CLIP but low pHash -> not self-match
        result1 = is_self_match(digest1, tmp_path2, 0.99, 0.90)
        # Low CLIP but high pHash -> not self-match
        result2 = is_self_match(digest1, tmp_path2, 0.95, 0.96)
        os.unlink(tmp_path1)
        os.unlink(tmp_path2)
        assert result1 is False
        assert result2 is False


class TestSelfMatchIntegration:
    """Integration tests for self-match filtering in pipeline context."""

    def test_identical_image_is_self_match(self):
        """An identical image copy should be detected as self-match."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            tmp_path = f.name
            img = Image.new("RGB", (100, 100), color="green")
            img.save(tmp_path, "JPEG")
        digest = compute_file_digest(tmp_path)
        emb = get_embedding(tmp_path)
        phash_val = get_phash(tmp_path)

        # Compare image to itself
        clip_sim = (cosine_similarity(emb, emb) + 1) / 2
        phash_sim = phash_similarity(phash_val, phash_val)

        assert clip_sim == 1.0
        assert phash_sim == 1.0
        result = is_self_match(digest, tmp_path, clip_sim, phash_sim)
        os.unlink(tmp_path)
        assert result is True

    def test_different_image_not_self_match(self):
        """A different image should not be detected as self-match."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f1:
            tmp_path1 = f1.name
            img1 = Image.new("RGB", (100, 100), color="red")
            img1.save(tmp_path1, "JPEG")
        digest1 = compute_file_digest(tmp_path1)
        emb1 = get_embedding(tmp_path1)
        phash1 = get_phash(tmp_path1)

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f2:
            tmp_path2 = f2.name
            img2 = Image.new("RGB", (100, 100), color="blue")
            img2.save(tmp_path2, "JPEG")
        emb2 = get_embedding(tmp_path2)
        phash2 = get_phash(tmp_path2)

        clip_sim = (cosine_similarity(emb1, emb2) + 1) / 2
        phash_sim = phash_similarity(phash1, phash2)

        # Different colors should have lower similarity
        result = is_self_match(digest1, tmp_path2, clip_sim, phash_sim)
        os.unlink(tmp_path1)
        os.unlink(tmp_path2)
        assert result is False
