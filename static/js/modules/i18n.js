/**
 * i18n (Internationalization) — 中英双语支持
 *
 * Usage: import { t, lang, setLang, toggleLang } from './i18n.js'
 *
 * In HTML: use data-i18n="key.name" for simple text nodes
 * In JS:   t('key.name') → translated string
 *           t('key.name', { count: 3 }) → interpolated: "3 个文件"
 *
 * Language priority: localStorage > browser setting > default 'zh'
 */
export { t, lang, setLang, toggleLang, initI18n, loadTranslations };

// ── State ──
let lang = localStorage.getItem('pricer3d_lang_v1') || getBrowserLang();

let STRINGS = {};

function getBrowserLang() {
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('en')) return 'en';
  return 'zh'; // default
}

function setLang(l) {
  lang = l;
  localStorage.setItem('pricer3d_lang_v1', l);
  // Notify all i18n-aware elements on the page
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
    const ph = el.getAttribute('data-i18n-placeholder');
    if (ph) el.placeholder = t(ph);
  });
  // Dispatch event for JS listeners
  window.dispatchEvent(new CustomEvent('i18n-change', { detail: { lang: l } }));
}

function toggleLang() {
  setLang(lang === 'zh' ? 'en' : 'zh');
}

function initI18n() {
  setLang(lang);
}

// ── Dynamic loading ──
// Keys not in the bundle can be loaded from the server
async function loadTranslations(newStrings) {
  Object.assign(STRINGS, newStrings);
}

// ── Translate ──
function t(key, params) {
  const str = STRINGS[lang]?.[key] || STRINGS['zh']?.[key] || key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? params[k] : `{${k}}`));
}

// ══════════════════════════════════════════
// Translation dictionary
// ══════════════════════════════════════════

