"""app/auth.py 认证模块扩展测试 — 覆盖密码哈希、JWT、工具函数、边界条件。"""

import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# 确保环境变量在导入前设置
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests")

import pytest
from app.auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    _login_failure_key_hash,
    _user_to_dict,
)
from app.utils import (
    normalize_email,
    normalize_phone,
    validate_username_or_raise,
    validate_password_or_raise,
    hash_verify_code,
    generate_numeric_code,
    mask_email,
    mask_phone,
    _sanitize_filename_component,
    normalize_materials,
)
from app.config import (
    EMAIL_PATTERN,
    PHONE_PATTERN,
    USERNAME_PATTERN,
)


# ========================================================================
# 密码哈希与验证
# ========================================================================
class TestPasswordHash:
    """密码哈希/验证测试。"""

    def test_hash_and_verify(self):
        """哈希后应能正确验证。"""
        pw = "TestPass123"
        hashed = get_password_hash(pw)
        assert verify_password(pw, hashed) is True

    def test_wrong_password_fails(self):
        """错误密码应验证失败。"""
        hashed = get_password_hash("CorrectPass1")
        assert verify_password("WrongPass1", hashed) is False

    def test_hash_not_plain_text(self):
        """哈希结果不应是明文。"""
        pw = "MyPassword1"
        hashed = get_password_hash(pw)
        assert hashed != pw
        assert len(hashed) > len(pw)

    def test_different_hashes_for_same_password(self):
        """相同密码应生成不同哈希（因为随机 salt）。"""
        pw = "SamePass123"
        h1 = get_password_hash(pw)
        h2 = get_password_hash(pw)
        assert h1 != h2

    def test_empty_password(self):
        """空密码应能哈希和验证（虽然实际不应允许）。"""
        hashed = get_password_hash("")
        assert verify_password("", hashed) is True

    def test_unicode_password(self):
        """Unicode 密码应正常处理。"""
        pw = "密码测试123"
        hashed = get_password_hash(pw)
        assert verify_password(pw, hashed) is True

    def test_long_password(self):
        """长密码（72字节内）应正常处理。"""
        # bcrypt 限制最大 72 字节，测试 70 字符的密码
        pw = "A" * 69 + "B1c"
        hashed = get_password_hash(pw)
        assert verify_password(pw, hashed) is True

    def test_password_exceeds_bcrypt_limit(self):
        """超过72字节的密码应抛出 ValueError。"""
        pw = "A" * 100 + "1"
        with pytest.raises(ValueError):
            get_password_hash(pw)


# ========================================================================
# JWT Token
# ========================================================================
class TestJWTToken:
    """JWT Token 创建测试。"""

    def test_create_token_returns_string(self):
        """创建 token 应返回字符串。"""
        token = create_access_token(1, "testuser")
        assert isinstance(token, str)
        assert len(token) > 20

    def test_token_contains_user_info(self):
        """token 应可解码出用户信息。"""
        from jose import jwt
        from app.config import JWT_SECRET_KEY, JWT_ALGORITHM

        token = create_access_token(42, "admin")
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        assert payload["sub"] == "42"
        assert payload["username"] == "admin"

    def test_token_has_expiry(self):
        """token 应包含过期时间。"""
        from jose import jwt
        from app.config import JWT_SECRET_KEY, JWT_ALGORITHM

        token = create_access_token(1, "user")
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        assert "exp" in payload
        assert payload["exp"] > time.time()

    def test_custom_expire_hours(self):
        """自定义过期时间应生效。"""
        from jose import jwt
        from app.config import JWT_SECRET_KEY, JWT_ALGORITHM

        token = create_access_token(1, "user", expire_hours=1)
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        # 过期时间应约 1 小时后
        expected_exp = time.time() + 3600
        assert abs(payload["exp"] - expected_exp) < 60  # 60 秒容差


# ========================================================================
# 登录失败追踪
# ========================================================================
class TestLoginFailureKeyHash:
    """登录失败 key hash 测试。"""

    def test_hash_deterministic(self):
        """相同输入应生成相同哈希。"""
        h1 = _login_failure_key_hash("testuser")
        h2 = _login_failure_key_hash("testuser")
        assert h1 == h2

    def test_case_insensitive(self):
        """大小写应不敏感。"""
        h1 = _login_failure_key_hash("TestUser")
        h2 = _login_failure_key_hash("testuser")
        assert h1 == h2

    def test_different_inputs_different_hashes(self):
        """不同输入应生成不同哈希。"""
        h1 = _login_failure_key_hash("user1")
        h2 = _login_failure_key_hash("user2")
        assert h1 != h2

    def test_strips_whitespace(self):
        """应去除首尾空白。"""
        h1 = _login_failure_key_hash("  testuser  ")
        h2 = _login_failure_key_hash("testuser")
        assert h1 == h2

    def test_empty_string(self):
        """空字符串不应崩溃。"""
        h = _login_failure_key_hash("")
        assert isinstance(h, str)
        assert len(h) > 0


