
const STORAGE_KEY = "mini_mes_materials_v2";
const EXTRA_KEY = "mini_mes_materials_extra_v2";
const ORDER_STORAGE_KEY = "mini_mes_orders_v1";

const MES_CONFIG = window.MES_CONFIG || {};
const REMOTE_ENABLED = Boolean(MES_CONFIG.SUPABASE_URL && MES_CONFIG.SUPABASE_ANON_KEY && window.supabase);
const IS_LOCAL_DEBUG = location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
const AUTO_REFRESH_MS = Math.max(5000, Number(MES_CONFIG.AUTO_REFRESH_SECONDS || 20) * 1000);
const db = REMOTE_ENABLED ? window.supabase.createClient(MES_CONFIG.SUPABASE_URL, MES_CONFIG.SUPABASE_ANON_KEY) : null;

const STATUS_LIST = ["待请购", "待下单", "在途", "部分到货", "材料齐备", "异常"];
const MATERIAL_OPTIONS = ["", "45#钢", "40Cr", "铝6061", "铝7075", "不锈钢304", "不锈钢316", "铜", "POM", "尼龙"];
const SUPPLIER_OPTIONS = ["", "供应商A", "供应商B", "供应商C", "供应商D"];
const SPEC_LINES_PREFIX = "@LINES:";
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
let orderHintListEl = null;
let materialItemEditingRowId = "";

const filterState = {
  month: String(new Date().getMonth() + 1).padStart(2, "0"),
  supplier: "",
  status: "",
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
  filterOverdueOnly: document.getElementById("materialFilterOverdueOnly"),
  searchInput: document.getElementById("searchInput"),

  kpiNeedOrder: document.getElementById("materialKpiNeedOrder"),
  kpiInTransit: document.getElementById("materialKpiInTransit"),
  kpiOverdue: document.getElementById("materialKpiOverdue"),
  kpiRisk3d: document.getElementById("materialKpiRisk3d"),
  kpiAmount: document.getElementById("materialKpiAmount"),
  kpiOrderImpact: document.getElementById("materialKpiOrderImpact"),
  orderHintCard: document.getElementById("orderHintCard"),
  orderHintList: document.getElementById("orderHintList"),

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
  syncPageActionLabels();
  setupOrderHintPanel();
  syncProcurementTableHeader();
  ensureMaterialItemDialog();
  bindEvents();
  initStatusFilterOptions();
  setFilterDefaults();
  rows = loadLocalRows();
  await refreshOrderCustomerMap();
  if (REMOTE_ENABLED) {
    await initAuth();
    await refreshFromRemote();
    const testAdded = await ensureTestRowExists();
    if (testAdded) render();
    setInterval(() => {
      if (!syncing && remoteOnline) void refreshFromRemote(false);
    }, AUTO_REFRESH_MS);
  } else {
    await ensureTestRowExists();
    setModeText("本地模式");
    render();
    setLastSyncTime();
  }
}

async function ensureTestRowExists() {
  if (!IS_LOCAL_DEBUG) return false;
  const exists = rows.some((r) => String(r.orderNo || "").trim().toUpperCase() === "ZZ2602001");
  if (exists) return false;
  const testRow = createEmptyRow();
  testRow.orderNo = "ZZ2602001";
  testRow.customer = "测试客户";
  rows.push(testRow);
  saveExtra(testRow.id, createDefaultExtra());
  saveLocalRows();
  return true;
}

function bindEvents() {
  bindFilterEvents();
  bindAuthEvents();
  bindDialogEvents();
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
      closeDialog(el.materialItemDialog);
      closeInfo();
    }
  });
}

function syncProcurementTableHeader() {
  const headRow = document.querySelector("#orderTable thead tr");
  if (!headRow) return;
  headRow.innerHTML = `
    <th>订单号</th>
    <th>客户</th>
    <th>物料</th>
    <th>状态</th>
    <th>操作</th>
  `;
}