STRINGS = {
  zh: {
    // ── Common / 通用 ──
    'common.loading': '加载中...',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.delete': '删除',
    'common.success': '成功',
    'common.error': '错误',
    'common.close': '关闭',
    'common.edit': '编辑',
    'common.download': '下载',
    'common.upload': '上传',
    'common.search': '搜索',
    'common.none': '无',
    'common.default': '默认',
    'common.noData': '暂无数据',
    'common.unknown': '未知',
    'common.select': '请选择',
    'common.optional': '可选',
    'common.required': '必填',
    'common.or': '或',
    'common.and': '和',
    'common.retry': '重试',
    'common.refresh': '刷新',
    'common.preview': '预览',

    // ── Auth / 认证 ──
    'auth.login': '登录',
    'auth.loginTitle': '登录 Pricer3D',
    'auth.logout': '退出登录',
    'auth.register': '注册',
    'auth.registerTitle': '注册 Pricer3D',
    'auth.forgotPassword': '忘记密码',
    'auth.resetPassword': '重置密码',
    'auth.setNewPassword': '设置新密码',
    'auth.username': '用户名',
    'auth.password': '密码',
    'auth.email': '邮箱',
    'auth.captcha': '验证码',
    'auth.verificationCode': '验证码',
    'auth.rememberMe': '保持登录状态 30 天',
    'auth.agreeTerms': '我同意',
    'auth.termsOfService': '服务条款',
    'auth.privacyPolicy': '隐私政策',
    'auth.sendCode': '发送验证码',
    'auth.resendIn': '{seconds}秒后重发',
    'auth.resendInMin': '{minutes}分{seconds}秒后重发',
    'auth.captchaLoadError': '验证码加载失败，请点击验证码图片重试',
    'auth.codeSendError': '验证码获取失败',
    'auth.loginFailed': '登录失败',
    'auth.registerFailed': '注册失败',
    'auth.logoutSuccess': '已退出登录',
    'auth.sessionExpired': '登录已过期，请重新登录',
    'auth.memberSince': '注册时间',
    'auth.subtitle': '3D 打印自动报价系统',

    // ── Auth validation ──
    'auth.enterUsername': '请输入账号',
    'auth.enterPassword': '请输入密码',
    'auth.passwordMinLength': '密码至少 6 位',
    'auth.enterCaptcha': '请输入验证码',
    'auth.agreeTermsRequired': '请先阅读并同意《用户协议》和《隐私政策》',
    'auth.captchaExpired': '验证码已失效，已自动刷新',
    'auth.enterEmail': '请输入邮箱',
    'auth.invalidEmail': '邮箱格式不正确',
    'auth.enterNewPassword': '请输入新密码',
    'auth.passwordRequirements': '密码至少 6 位且包含字母和数字',
    'auth.requestFailed': '请求失败',
    'auth.resetFailed': '重置失败',
    'auth.resetSuccess': '密码重置成功，请使用新密码登录',
    'auth.confirmResetPassword': '确认重置密码',
    'auth.loginResponseInvalid': '登录响应无效，请重试',
    'auth.codeSent': '验证码已发送至您的邮箱，请查收',
    'auth.devCodeNotice': '验证码：{code}（开发模式，邮件未发送）',
    'auth.memberBadge': '会员',
    'auth.postLoginProgress': '当前列表共 {total} 个文件，正在为新增 {new} 个文件生成静态图与自动报价...',
    'auth.postLoginDone': '当前列表共 {total} 个文件，新增 {new} 个文件报价完成',
    'auth.postLoginFail': '当前列表共 {total} 个文件，新增 {new} 个文件自动报价失败',
    'auth.noFileSelected': '未选择文件（最多20个，单文件需小于100MB）',

    // ── Quote / 报价 ──
    'quote.title': '报价',
    'quote.uploadZone': '拖拽文件到此处或点击上传',
    'quote.uploadHint': '支持 STL / STP / STEP / 3MF，最大 100MB',
    'quote.batchSettings': '批量设置：',
    'quote.applyToAll': '应用到全部',
    'quote.reQuote': '重新报价',
    'quote.reQuoteAll': '全部重报',
    'quote.selectAll': '全选',
    'quote.deselectAll': '取消选择',
    'quote.fileList': '文件列表',
    'quote.quoteResults': '报价结果',
    'quote.filename': '文件名',
    'quote.material': '材料',
    'quote.color': '颜色',
    'quote.quantity': '数量',
    'quote.unitPrice': '单价',
    'quote.totalPrice': '总价',
    'quote.total': '小计',
    'quote.time': '时间',
    'quote.filament': '耗材',
    'quote.actions': '操作',
    'quote.remove': '移除',
    'quote.recalc': '重算',
    'quote.noFiles': '尚未上传文件。拖拽 STL/STP/3MF 文件到上方区域或点击上传。',
    'quote.quoteBtn': '生成报价',
    'quote.quotaUsed': '今日已用 {used}/{limit} 次',
    'quote.quotaExceeded': '今日报价次数已用完',
    'quote.calculating': '计算中...',
    'quote.printerModel': '打印机',
    'quote.nozzleDiameter': '喷嘴直径',
    'quote.preset': '切片预设',
    'quote.presetNone': '不使用预设',
    'quote.printerNotSet': '未选择',
    'quote.requestFailed': '请求失败，请稍后重试',
    'quote.countMustBePositive': '数量必须大于等于 1',
    'quote.gcodeDetail': '📊详情',
    'quote.gcodeCollapse': '📊收起',
    'quote.prusaEnabled': 'PrusaSlicer 切片精确估算已启用',
    'quote.missingConfig': '⚠️ 未设置：{items}。建议先设置后再报价。',
    'quote.geometry': '几何信息',
    'quote.weight': '重量(g)',
    'quote.unitTime': '单件时间',
    'quote.totalTime': '总时间',
    'quote.status': '状态/错误',
    'quote.totalFiles': '文件总数',
    'quote.successFail': '成功 / 失败',
    'quote.totalCostCNY': '总费用 (CNY)',
    'quote.selectFile': '选择文件',
    'quote.noFileSelected': '未选择文件（最多20个，单文件需小于100MB）',
    'quote.uploadModels': '上传 3D 模型（stl/stp/step/obj/3mf，最多20个，单文件<100MB）',
    'quote.noDataUpload': '暂无数据，请在表格底部上传并自动报价',

    // ── Slicer / 切片配置 ──
    'slicer.title': '切片配置',
    'slicer.currentPreset': '当前预设',
    'slicer.savePreset': '💾 保存',
    'slicer.saveAsNew': '📋 另存为',
    'slicer.presetName': '预设名称（自动生成）',
    'slicer.layerHeight': '层高',
    'slicer.wallCount': '外壳圈数',
    'slicer.topShells': '顶实心层',
    'slicer.bottomShells': '底实心层',
    'slicer.infill': '填充密度',
    'slicer.brimWidth': '底边宽度',
    'slicer.noPreset': '-- 新建 / 未选择 --',
    'slicer.presetAutoName': '{layer}-{walls}-{infill}%',
    'slicer.presetLoadError': '预设加载失败',
    'slicer.presetSaveError': '预设保存失败',
    'slicer.presetDeleteError': '预设删除失败',
    'slicer.presetsTable': '已保存预设',
    'slicer.paramSummary': '层高:{layer} 墙:{walls} 填充:{infill}%',

    // ── Printer / 打印机配置 ──
    'printer.title': '机型配置',
    'printer.model': '打印机型号',
    'printer.nozzle': '喷嘴直径',
    'printer.bedInfo': '热床尺寸：{x} × {y} × {z} mm',
    'printer.selectPrinter': '选择打印机...',
    'printer.myPresets': '我的打印机预设',
    'printer.addPreset': '+ 新增',
    'printer.presetName': '预设名称',
    'printer.bedX': 'X 轴 (mm)',
    'printer.bedY': 'Y 轴 (mm)',
    'printer.bedZ': 'Z 轴 (mm)',
    'printer.allModels': '所有机型',
    'printer.restoreDefault': '恢复默认',
    'printer.defaultBadge': '默认项',
    'printer.saveSettingsHint': '点底部「保存设置」生效',

    // ── Materials / 材料 ──
    'material.title': '打印材料',
    'material.name': '材料名称',
    'material.density': '密度 (g/cm³)',
    'material.price': '单价 (元/g)',
    'material.colors': '颜色管理',
    'material.addMaterial': '新增材料',
    'material.addColor': '新增颜色',
    'material.colorHex': '颜色色号',
    'material.colorName': '颜色名称',
    'material.defaultColors': '默认颜色',

    // ── Settings / 用户中心 ──
    'settings.title': '用户中心',
    'settings.profile': '个人资料',
    'settings.pricing': '定价配置',
    'settings.formula': '计价公式',
    'settings.changePassword': '修改密码',
    'settings.saveSettings': '保存设置',
    'settings.saveSuccess': '设置已保存',
    'settings.saveError': '保存失败',
    'settings.printerConfig': '机型配置',
    'settings.slicerConfig': '切片配置',
    'settings.materialConfig': '材料配置',
    'settings.membership': '会员套餐',

    // ── Membership / 会员 ──
    'membership.title': '会员套餐',
    'membership.current': '当前套餐',
    'membership.free': '免费版',
    'membership.upgrade': '升级',
    'membership.refreshError': '刷新失败',
    'membership.loadError': '加载失败',
    'membership.refreshed': '会员状态已刷新',

    // ── History / 报价历史 ──
    'history.title': '报价历史',
    'history.time': '时间',
    'history.files': '文件',
    'history.status': '状态',
    'history.success': '✓ 成功',
    'history.noRecords': '暂无报价记录',

    // ── Preview / 预览 ──
    'preview.fileNotFound': '文件未找到',
    'preview.loading': '加载中 {name} ({pct}%)',
    'preview.title': '3D 预览',

    // ── Orientation / 朝向 ──
    'orientation.autoOrient': '🎯 智能摆放 (Lay on Face)',
    'orientation.exit': '退出摆放模式',
    'orientation.noFace': '无可用摆放面',
    'orientation.analyzeError': '分析失败',

    // ── Theme ──
    'theme.toggle': '切换深色/浅色主题',

    // ── Version / 页脚 ──
    'version.deployed': '部署时间',
    'version.label': '版本',
  },

  en: {
    // ── Common ──
    'common.loading': 'Loading...',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.delete': 'Delete',
    'common.success': 'Success',
    'common.error': 'Error',
    'common.close': 'Close',
    'common.edit': 'Edit',
    'common.download': 'Download',
    'common.upload': 'Upload',
    'common.search': 'Search',
    'common.none': 'None',
    'common.default': 'Default',
    'common.noData': 'No data',
    'common.unknown': 'Unknown',
    'common.select': 'Select',
    'common.optional': 'Optional',
    'common.required': 'Required',
    'common.or': 'or',
    'common.and': 'and',
    'common.retry': 'Retry',
    'common.refresh': 'Refresh',
    'common.preview': 'Preview',

    // ── Auth ──
    'auth.login': 'Login',
    'auth.loginTitle': 'Login to Pricer3D',
    'auth.logout': 'Logout',
    'auth.register': 'Register',
    'auth.registerTitle': 'Register for Pricer3D',
    'auth.forgotPassword': 'Forgot Password',
    'auth.resetPassword': 'Reset Password',
    'auth.setNewPassword': 'Set New Password',
    'auth.username': 'Username',
    'auth.password': 'Password',
    'auth.email': 'Email',
    'auth.captcha': 'CAPTCHA',
    'auth.verificationCode': 'Verification Code',
    'auth.rememberMe': 'Keep me logged in for 30 days',
    'auth.agreeTerms': 'I agree to the',
    'auth.termsOfService': 'Terms of Service',
    'auth.privacyPolicy': 'Privacy Policy',
    'auth.sendCode': 'Send Code',
    'auth.resendIn': 'Resend in {seconds}s',
    'auth.resendInMin': 'Resend in {minutes}m {seconds}s',
    'auth.captchaLoadError': 'Failed to load CAPTCHA, click to retry',
    'auth.codeSendError': 'Failed to send verification code',
    'auth.loginFailed': 'Login failed',
    'auth.registerFailed': 'Registration failed',
    'auth.logoutSuccess': 'Logged out',
    'auth.sessionExpired': 'Session expired, please login again',
    'auth.memberSince': 'Member since',
    'auth.subtitle': '3D Print Quoting System',

    // ── Auth validation ──
    'auth.enterUsername': 'Please enter username',
    'auth.enterPassword': 'Please enter password',
    'auth.passwordMinLength': 'Password must be at least 6 characters',
    'auth.enterCaptcha': 'Please enter CAPTCHA',
    'auth.agreeTermsRequired': 'Please agree to Terms of Service and Privacy Policy',
    'auth.captchaExpired': 'CAPTCHA expired, auto-refreshed',
    'auth.enterEmail': 'Please enter email',
    'auth.invalidEmail': 'Invalid email format',
    'auth.enterNewPassword': 'Please enter new password',
    'auth.passwordRequirements': 'Password must be at least 6 characters with letters and numbers',
    'auth.requestFailed': 'Request failed',
    'auth.resetFailed': 'Reset failed',
    'auth.resetSuccess': 'Password reset successful, please login with new password',
    'auth.confirmResetPassword': 'Confirm reset password',
    'auth.loginResponseInvalid': 'Invalid login response, please retry',
    'auth.codeSent': 'Verification code sent to your email',
    'auth.devCodeNotice': 'Code: {code} (dev mode, email not sent)',
    'auth.memberBadge': 'Member',
    'auth.postLoginProgress': '{total} files in list, generating thumbnails and quoting {new} new files...',
    'auth.postLoginDone': '{total} files in list, {new} new files quoted',
    'auth.postLoginFail': '{total} files in list, auto-quote failed for {new} new files',
    'auth.noFileSelected': 'No file selected (max 20 files, <100MB each)',

    // ── Quote ──
    'quote.title': 'Quote',
    'quote.uploadZone': 'Drag & drop files here or click to upload',
    'quote.uploadHint': 'Supports STL / STP / STEP / 3MF, max 100MB',
    'quote.batchSettings': 'Batch Settings: ',
    'quote.applyToAll': 'Apply to All',
    'quote.reQuote': 'Re-quote',
    'quote.reQuoteAll': 'Re-quote All',
    'quote.selectAll': 'Select All',
    'quote.deselectAll': 'Deselect All',
    'quote.fileList': 'File List',
    'quote.quoteResults': 'Quote Results',
    'quote.filename': 'Filename',
    'quote.material': 'Material',
    'quote.color': 'Color',
    'quote.quantity': 'Qty',
    'quote.unitPrice': 'Unit Price',
    'quote.totalPrice': 'Total Price',
    'quote.total': 'Subtotal',
    'quote.time': 'Time',
    'quote.filament': 'Filament',
    'quote.actions': 'Actions',
    'quote.remove': 'Remove',
    'quote.recalc': 'Recalc',
    'quote.noFiles': 'No files uploaded yet. Drag STL/STP/3MF files here or click to upload.',
    'quote.quoteBtn': 'Generate Quote',
    'quote.quotaUsed': 'Used {used}/{limit} today',
    'quote.quotaExceeded': 'Daily quote limit reached',
    'quote.calculating': 'Calculating...',
    'quote.printerModel': 'Printer',
    'quote.nozzleDiameter': 'Nozzle',
    'quote.preset': 'Preset',
    'quote.presetNone': 'No Preset',
    'quote.printerNotSet': 'Not selected',
    'quote.requestFailed': 'Request failed, please try again',
    'quote.countMustBePositive': 'Quantity must be >= 1',
    'quote.gcodeDetail': '📊Details',
    'quote.gcodeCollapse': '📊Hide',
    'quote.prusaEnabled': 'PrusaSlicer precise estimation enabled',
    'quote.missingConfig': '⚠️ Not set: {items}. Configure first for accurate quotes.',
    'quote.geometry': 'Geometry',
    'quote.weight': 'Weight(g)',
    'quote.unitTime': 'Unit Time',
    'quote.totalTime': 'Total Time',
    'quote.status': 'Status/Error',
    'quote.totalFiles': 'Total Files',
    'quote.successFail': 'Success / Failed',
    'quote.totalCostCNY': 'Total Cost (CNY)',
    'quote.selectFile': 'Select Files',
    'quote.noFileSelected': 'No file selected (max 20, <100MB each)',
    'quote.uploadModels': 'Upload 3D models (stl/stp/step/obj/3mf, max 20, <100MB each)',
    'quote.noDataUpload': 'No data. Upload files below for auto-quote.',

    // ── Slicer ──
    'slicer.title': 'Slicer Config',
    'slicer.currentPreset': 'Current Preset',
    'slicer.savePreset': '💾 Save',
    'slicer.saveAsNew': '📋 Save As',
    'slicer.presetName': 'Preset Name (auto-generated)',
    'slicer.layerHeight': 'Layer Height',
    'slicer.wallCount': 'Wall Loops',
    'slicer.topShells': 'Top Shells',
    'slicer.bottomShells': 'Bottom Shells',
    'slicer.infill': 'Infill Density',
    'slicer.brimWidth': 'Brim Width',
    'slicer.noPreset': '-- New / None --',
    'slicer.presetAutoName': '{layer}-{walls}-{infill}%',
    'slicer.presetLoadError': 'Failed to load presets',
    'slicer.presetSaveError': 'Failed to save preset',
    'slicer.presetDeleteError': 'Failed to delete preset',
    'slicer.presetsTable': 'Saved Presets',
    'slicer.paramSummary': 'Layer:{layer} Walls:{walls} Infill:{infill}%',

    // ── Printer ──
    'printer.title': 'Printer Config',
    'printer.model': 'Printer Model',
    'printer.nozzle': 'Nozzle Diameter',
    'printer.bedInfo': 'Bed Size: {x} × {y} × {z} mm',
    'printer.selectPrinter': 'Select printer...',
    'printer.myPresets': 'My Printers',
    'printer.addPreset': '+ Add',
    'printer.presetName': 'Name',
    'printer.bedX': 'X (mm)',
    'printer.bedY': 'Y (mm)',
    'printer.bedZ': 'Z (mm)',
    'printer.allModels': 'All Models',
    'printer.restoreDefault': 'Restore Default',
    'printer.defaultBadge': 'Default',
    'printer.saveSettingsHint': 'Save settings at bottom to apply',

    // ── Material ──
    'material.title': 'Materials',
    'material.name': 'Name',
    'material.density': 'Density (g/cm³)',
    'material.price': 'Price (¥/g)',
    'material.colors': 'Colors',
    'material.addMaterial': 'Add Material',
    'material.addColor': 'Add Color',
    'material.colorHex': 'Hex',
    'material.colorName': 'Color Name',
    'material.defaultColors': 'Default Colors',

    // ── Settings ──
    'settings.title': 'Settings',
    'settings.profile': 'Profile',
    'settings.pricing': 'Pricing',
    'settings.formula': 'Formula',
    'settings.changePassword': 'Change Password',
    'settings.saveSettings': 'Save Settings',
    'settings.saveSuccess': 'Settings saved',
    'settings.saveError': 'Save failed',
    'settings.printerConfig': 'Printer Config',
    'settings.slicerConfig': 'Slicer Config',
    'settings.materialConfig': 'Materials',
    'settings.membership': 'Membership',

    // ── Membership ──
    'membership.title': 'Membership',
    'membership.current': 'Current Plan',
    'membership.free': 'Free',
    'membership.upgrade': 'Upgrade',
    'membership.refreshError': 'Refresh failed',
    'membership.loadError': 'Failed to load',
    'membership.refreshed': 'Membership status refreshed',

    // ── History ──
    'history.title': 'Quote History',
    'history.time': 'Time',
    'history.files': 'Files',
    'history.status': 'Status',
    'history.success': '✓ Success',
    'history.noRecords': 'No quote history',

    // ── Preview ──
    'preview.fileNotFound': 'File not found',
    'preview.loading': 'Loading {name} ({pct}%)',
    'preview.title': '3D Preview',

    // ── Orientation ──
    'orientation.autoOrient': '🎯 Auto Orient (Lay on Face)',
    'orientation.exit': 'Exit Lay Mode',
    'orientation.noFace': 'No surface available',
    'orientation.analyzeError': 'Analysis failed',

    // ── Theme ──
    'theme.toggle': 'Toggle dark/light theme',

    // ── Version ──
    'version.deployed': 'Deployed',
    'version.label': 'Version',
  }
};

// ── Language flag helper ──
export function langFlag(l) {
  return l === 'zh' ? '🇨🇳' : '🇺🇸';
}
export function langLabel(l) {
  return l === 'zh' ? '中文' : 'English';
}
