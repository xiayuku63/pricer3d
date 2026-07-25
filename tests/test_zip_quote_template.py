import io

from openpyxl import load_workbook

from app.services.zip_quote_template import build_zip_template_bytes


def test_template_module_embeds_user_brands_in_examples_and_help():
    workbook = load_workbook(io.BytesIO(build_zip_template_bytes(["Brand Z"])))

    template = workbook["导入模板"]
    details = workbook["参数说明"]
    assert template["B3"].value == "Brand Z"
    assert details["E3"].value == "Brand Z"
    assert template["A1"].value == "filename"
