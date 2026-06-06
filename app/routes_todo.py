"""Todo API routes — CRUD for todos and categories."""

import logging
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import Request, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from .db import get_db_session
from .models_orm import Todo, Category
from .deps import get_current_user
from .audit import write_audit_event

logger = logging.getLogger(__name__)


# ── Pydantic schemas ──

class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class CategoryUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class TodoCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    status: str = Field(default="pending", pattern="^(pending|in_progress|completed|cancelled)$")
    priority: int = Field(default=0, ge=0, le=3)
    category_id: Optional[int] = None
    due_date: Optional[str] = None


class TodoUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    status: Optional[str] = Field(default=None, pattern="^(pending|in_progress|completed|cancelled)$")
    priority: Optional[int] = Field(default=None, ge=0, le=3)
    category_id: Optional[int] = None
    due_date: Optional[str] = None


# ── Category routes ──

async def list_categories(current_user=Depends(get_current_user)):
    """List all categories for the current user."""
    uid = int(current_user["id"])
    with get_db_session() as db:
        rows = (
            db.query(Category)
            .filter(Category.user_id == uid)
            .order_by(Category.created_at.desc())
            .all()
        )
    items = [{"id": r.id, "name": r.name, "created_at": r.created_at} for r in rows]
    return {"items": items}


async def create_category(payload: CategoryCreate, request: Request, current_user=Depends(get_current_user)):
    """Create a new category."""
    uid = int(current_user["id"])
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with get_db_session() as db:
            existing = db.query(Category).filter(
                Category.user_id == uid, Category.name == name
            ).first()
            if existing:
                raise HTTPException(status_code=409, detail="分类名称已存在")
            cat = Category(name=name, user_id=uid, created_at=now_iso)
            db.add(cat)
            db.flush()
            result = {"id": cat.id, "name": cat.name, "created_at": cat.created_at}
        write_audit_event(action="todo.category.create", request=request, user=current_user,
                          detail={"category_id": result["id"], "name": name})
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建分类失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"创建分类失败: {str(e)}")


async def delete_category(category_id: int, request: Request, current_user=Depends(get_current_user)):
    """Delete a category. Todos in this category will have category_id set to NULL."""
    uid = int(current_user["id"])
    with get_db_session() as db:
        cat = db.query(Category).filter(
            Category.id == int(category_id), Category.user_id == uid
        ).first()
        if not cat:
            raise HTTPException(status_code=404, detail="分类不存在或无权限")
        cat_name = cat.name
        db.delete(cat)
    write_audit_event(action="todo.category.delete", request=request, user=current_user,
                      detail={"category_id": int(category_id), "name": cat_name})
    return {"status": "ok"}


# ── Todo routes ──

async def list_todos(
    status: Optional[str] = None,
    category_id: Optional[int] = None,
    priority: Optional[int] = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_current_user),
):
    """List todos for the current user with optional filters."""
    uid = int(current_user["id"])
    safe_limit = max(1, min(int(limit), 100))
    safe_offset = max(0, int(offset))
    with get_db_session() as db:
        query = db.query(Todo).filter(Todo.user_id == uid)
        if status:
            query = query.filter(Todo.status == status)
        if category_id is not None:
            query = query.filter(Todo.category_id == int(category_id))
        if priority is not None:
            query = query.filter(Todo.priority == int(priority))
        total = query.count()
        rows = (
            query
            .order_by(Todo.priority.desc(), Todo.id.desc())
            .offset(safe_offset)
            .limit(safe_limit)
            .all()
        )
    items = []
    for r in rows:
        items.append({
            "id": r.id,
            "title": r.title,
            "description": r.description,
            "status": r.status,
            "priority": r.priority,
            "category_id": r.category_id,
            "due_date": r.due_date,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        })
    return {"items": items, "total": total, "limit": safe_limit, "offset": safe_offset}


