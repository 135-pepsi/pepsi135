
const STORAGE_KEY = "mini_mes_materials_v2";
const EXTRA_KEY = "mini_mes_materials_extra_v2";
const ORDER_STORAGE_KEY = "mini_mes_orders_v1";

const MES_CONFIG = window.MES_CONFIG || {};
const REMOTE_ENABLED = Boolean(MES_CONFIG.SUPABASE_URL && MES_CONFIG.SUPABASE_ANON_KEY && window.supabase);
const AUTO_REFRESH_MS = Math.max(5000, Number(MES_CONFIG.AUTO_REFRESH_SECONDS || 20) * 1000);
const db = REMOTE_ENABLED ? window.supabase.createClient(MES_CONFIG.SUPABASE_URL, MES_CONFIG.SUPABASE_ANON_KEY) : null;

const STATUS_LIST = ["待请购", "待下单", "在途", "部分到货", "已到货", "异常"];
const DEFAULT_EXTRA = Object.freeze({
  supplier: "",
  status: "待请购",
  machine: "机台1",
  safetyStock: 0,
  inTransit: 0,
  allocated: 0,
  dailyUse: 0,
  leadDays: 7,
  promiseDate: "",
  actualDate: "",
  lastOrderQty: 0,
  lastOrderPrice: 0,
  abnormalReason: "",
  abnormalAltMaterial: "",
  abnormalRecoverDate: "",
});

let rows = [];
let extras = loadExtras();
let orderCustomerMap = new Map();
let authSession = null;
let remoteOnline = REMOTE_ENABLED;
let syncing = false;
let reconnectTimer = 0;
let reconnectDelayMs = 5000;
let pageUnloading = false;
let activeRowId = "";

const filterState = {
  month: String(new Date().getMonth() + 1).padStart(2, "0"),
  supplier: "",
  status: "",
  machine: "",
  overdueOnly: false,
  keyword: "",
};

