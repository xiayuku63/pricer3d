"""
数据库迁移：添加用户品牌定制字段 + 更新会员文件上传限制
"""

import sqlite3
import logging

logger = logging.getLogger(__name__)

# 需要添加的列定义
BRAND_COLUMNS = [
    ("brand_name", "TEXT"),  # 公司/品牌名称
    ("brand_logo_url", "TEXT"),  # Logo 文件 URL
    ("brand_phone", "TEXT"),  # 联系电话
    ("brand_contact_email", "TEXT"),  # 报价联系邮箱（区别于账户邮箱）
    ("brand_address", "TEXT"),  # 公司地址
    ("brand_note", "TEXT"),  # 默认报价备注/条款
]


def _column_exists(cursor, table_name: str, column_name: str) -> bool:
    """检查表中是否已存在某列"""
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [row[1] for row in cursor.fetchall()]
    return column_name in columns


def migrate(db_path: str = None):
    if db_path is None:
        from .config import DB_PATH

        db_path = DB_PATH
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print("开始迁移：添加用户品牌定制字段...")

    # 1. 添加品牌定制列到 users 表
    for col_name, col_type in BRAND_COLUMNS:
        if not _column_exists(cursor, "users", col_name):
            cursor.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
            print(f"  ✓ 添加列 users.{col_name} ({col_type})")
        else:
            print(f"  ⊘ 列 users.{col_name} 已存在，跳过")

    conn.commit()
    conn.close()
    print("迁移完成！")


if __name__ == "__main__":
    migrate()
