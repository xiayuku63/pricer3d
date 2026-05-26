"""HTML page routes and health checks."""

import json
import os

from fastapi import HTTPException
from fastapi.responses import HTMLResponse

import time

from .config import APP_ENV, TERMS_VERSION, PRIVACY_VERSION, SMTP_FROM
from .database import get_db_conn

_START_TIME = time.time()


async def index():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()


async def register_page():
    with open("static/register.html", "r", encoding="utf-8") as f:
        return f.read()


def legal_terms():
    return f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>用户协议 - 3D打印自动报价系统</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen p-4 lg:p-6">
  <div class="max-w-3xl mx-auto bg-white rounded-xl shadow-md overflow-hidden">
    <div class="p-6 lg:p-8 space-y-6">
      <div class="border-b pb-4">
        <div class="uppercase tracking-wide text-sm text-indigo-500 font-semibold mb-1">Legal</div>
        <h1 class="text-2xl font-bold text-gray-900">用户协议</h1>
        <p class="text-xs text-gray-500 mt-1">版本：{TERMS_VERSION} | 生效日期：2026年5月23日</p>
      </div>

      <div class="text-sm text-gray-700 leading-relaxed space-y-5">
        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">一、总则</h3>
          <p>欢迎使用 3D打印自动报价系统（以下简称&ldquo;本系统&rdquo;或&ldquo;我们&rdquo;）。本协议是你（以下简称&ldquo;用户&rdquo;或&ldquo;你&rdquo;）与本系统运营方之间关于使用本系统服务的法律协议。</p>
          <p>你在注册、登录或使用本系统时，即表示你已阅读、理解并同意接受本协议全部条款的约束。如果你不同意本协议的任何条款，请停止注册和使用本系统。</p>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">二、服务内容</h3>
          <ul class="list-disc pl-5 space-y-2">
            <li><strong>3D模型自动报价：</strong>上传 STL、STEP、STP、OBJ、3MF 格式的 3D 模型文件，系统根据模型几何特征、材料选择、打印参数自动计算预估打印时间、材料用量及费用。</li>
            <li><strong>模型预览与分析：</strong>提供 3D 模型在线预览、底面分析（Lay on Face）、共面面片聚类等模型分析功能。</li>
            <li><strong>切片预设管理：</strong>支持用户自定义 PrusaSlicer 切片预设，个性化控制打印参数。</li>
            <li><strong>报价历史记录：</strong>记录用户的报价历史，支持查询和追溯。</li>
            <li><strong>会员服务：</strong>提供免费及付费会员等级，付费会员享有专属折扣等权益。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">三、用户注册与账号</h3>
          <ul class="list-disc pl-5 space-y-2">
            <li>用户注册时须提供真实、准确的用户名、邮箱或手机号。因信息不实导致的任何后果由用户自行承担。</li>
            <li>每个邮箱或手机号仅允许注册一个账号。我们有权对重复注册的账号进行合并或禁用。</li>
            <li>用户应妥善保管账号密码及登录凭证，不得将账号出借、转让或共享给他人使用。因账号保管不善导致的一切后果由用户承担。</li>
            <li>如发现账号被盗用或异常登录，用户应立即联系我们。我们有权在合理判断下采取冻结账号等措施。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">四、用户行为规范</h3>
          <p>用户在使用本系统时承诺：</p>
          <ul class="list-disc pl-5 space-y-2">
            <li>不利用本系统从事任何违法违规活动，包括但不限于上传含有病毒、恶意代码、违法内容的文件；</li>
            <li>不对本系统进行反向工程、破解、攻击、干扰或妨碍系统正常运行；</li>
            <li>不利用自动化工具（机器人、脚本等）批量调用接口或进行注册，除非事先获得我们书面许可；</li>
            <li>不侵犯他人的知识产权、隐私权或其他合法权益。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">五、报价说明与免责</h3>
          <ul class="list-disc pl-5 space-y-2">
            <li>本系统基于用户上传的 3D 模型自动计算报价，报价结果<strong>仅供参考</strong>，不构成具有法律约束力的要约或承诺。</li>
            <li>实际打印时间、材料用量和最终价格可能因打印机型号、材料批次、环境温度、模型复杂度和切片软件版本等因素产生差异。</li>
            <li>我们不保证报价结果与实际打印结果完全一致，基于报价数据的任何商业决策由用户自行承担风险。</li>
            <li>本系统使用的切片引擎（PrusaSlicer）为开源软件，其切片结果的准确性取决于该软件的算法和版本。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">六、会员服务与费用</h3>
          <ul class="list-disc pl-5 space-y-2">
            <li>本系统提供免费会员和付费会员两种服务等级。免费会员可使用基础的报价功能；付费会员享有额外的折扣和专属权益。</li>
            <li>会员费用的具体金额、有效期和支付方式以支付页面展示为准。</li>
            <li>付费会员到期后，会员权益自动终止，账号恢复为免费会员状态。</li>
            <li><strong>退款政策：</strong>除非法律另有规定或我们另有承诺，已支付的会员费用不支持退款。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">七、知识产权</h3>
          <ul class="list-disc pl-5 space-y-2">
            <li>本系统的软件代码、界面设计、算法逻辑等知识产权归运营方或其权利人所有。</li>
            <li>用户上传的 3D 模型文件的知识产权仍归用户或原权利人所有。我们不主张对用户上传模型的所有权。</li>
            <li>用户授予我们在提供服务所需范围内对上传模型进行处理（切片、计算、分析）的权利。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">八、服务中断与终止</h3>
          <ul class="list-disc pl-5 space-y-2">
            <li>因系统维护、升级、网络故障、不可抗力等原因可能导致服务暂时中断。我们将尽力提前通知用户。</li>
            <li>我们不因服务中断给用户造成的任何损失承担责任。</li>
            <li>如用户违反本协议，我们有权在不事先通知的情况下暂停或终止其账号的使用。</li>
            <li>用户可随时停止使用本系统。如需注销账号，请联系我们处理。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">九、隐私保护</h3>
          <p>我们重视你的个人信息安全。关于我们如何收集、使用和保护你的个人信息，请参阅我们的<a href="/legal/privacy" class="text-indigo-600 hover:text-indigo-800 underline">《隐私政策》</a>。</p>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">十、协议修改</h3>
          <p>我们有权根据需要修改本协议条款。修改后的协议将在本页面发布，并在发布时即时生效。重大变更我们将通过站内通知、邮件等方式告知。你继续使用本系统即表示你同意修改后的协议。</p>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">十一、法律适用与争议解决</h3>
          <p>本协议的订立、执行和解释均适用中华人民共和国法律。因本协议引起的或与之相关的争议，双方应友好协商解决；协商不成的，任何一方均有权向运营方所在地有管辖权的人民法院提起诉讼。</p>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">十二、联系方式</h3>
          <p>如你对本协议有任何疑问、意见或建议，请通过以下方式联系我们：</p>
          <p>邮箱：<strong>{SMTP_FROM}</strong></p>
        </section>
      </div>

      <div class="pt-4 border-t">
        <a href="/" class="text-sm px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50">&larr; 返回首页</a>
      </div>
    </div>
  </div>