function ensureMaterialItemDialog() {
  const existing = document.getElementById("materialItemDialog");
  if (existing) {
    el.materialItemDialog = existing;
    el.materialItemClose = document.getElementById("materialItemDialogCloseBtn");
    el.materialItemCancel = document.getElementById("materialItemCancelBtn");
    el.materialItemSave = document.getElementById("materialItemSaveBtn");
    el.materialItemClear = document.getElementById("materialItemClearBtn");
    el.materialInput = document.getElementById("materialItemMaterial");
    el.materialSpecInput = document.getElementById("materialItemSpec");
    el.materialQtyInput = document.getElementById("materialItemQty");
    el.materialSupplierInput = document.getElementById("materialItemSupplier");
    el.materialLineList = document.getElementById("materialLineList");
    el.materialLineAddBtn = document.getElementById("materialLineAddBtn");
    populateMaterialItemSelects();
    return;
  }
  const dialog = document.createElement("div");
  dialog.id = "materialItemDialog";
  dialog.className = "dialog-backdrop";
  dialog.hidden = true;
  dialog.innerHTML = `
    <section class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="materialItemDialogTitle">
      <header class="dialog-head">
        <h3 id="materialItemDialogTitle">物料明细</h3>
        <button id="materialItemDialogCloseBtn" class="btn btn-secondary" type="button">关闭</button>
      </header>
      <div class="material-item-grid">
        <div class="material-item-col material-item-col-fixed">
          <label class="auth-login-field"><span>材质</span><select id="materialItemMaterial"></select></label>
          <label class="auth-login-field"><span>供应商</span><select id="materialItemSupplier"></select></label>
        </div>
        <div class="material-item-col material-item-col-lines">
          <div class="auth-login-field">
            <span>尺寸与数量</span>
            <div id="materialLineList" class="material-line-list"></div>
            <button id="materialLineAddBtn" class="btn btn-secondary" type="button">新增尺寸行</button>
          </div>
        </div>
      </div>
      <div class="auth-login-actions">
        <button id="materialItemCancelBtn" class="btn btn-secondary" type="button">取消</button>
        <button id="materialItemClearBtn" class="btn btn-secondary" type="button">清空</button>
        <button id="materialItemSaveBtn" class="btn btn-primary" type="button">保存</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialog);
  el.materialItemDialog = dialog;
  el.materialItemClose = document.getElementById("materialItemDialogCloseBtn");
  el.materialItemCancel = document.getElementById("materialItemCancelBtn");
  el.materialItemSave = document.getElementById("materialItemSaveBtn");
  el.materialItemClear = document.getElementById("materialItemClearBtn");
  el.materialInput = document.getElementById("materialItemMaterial");
  el.materialSpecInput = document.getElementById("materialItemSpec");
  el.materialQtyInput = document.getElementById("materialItemQty");
  el.materialSupplierInput = document.getElementById("materialItemSupplier");
  el.materialLineList = document.getElementById("materialLineList");
  el.materialLineAddBtn = document.getElementById("materialLineAddBtn");
  populateMaterialItemSelects();
}

function populateMaterialItemSelects() {
  if (el.materialInput) {
    el.materialInput.innerHTML = "";
    MATERIAL_OPTIONS.forEach((name, idx) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = idx === 0 ? "请选择材质" : name;
      el.materialInput.appendChild(option);
    });
  }
  if (el.materialSupplierInput) {
    el.materialSupplierInput.innerHTML = "";
    SUPPLIER_OPTIONS.forEach((name, idx) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = idx === 0 ? "请选择供应商" : name;
      el.materialSupplierInput.appendChild(option);
    });
  }
}

function setSelectValueWithFallback(selectEl, value, placeholderText = "请选择") {
  if (!selectEl) return;
  const normalized = String(value || "").trim();
  if (!normalized) {
    selectEl.value = "";
    return;
  }
  const exists = Array.from(selectEl.options).some((opt) => opt.value === normalized);
  if (!exists) {
    const option = document.createElement("option");
    option.value = normalized;
    option.textContent = normalized || placeholderText;
    selectEl.appendChild(option);
  }
  selectEl.value = normalized;
}

function syncPageActionLabels() {
  const orderManageLink = document.querySelector('a[href="index.html"]');
  if (orderManageLink) orderManageLink.textContent = "订单管理";
}

function initStatusFilterOptions() {
  if (!el.filterStatus) return;
  const current = String(el.filterStatus.value || "");
  el.filterStatus.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部";
  el.filterStatus.appendChild(all);
  STATUS_LIST.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    el.filterStatus.appendChild(option);
  });
  el.filterStatus.value = STATUS_LIST.includes(current) ? current : "";
}

function setupOrderHintPanel() {
  if (el.orderHintList) {
    orderHintListEl = el.orderHintList;
    return;
  }
  const card = el.orderHintCard;
  if (!card) return;
  card.innerHTML = "";
  const title = document.createElement("h3");
  title.textContent = "新订单提示";
  const desc = document.createElement("p");
  desc.className = "order-hint-desc";
  desc.textContent = "订单明细出现新订单号后，会在这里提示并显示客户。";
  const list = document.createElement("ul");
  list.className = "order-hint-list";
  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(list);
  orderHintListEl = list;
}

function bindFilterEvents() {
  if (el.filterMonth) el.filterMonth.addEventListener("change", (e) => { filterState.month = String(e.target.value || ""); render(); });
  if (el.filterSupplier) el.filterSupplier.addEventListener("input", (e) => { filterState.supplier = String(e.target.value || "").trim().toLowerCase(); render(); });
  if (el.filterStatus) el.filterStatus.addEventListener("change", (e) => { filterState.status = String(e.target.value || ""); render(); });
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
  bindActionDialog(el.materialItemDialog, [el.materialItemClose, el.materialItemCancel], () => void saveMaterialItemDetail(), el.materialItemSave);
  if (el.materialItemClear) el.materialItemClear.addEventListener("click", clearMaterialItemDetail);
  if (el.materialLineAddBtn) el.materialLineAddBtn.addEventListener("click", () => appendMaterialLineRow("", ""));
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
  if (String(row.isReady || "").trim() === "是") return "材料齐备";
  if (Number(extra.inTransit || 0) > 0) return "在途";
  return "待请购";
}
function isOverdue(row, extra) {
  if (getStatus(row, extra) === "材料齐备") return false;
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
    const overdueOk = !filterState.overdueOnly || isOverdue(row, extra);
    if (!(monthOk && supplierOk && statusOk && overdueOk)) return false;
    if (!filterState.keyword) return true;
    const hay = [row.orderNo, row.customer, row.material, row.spec, extra.supplier, status].join(" ").toLowerCase();
    return hay.includes(filterState.keyword);
  });
}

function render() {
  cleanupExtras();
  const list = getFilteredRows();
  const extraMap = buildExtraMap(list);
  renderOrderHints();
  if (!el.tableBody) return;
  el.tableBody.innerHTML = "";
  list.forEach((row) => {
    const extra = extraMap.get(row.id) || createDefaultExtra();
    const tr = document.createElement("tr");
    tr.appendChild(editCell(row, "orderNo"));
    tr.appendChild(textCell(row.customer || ""));
    tr.appendChild(materialDetailCell(row, extra));
    tr.appendChild(textCell(getStatus(row, extra)));
    tr.appendChild(actionCell(row));
    el.tableBody.appendChild(tr);
  });
}

function materialDetailCell(row, extra) {
  const td = document.createElement("td");
  td.className = "material-detail-cell";
  td.dataset.id = row.id;
  const parsed = parseSpecLines(row.spec, row.quantity);
  const material = String(row.material || "").trim();
  const supplier = String(extra?.supplier || "").trim();
  const lines = parsed.lines.filter((x) => String(x.size || "").trim() || String(x.qty || "").trim());
  if (!material && !supplier && lines.length === 0) {
    td.textContent = "点击填写材质、尺寸、数量、供应商";
  } else {
    const group = document.createElement("div");
    group.className = "material-detail-group";
    const head = document.createElement("div");
    head.className = "material-detail-head";
    head.textContent = [material, supplier].filter(Boolean).join(" / ");
    if (head.textContent) group.appendChild(head);
    lines.forEach((line) => {
      const item = document.createElement("div");
      item.className = "material-detail-line";
      const size = String(line.size || "").trim();
      const qty = String(line.qty ?? "").trim();
      item.textContent = qty ? `${size} x${qty}` : size;
      group.appendChild(item);
    });
    td.appendChild(group);
  }
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "material-detail-add-btn action-btn-secondary";
  addBtn.textContent = "添加";
  addBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMaterialItemDialog(row.id);
  });
  td.appendChild(addBtn);
  td.title = "点击编辑物料明细";
  td.addEventListener("click", () => openMaterialItemDialog(row.id));
  return td;
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

function getMissingOrderHints() {
  const materialOrderNos = new Set(rows.map((r) => String(r.orderNo || "").trim().toUpperCase()).filter(Boolean));
  const hints = [];
  orderCustomerMap.forEach((customer, orderNo) => {
    const normalized = String(orderNo || "").trim().toUpperCase();
    if (!normalized || materialOrderNos.has(normalized)) return;
    hints.push({ orderNo: normalized, customer: String(customer || "").trim() });
  });
  return hints.sort((a, b) => b.orderNo.localeCompare(a.orderNo));
}

function renderOrderHints() {
  if (!orderHintListEl) return;
  orderHintListEl.innerHTML = "";
  const hints = getMissingOrderHints().slice(0, 24);
  if (!hints.length) {
    const li = document.createElement("li");
    li.className = "order-hint-empty";
    li.textContent = "暂无待建采购行的新订单";
    orderHintListEl.appendChild(li);
    return;
  }
  hints.forEach((item) => {
    const li = document.createElement("li");
    li.className = "order-hint-item";
    const text = document.createElement("span");
    text.className = "order-hint-text";
    text.textContent = `${item.orderNo} · ${item.customer || "未识别客户"}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-btn-secondary";
    btn.textContent = "加入采购明细";
    btn.addEventListener("click", () => { void addRowFromOrderHint(item.orderNo, item.customer); });
    li.appendChild(text);
    li.appendChild(btn);
    orderHintListEl.appendChild(li);
  });
}

