const MES_SHARED = window.MES_SHARED || {};
const MES_CONFIG = typeof MES_SHARED.getMesConfig === "function" ? MES_SHARED.getMesConfig() : (window.MES_CONFIG || {});
const supabaseSetup =
  typeof MES_SHARED.createSupabaseClient === "function"
    ? MES_SHARED.createSupabaseClient(MES_CONFIG, window.supabase)
    : {
        remoteEnabled: Boolean(MES_CONFIG.SUPABASE_URL && MES_CONFIG.SUPABASE_ANON_KEY && window.supabase),
        db: MES_CONFIG.SUPABASE_URL && MES_CONFIG.SUPABASE_ANON_KEY && window.supabase
          ? window.supabase.createClient(MES_CONFIG.SUPABASE_URL, MES_CONFIG.SUPABASE_ANON_KEY)
          : null,
      };
const db = supabaseSetup.db;
const REMOTE_ENABLED = Boolean(supabaseSetup.remoteEnabled);

const FIELD_LABELS = {
  order_no: "订单号",
  drawing_no: "图号",
  customer: "客户",
  item_name: "名称",
  qty: "数量",
  program_no: "程序单",
  planned_hours: "预计工时",
  machine: "机台",
  lathe: "车床",
  surface: "表面处理",
  status: "状态",
  start_time: "下单时间",
  due_date: "交期",
  is_delayed: "是否延期",
  note: "备注",
  material: "物料",
  spec: "规格",
  quantity: "采购数量",
  amount: "金额",
  is_ready: "是否齐备",
};

const HIDDEN_FIELDS = new Set(["id", "owner_id", "created_at", "updated_at"]);
const EMPTY_TEXT = "空";

let authSession = null;
let canViewAuditPage = false;
let allLogs = [];

const authUser = document.getElementById("authUser");
const systemMode = document.getElementById("systemMode");
const lastSyncTime = document.getElementById("lastSyncTime");
const refreshBtn = document.getElementById("refreshBtn");
const filterUserEmail = document.getElementById("filterUserEmail");
const filterPageType = document.getElementById("filterPageType");
const filterActionType = document.getElementById("filterActionType");
const filterDateFrom = document.getElementById("filterDateFrom");
const filterDateTo = document.getElementById("filterDateTo");
const auditSummary = document.getElementById("auditSummary");
const auditStatus = document.getElementById("auditStatus");
const auditTableBody = document.getElementById("auditTableBody");

function setModeText(text) {
  if (systemMode) systemMode.textContent = text;
}

function setLastSyncTime() {
  if (!lastSyncTime) return;
  const now = new Date();
  const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  lastSyncTime.textContent = `最近同步 ${t}`;
}

function updateAuthUi() {
  if (authUser) authUser.textContent = authSession?.user?.email || "未登录";
}

