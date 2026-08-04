"""Rendered legal documents for the web application.

These product-facing templates must be reviewed and completed by the deployment
owner before production use. They are not a substitute for legal advice.
"""

from html import escape


def _safe(value: str, fallback: str) -> str:
    raw = (value or "").strip()
    return escape(raw or fallback)


def _page(title: str, version: str, effective_date: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{escape(title)} - 3D打印自动报价系统</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen p-4 lg:p-6">
  <main class="max-w-4xl mx-auto bg-white rounded-xl shadow-md overflow-hidden">
    <div class="p-6 lg:p-8 space-y-6">
      <header class="border-b pb-4">
        <div class="uppercase tracking-wide text-sm text-indigo-500 font-semibold mb-1">Legal</div>
        <h1 class="text-2xl font-bold text-gray-900">{escape(title)}</h1>
        <p class="text-xs text-gray-500 mt-1">版本：{escape(version)} | 生效日期：{escape(effective_date)}</p>
      </header>
      <article class="text-sm text-gray-700 leading-relaxed space-y-5">{body}</article>
      <nav class="pt-4 border-t flex flex-wrap gap-3" aria-label="法律文件导航">
        <a href="/" class="text-sm px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50">&larr; 返回首页</a>
        <a href="/legal/terms" class="text-sm px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50">用户协议</a>
        <a href="/legal/privacy" class="text-sm px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50">隐私政策</a>
      </nav>
    </div>
  </main>
</body>
</html>
"""


def render_terms_page(
    version: str,
    effective_date: str,
    operator_name: str,
    contact_email: str,
    contact_address: str,
) -> str:
    operator = _safe(operator_name, "Pricer3D 运营方")
    email = _safe(contact_email, "请配置 LEGAL_CONTACT_EMAIL")
    address = _safe(contact_address, "请配置 LEGAL_CONTACT_ADDRESS")
    body = f"""
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">一、协议主体与接受</h2>
  <p>本用户协议由 {operator}（以下简称“运营方”）与使用 3D 打印自动报价系统（以下简称“本系统”）的用户（以下简称“你”）共同订立。</p>
  <p>当你注册、登录、访问或使用本系统时，即表示你已阅读、理解并同意本协议及《隐私政策》。如果你不同意其中任何内容，请停止注册和使用本系统。</p>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">二、服务范围</h2>
  <ul class="list-disc pl-5 space-y-2">
    <li>提供 STL、STP、STEP、OBJ、3MF 等 3D 模型的上传、解析、预览、几何分析和报价估算。</li>
    <li>提供单文件、多文件和 ZIP 清单报价，以及材料、颜色、数量、打印机和切片预设配置。</li>
    <li>提供智能摆放、Lay on Face、手动旋转、模型尺寸查看和重新计算等朝向功能。</li>
    <li>提供报价历史、CSV/Excel/PDF 导出、用户设置、会员服务及页面实际展示的其他功能。</li>
    <li>部分功能依赖 PrusaSlicer 或其他第三方软件、服务和部署环境，具体可用性以实际运行状态为准。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">三、账号、登录与开发环境</h2>
  <ul class="list-disc pl-5 space-y-2">
    <li>注册时应提供真实、准确、完整且保持更新的信息，不得冒用他人身份。</li>
    <li>你应妥善保管密码、验证码、JWT 登录凭证及其他认证信息，并对账号下发生的操作负责。</li>
    <li>发现账号被盗用、凭证泄露或异常活动时，应及时联系运营方。</li>
    <li>开发环境中的自动登录或演示账号仅用于本地开发和测试，不得用于生产环境、真实个人信息或商业数据。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">四、用户内容与知识产权</h2>
  <ul class="list-disc pl-5 space-y-2">
    <li>你上传的模型、BOM/清单、品牌资料和其他内容的权利仍归你或相应权利人所有。</li>
    <li>你应确保拥有上传、处理和用于报价的合法权利，且内容不侵犯知识产权、商业秘密、隐私权或其他合法权益。</li>
    <li>为提供解析、预览、切片、计算、保存历史和导出服务，你授权运营方在必要范围内处理相关内容。除法律要求或你另行授权外，运营方不会将模型用于与服务无关的商业用途。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">五、使用规范</h2>
  <p>你不得实施以下行为：</p>
  <ul class="list-disc pl-5 space-y-2">
    <li>上传病毒、恶意代码、违法内容、侵权内容或超出授权范围的文件；</li>
    <li>攻击、扫描、破解、绕过访问控制，或妨碍本系统及其基础设施运行；</li>
    <li>利用机器人或脚本超出合理频率调用接口、批量注册，或规避额度、风控和会员限制；</li>
    <li>利用报价、导出、会员或支付功能从事欺诈、恶意套利或其他违法活动。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">六、报价结果与责任说明</h2>
  <ul class="list-disc pl-5 space-y-2">
    <li>报价、打印时间、耗材重量、支撑估算、朝向评分和费用均为估算结果，仅供参考，不构成承诺或具有法律约束力的要约。</li>
    <li>实际结果可能受到打印机、喷嘴、材料批次、切片器版本、环境、模型修复状态、支撑策略和人工操作等因素影响。</li>
    <li>你应在生产前核对模型、工艺参数、材料、数量、币种、税费和最终价格，并对实际打印安全、质量和适用性负责。</li>
    <li>在适用法律允许的范围内，运营方不对用户依赖估算结果、上传内容或第三方服务造成的间接损失承担责任；依法不得排除的责任不受本条限制。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">七、会员、支付与导出</h2>
  <ul class="list-disc pl-5 space-y-2">
    <li>会员等级、价格、权益、有效期和支付方式以购买或订单页面展示为准。</li>
    <li>支付由部署方配置的支付服务商处理；除页面明确说明外，运营方不直接保存完整银行卡号、支付密码等敏感支付凭证。</li>
    <li>会员到期、订单关闭、退款或风控处理后，相关权益可能变更。退款以适用法律、订单页面和支付服务商规则为准。</li>
    <li>CSV、Excel、PDF 等文件根据当前报价结果生成，你应自行核对并妥善保管。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">八、服务变更、中断与终止</h2>
  <ul class="list-disc pl-5 space-y-2">
    <li>运营方可基于维护、升级、安全、合规或产品调整需要变更或暂停部分功能。</li>
    <li>因不可抗力、网络、云服务、存储、切片器、支付服务商或其他无法合理控制的原因导致中断时，运营方将在合理范围内恢复服务。</li>
    <li>如你违反本协议、法律法规或安全规则，运营方可限制访问、删除违规内容、暂停或终止账号。</li>
    <li>你可以停止使用本系统，并按照隐私政策申请处理账号和相关数据。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">九、隐私保护</h2>
  <p>运营方如何收集、使用、存储、共享和删除个人信息，以<a href="/legal/privacy" class="text-indigo-600 hover:underline">《隐私政策》</a>为准。</p>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">十、协议更新</h2>
  <p>运营方可能根据产品、法律法规或安全要求更新本协议。更新后的版本会显示新的版本号和生效日期；重大变更会通过页面提示、站内通知或其他适当方式告知。如你不同意更新内容，应停止使用并申请注销。</p>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">十一、适用法律与争议解决</h2>
  <p>本协议的订立、履行和解释适用中华人民共和国法律。因本协议产生的争议，双方应先友好协商；协商不成的，提交有管辖权的人民法院处理。</p>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">十二、联系我们</h2>
  <p>运营方：<strong>{operator}</strong></p>
  <p>联系邮箱：<strong>{email}</strong></p>
  <p>联系地址：<strong>{address}</strong></p>
</section>
"""
    return _page("用户协议", version, effective_date, body)


def render_privacy_page(
    version: str,
    effective_date: str,
    operator_name: str,
    contact_email: str,
    contact_address: str,
) -> str:
    operator = _safe(operator_name, "Pricer3D 运营方")
    email = _safe(contact_email, "请配置 LEGAL_CONTACT_EMAIL")
    address = _safe(contact_address, "请配置 LEGAL_CONTACT_ADDRESS")
    body = f"""
<section>
  <p>本隐私政策说明 {operator}（以下简称“运营方”）如何处理你在使用 3D 打印自动报价系统（以下简称“本系统”）时产生或提供的个人信息、模型文件和使用数据。具体处理方式可能因部署配置、地区和服务版本不同而存在差异。</p>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">一、我们处理的信息</h2>
  <h3 class="font-semibold mt-3 mb-1">1. 账号和身份信息</h3>
  <ul class="list-disc pl-5 space-y-1">
    <li>用户名、邮箱或手机号，以及注册、登录、验证和密码重置相关信息。</li>
    <li>密码以不可逆哈希形式保存，数据库不保存明文密码。</li>
    <li>用户协议和隐私政策的同意时间、版本，以及账号状态、会员等级和到期信息。</li>
  </ul>
  <h3 class="font-semibold mt-3 mb-1">2. 配置和业务数据</h3>
  <ul class="list-disc pl-5 space-y-1">
    <li>打印机、喷嘴、材料、品牌、颜色、切片预设、定价参数、品牌定制信息和报价公式。</li>
    <li>上传的 STL、STP、STEP、OBJ、3MF、ZIP/BOM 文件，以及预览、解析、切片、G-code、报价结果、导出文件和报价历史。</li>
    <li>会员订单、支付状态和客服、售后或争议处理记录。</li>
  </ul>
  <h3 class="font-semibold mt-3 mb-1">3. 自动生成和安全运行信息</h3>
  <ul class="list-disc pl-5 space-y-1">
    <li>IP 地址、请求时间、请求路径、HTTP 状态、请求 ID、错误和性能信息。</li>
    <li>浏览器、操作系统、语言和设备相关信息，用于兼容性和界面优化；除非部署方另行配置，不用于广告画像。</li>
    <li>验证码、登录失败、限流、幂等和审计记录，用于账号安全、反滥用和异常追溯。</li>
  </ul>
  <h3 class="font-semibold mt-3 mb-1">4. 浏览器本地数据</h3>
  <ul class="list-disc pl-5 space-y-1">
    <li>登录会话保存在浏览器 <code>sessionStorage</code> 中，用于当前标签页维持登录状态。</li>
    <li>部分打印参数、预设选择、界面偏好和新手引导完成状态保存在 <code>localStorage</code> 中；这些数据通常不会自动上传到服务器。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">二、处理目的</h2>
  <ul class="list-disc pl-5 space-y-1">
    <li>创建和维护账号，完成登录、验证、密码重置、权限和会员管理。</li>
    <li>接收、解析、预览和切片模型，计算打印时间、耗材、支撑和报价。</li>
    <li>保存报价历史，提供重新计算、搜索、清理和 CSV/Excel/PDF 导出。</li>
    <li>处理会员订单、支付回调、退款、客服和争议。</li>
    <li>进行安全防护、频率限制、审计、故障诊断、备份和服务改进。</li>
    <li>履行适用法律法规、司法或监管要求。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">三、必要性与同意</h2>
  <p>我们在提供你请求的账号、报价、支付或导出服务所必需的范围内处理信息；需要取得同意时，会通过注册、登录或页面提示取得同意。你可以拒绝非必要处理，但可能无法使用相应功能。</p>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">四、共享、委托处理与第三方服务</h2>
  <p>我们不会出售你的个人信息。仅在提供服务或法律要求的必要范围内共享或委托处理：</p>
  <ul class="list-disc pl-5 space-y-1">
    <li><strong>基础设施和存储：</strong>服务器、数据库、文件存储、备份、日志和网络服务提供商。</li>
    <li><strong>邮件和验证：</strong>Resend、SMTP 或部署方配置的其他邮件服务。</li>
    <li><strong>支付服务：</strong>部署方启用的支付平台，用于订单、支付、退款和会员状态同步。</li>
    <li><strong>切片和计算组件：</strong>PrusaSlicer 等服务器端处理组件，用于模型切片和报价计算。</li>
    <li><strong>法律与安全：</strong>在法律法规、司法程序、监管要求或保护相关主体安全所必要的范围内披露。</li>
  </ul>
  <p class="mt-2">具体第三方名称、所在地和处理方式取决于部署环境。部署方应在上线前补充实际供应商清单。</p>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">五、存储位置与保存期限</h2>
  <ul class="list-disc pl-5 space-y-1">
    <li>数据存储位置取决于部署服务器、数据库、文件存储和备份配置；本页面不作固定地域承诺。</li>
    <li>账号和同意记录通常在账号存续期间保存，并在注销后按照法律、安全审计、争议处理和备份周期保留必要记录。</li>
    <li>报价历史保留至用户删除、管理员清理或部署方保留策略触发。用户可在报价历史页面清理记录及关联模型/G-code 文件。</li>
    <li>默认自动清理策略下，上传模型和 G-code 分别保留约 30 天和 7 天；实际期限以部署任务和文件使用情况为准。</li>
    <li>切片缓存、日志、审计记录和备份按各自容量、时间和合规策略保留，过期后删除或覆盖。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">六、安全措施</h2>
  <ul class="list-disc pl-5 space-y-1">
    <li>使用 bcrypt 保存密码哈希，并对验证码等校验值进行哈希处理。</li>
    <li>使用 JWT、登录失败锁定、验证码、接口限流、幂等控制和审计日志降低滥用风险。</li>
    <li>生产环境应使用 HTTPS、独立随机密钥、最小权限、隔离文件目录和定期备份；任何安全措施都无法完全消除风险。</li>
    <li>发生可能影响个人信息的安全事件时，运营方会在适用法律要求的范围内采取补救和通知措施。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">七、你的权利与选择</h2>
  <ul class="list-disc pl-5 space-y-1">
    <li>你可以在用户中心查看和修改可编辑的账号、打印参数、材料、定价和品牌信息。</li>
    <li>你可以清理报价历史、上传模型和 G-code；账号注销、历史清理或浏览器存储清理可能无法恢复。</li>
    <li>你可以联系运营方申请访问、更正、删除、导出个人信息，或询问信息处理情况；运营方可能需要先核验身份。</li>
    <li>你可以清除 sessionStorage/localStorage、停止使用服务或撤回非必要同意，但可能导致退出登录或无法使用相关功能。</li>
  </ul>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">八、未成年人保护</h2>
  <p>本系统主要面向能够独立承担相应法律责任的用户。未成年人使用本系统应取得监护人同意并在监护人指导下进行。若发现未依法取得必要同意而处理了未成年人的个人信息，请联系运营方。</p>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">九、政策更新</h2>
  <p>运营方可能因产品、处理方式、法律法规或安全要求更新本政策。更新后的版本会显示新的版本号和生效日期；重大变更会通过页面提示、站内通知或其他适当方式告知。</p>
</section>
<section>
  <h2 class="text-base font-semibold text-gray-900 mb-2">十、联系我们</h2>
  <p>个人信息处理者/运营方：<strong>{operator}</strong></p>
  <p>联系邮箱：<strong>{email}</strong></p>
  <p>联系地址：<strong>{address}</strong></p>
  <p>如你认为个人信息权益受到侵害，或对本政策有疑问、意见或投诉，请通过上述方式联系运营方。</p>
</section>
"""
    return _page("隐私政策", version, effective_date, body)