const el = {
  tableBody: document.getElementById("tableBody"),
  tableWrap: document.getElementById("tableWrap"),
  backTopBtn: document.getElementById("backTopBtn"),
  systemMode: document.getElementById("systemMode"),
  lastSyncTime: document.getElementById("lastSyncTime"),
  authUser: document.getElementById("authUser"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  reconnectBtn: document.getElementById("reconnectBtn"),

  filterMonth: document.getElementById("materialFilterMonth"),
  filterSupplier: document.getElementById("materialFilterSupplier"),
  filterStatus: document.getElementById("materialFilterStatus"),
  filterMachine: document.getElementById("materialFilterMachine"),
  filterOverdueOnly: document.getElementById("materialFilterOverdueOnly"),
  searchInput: document.getElementById("searchInput"),
  addOrderBtn: document.getElementById("materialAddOrderBtn"),

  kpiNeedOrder: document.getElementById("materialKpiNeedOrder"),
  kpiInTransit: document.getElementById("materialKpiInTransit"),
  kpiOverdue: document.getElementById("materialKpiOverdue"),
  kpiRisk3d: document.getElementById("materialKpiRisk3d"),
  kpiAmount: document.getElementById("materialKpiAmount"),
  kpiOrderImpact: document.getElementById("materialKpiOrderImpact"),

  warningOverdue: document.getElementById("warningOverdueItems"),
  warningRisk: document.getElementById("warningRiskItems"),
  warningSafety: document.getElementById("warningSafetyItems"),

  authDialog: document.getElementById("authLoginDialog"),
  authEmail: document.getElementById("authLoginEmailInput"),
  authPassword: document.getElementById("authLoginPasswordInput"),
  authClose: document.getElementById("authLoginCloseBtn"),
  authCancel: document.getElementById("authLoginCancelBtn"),
  authPasswordLogin: document.getElementById("authPasswordLoginBtn"),
  authOtpLogin: document.getElementById("authLoginSubmitBtn"),

  poDialog: document.getElementById("poDialog"),
  poClose: document.getElementById("poDialogCloseBtn"),
  poCancel: document.getElementById("poCancelBtn"),
  poSave: document.getElementById("poSaveBtn"),
  poSupplier: document.getElementById("poSupplier"),
  poQty: document.getElementById("poQty"),
  poPrice: document.getElementById("poPrice"),
  poPromise: document.getElementById("poPromiseDate"),

  arrivalDialog: document.getElementById("arrivalDialog"),
  arrivalClose: document.getElementById("arrivalDialogCloseBtn"),
  arrivalCancel: document.getElementById("arrivalCancelBtn"),
  arrivalSave: document.getElementById("arrivalSaveBtn"),
  arrivalQty: document.getElementById("arrivalQty"),
  arrivalDate: document.getElementById("arrivalDate"),

  abnormalDialog: document.getElementById("abnormalDialog"),
  abnormalClose: document.getElementById("abnormalDialogCloseBtn"),
  abnormalCancel: document.getElementById("abnormalCancelBtn"),
  abnormalSave: document.getElementById("abnormalSaveBtn"),
  abnormalReason: document.getElementById("abnormalReason"),
  abnormalAlt: document.getElementById("abnormalAltMaterial"),
  abnormalRecover: document.getElementById("abnormalRecoverDate"),

  infoDialog: document.getElementById("infoDialog"),
  infoTitle: document.getElementById("infoDialogTitle"),
  infoText: document.getElementById("infoDialogText"),
  infoClose: document.getElementById("infoDialogCloseBtn"),
  infoOk: document.getElementById("infoDialogOkBtn"),
};

init().catch((e) => {
  console.error("物料页初始化失败", e);
  showInfo("初始化失败，请刷新页面重试。", "错误");
});

async function init() {
  bindEvents();
  setFilterDefaults();
  rows = loadLocalRows();
  await refreshOrderCustomerMap();
  if (REMOTE_ENABLED) {
    await initAuth();
    await refreshFromRemote();
    setInterval(() => {
      if (!syncing && remoteOnline) void refreshFromRemote(false);
    }, AUTO_REFRESH_MS);
  } else {
    setModeText("本地模式");
    render();
    setLastSyncTime();
  }
}

function bindEvents() {
  bindFilterEvents();
  bindAuthEvents();
  bindDialogEvents();
  if (el.addOrderBtn) el.addOrderBtn.addEventListener("click", () => void addBlankRow());
  if (el.reconnectBtn) el.reconnectBtn.addEventListener("click", () => void tryReconnect(true));

  if (el.backTopBtn) {
    el.backTopBtn.addEventListener("click", () => {
      if (el.tableWrap) el.tableWrap.scrollTo({ top: 0, behavior: "smooth" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  if (el.tableWrap) el.tableWrap.addEventListener("scroll", updateBackTopBtn);
  window.addEventListener("scroll", updateBackTopBtn);
  window.addEventListener("beforeunload", () => {
    pageUnloading = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAuthDialog();
      closeDialog(el.poDialog);
      closeDialog(el.arrivalDialog);
      closeDialog(el.abnormalDialog);
      closeInfo();
    }
  });
}

function bindFilterEvents() {
  if (el.filterMonth) el.filterMonth.addEventListener("change", (e) => { filterState.month = String(e.target.value || ""); render(); });
  if (el.filterSupplier) el.filterSupplier.addEventListener("input", (e) => { filterState.supplier = String(e.target.value || "").trim().toLowerCase(); render(); });
  if (el.filterStatus) el.filterStatus.addEventListener("change", (e) => { filterState.status = String(e.target.value || ""); render(); });
  if (el.filterMachine) el.filterMachine.addEventListener("change", (e) => { filterState.machine = String(e.target.value || ""); render(); });
  if (el.filterOverdueOnly) el.filterOverdueOnly.addEventListener("change", (e) => { filterState.overdueOnly = Boolean(e.target.checked); render(); });
  if (el.searchInput) el.searchInput.addEventListener("input", (e) => { filterState.keyword = String(e.target.value || "").trim().toLowerCase(); render(); });
}
function bindAuthEvents() {
  if (el.loginBtn) el.loginBtn.addEventListener("click", openAuthDialog);
  if (el.logoutBtn) el.logoutBtn.addEventListener("click", () => void logoutAuth());
  if (el.authClose) el.authClose.addEventListener("click", closeAuthDialog);
  if (el.authCancel) el.authCancel.addEventListener("click", closeAuthDialog);
  if (el.authPasswordLogin) el.authPasswordLogin.addEventListener("click", () => void loginByPassword());
  if (el.authOtpLogin) el.authOtpLogin.addEventListener("click", () => void loginByOtp());
  if (el.authDialog) el.authDialog.addEventListener("click", (e) => { if (e.target === el.authDialog) closeAuthDialog(); });
}

function bindDialogEvents() {
  bindActionDialog(el.poDialog, [el.poClose, el.poCancel], () => void savePo(), el.poSave);
  bindActionDialog(el.arrivalDialog, [el.arrivalClose, el.arrivalCancel], () => void saveArrival(), el.arrivalSave);
  bindActionDialog(el.abnormalDialog, [el.abnormalClose, el.abnormalCancel], () => void saveAbnormal(), el.abnormalSave);
  if (el.infoClose) el.infoClose.addEventListener("click", closeInfo);
  if (el.infoOk) el.infoOk.addEventListener("click", closeInfo);
  if (el.infoDialog) el.infoDialog.addEventListener("click", (e) => { if (e.target === el.infoDialog) closeInfo(); });
}

function bindActionDialog(dialogEl, closeButtons, saveFn, saveBtn) {
  closeButtons.forEach((b) => { if (b) b.addEventListener("click", () => closeDialog(dialogEl)); });
  if (saveBtn) saveBtn.addEventListener("click", saveFn);
  if (dialogEl) dialogEl.addEventListener("click", (e) => { if (e.target === dialogEl) closeDialog(dialogEl); });
}

function setFilterDefaults() { if (el.filterMonth) el.filterMonth.value = filterState.month; }
function createEmptyRow() { return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), orderNo: "", customer: "", material: "", spec: "", quantity: "", amount: "", isReady: "" }; }
function createDefaultExtra() { return { ...DEFAULT_EXTRA }; }
function getExtra(id) { return { ...createDefaultExtra(), ...(extras[id] || {}) }; }
function saveExtra(id, patch) { extras[id] = { ...getExtra(id), ...patch }; saveExtras(); }
function deleteExtra(id) { if (extras[id]) { delete extras[id]; saveExtras(); } }
function buildExtraMap(list) { const map = new Map(); list.forEach((row) => map.set(row.id, getExtra(row.id))); return map; }

function getCurrentStock(row) { const n = Number(row.quantity); return Number.isFinite(n) ? n : 0; }
function getAvailable(row, extra) { return getCurrentStock(row) + Number(extra.inTransit || 0) - Number(extra.allocated || 0); }
function getSuggestedQty(row, extra) {
  const available = getAvailable(row, extra);
  const target = Math.max(0, Number(extra.dailyUse || 0)) * Math.max(0, Number(extra.leadDays || 0)) * 1.2 + Math.max(0, Number(extra.safetyStock || 0));
  return Math.max(0, Math.ceil(target - available));
}
function getStatus(row, extra) {
  if (STATUS_LIST.includes(extra.status)) return extra.status;
  if (String(row.isReady || "").trim() === "是") return "已到货";
  if (Number(extra.inTransit || 0) > 0) return "在途";
  return "待请购";
}
function isOverdue(row, extra) {
  if (getStatus(row, extra) === "已到货") return false;
  if (!extra.promiseDate) return false;
  const d = new Date(extra.promiseDate);
  if (Number.isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}
function isRisk3d(row, extra) { return getAvailable(row, extra) <= Math.max(0, Number(extra.dailyUse || 0)) * 3; }

function getMonthFromOrderNo(orderNo) {
  const no = String(orderNo || "").trim().toUpperCase();
  if (!/^ZZ\d{7}$/.test(no)) return "";
  return no.slice(4, 6);
}

function getFilteredRows() {
  return rows.filter((row) => {
    const extra = getExtra(row.id);
    const status = getStatus(row, extra);
    const monthOk = !filterState.month || getMonthFromOrderNo(row.orderNo) === filterState.month;
    const supplierOk = !filterState.supplier || String(extra.supplier || "").toLowerCase().includes(filterState.supplier);
    const statusOk = !filterState.status || status === filterState.status;
    const machineOk = !filterState.machine || String(extra.machine || "") === filterState.machine;
    const overdueOk = !filterState.overdueOnly || isOverdue(row, extra);
    if (!(monthOk && supplierOk && statusOk && machineOk && overdueOk)) return false;
    if (!filterState.keyword) return true;
    const hay = [row.orderNo, row.customer, row.material, row.spec, extra.supplier, extra.machine, status].join(" ").toLowerCase();
    return hay.includes(filterState.keyword);
  });
}

function render() {
  cleanupExtras();
  const list = getFilteredRows();
  const extraMap = buildExtraMap(list);
  renderKpi(list, extraMap);
  renderWarnings(list, extraMap);
  if (!el.tableBody) return;
  el.tableBody.innerHTML = "";
  list.forEach((row) => {
    const extra = extraMap.get(row.id) || createDefaultExtra();
    const tr = document.createElement("tr");
    tr.appendChild(editCell(row, "orderNo"));
    tr.appendChild(textCell(row.customer || ""));
    tr.appendChild(editCell(row, "material"));
    tr.appendChild(editCell(row, "spec"));
    tr.appendChild(editCell(row, "quantity"));
    tr.appendChild(textCell(String(getAvailable(row, extra))));
    tr.appendChild(textCell(String(extra.safetyStock || 0)));
    tr.appendChild(textCell(String(getSuggestedQty(row, extra))));
    tr.appendChild(textCell(formatMmDd(extra.promiseDate)));
    tr.appendChild(textCell(getStatus(row, extra)));
    tr.appendChild(actionCell(row));
    el.tableBody.appendChild(tr);
  });
}

function renderKpi(list, extraMap = new Map()) {
  const getRowExtra = (row) => extraMap.get(row.id) || createDefaultExtra();
  const needOrder = list.filter((r) => getStatus(r, getRowExtra(r)) === "待下单").length;
  const inTransit = list.filter((r) => ["在途", "部分到货"].includes(getStatus(r, getRowExtra(r)))).length;
  const overdue = list.filter((r) => isOverdue(r, getRowExtra(r))).length;
  const risk3d = list.filter((r) => isRisk3d(r, getRowExtra(r))).length;
  const totalAmount = list.reduce((sum, r) => { const e = getRowExtra(r); return sum + Number(e.lastOrderQty || 0) * Number(e.lastOrderPrice || 0); }, 0);
  const impactOrders = new Set(list.filter((r) => isOverdue(r, getRowExtra(r)) || isRisk3d(r, getRowExtra(r))).map((r) => String(r.orderNo || "").trim()).filter(Boolean)).size;
  if (el.kpiNeedOrder) el.kpiNeedOrder.textContent = String(needOrder);
  if (el.kpiInTransit) el.kpiInTransit.textContent = String(inTransit);
  if (el.kpiOverdue) el.kpiOverdue.textContent = String(overdue);
  if (el.kpiRisk3d) el.kpiRisk3d.textContent = String(risk3d);
  if (el.kpiAmount) el.kpiAmount.textContent = formatCurrency(totalAmount);
  if (el.kpiOrderImpact) el.kpiOrderImpact.textContent = String(impactOrders);
}

function renderWarnings(list, extraMap = new Map()) {
  const getRowExtra = (row) => extraMap.get(row.id) || createDefaultExtra();
  renderWarningList(el.warningOverdue, list.filter((r) => isOverdue(r, getRowExtra(r))));
  renderWarningList(el.warningRisk, list.filter((r) => isRisk3d(r, getRowExtra(r))));
  renderWarningList(el.warningSafety, list.filter((r) => { const ex = getRowExtra(r); return getAvailable(r, ex) <= Number(ex.safetyStock || 0); }));
}

function renderWarningList(container, list) {
  if (!container) return;
  container.innerHTML = "";
  const top = list.slice(0, 8);
  if (top.length === 0) {
    const li = document.createElement("li");
    li.textContent = "暂无";
    container.appendChild(li);
    return;
  }
  top.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = `${r.orderNo || "-"} ${r.material || ""}`.trim();
    container.appendChild(li);
  });
}
function textCell(text) { const td = document.createElement("td"); td.textContent = String(text ?? ""); return td; }
function editCell(row, key) { const td = document.createElement("td"); td.dataset.id = row.id; td.dataset.key = key; td.textContent = String(row[key] ?? ""); td.addEventListener("dblclick", () => beginEdit(td)); return td; }

function beginEdit(td) {
  if (td.classList.contains("editing")) return;
  const row = rows.find((r) => r.id === td.dataset.id);
  if (!row) return;
  const key = td.dataset.key;
  const old = String(row[key] ?? "");
  td.classList.add("editing");
  td.innerHTML = "";
  const input = document.createElement("input");
  input.type = key === "quantity" ? "number" : "text";
  input.value = old;
  input.style.width = "100%";
  td.appendChild(input);
  input.focus();
  input.select();

  const save = async () => {
    td.classList.remove("editing");
    let next = String(input.value || "").trim();
    if (key === "orderNo") {
      next = normalizeOrderNo(next.toUpperCase());
      if (String(input.value || "").trim() && !next) {
        td.textContent = old;
        showInfo("订单号格式应为 ZZYYMMNNN 或 1~3 位流水号。", "校验失败");
        return;
      }
      row.customer = resolveCustomer(next, row.customer);
    }
    if (key === "quantity") {
      const n = Number(next);
      next = Number.isFinite(n) ? String(n) : "";
    }
    row[key] = next;
    await persist({ changed: [row] });
    render();
  };

  input.addEventListener("blur", () => { void save(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    if (e.key === "Escape") { td.classList.remove("editing"); td.textContent = old; }
  });
}

function actionCell(row) {
  const td = document.createElement("td");
  td.className = "op-cell";
  const wrap = document.createElement("div");
  wrap.className = "op-actions";
  wrap.append(
    actionButton("添加行", "action-btn-secondary", () => void addRowAfter(row.id)),
    actionButton("下单", "action-btn-secondary", () => openPoDialog(row.id)),
    actionButton("到货", "action-btn-secondary", () => openArrivalDialog(row.id)),
    actionButton("异常", "action-btn-secondary", () => openAbnormalDialog(row.id)),
    actionButton("删除", "action-btn", () => void deleteRow(row.id))
  );
  td.appendChild(wrap);
  return td;
}

function actionButton(text, cls, click) { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = text; b.addEventListener("click", click); return b; }

async function addBlankRow() {
  const next = createEmptyRow();
  const last = rows[rows.length - 1];
  if (last) { next.orderNo = last.orderNo || ""; next.customer = last.customer || ""; }
  rows.push(next);
  saveExtra(next.id, createDefaultExtra());
  await persist({ changed: [next], notifyAuth: false });
  render();
}

async function addRowAfter(afterId) {
  const idx = rows.findIndex((r) => r.id === afterId);
  const next = createEmptyRow();
  if (idx >= 0) {
    next.orderNo = rows[idx].orderNo || "";
    next.customer = rows[idx].customer || "";
    rows.splice(idx + 1, 0, next);
  } else rows.push(next);
  saveExtra(next.id, createDefaultExtra());
  await persist({ changed: [next], notifyAuth: false });
  render();
}

async function deleteRow(id) {
  if (!confirm("确认删除该物料行吗？")) return;
  rows = rows.filter((r) => r.id !== id);
  deleteExtra(id);
  await persist({ deletedId: id });
  render();
}

function openPoDialog(id) {
  activeRowId = id;
  const e = getExtra(id);
  if (el.poSupplier) el.poSupplier.value = e.supplier || "";
  if (el.poQty) el.poQty.value = e.lastOrderQty ? String(e.lastOrderQty) : "";
  if (el.poPrice) el.poPrice.value = e.lastOrderPrice ? String(e.lastOrderPrice) : "";
  if (el.poPromise) el.poPromise.value = e.promiseDate || "";
  openDialog(el.poDialog);
}

async function savePo() {
  const row = rows.find((r) => r.id === activeRowId);
  if (!row) return;
  const qty = Math.max(0, Number(el.poQty?.value || 0));
  const price = Math.max(0, Number(el.poPrice?.value || 0));
  const old = getExtra(row.id);
  saveExtra(row.id, {
    supplier: String(el.poSupplier?.value || "").trim(),
    promiseDate: String(el.poPromise?.value || "").trim(),
    inTransit: Math.max(0, Number(old.inTransit || 0) + qty),
    lastOrderQty: qty,
    lastOrderPrice: price,
    status: qty > 0 ? "在途" : "待下单",
  });
  row.amount = qty > 0 && price > 0 ? Number((qty * price).toFixed(2)) : row.amount;
  await persist({ changed: [row] });
  closeDialog(el.poDialog);
  render();
}

function openArrivalDialog(id) { activeRowId = id; if (el.arrivalQty) el.arrivalQty.value = ""; if (el.arrivalDate) el.arrivalDate.value = new Date().toISOString().slice(0, 10); openDialog(el.arrivalDialog); }
async function saveArrival() {
  const row = rows.find((r) => r.id === activeRowId);
  if (!row) return;
  const qty = Math.max(0, Number(el.arrivalQty?.value || 0));
  if (qty <= 0) { showInfo("请填写大于 0 的到货数量。", "校验失败"); return; }
  const e = getExtra(row.id);
  const left = Math.max(0, Number(e.inTransit || 0) - qty);
  const status = left > 0 ? "部分到货" : "已到货";
  saveExtra(row.id, { inTransit: left, actualDate: String(el.arrivalDate?.value || "").trim(), status });
  row.quantity = getCurrentStock(row) + qty;
  row.isReady = status === "已到货" ? "是" : "否";
  await persist({ changed: [row] });
  closeDialog(el.arrivalDialog);
  render();
}

function openAbnormalDialog(id) { activeRowId = id; const e = getExtra(id); if (el.abnormalReason) el.abnormalReason.value = e.abnormalReason || ""; if (el.abnormalAlt) el.abnormalAlt.value = e.abnormalAltMaterial || ""; if (el.abnormalRecover) el.abnormalRecover.value = e.abnormalRecoverDate || ""; openDialog(el.abnormalDialog); }
async function saveAbnormal() {
  const row = rows.find((r) => r.id === activeRowId);
  if (!row) return;
  saveExtra(row.id, { abnormalReason: String(el.abnormalReason?.value || "").trim(), abnormalAltMaterial: String(el.abnormalAlt?.value || "").trim(), abnormalRecoverDate: String(el.abnormalRecover?.value || "").trim(), status: "异常" });
  await persist({ changed: [row], notifyAuth: false });
  closeDialog(el.abnormalDialog);
  render();
}

function openDialog(d) { if (!d) return; d.hidden = false; document.body.style.overflow = "hidden"; }
function closeDialog(d) { if (!d) return; d.hidden = true; refreshBodyOverflow(); }
function refreshBodyOverflow() { const open = [el.authDialog, el.poDialog, el.arrivalDialog, el.abnormalDialog, el.infoDialog].some((d) => d && !d.hidden); if (!open) document.body.style.overflow = ""; }

function updateBackTopBtn() { if (!el.backTopBtn) return; const pageY = window.scrollY || 0; const tableY = el.tableWrap ? el.tableWrap.scrollTop : 0; el.backTopBtn.style.display = pageY > 120 || tableY > 120 ? "inline-flex" : "none"; }

async function initAuth() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  try { const { data, error } = await db.auth.getSession(); if (error) throw error; authSession = data?.session || null; } catch { authSession = null; }
  updateAuthUi();
  db.auth.onAuthStateChange((_e, session) => { authSession = session || null; updateAuthUi(); setModeText(authSession ? "云端共享模式" : "云端只读（未登录）"); });
}

function updateAuthUi() { if (el.authUser) el.authUser.textContent = authSession?.user?.email || "未登录"; if (el.loginBtn) el.loginBtn.style.display = authSession ? "none" : "inline-flex"; if (el.logoutBtn) el.logoutBtn.style.display = authSession ? "inline-flex" : "none"; }
function openAuthDialog() { if (!REMOTE_ENABLED || !db?.auth) return; if (el.authEmail) el.authEmail.value = ""; if (el.authPassword) el.authPassword.value = ""; openDialog(el.authDialog); }
function closeAuthDialog() { closeDialog(el.authDialog); }

async function loginByPassword() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  const email = String(el.authEmail?.value || "").trim().toLowerCase();
  const password = String(el.authPassword?.value || "");
  if (!email || !password) { showInfo("请输入邮箱和密码。", "登录失败"); return; }
  try { const { error } = await db.auth.signInWithPassword({ email, password }); if (error) throw error; closeAuthDialog(); showInfo("登录成功。", "登录成功"); } catch (e) { showInfo(`密码登录失败：${e?.message || "未知错误"}`, "登录失败"); }
}

async function loginByOtp() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  const email = String(el.authEmail?.value || "").trim().toLowerCase();
  if (!email) { showInfo("请输入邮箱。", "登录失败"); return; }
  try {
    const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: window.location.href.split("#")[0] } });
    if (error) throw error;
    closeAuthDialog();
    showInfo("登录邮件已发送，请到邮箱点击链接。", "提示");
  } catch (e) {
    showInfo(`发送失败：${e?.message || "未知错误"}`, "登录失败");
  }
}

