"""SQLAlchemy engine + session management.

Use get_session() for new code. Existing get_db_conn() (raw sqlite3)
still works in parallel — they share the same DB_PATH.
"""

import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session, DeclarativeBase

from .config import DB_PATH

# Ensure parent directory exists for file-based SQLite
_db_dir = os.path.dirname(os.path.abspath(DB_PATH))
if _db_dir and not os.path.exists(_db_dir):
    os.makedirs(_db_dir, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable WAL mode and foreign keys."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_session() -> Session:
    """Yield a SQLAlchemy session (use as FastAPI dependency)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


from contextlib import contextmanager  # noqa: E402


@contextmanager
def get_db_session():
    """Context manager yielding a SQLAlchemy Session with auto-commit/rollback.

    Use this as a drop-in replacement for get_db_conn():
        with get_db_session() as db:
            db.query(User).filter(...)
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_orm() -> None:
    """Create all tables from ORM models. Safe to call repeatedly."""
    from . import models_orm  # noqa — ensure models are registered

    Base.metadata.create_all(bind=engine)


# ── Timestamp TypeDecorators ──
# SQLite stores timestamps as strings, but we want proper datetime/float
# in Python. These TypeDecorators convert transparently at the ORM layer
# without altering the database schema.

import datetime as _dt  # noqa: E402
from sqlalchemy.types import TypeDecorator, DateTime, Float  # noqa: E402


class UTCDateTime(TypeDecorator):
    """Read/write ISO-8601 strings as timezone-aware datetime objects.

    impl=DateTime(timezone=True) causes SQLAlchemy to bind the Python type
    correctly while keeping the column as TEXT in the DB. The process_result_value
    hook ensures datetime objects are always tz-aware.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, str):
            try:
                return _dt.datetime.fromisoformat(value)
            except ValueError:
                try:
                    return _dt.datetime.fromtimestamp(float(value), tz=_dt.timezone.utc)
                except (ValueError, TypeError):
                    return value  # last resort
        if isinstance(value, (int, float)):
            return _dt.datetime.fromtimestamp(value, tz=_dt.timezone.utc)
        if hasattr(value, "isoformat"):
            return value
        return value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, _dt.datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=_dt.timezone.utc)
            return value
        if isinstance(value, str):
            try:
                dt = _dt.datetime.fromisoformat(value)
            except ValueError:
                return value
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=_dt.timezone.utc)
            return dt
        return value


class UnixTimestamp(TypeDecorator):
    """Read/write Unix epoch floats as Python float.

    impl=Float keeps the DB column as REAL; process_bind/result handle
    string→float conversion transparently.
    """

    impl = Float
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return float(_dt.datetime.fromisoformat(value).timestamp())
        return float(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return float(value)