</body>
</html>
"""


def legal_privacy():
    return f"""
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>隐私政策 - 3D打印自动报价系统</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen p-4 lg:p-6">
  <div class="max-w-3xl mx-auto bg-white rounded-xl shadow-md overflow-hidden">
    <div class="p-6 lg:p-8 space-y-6">
      <div class="border-b pb-4">
        <div class="uppercase tracking-wide text-sm text-indigo-500 font-semibold mb-1">Legal</div>
        <h1 class="text-2xl font-bold text-gray-900">隐私政策</h1>
        <p class="text-xs text-gray-500 mt-1">版本：{PRIVACY_VERSION} | 生效日期：2026年5月23日</p>
      </div>

      <div class="text-sm text-gray-700 leading-relaxed space-y-5">
        <section>
          <p>本隐私政策说明 3D打印自动报价系统（以下简称&ldquo;我们&rdquo;）如何收集、使用、存储和保护你的个人信息。我们重视你的隐私，并致力于保护你的个人数据。</p>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">一、我们收集的信息</h3>
          <p>在你使用本系统时，我们可能收集以下类型的信息：</p>
          <h4 class="font-semibold mt-3 mb-1">1. 你主动提供的信息</h4>
          <ul class="list-disc pl-5 space-y-1">
            <li><strong>账号信息：</strong>注册时需提供用户名、邮箱地址或手机号。</li>
            <li><strong>密码：</strong>经 bcrypt 哈希加密后存储，我们无法获知你的明文密码。</li>
            <li><strong>验证信息：</strong>邮箱验证码、手机验证码（一次性使用，SHA256 哈希存储）。</li>
            <li><strong>上传文件：</strong>你上传的 3D 模型文件（STL、STEP、STP、OBJ、3MF 格式），用于切片分析与报价计算。</li>
            <li><strong>切片预设：</strong>你自定义的 PrusaSlicer 切片参数配置。</li>
            <li><strong>支付信息：</strong>会员购买时的订单信息（支付具体由第三方支付服务商处理，我们不直接收集银行卡号等敏感支付信息）。</li>
          </ul>
          <h4 class="font-semibold mt-3 mb-1">2. 自动收集的信息</h4>
          <ul class="list-disc pl-5 space-y-1">
            <li><strong>日志信息：</strong>包括 IP 地址、请求时间、请求路径、HTTP 状态码、响应时间等，用于系统运维和安全审计。</li>
            <li><strong>设备信息：</strong>浏览器类型、操作系统版本等，用于优化用户体验。</li>
            <li><strong>使用数据：</strong>报价次数、功能使用频率等统计信息（去标识化处理）。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">二、信息的使用目的</h3>
          <p>我们收集的信息仅用于以下目的：</p>
          <ul class="list-disc pl-5 space-y-1">
            <li><strong>提供服务：</strong>处理 3D 模型报价请求、计算打印成本和时间、展示模型预览与分析结果。</li>
            <li><strong>账号管理：</strong>用户注册、登录验证、密码重置等身份认证相关操作。</li>
            <li><strong>会员服务：</strong>管理会员等级、折扣计算、订单处理和会员到期提醒。</li>
            <li><strong>安全防护：</strong>实施验证码、频率限制、登录失败锁定等安全措施，防止恶意访问和攻击。</li>
            <li><strong>审计日志：</strong>记录关键操作（注册、登录、支付等）用于合规审计和异常追溯。</li>
            <li><strong>服务改进：</strong>分析使用数据以优化报价算法和用户体验。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">三、信息的存储与保护</h3>
          <ul class="list-disc pl-5 space-y-1">
            <li><strong>存储位置：</strong>你的个人信息存储在位于中华人民共和国的服务器上。</li>
            <li><strong>存储期限：</strong>账号信息在账号存续期间及注销后合理期限内保留。验证码信息在验证完成后自动标记为已使用，仅保留用于安全审计。</li>
            <li><strong>安全措施：</strong>我们采用以下技术措施保护你的数据：密码 bcrypt 哈希加密、验证码 SHA256 哈希存储、HTTPS 传输加密（生产环境）、IP 频率限制和登录保护。</li>
            <li><strong>数据处理：</strong>你上传的 3D 模型文件仅在完成切片分析和报价计算后临时存储，我们不会将你的模型文件用于其他目的或提供给第三方。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">四、信息的共享与披露</h3>
          <p>我们<strong>不会</strong>将你的个人信息出售、出租或交易给第三方。仅在以下情况下可能共享：</p>
          <ul class="list-disc pl-5 space-y-1">
            <li><strong>法律要求：</strong>根据法律法规、司法程序或政府要求披露必要的信息。</li>
            <li><strong>保护权益：</strong>为保护我们、用户或公众的合法权益免受损害所必需的披露。</li>
            <li><strong>服务提供商：</strong>支付服务由第三方支付平台处理（如支付宝、微信支付等），你需同时遵守其隐私政策。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">五、你的权利</h3>
          <p>根据适用法律法规，你享有以下权利：</p>
          <ul class="list-disc pl-5 space-y-1">
            <li><strong>查阅与更正：</strong>登录后可在用户中心查看和修改你的基本信息（密码、邮箱、手机号等）。</li>
            <li><strong>删除数据：</strong>你可联系我们注销账号，我们将在核实身份后删除你的账号信息。</li>
            <li><strong>撤回同意：</strong>你可随时停止使用本系统。注销账号即表示撤回对本隐私政策的同意。</li>
            <li><strong>数据导出：</strong>如需导出你的个人数据副本，可联系我们申请。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">六、未成年人保护</h3>
          <p>本系统主要面向具备完全民事行为能力的用户。如果你未满 18 周岁，请在监护人的陪同和同意下使用本系统。我们不会故意收集未成年人的个人信息，如发现误收集，将及时删除。</p>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">七、Cookie 与本地存储</h3>
          <ul class="list-disc pl-5 space-y-1">
            <li>本系统在浏览器端使用 <code>localStorage</code> 存储你的登录凭证（JWT Token），以便你在关闭浏览器后再次访问时保持登录状态。</li>
            <li>我们不使用第三方跟踪 Cookie 或广告投放类 Cookie。</li>
            <li>你可以在浏览器设置中清除本地存储数据，清除后需重新登录。</li>
          </ul>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">八、隐私政策的更新</h3>
          <p>我们可能适时更新本隐私政策。更新后的版本将在本页面发布，并在发布时即时生效。重大变更我们将通过站内通知、邮件等方式告知。建议你定期查阅本页面了解最新版本。</p>
        </section>

        <section>
          <h3 class="text-base font-semibold text-gray-900 mb-2">九、联系方式</h3>
          <p>如你对本隐私政策有任何疑问、意见或投诉，请通过以下方式联系我们：</p>
          <p>邮箱：<strong>{SMTP_FROM}</strong></p>
        </section>
      </div>

      <div class="pt-4 border-t">
        <a href="/" class="text-sm px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50">&larr; 返回首页</a>
      </div>
    </div>
  </div>
</body>
</html>
"""


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
        with get_db_conn() as conn:
            row = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()
            user_count = int(row["c"] or 0) if row else 0
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
    import os
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