# ========================================================================
# _user_to_dict — ORM 转 dict
# ========================================================================
class TestUserToDict:
    """_user_to_dict 测试。"""

    def test_none_returns_none(self):
        """None 输入返回 None。"""
        assert _user_to_dict(None) is None

    def test_mock_user_object(self):
        """模拟 ORM 对象转 dict。"""

        class MockUser:
            id = 1
            username = "testuser"
            password_hash = "hashed"
            created_at = "2024-01-01"
            materials = "[]"
            colors = "[]"
            pricing_config = "{}"
            email = "test@example.com"
            phone = None
            email_verified = 0
            phone_verified = 0
            membership_level = "free"
            membership_expires_at = None
            terms_accepted_at = "2024-01-01"
            privacy_accepted_at = "2024-01-01"
            terms_version = "v1"
            privacy_version = "v1"
            default_printer_id = None
            default_nozzle = None
            default_slicer_preset_id = None
            default_material = None
            default_color = None

        result = _user_to_dict(MockUser())
        assert result["id"] == 1
        assert result["username"] == "testuser"
        assert result["email"] == "test@example.com"
        assert result["membership_level"] == "free"


# ========================================================================
# normalize_email — 邮箱标准化
# ========================================================================
class TestNormalizeEmail:
    """邮箱标准化测试。"""

    def test_valid_email(self):
        """有效邮箱应通过。"""
        assert normalize_email("Test@Example.COM") == "test@example.com"

    def test_strips_whitespace(self):
        """应去除首尾空白。"""
        assert normalize_email("  user@test.com  ") == "user@test.com"

    def test_invalid_no_at(self):
        """缺少 @ 应抛出异常。"""
        with pytest.raises(Exception):
            normalize_email("invalid-email")

    def test_invalid_empty(self):
        """空邮箱应抛出异常。"""
        with pytest.raises(Exception):
            normalize_email("")

    def test_invalid_double_at(self):
        """多个 @ 应抛出异常。"""
        with pytest.raises(Exception):
            normalize_email("a@b@c.com")


# ========================================================================
# normalize_phone — 手机号标准化
# ========================================================================
class TestNormalizePhone:
    """手机号标准化测试。"""

    def test_valid_phone(self):
        """有效手机号应通过。"""
        assert normalize_phone("13800138000") == "13800138000"

    def test_with_country_code(self):
        """带国际区号。"""
        result = normalize_phone("+8613800138000")
        assert result == "+8613800138000"

    def test_strips_dashes(self):
        """应去除破折号。"""
        result = normalize_phone("138-0013-8000")
        assert result == "13800138000"

    def test_strips_spaces(self):
        """应去除空格。"""
        result = normalize_phone("138 0013 8000")
        assert result == "13800138000"

    def test_invalid_too_short(self):
        """过短号码应抛出异常。"""
        with pytest.raises(Exception):
            normalize_phone("123")

    def test_invalid_empty(self):
        """空值应抛出异常。"""
        with pytest.raises(Exception):
            normalize_phone("")

    def test_invalid_letters(self):
        """包含字母应抛出异常。"""
        with pytest.raises(Exception):
            normalize_phone("abcdefghijk")


# ========================================================================
# validate_username_or_raise — 用户名校验
# ========================================================================
class TestValidateUsername:
    """用户名校验测试。"""

    def test_valid_username(self):
        """有效用户名。"""
        assert validate_username_or_raise("testuser") == "testuser"

    def test_valid_with_dot(self):
        """带点号的用户名。"""
        assert validate_username_or_raise("test.user") == "test.user"

    def test_valid_with_dash(self):
        """带破折号的用户名。"""
        assert validate_username_or_raise("test-user") == "test-user"

    def test_valid_with_underscore(self):
        """带下划线的用户名。"""
        assert validate_username_or_raise("test_user") == "test_user"

    def test_too_short(self):
        """过短用户名应抛出异常。"""
        with pytest.raises(Exception):
            validate_username_or_raise("ab")

    def test_too_long(self):
        """过长用户名应抛出异常。"""
        with pytest.raises(Exception):
            validate_username_or_raise("a" * 51)

    def test_invalid_characters(self):
        """包含特殊字符应抛出异常。"""
        with pytest.raises(Exception):
            validate_username_or_raise("test@user")

    def test_empty_username(self):
        """空用户名应抛出异常。"""
        with pytest.raises(Exception):
            validate_username_or_raise("")

    def test_strips_whitespace(self):
        """应去除首尾空白。"""
        assert validate_username_or_raise("  testuser  ") == "testuser"