async function addRowFromOrderHint(orderNo, customer) {
  const next = createEmptyRow();
  next.orderNo = String(orderNo || "").trim().toUpperCase();
  next.customer = String(customer || "").trim();
  rows.push(next);
  saveExtra(next.id, createDefaultExtra());
  await persist({ changed: [next], notifyAuth: false });
  render();
  openMaterialItemDialog(next.id);
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
  rows.push(next);
  saveExtra(next.id, createDefaultExtra());
  await persist({ changed: [next], notifyAuth: false });
  render();
  openMaterialItemDialog(next.id);
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
  const status = left > 0 ? "部分到货" : "材料齐备";
  saveExtra(row.id, { inTransit: left, actualDate: String(el.arrivalDate?.value || "").trim(), status });
  row.quantity = getCurrentStock(row) + qty;
  row.isReady = status === "材料齐备" ? "是" : "否";
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
function refreshBodyOverflow() { const open = [el.authDialog, el.poDialog, el.arrivalDialog, el.abnormalDialog, el.materialItemDialog, el.infoDialog].some((d) => d && !d.hidden); if (!open) document.body.style.overflow = ""; }

function openMaterialItemDialog(rowId) {
  const row = rows.find((r) => r.id === rowId);
  if (!row || !el.materialItemDialog) return;
  const extra = getExtra(rowId);
  materialItemEditingRowId = rowId;
  setSelectValueWithFallback(el.materialInput, String(row.material || ""), "请选择材质");
  const parsed = parseSpecLines(row.spec, row.quantity);
  renderMaterialLineRows(parsed.lines);
  setSelectValueWithFallback(el.materialSupplierInput, String(extra.supplier || ""), "请选择供应商");
  openDialog(el.materialItemDialog);
  if (el.materialInput) el.materialInput.focus();
}

function clearMaterialItemDetail() {
  if (el.materialInput) el.materialInput.value = "";
  renderMaterialLineRows([{ size: "", qty: "" }]);
  if (el.materialSupplierInput) el.materialSupplierInput.value = "";
}

function appendMaterialLineRow(size = "", qty = "") {
  if (!el.materialLineList) return;
  const row = document.createElement("div");
  row.className = "material-line-row";
  const sizeInput = document.createElement("input");
  sizeInput.type = "text";
  sizeInput.className = "material-line-size";
  sizeInput.placeholder = "尺寸";
  sizeInput.value = String(size || "");
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.min = "0";
  qtyInput.step = "1";
  qtyInput.className = "material-line-qty";
  qtyInput.placeholder = "数量";
  qtyInput.value = qty === "" ? "" : String(qty);
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "action-btn";
  removeBtn.textContent = "删除";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!el.materialLineList?.children.length) appendMaterialLineRow("", "");
  });
  row.appendChild(sizeInput);
  row.appendChild(qtyInput);
  row.appendChild(removeBtn);
  el.materialLineList.appendChild(row);
}