async def get_todo(todo_id: int, current_user=Depends(get_current_user)):
    """Get a single todo by ID."""
    uid = int(current_user["id"])
    with get_db_session() as db:
        r = db.query(Todo).filter(Todo.id == int(todo_id), Todo.user_id == uid).first()
        if not r:
            raise HTTPException(status_code=404, detail="待办事项不存在或无权限")
        return {
            "id": r.id,
            "title": r.title,
            "description": r.description,
            "status": r.status,
            "priority": r.priority,
            "category_id": r.category_id,
            "due_date": r.due_date,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        }


async def create_todo(payload: TodoCreate, request: Request, current_user=Depends(get_current_user)):
    """Create a new todo."""
    uid = int(current_user["id"])
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    # Validate category ownership if provided
    if payload.category_id is not None:
        with get_db_session() as db:
            cat = db.query(Category).filter(
                Category.id == int(payload.category_id), Category.user_id == uid
            ).first()
            if not cat:
                raise HTTPException(status_code=400, detail="指定的分类不存在或无权限")
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with get_db_session() as db:
            todo = Todo(
                title=title,
                description=payload.description,
                status=payload.status,
                priority=payload.priority,
                category_id=payload.category_id,
                user_id=uid,
                due_date=payload.due_date,
                created_at=now_iso,
                updated_at=now_iso,
            )
            db.add(todo)
            db.flush()
            result = {
                "id": todo.id,
                "title": todo.title,
                "description": todo.description,
                "status": todo.status,
                "priority": todo.priority,
                "category_id": todo.category_id,
                "due_date": todo.due_date,
                "created_at": todo.created_at,
                "updated_at": todo.updated_at,
            }
        write_audit_event(action="todo.create", request=request, user=current_user,
                          detail={"todo_id": result["id"], "title": title})
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建待办失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"创建待办失败: {str(e)}")


async def update_todo(todo_id: int, payload: TodoUpdate, request: Request, current_user=Depends(get_current_user)):
    """Update a todo."""
    uid = int(current_user["id"])
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_db_session() as db:
        todo = db.query(Todo).filter(Todo.id == int(todo_id), Todo.user_id == uid).first()
        if not todo:
            raise HTTPException(status_code=404, detail="待办事项不存在或无权限")
        if payload.title is not None:
            title = payload.title.strip()
            if not title:
                raise HTTPException(status_code=400, detail="标题不能为空")
            todo.title = title
        if payload.description is not None:
            todo.description = payload.description
        if payload.status is not None:
            todo.status = payload.status
        if payload.priority is not None:
            todo.priority = payload.priority
        if payload.category_id is not None:
            if payload.category_id != 0:
                cat = db.query(Category).filter(
                    Category.id == int(payload.category_id), Category.user_id == uid
                ).first()
                if not cat:
                    raise HTTPException(status_code=400, detail="指定的分类不存在或无权限")
            todo.category_id = payload.category_id if payload.category_id != 0 else None
        if payload.due_date is not None:
            todo.due_date = payload.due_date
        todo.updated_at = now_iso
        result = {
            "id": todo.id,
            "title": todo.title,
            "description": todo.description,
            "status": todo.status,
            "priority": todo.priority,
            "category_id": todo.category_id,
            "due_date": todo.due_date,
            "created_at": todo.created_at,
            "updated_at": todo.updated_at,
        }
    write_audit_event(action="todo.update", request=request, user=current_user,
                      detail={"todo_id": int(todo_id)})
    return result


async def delete_todo(todo_id: int, request: Request, current_user=Depends(get_current_user)):
    """Delete a todo."""
    uid = int(current_user["id"])
    with get_db_session() as db:
        todo = db.query(Todo).filter(Todo.id == int(todo_id), Todo.user_id == uid).first()
        if not todo:
            raise HTTPException(status_code=404, detail="待办事项不存在或无权限")
        db.delete(todo)
    write_audit_event(action="todo.delete", request=request, user=current_user,
                      detail={"todo_id": int(todo_id)})
    return {"status": "ok"}
