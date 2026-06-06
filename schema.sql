-- ============================================
-- 待办事项应用数据库 Schema
-- ============================================
-- 设计说明：
--   - 使用 MySQL/PostgreSQL 兼容语法
--   - 支持用户、分类、待办事项三层结构
--   - 包含适当的索引和外键约束
--   - 考虑了查询性能和数据完整性
-- ============================================

-- -------------------------------------------
-- 1. 用户表 (users)
-- -------------------------------------------
CREATE TABLE users (
    id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
    username      VARCHAR(50)  NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 唯一约束：用户名和邮箱不能重复
    CONSTRAINT uk_users_username UNIQUE (username),
    CONSTRAINT uk_users_email    UNIQUE (email)
);

-- 用户表索引
CREATE INDEX idx_users_created_at ON users (created_at);


-- -------------------------------------------
-- 2. 分类表 (categories)
-- -------------------------------------------
CREATE TABLE categories (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name        VARCHAR(100) NOT NULL,
    user_id     BIGINT       NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 外键约束：分类属于某个用户
    CONSTRAINT fk_categories_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    -- 同一用户下分类名不能重复
    CONSTRAINT uk_categories_user_name UNIQUE (user_id, name)
);

-- 分类表索引
CREATE INDEX idx_categories_user_id    ON categories (user_id);
CREATE INDEX idx_categories_created_at ON categories (created_at);


-- -------------------------------------------
-- 3. 待办事项表 (todos)
-- -------------------------------------------
CREATE TABLE todos (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    title       VARCHAR(200) NOT NULL,
    description TEXT         NULL,
    status      VARCHAR(20)  NOT NULL DEFAULT 'pending',
    priority    TINYINT      NOT NULL DEFAULT 0,
    category_id BIGINT       NULL,
    user_id     BIGINT       NOT NULL,
    due_date    DATE         NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- 外键约束：待办事项属于某个用户
    CONSTRAINT fk_todos_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    -- 外键约束：待办事项可属于某个分类（可为空）
    CONSTRAINT fk_todos_category
        FOREIGN KEY (category_id) REFERENCES categories (id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    -- 状态约束：只允许特定值
    CONSTRAINT chk_todos_status
        CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),

    -- 优先级约束：0-低 1-中 2-高 3-紧急
    CONSTRAINT chk_todos_priority
        CHECK (priority BETWEEN 0 AND 3)
);

-- 待办事项表索引
-- 用于按用户查询待办列表
CREATE INDEX idx_todos_user_id     ON todos (user_id);

-- 用于按分类筛选
CREATE INDEX idx_todos_category_id ON todos (category_id);

-- 用于按状态筛选（最常用查询）
CREATE INDEX idx_todos_status      ON todos (status);

-- 用于按优先级排序
CREATE INDEX idx_todos_priority    ON todos (priority);

-- 用于查询到期任务
CREATE INDEX idx_todos_due_date    ON todos (due_date);

-- 复合索引：按用户+状态查询（最常见场景）
CREATE INDEX idx_todos_user_status ON todos (user_id, status);

-- 复合索引：按用户+分类查询
CREATE INDEX idx_todos_user_category ON todos (user_id, category_id);

-- 复合索引：按用户+到期日期查询未完成任务
CREATE INDEX idx_todos_user_due ON todos (user_id, due_date, status);


-- ============================================
-- 设计决策总结
-- ============================================
-- 1. 主键策略：使用 BIGINT AUTO_INCREMENT 作为主键，适合大规模数据
--
-- 2. 外键策略：
--    - users -> categories: ON DELETE CASCADE（删除用户时级联删除其分类）
--    - users -> todos: ON DELETE CASCADE（删除用户时级联删除其待办）
--    - categories -> todos: ON DELETE SET NULL（删除分类时待办项的分类置空）
--
-- 3. 索引策略：
--    - 单列索引：覆盖常用筛选字段（status, priority, due_date）
--    - 复合索引：针对最常见查询模式（用户+状态、用户+分类）
--    - 唯一索引：保证用户名、邮箱唯一性
--
-- 4. 数据类型选择：
--    - TIMESTAMP: 自动记录时间，updated_at 自动更新
--    - TINYINT: 优先级使用小整数，节省空间
--    - TEXT: 描述字段使用 TEXT，支持长文本
--    - VARCHAR: 有明确长度限制的字段
--
-- 5. 约束设计：
--    - CHECK 约束确保状态和优先级在合法范围内
--    - 唯一约束防止重复数据
--    - NOT NULL 约束保证必填字段完整性
-- ============================================