function renderMaterialLineRows(lines = []) {
  if (!el.materialLineList) return;
  el.materialLineList.innerHTML = "";
  if (!lines.length) {
    appendMaterialLineRow("", "");
    return;
  }
  lines.forEach((line) => appendMaterialLineRow(line.size, line.qty));
}

function collectMaterialLineRows() {
  if (!el.materialLineList) return [];
  const lines = [];
  el.materialLineList.querySelectorAll(".material-line-row").forEach((rowEl) => {
    const size = String(rowEl.querySelector(".material-line-size")?.value || "").trim();
    const qtyRaw = String(rowEl.querySelector(".material-line-qty")?.value || "").trim();
    const qtyNum = qtyRaw === "" ? NaN : Number(qtyRaw);
    if (!size && !qtyRaw) return;
    lines.push({ size, qty: Number.isFinite(qtyNum) && qtyNum >= 0 ? Math.floor(qtyNum) : null });
  });
  return lines;
}

function parseSpecLines(specValue, qtyValue) {
  const raw = String(specValue || "").trim();
  if (!raw) return { lines: [] };
  if (raw.startsWith(SPEC_LINES_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(SPEC_LINES_PREFIX.length));
      if (Array.isArray(parsed)) {
        return {
          lines: parsed
            .map((x) => ({
              size: String(x?.size || "").trim(),
              qty: Number.isFinite(Number(x?.qty)) ? Math.floor(Math.max(0, Number(x.qty))) : "",
            }))
            .filter((x) => x.size || x.qty !== ""),
        };
      }
    } catch {
      // ignore
    }
  }
  return {
    lines: [{ size: raw, qty: qtyValue === "" ? "" : Number(qtyValue) || "" }],
  };
}