async function logoutAuth() { if (!REMOTE_ENABLED || !db?.auth) return; try { const { error } = await db.auth.signOut(); if (error) throw error; } catch (e) { showInfo(`退出失败：${e?.message || "未知错误"}`, "提示"); } }
function canWriteRemote(notify = true) { if (!REMOTE_ENABLED) return false; if (authSession) return true; if (notify) showInfo("当前为只读模式，请先登录后再写入云端。", "写入受限"); return false; }

function setModeText(text) { if (el.systemMode) el.systemMode.textContent = text; }
function setLastSyncTime() { if (!el.lastSyncTime) return; const now = new Date(); const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`; el.lastSyncTime.textContent = `最近同步 ${t}`; }

async function persist({ changed = [], deletedId = "", notifyAuth = true } = {}) {
  saveLocalRows();
  setLastSyncTime();
  if (!REMOTE_ENABLED || !remoteOnline) return;
  if (!canWriteRemote(notifyAuth)) return;
  syncing = true;
  try {
    if (changed.length > 0) {
      const base = Date.now();
      const payload = changed.map((r, i) => toDbRow(r, new Date(base + i).toISOString()));
      const { error } = await db.from("mes_materials").upsert(payload, { onConflict: "id" });
      if (error) throw error;
    }
    if (deletedId) {
      const { error } = await db.from("mes_materials").delete().eq("id", deletedId);
      if (error) throw error;
    }
  } catch (e) {
    handleRemoteError("物料云端同步失败", e);
  } finally { syncing = false; }
}
async function refreshFromRemote(showAlert = false) {
  if (!REMOTE_ENABLED || !remoteOnline) return;
  try {
    const { data, error } = await db.from("mes_materials").select("*").order("updated_at", { ascending: true });
    if (error) throw error;
    rows = (data || []).map(fromDbRow).map((r) => ({ ...r, customer: resolveCustomer(r.orderNo, r.customer) })).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    saveLocalRows();
    setModeText(authSession ? "云端共享模式" : "云端只读（未登录）");
    setLastSyncTime();
    render();
    reconnectDelayMs = 5000;
    if (showAlert) showInfo("已从云端刷新。", "提示");
  } catch (e) {
    if (pageUnloading) return;
    handleRemoteError("物料云端读取失败", e);
    rows = loadLocalRows();
    render();
  }
}

function handleRemoteError(prefix, err) {
  remoteOnline = false;
  setModeText("本地模式（云连接失败）");
  scheduleReconnect();
  showInfo(`${prefix}：${err?.message || err?.error_description || "未知错误"}`, "提示");
}

function scheduleReconnect() {
  if (!REMOTE_ENABLED || remoteOnline || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = 0; void tryReconnect(false); }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 60000);
}

async function tryReconnect(manual) {
  if (!REMOTE_ENABLED) return;
  try {
    const { error } = await db.from("mes_materials").select("id").limit(1);
    if (error) throw error;
    remoteOnline = true;
    reconnectDelayMs = 5000;
    await refreshFromRemote(false);
    if (manual) showInfo("云端连接已恢复。", "提示");
  } catch (e) {
    remoteOnline = false;
    setModeText("本地模式（云连接失败）");
    scheduleReconnect();
    if (manual) showInfo(`重连失败：${e?.message || "未知错误"}`, "提示");
  }
}

async function refreshOrderCustomerMap() {
  if (REMOTE_ENABLED && remoteOnline) {
    try {
      const { data, error } = await db.from("mes_orders").select("order_no,customer,updated_at").neq("order_no", "").order("updated_at", { ascending: true });
      if (error) throw error;
      const map = new Map();
      (data || []).forEach((item) => {
        const key = String(item.order_no || "").trim().toUpperCase();
        if (!key) return;
        map.set(key, String(item.customer || "").trim());
      });
      orderCustomerMap = map;
      await syncCustomerFromOrderMap();
      return;
    } catch {
      // fallback
    }
  }
  const raw = localStorage.getItem(ORDER_STORAGE_KEY);
  if (!raw) return;
  try {
    const list = JSON.parse(raw);
    const map = new Map();
    (Array.isArray(list) ? list : []).forEach((item) => {
      const key = String(item?.orderNo || item?.order_no || "").trim().toUpperCase();
      if (!key) return;
      map.set(key, String(item?.customer || "").trim());
    });
    orderCustomerMap = map;
    await syncCustomerFromOrderMap();
  } catch {
    // ignore
  }
}

async function syncCustomerFromOrderMap() {
  const changed = [];
  rows.forEach((r) => {
    const normalized = String(r.orderNo || "").trim().toUpperCase();
    if (normalized !== r.orderNo) r.orderNo = normalized;
    if (!normalized) return;
    const customer = orderCustomerMap.get(normalized);
    if (!customer) return;
    if (String(r.customer || "").trim() === customer) return;
    r.customer = customer;
    changed.push(r);
  });
  if (changed.length > 0) await persist({ changed, notifyAuth: false });
}

function cleanupExtras() { const ids = new Set(rows.map((r) => r.id)); let changed = false; Object.keys(extras).forEach((id) => { if (!ids.has(id)) { delete extras[id]; changed = true; } }); if (changed) saveExtras(); }
function normalizeOrderNo(input) {
  const raw = String(input || "").trim().toUpperCase();
  if (!raw) return "";
  if (/^ZZ\d{7}$/.test(raw)) return raw;
  if (!/^\d{1,3}$/.test(raw)) return "";
  const serial = raw.padStart(3, "0");
  const now = new Date();
  return `ZZ${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${serial}`;
}
function resolveCustomer(orderNo, fallback) { const key = String(orderNo || "").trim().toUpperCase(); return orderCustomerMap.get(key) || String(fallback || "").trim(); }

function toDbRow(r, updatedAt) { return { id: r.id, order_no: r.orderNo || "", customer: r.customer || "", material: r.material || "", spec: r.spec || "", quantity: toFiniteOrNull(r.quantity), amount: toFiniteOrNull(r.amount), is_ready: r.isReady || "", created_at: r.createdAt || updatedAt || new Date().toISOString(), updated_at: updatedAt || new Date().toISOString() }; }
function fromDbRow(row) { return { id: row.id || crypto.randomUUID(), createdAt: row.created_at || row.updated_at || new Date().toISOString(), orderNo: String(row.order_no || ""), customer: String(row.customer || ""), material: String(row.material || ""), spec: String(row.spec || ""), quantity: row.quantity == null ? "" : Number(row.quantity), amount: row.amount == null ? "" : Number(row.amount), isReady: String(row.is_ready || "") }; }
function toFiniteOrNull(v) { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

function saveLocalRows() { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); }
function loadLocalRows() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try { const list = JSON.parse(raw); if (!Array.isArray(list)) return []; return list.map((r, i) => ({ ...createEmptyRow(), ...r, createdAt: r.createdAt || new Date(Date.now() + i).toISOString() })); } catch { return []; }
}
function saveExtras() { localStorage.setItem(EXTRA_KEY, JSON.stringify(extras)); }
function loadExtras() { const raw = localStorage.getItem(EXTRA_KEY); if (!raw) return {}; try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; } }

function formatCurrency(value) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safe);
}
function formatMmDd(dateText) { if (!dateText) return ""; const d = new Date(dateText); if (Number.isNaN(d.getTime())) return ""; return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

function showInfo(message, title = "提示") {
  if (!el.infoDialog || !el.infoText) { alert(message); return; }
  if (el.infoTitle) el.infoTitle.textContent = title;
  el.infoText.textContent = String(message || "");
  openDialog(el.infoDialog);
}
function closeInfo() { closeDialog(el.infoDialog); }
