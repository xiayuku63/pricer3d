"""待办事项 CRUD API — Categories & Todos.

Endpoints:
    /api/categories  (GET, POST, PUT, DELETE)
    /api/todos       (GET, POST, PUT, DELETE)
"""

import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from .db import get_db_session
from .models_orm import Category, Todo
from .deps import get_current_user
from .errors import NotFoundError, ValidationError, ConflictError, success_response

logger = logging.getLogger(__name__)

router = APIRouter()

# ──────────────────────────────────────────────
# Pydantic schemas
# ──────────────────────────────────────────────

VALID_STATUSES = {"pending", "in_progress", "completed", "cancelled"}
VALID_PRIORITIES = {0, 1, 2, 3}


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class CategoryUpdate(BaseModel):
    id: int
    name: str = Field(..., min_length=1, max_length=100)


class CategoryOut(BaseModel):
    id: int
    name: str
    user_id: int
    created_at: str


class TodoCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    status: str = Field(default="pending")
    priority: int = Field(default=0, ge=0, le=3)
    category_id: Optional[int] = None
    due_date: Optional[str] = None


class TodoUpdate(BaseModel):
    id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[int] = Field(default=None, ge=0, le=3)
    category_id: Optional[int] = None
    due_date: Optional[str] = None


class TodoOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    status: str
    priority: int
    category_id: Optional[int]
    user_id: int
    due_date: Optional[str]
    created_at: str
    updated_at: str


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize_todo(row) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "description": row.description,
        "status": row.status,
        "priority": row.priority,
        "category_id": row.category_id,
        "user_id": row.user_id,
        "due_date": row.due_date,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _serialize_category(row) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "user_id": row.user_id,
        "created_at": row.created_at,
    }


# ──────────────────────────────────────────────
# Category endpoints
# ──────────────────────────────────────────────

@router.get("/api/categories")
async def list_categories(current_user=Depends(get_current_user)):
    """获取当前用户的所有分类"""
    uid = current_user["id"]
    with get_db_session() as db:
        rows = (
            db.query(Category)
            .filter(Category.user_id == uid)
            .order_by(Category.created_at.asc())
            .all()
        )
        data = [_serialize_category(r) for r in rows]
    return success_response(data)


@router.post("/api/categories")
async def create_category(body: CategoryCreate, current_user=Depends(get_current_user)):
    """创建分类"""
    uid = current_user["id"]
    now = _now_iso()
    with get_db_session() as db:
        # 检查同名分类
        existing = (
            db.query(Category)
            .filter(Category.user_id == uid, Category.name == body.name)
            .first()
        )
        if existing:
            raise ConflictError("同名分类已存在")
        cat = Category(name=body.name, user_id=uid, created_at=now)
        db.add(cat)
        db.flush()
        data = _serialize_category(cat)
    return success_response(data)


@router.put("/api/categories")
async def update_category(body: CategoryUpdate, current_user=Depends(get_current_user)):
    """更新分类名称"""
    uid = current_user["id"]
    with get_db_session() as db:
        cat = db.query(Category).filter(Category.id == body.id, Category.user_id == uid).first()
        if not cat:
            raise NotFoundError("分类不存在")
        # 检查冲突
        dup = (
            db.query(Category)
            .filter(Category.user_id == uid, Category.name == body.name, Category.id != body.id)
            .first()
        )
        if dup:
            raise ConflictError("同名分类已存在")
        cat.name = body.name
        db.flush()
        data = _serialize_category(cat)
    return success_response(data)


@router.delete("/api/categories/{category_id}")
async def delete_category(category_id: int, current_user=Depends(get_current_user)):
    """删除分类（关联的待办事项 category_id 会被置空）"""
    uid = current_user["id"]
    with get_db_session() as db:
        cat = db.query(Category).filter(Category.id == category_id, Category.user_id == uid).first()
        if not cat:
            raise NotFoundError("分类不存在")
        # 将属于该分类的 todo 的 category_id 置空
        db.query(Todo).filter(Todo.category_id == category_id, Todo.user_id == uid).update(
            {Todo.category_id: None}
        )
        db.delete(cat)
        db.flush()
    return success_response({"deleted_id": category_id})


