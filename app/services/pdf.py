"""PDF quote generation service for Pricer3D.

Generates professional PDF quotes using reportlab with support for
Chinese text, brand customization, and clean table layout.
"""

import io
import logging
import os
import base64
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    Image as RLImage,
    HRFlowable,
)

logger = logging.getLogger(__name__)

# ── Color scheme ──
DARK_BLUE = (30, 41, 59)  # #1e293b
INDIGO = (79, 70, 229)  # #4f46e5
LIGHT_GRAY = (241, 245, 249)  # #f1f5f9
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
BORDER_GRAY = (203, 213, 225)  # #cbd5e1

# ── Try to register Chinese font ──
_FONT_NAME = "Helvetica"
_FONT_BOLD = "Helvetica-Bold"
_CN_FONT_AVAILABLE = False

try:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont

    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    _FONT_NAME = "STSong-Light"
    _FONT_BOLD = "STSong-Light"
    _CN_FONT_AVAILABLE = True
    logger.info("PDF: Chinese font STSong-Light registered successfully")
except Exception as e:
    logger.warning("PDF: Chinese font not available, falling back to Helvetica: %s", e)


def _make_styles():
    """Create paragraph styles for the PDF."""
    styles = {}

    styles["brand_name"] = ParagraphStyle(
        "BrandName",
        fontName=_FONT_BOLD,
        fontSize=18,
        textColor=colors.Color(*[c / 255 for c in DARK_BLUE]),
        alignment=TA_LEFT,
        spaceAfter=4,
    )

    styles["quote_title"] = ParagraphStyle(
        "QuoteTitle",
        fontName=_FONT_BOLD,
        fontSize=14,
        textColor=colors.Color(*[c / 255 for c in INDIGO]),
        alignment=TA_LEFT,
        spaceAfter=4,
    )

    styles["header_info"] = ParagraphStyle(
        "HeaderInfo",
        fontName=_FONT_NAME,
        fontSize=9,
        textColor=colors.Color(0.3, 0.3, 0.3),
        alignment=TA_LEFT,
        leading=14,
    )

    styles["section_title"] = ParagraphStyle(
        "SectionTitle",
        fontName=_FONT_BOLD,
        fontSize=11,
        textColor=colors.Color(*[c / 255 for c in DARK_BLUE]),
        spaceBefore=12,
        spaceAfter=6,
    )

    styles["body"] = ParagraphStyle(
        "Body",
        fontName=_FONT_NAME,
        fontSize=9,
        textColor=colors.Color(0.2, 0.2, 0.2),
        alignment=TA_LEFT,
        leading=14,
    )

    styles["body_right"] = ParagraphStyle(
        "BodyRight",
        fontName=_FONT_NAME,
        fontSize=9,
        textColor=colors.Color(0.2, 0.2, 0.2),
        alignment=TA_RIGHT,
        leading=14,
    )

    styles["table_header"] = ParagraphStyle(
        "TableHeader",
        fontName=_FONT_BOLD,
        fontSize=7,
        textColor=WHITE,
        alignment=TA_CENTER,
        leading=12,
    )

    styles["table_cell"] = ParagraphStyle(
        "TableCell",
        fontName=_FONT_NAME,
        fontSize=7,
        textColor=colors.Color(0.15, 0.15, 0.15),
        alignment=TA_CENTER,
        leading=11,
    )

    styles["table_cell_left"] = ParagraphStyle(
        "TableCellLeft",
        fontName=_FONT_NAME,
        fontSize=7,
        textColor=colors.Color(0.15, 0.15, 0.15),
        alignment=TA_LEFT,
        leading=11,
    )

    styles["summary_label"] = ParagraphStyle(
        "SummaryLabel",
        fontName=_FONT_NAME,
        fontSize=9,
        textColor=colors.Color(0.3, 0.3, 0.3),
        alignment=TA_RIGHT,
    )

    styles["summary_value"] = ParagraphStyle(
        "SummaryValue",
        fontName=_FONT_BOLD,
        fontSize=10,
        textColor=colors.Color(*[c / 255 for c in DARK_BLUE]),
        alignment=TA_RIGHT,
    )

    styles["footer"] = ParagraphStyle(
        "Footer",
        fontName=_FONT_NAME,
        fontSize=8,
        textColor=colors.Color(0.5, 0.5, 0.5),
        alignment=TA_LEFT,
        leading=12,
    )

    styles["watermark"] = ParagraphStyle(
        "Watermark",
        fontName=_FONT_NAME,
        fontSize=7,
        textColor=colors.Color(0.7, 0.7, 0.7),
        alignment=TA_CENTER,
    )

    styles["client_field"] = ParagraphStyle(
        "ClientField",
        fontName=_FONT_NAME,
        fontSize=9,
        textColor=colors.Color(0.4, 0.4, 0.4),
        alignment=TA_LEFT,
        leading=16,
    )

    return styles


