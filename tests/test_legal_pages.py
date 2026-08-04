from app.legal_content import render_privacy_page, render_terms_page


def test_terms_page_uses_current_product_features_and_escapes_operator_fields():
    html = render_terms_page(
        version="v2",
        effective_date="2026-07-31",
        operator_name="<script>alert(1)</script>",
        contact_email="legal@example.com",
        contact_address="Shanghai",
    )

    assert "版本：v2" in html
    assert "生效日期：2026-07-31" in html
    assert "ZIP 清单报价" in html
    assert "智能摆放" in html
    assert "PrusaSlicer" in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "<script>alert(1)</script>" not in html


def test_privacy_page_describes_actual_browser_and_file_retention_behavior():
    html = render_privacy_page(
        version="v2",
        effective_date="2026-07-31",
        operator_name="Pricer3D 运营方",
        contact_email="",
        contact_address="",
    )

    assert "sessionStorage" in html
    assert "localStorage" in html
    assert "上传模型和 G-code 分别保留约 30 天和 7 天" in html
    assert "报价历史页面清理记录及关联模型/G-code 文件" in html
    assert "Resend" in html
    assert "请配置 LEGAL_CONTACT_EMAIL" in html
    assert "存储在位于中华人民共和国的服务器" not in html
