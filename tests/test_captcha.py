from io import BytesIO
from pathlib import Path

from PIL import Image

from app.captcha import captcha_image_bytes


ROOT = Path(__file__).resolve().parents[1]


def test_captcha_image_is_large_enough_to_read():
    content_type, payload = captcha_image_bytes("ABCD")

    if content_type == "image/png":
        image = Image.open(BytesIO(payload))
        assert image.width >= 180
        assert image.height >= 64
    else:
        svg = payload.decode("utf-8")
        assert 'width="180"' in svg
        assert 'height="64"' in svg


def test_login_captcha_has_readable_display_size():
    login = (ROOT / "static/partials/login-modal.html").read_text(encoding="utf-8")
    mobile = (ROOT / "static/css/mobile.css").read_text(encoding="utf-8")
    head = (ROOT / "static/partials/head.html").read_text(encoding="utf-8")

    assert "h-[52px] w-[144px]" in login
    assert "height: 52px !important" in mobile
    assert "width: 136px !important" in mobile
    assert "/static/css/mobile.css?v=4" in head