def _generate_quote_number() -> str:
    """Generate a quote number: Q + date + random 4-digit sequence."""
    import random

    now = datetime.now()
    seq = random.randint(1000, 9999)
    return f"Q{now.strftime('%Y%m%d')}{seq}"


def _make_thumbnail_image(b64_str, col_width=28 * mm):
    """Create a ReportLab Image from base64 PNG/SVG data, preserving aspect ratio."""
    if not b64_str:
        return None
    try:
        img_data = base64.b64decode(b64_str)
        img_buf = io.BytesIO(img_data)
        img = RLImage(img_buf)
        w = min(col_width - 2 * mm, img.drawWidth)
        scale = w / img.drawWidth
        h = img.drawHeight * scale
        if h > 18 * mm:
            h = 18 * mm
            w = img.drawWidth * (h / img.drawHeight)
        img.drawWidth = w
        img.drawHeight = h
        img.hAlign = "CENTER"
        return img
    except Exception:
        return None


def _make_color_cell(hex_str, styles):
    """Create a cell with a color swatch + hex label."""
    hex_str = str(hex_str or "").strip()
    if not hex_str or hex_str == "-":
        return Paragraph("-", styles["table_cell"])
    if not hex_str.startswith("#"):
        hex_str = "#" + hex_str
    try:
        r = int(hex_str[1:3], 16) / 255
        g = int(hex_str[3:5], 16) / 255
        b = int(hex_str[5:7], 16) / 255
        swatch_color = colors.Color(r, g, b)
    except Exception:
        return Paragraph(hex_str, styles["table_cell"])
    swatch = Table([[""]], colWidths=[10 * mm], rowHeights=[6 * mm])
    swatch.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), swatch_color),
                ("BOX", (0, 0), (0, 0), 0.5, colors.Color(0.7, 0.7, 0.7)),
                ("TOPPADDING", (0, 0), (0, 0), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 0),
            ]
        )
    )
    label = Paragraph(
        hex_str,
        ParagraphStyle(
            "ColorLabel",
            parent=styles["table_cell"],
            fontSize=6,
            textColor=colors.Color(0.4, 0.4, 0.4),
            alignment=TA_CENTER,
        ),
    )
    cell = Table([[swatch], [label]], colWidths=[12 * mm])
    cell.setStyle(
        TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return cell


def _try_load_logo(logo_url: str) -> Optional[RLImage]:
    """Try to load brand logo image from URL path."""
    if not logo_url:
        return None
    try:
        if logo_url.startswith("/"):
            local_path = logo_url.lstrip("/")
        else:
            local_path = logo_url

        if os.path.exists(local_path):
            img = RLImage(local_path, width=40 * mm, height=15 * mm)
            img.hAlign = "LEFT"
            return img

        if not local_path.startswith("static"):
            alt_path = os.path.join("static", local_path)
            if os.path.exists(alt_path):
                img = RLImage(alt_path, width=40 * mm, height=15 * mm)
                img.hAlign = "LEFT"
                return img
    except Exception as e:
        logger.warning("PDF: Failed to load logo from %s: %s", logo_url, e)
    return None


def generate_pdf_quote(
    items: List[Dict[str, Any]],
    brand_name: str = "",
    brand_logo_url: str = "",
    brand_phone: str = "",
    brand_contact_email: str = "",
    brand_address: str = "",
    brand_note: str = "",
    member_discount_percent: float = 0.0,
) -> bytes:
    """Generate a professional PDF quote."""
    buf = io.BytesIO()
    styles = _make_styles()

    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=2 * cm,
    )

    elements = []
    page_width = landscape(A4)[0] - 3 * cm

    logo_img = _try_load_logo(brand_logo_url)

    quote_number = _generate_quote_number()
    quote_date = datetime.now().strftime("%Y-%m-%d")
    valid_until = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")

    display_name = brand_name if brand_name else "Pricer3D"

    left_elements = []
    if logo_img:
        left_elements.append(logo_img)
        left_elements.append(Spacer(1, 4 * mm))
    left_elements.append(Paragraph(display_name, styles["brand_name"]))
    left_elements.append(Spacer(1, 3 * mm))

    contact_lines = []
    if brand_phone:
        contact_lines.append(f"Tel: {brand_phone}")
    if brand_contact_email:
        contact_lines.append(f"Email: {brand_contact_email}")
    if brand_address:
        contact_lines.append(f"Addr: {brand_address}")

    if contact_lines:
        for line in contact_lines:
            left_elements.append(Paragraph(line, styles["header_info"]))

    right_elements = [
        Paragraph("报价单 / QUOTATION", styles["quote_title"]),
        Spacer(1, 2 * mm),
        Paragraph(f"报价编号: {quote_number}", styles["header_info"]),
        Paragraph(f"报价日期: {quote_date}", styles["header_info"]),
        Paragraph(f"有效期至: {valid_until}", styles["header_info"]),
    ]

    header_table = Table(
        [[left_elements, right_elements]],
        colWidths=[page_width * 0.55, page_width * 0.45],
    )
    header_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    elements.append(header_table)

    elements.append(Spacer(1, 6 * mm))
    elements.append(
        HRFlowable(
            width="100%",
            thickness=2,
            lineCap="round",
            color=colors.Color(*[c / 255 for c in INDIGO]),
        )
    )
    elements.append(Spacer(1, 6 * mm))

    elements.append(Paragraph("客户信息 / CLIENT INFO", styles["section_title"]))

    client_fields = [
        "客户名称 / Client Name: _______________________________",
        "联系电话 / Contact: ___________________________________",
        "地址 / Address: ______________________________________",
    ]
    for field in client_fields:
        elements.append(Paragraph(field, styles["client_field"]))

    elements.append(Spacer(1, 6 * mm))

    elements.append(Paragraph("报价明细 / ITEMS", styles["section_title"]))

    headers = [
        "#",
        "文件名\nFilename",
        "预览\nPreview",
        "材料品牌\nMaterial Brand",
        "打印机\nPrinter",
        "材料\nMaterial",
        "颜色\nColor",
        "数量\nQty",
        "层高(mm)\nLayer",
        "填充率\nInfill",
        "重量(g)\nWeight",
        "时间(h)\nTime",
        "单价(¥)\nUnit Price",
        "小计(¥)\nSubtotal",
    ]

    header_row = [Paragraph(h, styles["table_header"]) for h in headers]

    data_rows = [header_row]
    total_amount = 0.0

    for idx, item in enumerate(items, 1):
        qty = int(item.get("quantity") or 1)
        total_cost = round(float(item.get("cost_cny") or 0), 2)
        unit_price = round(total_cost / qty, 2) if qty > 0 else total_cost
        subtotal = total_cost
        total_amount += subtotal

        brand_val = str(item.get("brand", ""))[:12]
        printer_val = _clean_printer(item.get("printer_model", ""))[:18]
        layer_val = item.get("layer_height", 0)
        infill_val = item.get("infill_percent", 0)
        layer_str = f"{layer_val:.1f}" if layer_val else "-"
        infill_str = f"{infill_val}%" if infill_val else "-"

        row = [
            Paragraph(str(idx), styles["table_cell"]),
            Paragraph(str(item.get("filename", ""))[:25], styles["table_cell_left"]),
            _make_thumbnail_image(item.get("thumbnail_b64", "")) or Paragraph("-", styles["table_cell"]),
            Paragraph(brand_val, styles["table_cell"]),
            Paragraph(printer_val, styles["table_cell"]),
            Paragraph(str(item.get("material", ""))[:12], styles["table_cell"]),
            _make_color_cell(item.get("color", ""), styles),
            Paragraph(str(qty), styles["table_cell"]),
            Paragraph(layer_str, styles["table_cell"]),
            Paragraph(infill_str, styles["table_cell"]),
            Paragraph(f"{float(item.get('weight_g') or 0):.1f}", styles["table_cell"]),
            Paragraph(f"{float(item.get('estimated_time_h') or 0):.1f}", styles["table_cell"]),
            Paragraph(f"{unit_price:.2f}", styles["table_cell"]),
            Paragraph(f"{subtotal:.2f}", styles["table_cell"]),
        ]
        data_rows.append(row)

    col_widths = [
        page_width * 0.025,
        page_width * 0.10,
        28 * mm,
        page_width * 0.06,
        page_width * 0.10,
        page_width * 0.06,
        page_width * 0.05,
        page_width * 0.035,
        page_width * 0.05,
        page_width * 0.05,
        page_width * 0.07,
        page_width * 0.05,
        page_width * 0.065,
        page_width * 0.065,
    ]

    table = Table(data_rows, colWidths=col_widths, repeatRows=1)

    dark_blue_color = colors.Color(*[c / 255 for c in DARK_BLUE])
    light_gray_color = colors.Color(*[c / 255 for c in LIGHT_GRAY])
    border_color = colors.Color(*[c / 255 for c in BORDER_GRAY])

    table_style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), dark_blue_color),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), _FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, border_color),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]

    for i in range(1, len(data_rows)):
        if i % 2 == 0:
            table_style_cmds.append(("BACKGROUND", (0, i), (-1, i), light_gray_color))

    table.setStyle(TableStyle(table_style_cmds))
    elements.append(table)

    elements.append(Spacer(1, 8 * mm))

    elements.append(Paragraph("费用汇总 / SUMMARY", styles["section_title"]))

    summary_data = [
        [Paragraph(f"报价项目数 / Items: {len(items)}", styles["summary_label"]), ""],
        [
            Paragraph("合计金额 / Subtotal:", styles["summary_label"]),
            Paragraph(f"¥ {total_amount:.2f}", styles["summary_value"]),
        ],
    ]

    discount_amount = 0.0
    final_total = total_amount
    if member_discount_percent > 0:
        discount_amount = round(total_amount * member_discount_percent / 100, 2)
        final_total = round(total_amount - discount_amount, 2)
        summary_data.append(
            [
                Paragraph(f"会员折扣 / Discount ({member_discount_percent:.0f}%):", styles["summary_label"]),
                Paragraph(
                    f"- ¥ {discount_amount:.2f}",
                    ParagraphStyle(
                        "DiscountValue",
                        parent=styles["summary_value"],
                        textColor=colors.Color(0.1, 0.6, 0.1),
                    ),
                ),
            ]
        )
        summary_data.append(
            [
                Paragraph("应付总额 / Total Due:", styles["summary_label"]),
                Paragraph(
                    f"¥ {final_total:.2f}",
                    ParagraphStyle(
                        "FinalTotal",
                        parent=styles["summary_value"],
                        fontSize=13,
                        textColor=colors.Color(*[c / 255 for c in INDIGO]),
                    ),
                ),
            ]
        )
    else:
        summary_data[-1] = [
            Paragraph("应付总额 / Total Due:", styles["summary_label"]),
            Paragraph(
                f"¥ {final_total:.2f}",
                ParagraphStyle(
                    "FinalTotal",
                    parent=styles["summary_value"],
                    fontSize=13,
                    textColor=colors.Color(*[c / 255 for c in INDIGO]),
                ),
            ),
        ]

    summary_table = Table(
        summary_data,
        colWidths=[page_width * 0.7, page_width * 0.3],
    )
    summary_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LINEBELOW", (0, -1), (-1, -1), 1.5, colors.Color(*[c / 255 for c in INDIGO])),
            ]
        )
    )
    elements.append(summary_table)

    elements.append(Spacer(1, 10 * mm))

    elements.append(
        HRFlowable(
            width="100%",
            thickness=0.5,
            lineCap="round",
            color=border_color,
        )
    )
    elements.append(Spacer(1, 4 * mm))

    if brand_note:
        elements.append(Paragraph("备注 / NOTES", styles["section_title"]))
        note_text = brand_note.replace("\n", "<br/>")
        elements.append(Paragraph(note_text, styles["footer"]))
        elements.append(Spacer(1, 4 * mm))

    payment_terms = (
        "付款方式 / Payment Terms: _________________________________<br/>"
        "付款期限 / Payment Due: _________________________________"
    )
    elements.append(Paragraph(payment_terms, styles["footer"]))

    elements.append(Spacer(1, 8 * mm))

    elements.append(
        HRFlowable(
            width="100%",
            thickness=0.3,
            lineCap="round",
            color=colors.Color(0.85, 0.85, 0.85),
        )
    )
    elements.append(Spacer(1, 2 * mm))
    elements.append(Paragraph("Generated by Pricer3D — https://pricer3d.com", styles["watermark"]))

    doc.build(elements)
    buf.seek(0)
    return buf.read()


def _clean_printer(name):
    """Strip nozzle suffix and format: 'bambu_a1_04' -> 'Bambu A1'."""
    name = re.sub(r"_\d{2}$", "", str(name or ""))
    parts = name.replace("_", " ").title().split()
    result = []
    for p in parts:
        if re.match(r"^[A-Za-z]{1,2}\d+[A-Za-z]*$", p):
            result.append(p.upper())
        else:
            result.append(p)
    return " ".join(result)
