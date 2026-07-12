"""SQLAlchemy ORM models — mirrors existing sqlite3 schema.

These models coexist with the raw SQL pathway. New code should
use these models + get_session(); existing code continues unchanged.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Text,
    ForeignKey,
    Index,
    UniqueConstraint,
)

from .db import Base


def _utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(String, nullable=False)

    materials = Column(Text)
    colors = Column(Text)
    pricing_config = Column(Text)
    email = Column(String)
    phone = Column(String)
    email_verified = Column(Integer, default=0)
    phone_verified = Column(Integer, default=0)
    membership_level = Column(String, default="free")
    membership_expires_at = Column(String)
    terms_accepted_at = Column(String)
    privacy_accepted_at = Column(String)
    terms_version = Column(String)
    privacy_version = Column(String)
    default_printer_id = Column(String)
    default_nozzle = Column(String)
    default_slicer_preset_id = Column(Integer)
    default_material = Column(String)
    default_color = Column(String)
    default_brand = Column(String)
    # 品牌定制字段
    brand_name = Column(String)  # 公司/品牌名称
    brand_logo_url = Column(String)  # Logo 文件 URL
    brand_phone = Column(String)  # 联系电话
    brand_contact_email = Column(String)  # 报价联系邮箱（区别于账户邮箱）
    brand_address = Column(String)  # 公司地址
    brand_note = Column(Text)  # 默认报价备注/条款


class PrinterPreset(Base):
    __tablename__ = "printer_presets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    name = Column(String, nullable=False)
    bed_width = Column(Float, nullable=False, default=256)
    bed_depth = Column(Float, nullable=False, default=256)
    bed_height = Column(Float, nullable=False, default=256)
    nozzle = Column(Float, nullable=False, default=0.4)
    nozzles = Column(Text, nullable=False, default="[0.4]")
    profile_b64 = Column(Text, nullable=False)
    created_at = Column(String, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "name"),)


class SlicerPreset(Base):
    __tablename__ = "slicer_presets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    name = Column(String, nullable=False)
    ext = Column(String, nullable=False)
    content_b64 = Column(Text, nullable=False)
    created_at = Column(String, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "name"),)


class VerificationCode(Base):
    __tablename__ = "verification_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    channel = Column(String, nullable=False)
    target = Column(String, nullable=False)
    code_hash = Column(String, nullable=False)
    expires_at = Column(String, nullable=False)
    created_at = Column(String, nullable=False)
    used_at = Column(String)
    attempts = Column(Integer, default=0)

    __table_args__ = (Index("idx_vc_target", "channel", "target"),)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(String, nullable=False, index=True)
    user_id = Column(Integer)
    username = Column(String)
    action = Column(String, nullable=False, index=True)
    ip = Column(String)
    method = Column(String)
    path = Column(String)
    request_id = Column(String)
    idempotency_key = Column(String)
    detail_json = Column(Text)


class QuoteHistory(Base):
    __tablename__ = "quote_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    filename = Column(String, nullable=False)
    material = Column(String, nullable=False)
    color = Column(String)
    quantity = Column(Integer, default=1)
    volume_cm3 = Column(Float)
    weight_g = Column(Float)
    estimated_time_h = Column(Float)
    cost_cny = Column(Float)
    dimensions = Column(String)
    status = Column(String, default="success")
    error_msg = Column(Text)
    created_at = Column(String, index=True)
    printer_model = Column(String(50))
    slicer_preset_id = Column(Integer)
    nozzle_diameter = Column(Float)
    layer_height = Column(Float)
    wall_count = Column(Integer)
    infill = Column(Integer)
    brand = Column(String(40))
    cost_breakdown = Column(Text)
    slicer_fallback = Column(Integer, default=0)
    slicer_error = Column(Text, nullable=True)
    slicer_estimated_time_s = Column(Float, nullable=True)


class PaymentOrder(Base):
    __tablename__ = "payment_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_no = Column(String, unique=True, nullable=False)
    user_id = Column(Integer, nullable=False, index=True)
    plan_code = Column(String, nullable=False)
    amount_cny = Column(Float, nullable=False)
    currency = Column(String, nullable=False)
    provider = Column(String, nullable=False)
    status = Column(String, nullable=False, index=True)
    created_at = Column(String, index=True)
    paid_at = Column(String)
    provider_txn_id = Column(String)
    raw_json = Column(Text)


class MembershipPlan(Base):
    __tablename__ = "membership_plans"

    code = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    price_cny = Column(Float, nullable=False)
    currency = Column(String, nullable=False)
    duration_days = Column(Integer, nullable=False)
    active = Column(Integer, default=1)
    created_at = Column(String)

    __table_args__ = (Index("idx_mp_active", "active"),)


class LoginFailure(Base):
    __tablename__ = "login_failures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(String)
    key_hash = Column(String, unique=True, nullable=False)
    fail_count = Column(Integer, default=0)
    first_failed_at = Column(String)
    last_failed_at = Column(String)
    locked_until = Column(String)


class IdempotencyResponse(Base):
    __tablename__ = "idempotency_responses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(String)
    expires_at = Column(String, index=True)
    user_id = Column(Integer, nullable=False)
    method = Column(String, nullable=False)
    path = Column(String, nullable=False)
    idem_key = Column(String, nullable=False)
    status_code = Column(Integer)
    response_json = Column(Text)

    __table_args__ = (UniqueConstraint("user_id", "method", "path", "idem_key"),)


class AppDefault(Base):
    __tablename__ = "app_defaults"

    key = Column(String, primary_key=True)
    value_json = Column(Text, nullable=False)
    updated_at = Column(String)
    updated_by = Column(Integer)
    updated_by_username = Column(String)


class RateLimitState(Base):
    __tablename__ = "rate_limit_state"

    rate_key = Column(String, primary_key=True)
    bucket_json = Column(Text, nullable=False)
    updated_at = Column(String)


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    user_id = Column(Integer, nullable=False, index=True)
    created_at = Column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "name"),
        Index("idx_categories_created_at", "created_at"),
    )


class Todo(Base):
    __tablename__ = "todos"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False)
    description = Column(Text)
    status = Column(String(20), nullable=False, default="pending")
    priority = Column(Integer, nullable=False, default=0)
    category_id = Column(Integer, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    due_date = Column(String)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)

    __table_args__ = (
        Index("idx_todos_status", "status"),
        Index("idx_todos_priority", "priority"),
        Index("idx_todos_due_date", "due_date"),
        Index("idx_todos_user_status", "user_id", "status"),
        Index("idx_todos_user_category", "user_id", "category_id"),
        Index("idx_todos_user_due", "user_id", "due_date", "status"),
    )


class PrinterParam(Base):
    """打印机高级参数（速度、加速度、抖动限制）"""

    __tablename__ = "printer_params"

    id = Column(Integer, primary_key=True, autoincrement=True)
    printer_id = Column(String, nullable=False, index=True)
    nozzle = Column(Float, nullable=False)
    max_speed = Column(Float, default=500)  # mm/s
    max_acceleration = Column(Float, default=10000)  # mm/s²
    jerk_limit = Column(Float, default=0.04)  # mm/s
    speed_enabled = Column(Integer, default=0)  # 是否启用高级参数
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)

    __table_args__ = (UniqueConstraint("printer_id", "nozzle"),)


class MaterialBrand(Base):
    """材料品牌"""

    __tablename__ = "material_brands"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)
    logo_url = Column(String)
    website = Column(String)
    sort_order = Column(Integer, default=0)
    active = Column(Integer, default=1)
    created_at = Column(String, nullable=False)


class MaterialType(Base):
    """材料类型"""

    __tablename__ = "material_types"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)
    display_name = Column(String, nullable=False)
    density = Column(Float, default=1.24)  # g/cm³
    description = Column(Text)
    sort_order = Column(Integer, default=0)
    active = Column(Integer, default=1)
    created_at = Column(String, nullable=False)


class Material(Base):
    """具体材料（品牌+类型+参数）"""

    __tablename__ = "materials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    brand_id = Column(Integer, ForeignKey("material_brands.id"), nullable=False)
    type_id = Column(Integer, ForeignKey("material_types.id"), nullable=False)
    name = Column(String, nullable=False)
    color = Column(String)
    density = Column(Float)  # 覆盖类型的默认密度
    price_per_kg = Column(Float)  # 每公斤价格
    hotend_temp_min = Column(Integer)
    hotend_temp_max = Column(Integer)
    bed_temp_min = Column(Integer)
    bed_temp_max = Column(Integer)
    print_speed_max = Column(Float)  # 建议最大打印速度
    description = Column(Text)
    active = Column(Integer, default=1)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)

    __table_args__ = (UniqueConstraint("brand_id", "type_id", "name"),)
