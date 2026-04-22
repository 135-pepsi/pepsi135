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
const AUDIT_PAGE_SIZE = 500;
const AUDIT_MAX_ROWS = 5000;

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
let auditLoadSeq = 0;

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
  const preview = items.slice(0, 3).map((item) => `${item.label}: ${item.before} -> ${item.after}`);
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
  const filtered = Array.isArray(allLogs) ? allLogs : [];
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
            <summary>查看详情</summary>
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

function getAuditFilters() {
  return {
    email: String(filterUserEmail?.value || "").trim().toLowerCase(),
    pageType: String(filterPageType?.value || "").trim(),
    actionType: String(filterActionType?.value || "").trim(),
    dateFrom: String(filterDateFrom?.value || "").trim(),
    dateTo: String(filterDateTo?.value || "").trim(),
  };
}

function buildAuditStatusText(rowCount, truncated, filters) {
  const filterLabels = [];
  if (filters.email) filterLabels.push(`邮箱包含“${filters.email}”`);
  if (filters.pageType) filterLabels.push(`页面=${formatPageType(filters.pageType)}`);
  if (filters.actionType) filterLabels.push(`动作=${formatActionType(filters.actionType)}`);
  if (filters.dateFrom) filterLabels.push(`开始=${filters.dateFrom}`);
  if (filters.dateTo) filterLabels.push(`结束=${filters.dateTo}`);

  const scopeText = filterLabels.length > 0 ? `当前筛选（${filterLabels.join("；")}）` : "当前条件";
  if (rowCount <= 0) return `${scopeText}下暂无修改记录。`;
  if (truncated) return `${scopeText}已加载前 ${rowCount} 条记录；结果较多，请继续缩小筛选范围。`;
  return `${scopeText}已加载 ${rowCount} 条记录。`;
}

async function fetchAuditLogs(filters, requestId) {
  const rows = [];
  for (let from = 0; from < AUDIT_MAX_ROWS; from += AUDIT_PAGE_SIZE) {
    let query = db
      .from("mes_audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, from + AUDIT_PAGE_SIZE - 1);

    if (filters.email) query = query.ilike("user_email", `%${filters.email}%`);
    if (filters.pageType) query = query.eq("page_type", filters.pageType);
    if (filters.actionType) query = query.eq("action_type", filters.actionType);
    if (filters.dateFrom) query = query.gte("created_at", `${filters.dateFrom}T00:00:00`);
    if (filters.dateTo) query = query.lt("created_at", `${filters.dateTo}T23:59:59.999`);

    const { data, error } = await query;
    if (requestId !== auditLoadSeq) return { rows: [], truncated: false, stale: true };
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < AUDIT_PAGE_SIZE) return { rows, truncated: false, stale: false };
  }
  return { rows, truncated: true, stale: false };
}

async function loadAuditLogs(showStatus = true) {
  const requestId = ++auditLoadSeq;
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
    const filters = getAuditFilters();
    const result = await fetchAuditLogs(filters, requestId);
    if (result.stale) return;
    allLogs = result.rows;
    renderLogs();
    setModeText("审计可用");
    if (auditStatus) auditStatus.textContent = buildAuditStatusText(allLogs.length, result.truncated, filters);
    setLastSyncTime();
  } catch (error) {
    if (requestId !== auditLoadSeq) return;
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
    element.addEventListener(eventName, () => {
      void loadAuditLogs(false);
    });
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