async function refreshAuditPageAccess() {
  canViewAuditPage = false;
  if (!authSession || !db) return;
  const email = String(authSession?.user?.email || "").trim().toLowerCase();
  if (!email) return;
  try {
    canViewAuditPage =
      typeof MES_SHARED.checkAuditAdminAccess === "function"
        ? await MES_SHARED.checkAuditAdminAccess(db, email)
        : false;
  } catch (_error) {
    canViewAuditPage = false;
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function formatPageType(value) {
  if (value === "orders") return "订单页";
  if (value === "materials") return "物料页";
  return String(value || "--");
}

function formatActionType(value) {
  if (value === "insert") return "新增";
  if (value === "update") return "修改";
  if (value === "delete") return "删除";
  return String(value || "--");
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function areValuesEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (_error) {
    return String(a) === String(b);
  }
}

function formatFieldLabel(key) {
  return FIELD_LABELS[key] || key;
}

function formatValue(value) {
  if (value == null) return EMPTY_TEXT;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || EMPTY_TEXT;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : EMPTY_TEXT;
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY_TEXT;
    return value.map((item) => formatValue(item)).join("、");
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return EMPTY_TEXT;
    return JSON.stringify(value);
  }
  return String(value);
}

function getRecordLabel(item) {
  const beforeData = normalizeObject(item.before_data);
  const afterData = normalizeObject(item.after_data);
  return (
    String(item.record_label || "").trim() ||
    String(afterData.order_no || beforeData.order_no || "").trim() ||
    String(afterData.customer || beforeData.customer || "").trim() ||
    String(item.record_id || "").trim() ||
    "--"
  );
}

function getChangedKeys(item) {
  const beforeData = normalizeObject(item.before_data);
  const afterData = normalizeObject(item.after_data);
  const keys = new Set();

  if (Array.isArray(item.changed_fields)) {
    item.changed_fields.forEach((key) => {
      const name = String(key || "").trim();
      if (name) keys.add(name);
    });
  }

  Object.keys(beforeData).forEach((key) => keys.add(key));
  Object.keys(afterData).forEach((key) => keys.add(key));

  return Array.from(keys).filter((key) => {
    if (!key || HIDDEN_FIELDS.has(key)) return false;
    return !areValuesEqual(beforeData[key], afterData[key]);
  });
}

function buildChangeItems(item) {
  const actionType = String(item.action_type || "").trim();
  const beforeData = normalizeObject(item.before_data);
  const afterData = normalizeObject(item.after_data);
  const changedKeys = getChangedKeys(item);

  if (actionType === "insert") {
    return changedKeys
      .filter((key) => isMeaningfulValue(afterData[key]))
      .map((key) => ({
        label: formatFieldLabel(key),
        before: EMPTY_TEXT,
        after: formatValue(afterData[key]),
      }));
  }

  if (actionType === "delete") {
    return changedKeys
      .filter((key) => isMeaningfulValue(beforeData[key]))
      .map((key) => ({
        label: formatFieldLabel(key),
        before: formatValue(beforeData[key]),
        after: EMPTY_TEXT,
      }));
  }

  return changedKeys.map((key) => ({
    label: formatFieldLabel(key),
    before: formatValue(beforeData[key]),
    after: formatValue(afterData[key]),
  }));
}

function buildChangeSummary(items) {
  if (items.length === 0) return "无可读变更";
  const preview = items.slice(0, 3).map((item) => `${item.label}：${item.before} -> ${item.after}`);
  const remain = items.length - preview.length;
  return remain > 0 ? `${preview.join("；")}；其余 ${remain} 项` : preview.join("；");
}

function renderChangeDetails(items) {
  if (items.length === 0) {
    return '<div class="audit-change-empty">没有可展示的业务字段变化</div>';
  }
  return items
    .map(
      (item) => `
        <div class="audit-change-item">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.before)}</span>
          <em>-></em>
          <span>${escapeHtml(item.after)}</span>
        </div>
      `
    )
    .join("");
}

function renderLogs() {
  const emailFilter = String(filterUserEmail?.value || "").trim().toLowerCase();
  const pageFilter = String(filterPageType?.value || "").trim();
  const actionFilter = String(filterActionType?.value || "").trim();
  const fromDate = String(filterDateFrom?.value || "").trim();
  const toDate = String(filterDateTo?.value || "").trim();

  const filtered = allLogs.filter((item) => {
    const emailOk = !emailFilter || String(item.user_email || "").toLowerCase().includes(emailFilter);
    const pageOk = !pageFilter || item.page_type === pageFilter;
    const actionOk = !actionFilter || item.action_type === actionFilter;
    const createdDate = String(item.created_at || "").slice(0, 10);
    const fromOk = !fromDate || createdDate >= fromDate;
    const toOk = !toDate || createdDate <= toDate;
    return emailOk && pageOk && actionOk && fromOk && toOk;
  });

  if (auditSummary) auditSummary.textContent = `共 ${filtered.length} 条`;
  if (!auditTableBody) return;

  if (filtered.length === 0) {
    auditTableBody.innerHTML = '<tr><td colspan="7" class="audit-empty-cell">暂无匹配记录</td></tr>';
    return;
  }

  const rows = filtered.map((item) => {
    const changeItems = buildChangeItems(item);
    const label = getRecordLabel(item);
    const summary = buildChangeSummary(changeItems);
    return `
      <tr>
        <td>${escapeHtml(formatDateTime(item.created_at))}</td>
        <td>${escapeHtml(item.user_email || "--")}</td>
        <td>${escapeHtml(formatPageType(item.page_type))}</td>
        <td>${escapeHtml(formatActionType(item.action_type))}</td>
        <td>${escapeHtml(label)}</td>
        <td class="audit-fields-cell">${escapeHtml(summary)}</td>
        <td class="audit-detail-cell">
          <details class="audit-detail">
            <summary>查看明细</summary>
            <div class="audit-change-list">
              ${renderChangeDetails(changeItems)}
            </div>
          </details>
        </td>
      </tr>
    `;
  });

  auditTableBody.innerHTML = rows.join("");
}

async function loadAuditLogs(showStatus = true) {
  if (!REMOTE_ENABLED || !db) {
    setModeText("未配置云端");
    if (auditStatus) auditStatus.textContent = "当前未配置 Supabase，无法查看修改记录。";
    return;
  }

  if (!authSession) {
    setModeText("请先登录");
    if (auditStatus) auditStatus.textContent = "请先在订单页或物料页登录后再访问本页。";
    if (auditTableBody) auditTableBody.innerHTML = "";
    return;
  }

  if (!canViewAuditPage) {
    setModeText("无权限");
    if (auditStatus) auditStatus.textContent = "当前账号不是审计管理员，正在返回订单页。";
    if (auditTableBody) auditTableBody.innerHTML = "";
    setTimeout(() => {
      window.location.href = "index.html";
    }, 600);
    return;
  }

  if (showStatus && auditStatus) auditStatus.textContent = "正在加载审计日志...";

  try {
    const { data, error } = await db
      .from("mes_audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    allLogs = data || [];
    renderLogs();
    setModeText("审计可用");
    if (auditStatus) auditStatus.textContent = allLogs.length > 0 ? "已加载最近 200 条修改记录。" : "暂无修改记录。";
    setLastSyncTime();
  } catch (error) {
    allLogs = [];
    renderLogs();
    setModeText("无权限或读取失败");
    if (auditStatus) {
      auditStatus.textContent =
        error?.message && /permission|policy|row-level security|forbidden/i.test(error.message)
          ? "当前账号无权查看修改记录。请确认该邮箱已加入 mes_audit_admins。"
          : `加载失败：${error?.message || "未知错误"}`;
    }
  }
}

async function initAuth() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    authSession = data?.session || null;
  } catch (_error) {
    authSession = null;
  }

  await refreshAuditPageAccess();
  updateAuthUi();

  db.auth.onAuthStateChange(async (_event, session) => {
    authSession = session || null;
    await refreshAuditPageAccess();
    updateAuthUi();
    await loadAuditLogs(true);
  });
}

function bindEvents() {
  [filterUserEmail, filterPageType, filterActionType, filterDateFrom, filterDateTo].forEach((element) => {
    if (!element) return;
    const eventName = element.tagName === "INPUT" ? "input" : "change";
    element.addEventListener(eventName, renderLogs);
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      void loadAuditLogs(true);
    });
  }
}

async function init() {
  bindEvents();
  await initAuth();
  updateAuthUi();
  await loadAuditLogs(true);
}

void init();