# ========================================================================
# validate_password_or_raise — 密码校验
# ========================================================================
class TestValidatePassword:
    """密码校验测试。"""

    def test_valid_password(self):
        """有效密码（字母+数字，长度符合）。"""
        assert validate_password_or_raise("TestPass123") == "TestPass123"

    def test_no_digit(self):
        """缺少数字应抛出异常。"""
        with pytest.raises(Exception):
            validate_password_or_raise("OnlyLetters")

    def test_no_letter(self):
        """缺少字母应抛出异常。"""
        with pytest.raises(Exception):
            validate_password_or_raise("12345678")

    def test_too_short(self):
        """过短密码应抛出异常。"""
        with pytest.raises(Exception):
            validate_password_or_raise("Ab1")

    def test_too_long(self):
        """过长密码应抛出异常。"""
        with pytest.raises(Exception):
            validate_password_or_raise("A1" * 51)

    def test_minimum_length(self):
        """最小长度密码应通过。"""
        pw = "Abcdefg1"  # 8 chars
        assert validate_password_or_raise(pw) == pw


# ========================================================================
# hash_verify_code / generate_numeric_code — 验证码
# ========================================================================
class TestVerificationCode:
    """验证码相关函数测试。"""

    def test_generate_numeric_code_length(self):
        """生成指定位数的验证码。"""
        code = generate_numeric_code(6)
        assert len(code) == 6
        assert code.isdigit()

    def test_generate_numeric_code_4_digits(self):
        """4 位验证码。"""
        code = generate_numeric_code(4)
        assert len(code) == 4

    def test_generate_numeric_code_too_short_clamped(self):
        """过短请求被 clamp 到 4。"""
        code = generate_numeric_code(1)
        assert len(code) == 4

    def test_generate_numeric_code_too_long_clamped(self):
        """过长请求被 clamp 到 8。"""
        code = generate_numeric_code(100)
        assert len(code) == 8

    def test_hash_verify_code_deterministic(self):
        """相同输入生成相同哈希。"""
        h1 = hash_verify_code("123456")
        h2 = hash_verify_code("123456")
        assert h1 == h2

    def test_hash_verify_code_different_codes(self):
        """不同验证码生成不同哈希。"""
        h1 = hash_verify_code("123456")
        h2 = hash_verify_code("654321")
        assert h1 != h2

    def test_hash_verify_code_type(self):
        """返回类型为 str。"""
        assert isinstance(hash_verify_code("000000"), str)


# ========================================================================
# mask_email / mask_phone — 脱敏
# ========================================================================
class TestMasking:
    """数据脱敏测试。"""

    def test_mask_email_normal(self):
        """标准邮箱脱敏。"""
        masked = mask_email("test@example.com")
        assert masked == "t***t@example.com"

    def test_mask_email_short_local(self):
        """短 local 部分。"""
        masked = mask_email("ab@test.com")
        assert masked == "a***@test.com"

    def test_mask_email_single_char(self):
        """单字符 local。"""
        masked = mask_email("a@test.com")
        assert masked == "a***@test.com"

    def test_mask_email_none(self):
        """None 返回 None。"""
        assert mask_email(None) is None

    def test_mask_phone_normal(self):
        """标准手机号脱敏。"""
        masked = mask_phone("13800138000")
        assert masked == "138****8000"

    def test_mask_phone_short(self):
        """短号码脱敏。"""
        masked = mask_phone("123")
        assert masked == "***"

    def test_mask_phone_none(self):
        """None 返回 None。"""
        assert mask_phone(None) is None


