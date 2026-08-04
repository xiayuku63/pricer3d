"""HTML page routes and health checks."""

import json
import os

from fastapi import HTTPException
from fastapi.responses import HTMLResponse

import time

from .config import (
    APP_ENV,
    TERMS_VERSION,
    PRIVACY_VERSION,
    LEGAL_EFFECTIVE_DATE,
    LEGAL_OPERATOR_NAME,
    LEGAL_CONTACT_EMAIL,
    LEGAL_CONTACT_ADDRESS,
)
from .legal_content import render_terms_page, render_privacy_page

_START_TIME = time.time()


async def index():
    """Assemble index.html from partials."""
    partials_dir = "static/partials"
    order = [
        "head",
        "page-shell",
        "login-modal",
        "membership-modal",
        "payment-modal",
        "admin-users-modal",
        "options-modal",
        "user-center-modal",
        "quote-history-modal",
        "preview-modal",
        "orient-modal",
        "zip-preview-modal",
        "scripts",
        "closing",
    ]
    parts = []
    for name in order:
        fpath = f"{partials_dir}/{name}.html"
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                parts.append(f.read())
        except FileNotFoundError:
            pass
    return "".join(parts)


async def register_page():
    with open("static/register.html", "r", encoding="utf-8") as f:
        return f.read()


def legal_terms():
    return render_terms_page(
        version=TERMS_VERSION,
        effective_date=LEGAL_EFFECTIVE_DATE,
        operator_name=LEGAL_OPERATOR_NAME,
        contact_email=LEGAL_CONTACT_EMAIL,
        contact_address=LEGAL_CONTACT_ADDRESS,
    )


def legal_privacy():
    return render_privacy_page(
        version=PRIVACY_VERSION,
        effective_date=LEGAL_EFFECTIVE_DATE,
        operator_name=LEGAL_OPERATOR_NAME,
        contact_email=LEGAL_CONTACT_EMAIL,
        contact_address=LEGAL_CONTACT_ADDRESS,
    )


async def admin_users_page():
    with open("static/admin_users.html", "r", encoding="utf-8") as f:
        return f.read()


def pay_mock(order_no: str = ""):
    safe_order_no = (order_no or "").strip()[:80]
    return f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>模拟支付</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen p-4 lg:p-6">
  <div class="max-w-lg mx-auto bg-white rounded-xl shadow-md overflow-hidden">
    <div class="p-6 space-y-4">
      <div>
        <div class="uppercase tracking-wide text-sm text-indigo-500 font-semibold mb-1">Mock Payment</div>
        <h2 class="text-xl font-bold text-gray-900">会员充值（模拟支付）</h2>
        <p class="text-xs text-gray-500 mt-1">订单号：<span class="font-mono">{safe_order_no or "-"}</span></p>
      </div>
      <div class="text-sm text-gray-700 leading-relaxed">
        这是开发用的模拟支付页。点击"确认支付"后，系统会校验订单并将你的账号升级为会员。
      </div>
      <p id="msg" class="hidden text-xs"></p>
      <div class="flex gap-2">
        <button id="pay-btn" type="button" class="flex-1 py-2 px-3 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700">确认支付</button>
        <a href="/" class="py-2 px-3 rounded-md border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">返回首页</a>
      </div>
    </div>
  </div>

  <script type="module">
    const TOKEN_STORAGE_KEY = "demo_access_token_v1";
    const authToken = localStorage.getItem(TOKEN_STORAGE_KEY) || "";
    const orderNo = {json.dumps(safe_order_no)};
    const msg = document.getElementById('msg');
    const payBtn = document.getElementById('pay-btn');

    function showMsg(text, ok = false) {{
      msg.textContent = text;
      msg.className = ok ? "text-xs text-green-600" : "text-xs text-red-600";
      msg.classList.remove('hidden');
    }}

    async function doPay() {{
      if (!orderNo) {{
        showMsg('订单号缺失', false);
        return;
      }}
      if (!authToken) {{
        showMsg('未登录，请先回到首页登录后再支付', false);
        return;
      }}
      payBtn.disabled = true;
      payBtn.textContent = '处理中...';
      try {{
        const resp = await fetch('/api/billing/mock/complete', {{
          method: 'POST',
          headers: {{
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${{authToken}}`
          }},
          body: JSON.stringify({{ order_no: orderNo }})
        }});
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || '支付失败');
        showMsg(`支付成功，会员已生效。到期时间：${{data.membership_expires_at || '永久'}}`, true);
        payBtn.textContent = '已支付';
      }} catch (e) {{
        showMsg(e.message || '支付失败', false);
        payBtn.disabled = false;
        payBtn.textContent = '确认支付';
      }}
    }}

    payBtn.addEventListener('click', doPay);
  </script>
</body>
</html>
"""


def healthz():
    import shutil

    disk = shutil.disk_usage(".")
    return {
        "status": "ok",
        "env": APP_ENV,
        "uptime_seconds": round(time.time() - _START_TIME, 1),
        "disk_free_mb": round(disk.free / (1024 * 1024), 1),
    }


def readyz():
    import shutil

    try:
        from .db import get_db_session
        from .models_orm import User as UserORM

        with get_db_session() as db:
            user_count = db.query(UserORM).count()
        disk = shutil.disk_usage(".")
        return {
            "status": "ok",
            "db": "ok",
            "env": APP_ENV,
            "uptime_seconds": round(time.time() - _START_TIME, 1),
            "user_count": user_count,
            "disk_free_mb": round(disk.free / (1024 * 1024), 1),
        }
    except Exception:
        raise HTTPException(status_code=503, detail="服务未就绪")


def version():
    """Return application version and deploy time from VERSION file."""
    version_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "VERSION")
    result = {"version": "unknown", "deployed_at": None, "env": APP_ENV}
    try:
        with open(version_file, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("deployed_at:"):
                    result["deployed_at"] = line.split(":", 1)[1].strip()
                elif line and not line.startswith("#"):
                    # first non-comment, non-deployed_at line is the version
                    if result["version"] == "unknown":
                        result["version"] = line
    except Exception:
        pass
    return result


def printer_params_page():
    """打印机参数管理页面"""
    import os

    html_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "html", "printer_params.html")
    with open(html_path, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


def materials_page():
    """材料管理页面"""
    import os

    html_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "html", "materials.html")
    with open(html_path, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


def quote_page():
    """报价计算页面（带材料选择器）"""
    import os

    html_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "html", "quote.html")
    with open(html_path, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())