function serializeSpecLines(lines) {
  const normalized = lines
    .map((x) => ({ size: String(x.size || "").trim(), qty: x.qty == null ? "" : x.qty }))
    .filter((x) => x.size || x.qty !== "");
  if (!normalized.length) return { spec: "", quantity: "" };
  if (normalized.length === 1) {
    const one = normalized[0];
    return { spec: one.size, quantity: one.qty === "" ? "" : String(one.qty) };
  }
  const totalQty = normalized.reduce((sum, x) => sum + (x.qty === "" ? 0 : Number(x.qty)), 0);
  return { spec: `${SPEC_LINES_PREFIX}${JSON.stringify(normalized)}`, quantity: String(totalQty) };
}

async function saveMaterialItemDetail() {
  const row = rows.find((r) => r.id === materialItemEditingRowId);
  if (!row) return;
  const material = String(el.materialInput?.value || "").trim();
  const supplier = String(el.materialSupplierInput?.value || "").trim();
  const lines = collectMaterialLineRows();
  if (!lines.length) {
    showInfo("请至少填写一行尺寸和数量。", "校验失败");
    return;
  }
  if (lines.some((line) => !line.size || line.qty == null)) {
    showInfo("每行都需要填写有效的尺寸和数量。", "校验失败");
    return;
  }
  const serialized = serializeSpecLines(lines);
  row.material = material;
  row.spec = serialized.spec;
  row.quantity = serialized.quantity;
  saveExtra(row.id, { supplier });
  await persist({ changed: [row] });
  materialItemEditingRowId = "";
  closeDialog(el.materialItemDialog);
  render();
}

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
    await refreshOrderCustomerMap(false);
    const { data, error } = await db.from("mes_materials").select("*").order("updated_at", { ascending: true });
    if (error) throw error;
    rows = (data || []).map(fromDbRow).map((r) => ({ ...r, customer: resolveCustomer(r.orderNo, r.customer) })).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    await ensureTestRowExists();
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

async function refreshOrderCustomerMap(syncRows = true) {
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
      if (syncRows) await syncCustomerFromOrderMap();
      renderOrderHints();
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
    if (syncRows) await syncCustomerFromOrderMap();
    renderOrderHints();
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
