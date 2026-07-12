"""
材料管理 API
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone

from .db import get_db_session
from .models_orm import MaterialBrand, MaterialType, Material
from .deps import get_current_user


router = APIRouter(prefix="/api/materials", tags=["materials"])


# ── Brand Schemas ──


class BrandResponse(BaseModel):
    id: int
    name: str
    logo_url: Optional[str] = None
    website: Optional[str] = None
    sort_order: int
    active: bool
    created_at: str


class BrandCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    logo_url: Optional[str] = None
    website: Optional[str] = None
    sort_order: int = 0


# ── Type Schemas ──


class TypeResponse(BaseModel):
    id: int
    name: str
    display_name: str
    density: float
    description: Optional[str] = None
    sort_order: int
    active: bool
    created_at: str


class TypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    display_name: str = Field(..., min_length=1, max_length=100)
    density: float = Field(default=1.24, gt=0)
    description: Optional[str] = None
    sort_order: int = 0


# ── Material Schemas ──


class MaterialResponse(BaseModel):
    id: int
    brand_id: int
    brand_name: str
    type_id: int
    type_name: str
    name: str
    color: Optional[str] = None
    density: Optional[float] = None
    price_per_kg: Optional[float] = None
    hotend_temp_min: Optional[int] = None
    hotend_temp_max: Optional[int] = None
    bed_temp_min: Optional[int] = None
    bed_temp_max: Optional[int] = None
    print_speed_max: Optional[float] = None
    description: Optional[str] = None
    active: bool
    created_at: str
    updated_at: str


class MaterialCreate(BaseModel):
    brand_id: int
    type_id: int
    name: str = Field(..., min_length=1, max_length=100)
    color: Optional[str] = None
    density: Optional[float] = None
    price_per_kg: Optional[float] = None
    hotend_temp_min: Optional[int] = None
    hotend_temp_max: Optional[int] = None
    bed_temp_min: Optional[int] = None
    bed_temp_max: Optional[int] = None
    print_speed_max: Optional[float] = None
    description: Optional[str] = None


class MaterialUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    density: Optional[float] = None
    price_per_kg: Optional[float] = None
    hotend_temp_min: Optional[int] = None
    hotend_temp_max: Optional[int] = None
    bed_temp_min: Optional[int] = None
    bed_temp_max: Optional[int] = None
    print_speed_max: Optional[float] = None
    description: Optional[str] = None
    active: Optional[bool] = None


# ── Brand Endpoints ──


@router.get("/brands", response_model=List[BrandResponse])
async def list_brands(active_only: bool = Query(True)):
    """获取所有品牌"""
    with get_db_session() as db:
        query = db.query(MaterialBrand)
        if active_only:
            query = query.filter(MaterialBrand.active == 1)
        brands = query.order_by(MaterialBrand.sort_order).all()

        return [
            BrandResponse(
                id=b.id,
                name=b.name,
                logo_url=b.logo_url,
                website=b.website,
                sort_order=b.sort_order,
                active=bool(b.active),
                created_at=b.created_at,
            )
            for b in brands
        ]


@router.post("/brands", response_model=BrandResponse)
async def create_brand(data: BrandCreate, user: dict = Depends(get_current_user)):
    """创建品牌（需要登录）"""
    now = datetime.now(timezone.utc).isoformat()

    with get_db_session() as db:
        existing = db.query(MaterialBrand).filter(MaterialBrand.name == data.name).first()
        if existing:
            raise HTTPException(status_code=400, detail="品牌名称已存在")

        brand = MaterialBrand(
            name=data.name,
            logo_url=data.logo_url,
            website=data.website,
            sort_order=data.sort_order,
            created_at=now,
        )
        db.add(brand)
        db.commit()

        return BrandResponse(
            id=brand.id,
            name=brand.name,
            logo_url=brand.logo_url,
            website=brand.website,
            sort_order=brand.sort_order,
            active=bool(brand.active),
            created_at=brand.created_at,
        )


# ── Type Endpoints ──


@router.get("/types", response_model=List[TypeResponse])
async def list_types(active_only: bool = Query(True)):
    """获取所有材料类型"""
    with get_db_session() as db:
        query = db.query(MaterialType)
        if active_only:
            query = query.filter(MaterialType.active == 1)
        types = query.order_by(MaterialType.sort_order).all()

        return [
            TypeResponse(
                id=t.id,
                name=t.name,
                display_name=t.display_name,
                density=t.density,
                description=t.description,
                sort_order=t.sort_order,
                active=bool(t.active),
                created_at=t.created_at,
            )
            for t in types
        ]


@router.post("/types", response_model=TypeResponse)
async def create_type(data: TypeCreate, user: dict = Depends(get_current_user)):
    """创建材料类型（需要登录）"""
    now = datetime.now(timezone.utc).isoformat()

    with get_db_session() as db:
        existing = db.query(MaterialType).filter(MaterialType.name == data.name).first()
        if existing:
            raise HTTPException(status_code=400, detail="材料类型名称已存在")

        mat_type = MaterialType(
            name=data.name,
            display_name=data.display_name,
            density=data.density,
            description=data.description,
            sort_order=data.sort_order,
            created_at=now,
        )
        db.add(mat_type)
        db.commit()

        return TypeResponse(
            id=mat_type.id,
            name=mat_type.name,
            display_name=mat_type.display_name,
            density=mat_type.density,
            description=mat_type.description,
            sort_order=mat_type.sort_order,
            active=bool(mat_type.active),
            created_at=mat_type.created_at,
        )


# ── Material Endpoints ──


@router.get("", response_model=List[MaterialResponse])
async def list_materials(
    brand_id: Optional[int] = Query(None), type_id: Optional[int] = Query(None), active_only: bool = Query(True)
):
    """获取材料列表（可按品牌、类型筛选）"""
    with get_db_session() as db:
        query = (
            db.query(Material, MaterialBrand, MaterialType)
            .join(MaterialBrand, Material.brand_id == MaterialBrand.id)
            .join(MaterialType, Material.type_id == MaterialType.id)
        )

        if brand_id is not None:
            query = query.filter(Material.brand_id == brand_id)
        if type_id is not None:
            query = query.filter(Material.type_id == type_id)
        if active_only:
            query = query.filter(Material.active == 1)

        results = query.order_by(MaterialBrand.sort_order, MaterialType.sort_order, Material.name).all()

        return [
            MaterialResponse(
                id=m.id,
                brand_id=m.brand_id,
                brand_name=b.name,
                type_id=m.type_id,
                type_name=t.name,
                name=m.name,
                color=m.color,
                density=m.density,
                price_per_kg=m.price_per_kg,
                hotend_temp_min=m.hotend_temp_min,
                hotend_temp_max=m.hotend_temp_max,
                bed_temp_min=m.bed_temp_min,
                bed_temp_max=m.bed_temp_max,
                print_speed_max=m.print_speed_max,
                description=m.description,
                active=bool(m.active),
                created_at=m.created_at,
                updated_at=m.updated_at,
            )
            for m, b, t in results
        ]


@router.get("/{material_id}", response_model=MaterialResponse)
async def get_material(material_id: int):
    """获取单个材料详情"""
    with get_db_session() as db:
        result = (
            db.query(Material, MaterialBrand, MaterialType)
            .join(MaterialBrand, Material.brand_id == MaterialBrand.id)
            .join(MaterialType, Material.type_id == MaterialType.id)
            .filter(Material.id == material_id)
            .first()
        )

        if not result:
            raise HTTPException(status_code=404, detail="材料不存在")

        m, b, t = result
        return MaterialResponse(
            id=m.id,
            brand_id=m.brand_id,
            brand_name=b.name,
            type_id=m.type_id,
            type_name=t.name,
            name=m.name,
            color=m.color,
            density=m.density,
            price_per_kg=m.price_per_kg,
            hotend_temp_min=m.hotend_temp_min,
            hotend_temp_max=m.hotend_temp_max,
            bed_temp_min=m.bed_temp_min,
            bed_temp_max=m.bed_temp_max,
            print_speed_max=m.print_speed_max,
            description=m.description,
            active=bool(m.active),
            created_at=m.created_at,
            updated_at=m.updated_at,
        )


@router.post("", response_model=MaterialResponse)
async def create_material(data: MaterialCreate, user: dict = Depends(get_current_user)):
    """创建材料（需要登录）"""
    now = datetime.now(timezone.utc).isoformat()

    with get_db_session() as db:
        # 验证品牌和类型存在
        brand = db.query(MaterialBrand).filter(MaterialBrand.id == data.brand_id).first()
        if not brand:
            raise HTTPException(status_code=400, detail="品牌不存在")
        mat_type = db.query(MaterialType).filter(MaterialType.id == data.type_id).first()
        if not mat_type:
            raise HTTPException(status_code=400, detail="材料类型不存在")

        # 检查是否已存在
        existing = (
            db.query(Material)
            .filter(Material.brand_id == data.brand_id, Material.type_id == data.type_id, Material.name == data.name)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="该品牌下已存在同名材料")

        material = Material(
            brand_id=data.brand_id,
            type_id=data.type_id,
            name=data.name,
            color=data.color,
            density=data.density,
            price_per_kg=data.price_per_kg,
            hotend_temp_min=data.hotend_temp_min,
            hotend_temp_max=data.hotend_temp_max,
            bed_temp_min=data.bed_temp_min,
            bed_temp_max=data.bed_temp_max,
            print_speed_max=data.print_speed_max,
            description=data.description,
            created_at=now,
            updated_at=now,
        )
        db.add(material)
        db.commit()

        return MaterialResponse(
            id=material.id,
            brand_id=material.brand_id,
            brand_name=brand.name,
            type_id=material.type_id,
            type_name=mat_type.name,
            name=material.name,
            color=material.color,
            density=material.density,
            price_per_kg=material.price_per_kg,
            hotend_temp_min=material.hotend_temp_min,
            hotend_temp_max=material.hotend_temp_max,
            bed_temp_min=material.bed_temp_min,
            bed_temp_max=material.bed_temp_max,
            print_speed_max=material.print_speed_max,
            description=material.description,
            active=bool(material.active),
            created_at=material.created_at,
            updated_at=material.updated_at,
        )


@router.put("/{material_id}", response_model=MaterialResponse)
async def update_material(material_id: int, data: MaterialUpdate, user: dict = Depends(get_current_user)):
    """更新材料（需要登录）"""
    now = datetime.now(timezone.utc).isoformat()

    with get_db_session() as db:
        material = db.query(Material).filter(Material.id == material_id).first()
        if not material:
            raise HTTPException(status_code=404, detail="材料不存在")

        # 更新字段
        update_data = data.dict(exclude_unset=True)
        for field, value in update_data.items():
            if value is not None:
                if field == "active":
                    setattr(material, field, 1 if value else 0)
                else:
                    setattr(material, field, value)

        material.updated_at = now
        db.commit()

        # 重新查询获取品牌和类型名称
        result = (
            db.query(Material, MaterialBrand, MaterialType)
            .join(MaterialBrand, Material.brand_id == MaterialBrand.id)
            .join(MaterialType, Material.type_id == MaterialType.id)
            .filter(Material.id == material_id)
            .first()
        )

        m, b, t = result
        return MaterialResponse(
            id=m.id,
            brand_id=m.brand_id,
            brand_name=b.name,
            type_id=m.type_id,
            type_name=t.name,
            name=m.name,
            color=m.color,
            density=m.density,
            price_per_kg=m.price_per_kg,
            hotend_temp_min=m.hotend_temp_min,
            hotend_temp_max=m.hotend_temp_max,
            bed_temp_min=m.bed_temp_min,
            bed_temp_max=m.bed_temp_max,
            print_speed_max=m.print_speed_max,
            description=m.description,
            active=bool(m.active),
            created_at=m.created_at,
            updated_at=m.updated_at,
        )


@router.delete("/{material_id}")
async def delete_material(material_id: int, user: dict = Depends(get_current_user)):
    """删除材料（软删除，设置 active=0）"""
    now = datetime.now(timezone.utc).isoformat()

    with get_db_session() as db:
        material = db.query(Material).filter(Material.id == material_id).first()
        if not material:
            raise HTTPException(status_code=404, detail="材料不存在")

        material.active = 0
        material.updated_at = now
        db.commit()

        return {"message": "材料已禁用", "id": material_id}