# ========================================================================
# _sanitize_filename_component — 文件名安全化
# ========================================================================
class TestSanitizeFilename:
    """文件名安全化测试。"""

    def test_normal_filename(self):
        """正常文件名不变。"""
        assert _sanitize_filename_component("model_v1", "model") == "model_v1"

    def test_disallowed_chars_replaced(self):
        """不允许的字符被替换为下划线。"""
        result = _sanitize_filename_component('a/b\\c:d*e?f"g<h>i|j', "model")
        assert "/" not in result
        assert "\\" not in result
        assert ":" not in result

    def test_empty_returns_fallback(self):
        """空输入返回 fallback。"""
        assert _sanitize_filename_component("", "fallback") == "fallback"

    def test_whitespace_only_returns_fallback(self):
        """纯空白返回 fallback。"""
        assert _sanitize_filename_component("   ", "fallback") == "fallback"

    def test_max_len_truncation(self):
        """超长文件名被截断。"""
        result = _sanitize_filename_component("a" * 200, "model", max_len=10)
        assert len(result) <= 10

    def test_control_chars_replaced(self):
        """控制字符被替换。"""
        result = _sanitize_filename_component("model\x00\x01", "model")
        assert "\x00" not in result
        assert "\x01" not in result


# ========================================================================
# normalize_materials — 材料标准化
# ========================================================================
class TestNormalizeMaterials:
    """材料标准化测试。"""

    def test_none_returns_defaults(self):
        """None 输入返回默认材料。"""
        result = normalize_materials(None)
        assert len(result) > 0
        assert result[0]["name"] == "PLA"

    def test_empty_list_returns_defaults(self):
        """空列表返回默认材料。"""
        result = normalize_materials([])
        assert len(result) > 0

    def test_custom_material(self):
        """自定义材料应被标准化。"""
        raw = [{"name": "CustomPLA", "density": 1.3, "price_per_kg": 100.0}]
        result = normalize_materials(raw)
        assert len(result) == 1
        assert result[0]["name"] == "CustomPLA"
        assert result[0]["density"] == 1.3
        assert result[0]["price_per_kg"] == 100.0

    def test_material_without_name_skipped(self):
        """没有名称的材料被跳过。"""
        raw = [{"density": 1.0}]
        result = normalize_materials(raw)
        # 如果所有材料都没有 name，返回默认材料
        assert len(result) > 0

    def test_price_field_normalized(self):
        """price 字段应转换为 price_per_kg。"""
        raw = [{"name": "Test", "density": 1.0, "price": 0.1}]
        result = normalize_materials(raw)
        assert result[0]["price_per_kg"] == 100.0  # 0.1 * 1000

    def test_legacy_color_palette_is_collapsed_to_one_color(self):
        """旧颜色列表只保留第一项并输出单颜色字段。"""
        raw = [{"name": "Test", "density": 1.0, "price_per_kg": 80.0, "colors": ["Red", "Blue"]}]
        result = normalize_materials(raw)
        assert result[0]["color"] == {"name": "Red", "hex": "#dc2626"}
        assert "colors" not in result[0]

    def test_brand_defaults_to_generic(self):
        """品牌默认为 Generic。"""
        raw = [{"name": "TestMat", "density": 1.0, "price_per_kg": 80.0}]
        result = normalize_materials(raw)
        assert result[0]["brand"] == "Generic"

    def test_duplicate_material_names_are_supported_when_colors_differ(self):
        raw = [
            {
                "name": "PLA",
                "brand": "Eryone",
                "density": 1.24,
                "price_per_kg": 80.0,
                "color": {"name": "White", "hex": "#ffffff"},
            },
            {
                "name": "PLA",
                "brand": "Eryone",
                "density": 1.24,
                "price_per_kg": 80.0,
                "color": {"name": "Blue", "hex": "#123456"},
            },
        ]
        result = normalize_materials(raw)
        assert len(result) == 2
        assert [m["color"]["hex"] for m in result] == ["#ffffff", "#123456"]


# ========================================================================
# 正则模式验证
# ========================================================================
class TestPatterns:
    """配置中的正则模式测试。"""

    def test_email_pattern_valid(self):
        """有效邮箱。"""
        assert EMAIL_PATTERN.match("user@example.com")

    def test_email_pattern_no_at(self):
        """无 @ 号。"""
        assert not EMAIL_PATTERN.match("userexample.com")

    def test_email_pattern_too_long_local(self):
        """local 部分超长。"""
        assert not EMAIL_PATTERN.match("a" * 65 + "@test.com")

    def test_phone_pattern_valid(self):
        """有效手机号。"""
        assert PHONE_PATTERN.match("+8613800138000")

    def test_phone_pattern_too_short(self):
        """过短号码。"""
        assert not PHONE_PATTERN.match("123")

    def test_username_pattern_valid(self):
        """有效用户名。"""
        assert USERNAME_PATTERN.match("test_user")

    def test_username_pattern_too_short(self):
        """过短用户名。"""
        assert not USERNAME_PATTERN.match("ab")

    def test_username_pattern_invalid_chars(self):
        """无效字符。"""
        assert not USERNAME_PATTERN.match("test user!")