# ──────────────────────────────────────────────
# Todo CRUD endpoints
# ──────────────────────────────────────────────

@router.get("/api/todos")
async def list_todos(
    status: Optional[str] = Query(default=None),
    priority: Optional[int] = Query(default=None, ge=0, le=3),
    category_id: Optional[int] = Query(default=None),
    current_user=Depends(get_current_user),
):
    """获取待办列表，支持按 status / priority / category_id 筛选"""
    uid = current_user["id"]
    with get_db_session() as db:
        q = db.query(Todo).filter(Todo.user_id == uid)
        if status is not None:
            if status not in VALID_STATUSES:
                raise ValidationError(f"无效状态: {status}，允许值: {VALID_STATUSES}")
            q = q.filter(Todo.status == status)
        if priority is not None:
            q = q.filter(Todo.priority == priority)
        if category_id is not None:
            q = q.filter(Todo.category_id == category_id)
        rows = q.order_by(Todo.priority.desc(), Todo.created_at.desc()).all()
        data = [_serialize_todo(r) for r in rows]
    return success_response(data)


@router.post("/api/todos")
async def create_todo(body: TodoCreate, current_user=Depends(get_current_user)):
    """创建待办事项"""
    uid = current_user["id"]
    if body.status not in VALID_STATUSES:
        raise ValidationError(f"无效状态: {body.status}，允许值: {VALID_STATUSES}")
    now = _now_iso()

    with get_db_session() as db:
        # 验证分类归属
        if body.category_id is not None:
            cat = db.query(Category).filter(Category.id == body.category_id, Category.user_id == uid).first()
            if not cat:
                raise NotFoundError("指定的分类不存在")

        todo = Todo(
            title=body.title,
            description=body.description,
            status=body.status,
            priority=body.priority,
            category_id=body.category_id,
            user_id=uid,
            due_date=body.due_date,
            created_at=now,
            updated_at=now,
        )
        db.add(todo)
        db.flush()
        data = _serialize_todo(todo)
    return success_response(data)


@router.put("/api/todos")
async def update_todo(body: TodoUpdate, current_user=Depends(get_current_user)):
    """更新待办事项（部分更新）"""
    uid = current_user["id"]
    if body.status is not None and body.status not in VALID_STATUSES:
        raise ValidationError(f"无效状态: {body.status}，允许值: {VALID_STATUSES}")

    with get_db_session() as db:
        todo = db.query(Todo).filter(Todo.id == body.id, Todo.user_id == uid).first()
        if not todo:
            raise NotFoundError("待办事项不存在")

        if body.title is not None:
            todo.title = body.title
        if body.description is not None:
            todo.description = body.description
        if body.status is not None:
            todo.status = body.status
        if body.priority is not None:
            todo.priority = body.priority
        if body.category_id is not None:
            cat = db.query(Category).filter(Category.id == body.category_id, Category.user_id == uid).first()
            if not cat:
                raise NotFoundError("指定的分类不存在")
            todo.category_id = body.category_id
        if body.due_date is not None:
            todo.due_date = body.due_date

        todo.updated_at = _now_iso()
        db.flush()
        data = _serialize_todo(todo)
    return success_response(data)


@router.delete("/api/todos/{todo_id}")
async def delete_todo(todo_id: int, current_user=Depends(get_current_user)):
    """删除待办事项"""
    uid = current_user["id"]
    with get_db_session() as db:
        todo = db.query(Todo).filter(Todo.id == todo_id, Todo.user_id == uid).first()
        if not todo:
            raise NotFoundError("待办事项不存在")
        db.delete(todo)
        db.flush()
    return success_response({"deleted_id": todo_id})
