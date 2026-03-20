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

let authSession = null;
let allLogs = [];
let canViewAuditPage = false;

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

function safePrettyJson(value) {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
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
    const changedFields = Array.isArray(item.changed_fields) ? item.changed_fields : [];
    const changedText = changedFields.length > 0 ? changedFields.join("、") : "--";
    const label = item.record_label || item.record_id || "--";
    const beforeText = safePrettyJson(item.before_data);
    const afterText = safePrettyJson(item.after_data);
    return `
      <tr>
        <td>${escapeHtml(formatDateTime(item.created_at))}</td>
        <td>${escapeHtml(item.user_email || "--")}</td>
        <td>${escapeHtml(formatPageType(item.page_type))}</td>
        <td>${escapeHtml(formatActionType(item.action_type))}</td>
        <td>${escapeHtml(label)}</td>
        <td class="audit-fields-cell">${escapeHtml(changedText)}</td>
        <td class="audit-detail-cell">
          <details class="audit-detail">
            <summary>查看</summary>
            <div class="audit-detail-block">
              <strong>变更前</strong>
              <pre>${escapeHtml(beforeText || "无")}</pre>
            </div>
            <div class="audit-detail-block">
              <strong>变更后</strong>
              <pre>${escapeHtml(afterText || "无")}</pre>
            </div>
          </details>
        </td>
      </tr>
    `;
  });
  auditTableBody.innerHTML = rows.join("");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  [filterUserEmail, filterPageType, filterActionType, filterDateFrom, filterDateTo].forEach((el) => {
    if (!el) return;
    const eventName = el.tagName === "INPUT" ? "input" : "change";
    el.addEventListener(eventName, renderLogs);
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
