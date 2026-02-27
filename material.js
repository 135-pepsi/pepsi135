
const STORAGE_KEY = "mini_mes_materials_v2";
const EXTRA_KEY = "mini_mes_materials_extra_v2";
const ORDER_STORAGE_KEY = "mini_mes_orders_v1";
const SUPPLIER_CUSTOM_KEY = "mini_mes_supplier_options_v1";

const MES_CONFIG = window.MES_CONFIG || {};
const REMOTE_ENABLED = Boolean(MES_CONFIG.SUPABASE_URL && MES_CONFIG.SUPABASE_ANON_KEY && window.supabase);
const IS_LOCAL_DEBUG = location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
const AUTO_REFRESH_MS = Math.max(5000, Number(MES_CONFIG.AUTO_REFRESH_SECONDS || 5) * 1000);
const UPLOAD_API_BASE = String(MES_CONFIG.UPLOAD_API_BASE || "").replace(/\/+$/, "");
const UPLOAD_MAX_MB = Math.max(1, Number(MES_CONFIG.UPLOAD_MAX_MB || 50));
const db = REMOTE_ENABLED ? window.supabase.createClient(MES_CONFIG.SUPABASE_URL, MES_CONFIG.SUPABASE_ANON_KEY) : null;

const STATUS_LIST = ["下单", "采购", "到货", "异常"];
const MATERIAL_OPTIONS = ["", "45#钢", "40Cr", "铝6061", "铝7075", "铝2A12", "不锈钢304", "不锈钢316", "铜", "POM", "尼龙"];
const SUPPLIER_BASE_OPTIONS = [""];
const SUPPLIER_BLOCKLIST = new Set(["供应商A", "供应商B", "供应商C", "供应商D", "sdf"]);
let supplierOptions = buildSupplierOptions(loadCustomSupplierOptions());
const SPEC_LINES_PREFIX = "@LINES:";
const MATERIAL_GROUPS_PREFIX = "@MATS:";
const DEFAULT_EXTRA = Object.freeze({
  supplier: "",
  status: "下单",
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
let orderSummaryMap = new Map();
let authSession = null;
let remoteOnline = REMOTE_ENABLED;
let syncing = false;
let reconnectTimer = 0;
let reconnectDelayMs = 5000;
let pageUnloading = false;
let activeRowId = "";
let orderHintListEl = null;
let materialItemEditingRowId = "";
let materialItemEditingGroups = [];
let materialItemEditingGroupIndex = 0;
let otherItemEditingRowId = "";
let otherItemEditingGroupIndex = 0;
let amountEditingRowId = "";
let amountEditingGroupIndex = -1;
let selectedRowId = "";
let supplierCustomBound = false;
let otherScreenshotDataUrl = "";
let screenshotPreviewRenderToken = 0;
const screenshotObjectUrlCache = new Map();

const filterState = {
  month: String(new Date().getMonth() + 1).padStart(2, "0"),
  supplier: "",
  status: "",
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
  imagePreviewDialog: document.getElementById("imagePreviewDialog"),
  imagePreviewClose: document.getElementById("imagePreviewCloseBtn"),
  imagePreviewBody: document.getElementById("imagePreviewBody"),

  amountDialog: document.getElementById("amountEditDialog"),
  amountClose: document.getElementById("amountEditDialogCloseBtn"),
  amountCancel: document.getElementById("amountEditCancelBtn"),
  amountSave: document.getElementById("amountEditSaveBtn"),
  amountInput: document.getElementById("amountEditInput"),

  otherDialog: document.getElementById("otherItemDialog"),
  otherClose: document.getElementById("otherItemDialogCloseBtn"),
  otherCancel: document.getElementById("otherItemCancelBtn"),
  otherSave: document.getElementById("otherItemSaveBtn"),
  otherClear: document.getElementById("otherItemClearBtn"),
  otherNameInput: document.getElementById("otherItemName"),
  otherSupplierInput: document.getElementById("otherItemSupplier"),
  otherLineList: document.getElementById("otherLineList"),
  otherLineAddBtn: document.getElementById("otherLineAddBtn"),
  otherScreenshotInput: document.getElementById("otherScreenshotInput"),
  otherScreenshotPreview: document.getElementById("otherScreenshotPreview"),
  otherScreenshotClearBtn: document.getElementById("otherScreenshotClearBtn"),
  otherScreenshotCaptureBtn: document.getElementById("otherScreenshotCaptureBtn"),
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
  ensureOtherItemDialog();
  ensureAmountEditDialog();
  ensureImagePreviewDialog();
  bindEvents();
  initStatusFilterOptions();
  initSupplierFilterOptions();
  setFilterDefaults();
  rows = loadLocalRows();
  if (REMOTE_ENABLED) {
    await initAuth();
    if (shouldUseLocalOnlyMode()) {
      await refreshOrderCustomerMap();
      await ensureTestRowExists();
      setModeText("本地调试模式（未登录）");
      render();
      setLastSyncTime();
    } else {
      await refreshFromRemote();
      const testAdded = await ensureTestRowExists();
      if (testAdded) render();
    }
    setInterval(() => {
      if (!syncing && remoteOnline && !shouldUseLocalOnlyMode()) void refreshFromRemote(false);
    }, AUTO_REFRESH_MS);
  } else {
    await refreshOrderCustomerMap();
    await ensureTestRowExists();
    setModeText("本地模式");
    render();
    setLastSyncTime();
  }
}

function shouldUseLocalOnlyMode() {
  return IS_LOCAL_DEBUG && !authSession;
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
  bindHeaderActions();
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
      closeDialog(el.otherDialog);
      closeDialog(el.amountDialog);
      closeInfo();
      closeImagePreview();
    }
  });
}

function bindHeaderActions() {
  const addMaterialBtn = document.getElementById("materialHeaderAddMaterialBtn");
  const addOtherBtn = document.getElementById("materialHeaderAddOtherBtn");
  if (addMaterialBtn) addMaterialBtn.addEventListener("click", () => {
    if (!selectedRowId) {
      showInfo("请先点击一行，再使用表头添加。", "提示");
      return;
    }
    void addMaterialForOrderRow(selectedRowId);
  });
  if (addOtherBtn) addOtherBtn.addEventListener("click", () => {
    if (!selectedRowId) {
      showInfo("请先点击一行，再使用表头添加。", "提示");
      return;
    }
    void addOtherForOrderRow(selectedRowId);
  });
}

function syncProcurementTableHeader() {
  const headRow = document.querySelector("#orderTable thead tr");
  if (!headRow) return;
  headRow.innerHTML = `
    <th>订单号</th>
    <th>客户</th>
    <th><div class="material-head-cell"><span>物料</span><div class="material-head-actions"><button id="materialHeaderAddMaterialBtn" class="action-btn-secondary" type="button">添加物料</button><button id="materialHeaderAddOtherBtn" class="action-btn-secondary" type="button">添加其他</button></div></div></th>
    <th>金额</th>
    <th>状态</th>
    <th>操作</th>
    <th>内容简介</th>
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
    bindSupplierCustomAdd();
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
  bindSupplierCustomAdd();
}

function ensureAmountEditDialog() {
  const existing = document.getElementById("amountEditDialog");
  if (existing) {
    el.amountDialog = existing;
    el.amountClose = document.getElementById("amountEditDialogCloseBtn");
    el.amountCancel = document.getElementById("amountEditCancelBtn");
    el.amountSave = document.getElementById("amountEditSaveBtn");
    el.amountInput = document.getElementById("amountEditInput");
    return;
  }
  const dialog = document.createElement("div");
  dialog.id = "amountEditDialog";
  dialog.className = "dialog-backdrop";
  dialog.hidden = true;
  dialog.innerHTML = `
    <section class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="amountEditDialogTitle">
      <header class="dialog-head">
        <h3 id="amountEditDialogTitle">编辑金额</h3>
        <button id="amountEditDialogCloseBtn" class="btn btn-secondary" type="button">关闭</button>
      </header>
      <div class="auth-login-form">
        <label class="auth-login-field">
          <span>购买金额（元）</span>
          <input id="amountEditInput" type="number" min="0" step="0.01" placeholder="请输入金额" />
        </label>
      </div>
      <div class="auth-login-actions">
        <button id="amountEditCancelBtn" class="btn btn-secondary" type="button">取消</button>
        <button id="amountEditSaveBtn" class="btn btn-primary" type="button">保存</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialog);
  el.amountDialog = dialog;
  el.amountClose = document.getElementById("amountEditDialogCloseBtn");
  el.amountCancel = document.getElementById("amountEditCancelBtn");
  el.amountSave = document.getElementById("amountEditSaveBtn");
  el.amountInput = document.getElementById("amountEditInput");
}

function ensureImagePreviewDialog() {
  const existing = document.getElementById("imagePreviewDialog");
  if (existing) {
    el.imagePreviewDialog = existing;
    el.imagePreviewClose = document.getElementById("imagePreviewCloseBtn");
    el.imagePreviewBody = document.getElementById("imagePreviewBody");
    return;
  }
  const dialog = document.createElement("div");
  dialog.id = "imagePreviewDialog";
  dialog.className = "dialog-backdrop";
  dialog.hidden = true;
  dialog.innerHTML = `
    <section class="dialog-panel image-preview-panel" role="dialog" aria-modal="true" aria-labelledby="imagePreviewTitle">
      <header class="dialog-head">
        <h3 id="imagePreviewTitle">截图预览</h3>
        <button id="imagePreviewCloseBtn" class="btn btn-secondary" type="button">关闭</button>
      </header>
      <div id="imagePreviewBody" class="image-preview-body"></div>
    </section>
  `;
  document.body.appendChild(dialog);
  el.imagePreviewDialog = dialog;
  el.imagePreviewClose = document.getElementById("imagePreviewCloseBtn");
  el.imagePreviewBody = document.getElementById("imagePreviewBody");
}

function ensureOtherItemDialog() {
  const existing = document.getElementById("otherItemDialog");
  if (existing) {
    el.otherDialog = existing;
    el.otherClose = document.getElementById("otherItemDialogCloseBtn");
    el.otherCancel = document.getElementById("otherItemCancelBtn");
    el.otherSave = document.getElementById("otherItemSaveBtn");
    el.otherClear = document.getElementById("otherItemClearBtn");
    el.otherNameInput = document.getElementById("otherItemName");
    el.otherSupplierInput = document.getElementById("otherItemSupplier");
    el.otherLineList = document.getElementById("otherLineList");
    el.otherLineAddBtn = document.getElementById("otherLineAddBtn");
    el.otherScreenshotInput = document.getElementById("otherScreenshotInput");
    el.otherScreenshotPreview = document.getElementById("otherScreenshotPreview");
    el.otherScreenshotClearBtn = document.getElementById("otherScreenshotClearBtn");
    el.otherScreenshotCaptureBtn = document.getElementById("otherScreenshotCaptureBtn");
    populateMaterialItemSelects();
    bindSupplierCustomAdd();
    return;
  }
  const dialog = document.createElement("div");
  dialog.id = "otherItemDialog";
  dialog.className = "dialog-backdrop";
  dialog.hidden = true;
  dialog.innerHTML = `
    <section class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="otherItemDialogTitle">
      <header class="dialog-head">
        <h3 id="otherItemDialogTitle">其他采购项</h3>
        <button id="otherItemDialogCloseBtn" class="btn btn-secondary" type="button">关闭</button>
      </header>
      <div class="material-item-grid">
        <div class="material-item-col material-item-col-fixed">
          <label class="auth-login-field"><span>名称</span><input id="otherItemName" type="text" placeholder="请输入名称" /></label>
          <label class="auth-login-field"><span>供应商（自定义）</span><input id="otherItemSupplier" type="text" placeholder="请输入供应商" /></label>
        </div>
        <div class="material-item-col material-item-col-lines">
          <div class="auth-login-field">
            <span>规格与数量</span>
            <div id="otherLineList" class="material-line-list"></div>
            <button id="otherLineAddBtn" class="btn btn-secondary" type="button">新增规格行</button>
          </div>
          <div class="auth-login-field">
            <span>截图</span>
            <input id="otherScreenshotInput" type="file" accept="image/*" />
            <div id="otherScreenshotPreview" class="other-screenshot-preview">未上传截图</div>
            <div class="other-screenshot-actions">
              <button id="otherScreenshotCaptureBtn" class="btn btn-secondary" type="button">截屏</button>
              <button id="otherScreenshotClearBtn" class="btn btn-secondary" type="button">清除截图</button>
            </div>
          </div>
        </div>
      </div>
      <div class="auth-login-actions">
        <button id="otherItemCancelBtn" class="btn btn-secondary" type="button">取消</button>
        <button id="otherItemClearBtn" class="btn btn-secondary" type="button">清空</button>
        <button id="otherItemSaveBtn" class="btn btn-primary" type="button">保存</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialog);
  el.otherDialog = dialog;
  el.otherClose = document.getElementById("otherItemDialogCloseBtn");
  el.otherCancel = document.getElementById("otherItemCancelBtn");
  el.otherSave = document.getElementById("otherItemSaveBtn");
  el.otherClear = document.getElementById("otherItemClearBtn");
  el.otherNameInput = document.getElementById("otherItemName");
  el.otherSupplierInput = document.getElementById("otherItemSupplier");
  el.otherLineList = document.getElementById("otherLineList");
  el.otherLineAddBtn = document.getElementById("otherLineAddBtn");
  el.otherScreenshotInput = document.getElementById("otherScreenshotInput");
  el.otherScreenshotPreview = document.getElementById("otherScreenshotPreview");
  el.otherScreenshotClearBtn = document.getElementById("otherScreenshotClearBtn");
  el.otherScreenshotCaptureBtn = document.getElementById("otherScreenshotCaptureBtn");
  populateMaterialItemSelects();
  bindSupplierCustomAdd();
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
    supplierOptions.forEach((name, idx) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = idx === 0 ? "请选择供应商" : name;
      el.materialSupplierInput.appendChild(option);
    });
    const customOption = document.createElement("option");
    customOption.value = "__custom__";
    customOption.textContent = "＋ 自定义供应商";
    el.materialSupplierInput.appendChild(customOption);
  }
}

function bindSupplierCustomAdd() {
  if (!el.materialSupplierInput || supplierCustomBound) return;
  supplierCustomBound = true;
  el.materialSupplierInput.addEventListener("change", () => {
    if (el.materialSupplierInput.value !== "__custom__") return;
    const input = prompt("请输入新的供应商名称");
    const name = String(input || "").trim();
    if (!name) {
      el.materialSupplierInput.value = "";
      return;
    }
    addCustomSupplierOption(name);
    populateMaterialItemSelects();
    setSelectValueWithFallback(el.materialSupplierInput, name, "请选择供应商");
  });
}

function loadCustomSupplierOptions() {
  const raw = localStorage.getItem(SUPPLIER_CUSTOM_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list
        .map((x) => String(x || "").trim())
        .filter((x) => x && !SUPPLIER_BLOCKLIST.has(x))
      : [];
  } catch {
    return [];
  }
}

function saveCustomSupplierOptions() {
  const custom = supplierOptions.filter((name) => name && !SUPPLIER_BASE_OPTIONS.includes(name) && !SUPPLIER_BLOCKLIST.has(name));
  localStorage.setItem(SUPPLIER_CUSTOM_KEY, JSON.stringify(custom));
}

function buildSupplierOptions(customList = []) {
  const set = new Set(SUPPLIER_BASE_OPTIONS);
  customList.forEach((name) => {
    const v = String(name || "").trim();
    if (v && !SUPPLIER_BLOCKLIST.has(v)) set.add(v);
  });
  return Array.from(set);
}

function addCustomSupplierOption(name) {
  const v = String(name || "").trim();
  if (!v) return;
  if (SUPPLIER_BLOCKLIST.has(v)) return;
  if (!supplierOptions.includes(v)) {
    supplierOptions.push(v);
    saveCustomSupplierOptions();
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

function collectSupplierFilterOptions() {
  const set = new Set();
  supplierOptions.forEach((name) => {
    const v = String(name || "").trim();
    if (v) set.add(v);
  });
  rows.forEach((row) => {
    const extra = getExtra(row.id);
    const merged = [String(extra?.supplier || "").trim()];
    parseMaterialGroups(row, extra).forEach((g) => merged.push(String(g?.supplier || "").trim()));
    merged.forEach((v) => { if (v) set.add(v); });
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function initSupplierFilterOptions() {
  if (!el.filterSupplier) return;
  const current = String(el.filterSupplier.value || "").trim();
  const list = collectSupplierFilterOptions();
  el.filterSupplier.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部";
  el.filterSupplier.appendChild(all);
  list.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    el.filterSupplier.appendChild(option);
  });
  el.filterSupplier.value = list.includes(current) ? current : "";
  filterState.supplier = String(el.filterSupplier.value || "").trim().toLowerCase();
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
  if (el.filterSupplier) el.filterSupplier.addEventListener("change", (e) => { filterState.supplier = String(e.target.value || "").trim().toLowerCase(); render(); });
  if (el.filterStatus) el.filterStatus.addEventListener("change", (e) => { filterState.status = String(e.target.value || ""); render(); });
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
  bindActionDialog(el.otherDialog, [el.otherClose, el.otherCancel], () => void saveOtherItemDetail(), el.otherSave);
  bindActionDialog(el.amountDialog, [el.amountClose, el.amountCancel], () => void saveAmountEditDialog(), el.amountSave);
  if (el.materialItemClear) el.materialItemClear.addEventListener("click", clearMaterialItemDetail);
  if (el.otherClear) el.otherClear.addEventListener("click", clearOtherItemDetail);
  if (el.materialLineAddBtn) el.materialLineAddBtn.addEventListener("click", () => appendMaterialLineRow("", ""));
  if (el.otherLineAddBtn) el.otherLineAddBtn.addEventListener("click", () => appendOtherLineRow("", ""));
  if (el.otherScreenshotInput) el.otherScreenshotInput.addEventListener("change", () => void handleOtherScreenshotChange());
  if (el.otherScreenshotClearBtn) el.otherScreenshotClearBtn.addEventListener("click", clearOtherScreenshot);
  if (el.otherScreenshotCaptureBtn) el.otherScreenshotCaptureBtn.addEventListener("click", () => void captureOtherScreenshot());
  if (el.infoClose) el.infoClose.addEventListener("click", closeInfo);
  if (el.infoOk) el.infoOk.addEventListener("click", closeInfo);
  if (el.infoDialog) el.infoDialog.addEventListener("click", (e) => { if (e.target === el.infoDialog) closeInfo(); });
  if (el.imagePreviewClose) el.imagePreviewClose.addEventListener("click", closeImagePreview);
  if (el.imagePreviewDialog) el.imagePreviewDialog.addEventListener("click", (e) => { if (e.target === el.imagePreviewDialog) closeImagePreview(); });
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

function normalizeStatus(value, row, extra) {
  const raw = String(value || "").trim();
  if (raw === "下单" || raw === "采购" || raw === "到货" || raw === "异常") return raw;
  if (raw === "待采购") return "下单";
  if (raw === "发货中") return "采购";
  if (raw === "已到货") return "到货";
  if (raw === "待请购" || raw === "待下单") return "下单";
  if (raw === "在途" || raw === "部分到货") return "采购";
  if (raw === "材料齐备") return "到货";
  if (String(row?.isReady || "").trim() === "是") return "到货";
  if (Number(extra?.inTransit || 0) > 0) return "采购";
  return "下单";
}

function getStatus(row, extra) {
  const groups = parseMaterialGroups(row, extra);
  if (!groups.length) return normalizeStatus(extra?.status, row, extra);
  const statuses = groups.map((g) => normalizeStatus(g?.status, row, extra));
  if (statuses.some((s) => s === "异常")) return "异常";
  if (statuses.every((s) => s === "到货")) return "到货";
  if (statuses.some((s) => s === "采购")) return "采购";
  return "下单";
}
function isOverdue(row, extra) {
  if (getStatus(row, extra) === "到货") return false;
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
    const supplierText = getSupplierFilterText(row, extra);
    const monthOk = !filterState.month || getMonthFromOrderNo(row.orderNo) === filterState.month;
    const supplierOk = !filterState.supplier || supplierText.split(/\s+/).includes(filterState.supplier);
    const statusOk = !filterState.status || status === filterState.status;
    return monthOk && supplierOk && statusOk;
  });
}

function getOrderSummary(orderNo, fallback = "") {
  const key = String(orderNo || "").trim().toUpperCase();
  const mapped = key ? String(orderSummaryMap.get(key) || "").trim() : "";
  return mapped || String(fallback || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateTimeText(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function buildContentSummary(row, extra) {
  const orderNo = String(row.orderNo || "").trim();
  const customer = String(row.customer || "").trim();
  const groups = parseMaterialGroups(row, extra);
  const header = [
    `订单号: ${orderNo || "-"}`,
    `客户: ${customer || "-"}`,
  ];
  if (!groups.length) {
    const fallback = getOrderSummary(row.orderNo, row.summary || "");
    return [...header, `物料内容: ${fallback || "-"}`].join(" | ");
  }
  const body = groups.map((g, idx) => {
    const status = normalizeStatus(g?.status, row, extra);
    const amount = g?.amount === "" || g?.amount == null ? "-" : formatCurrency(g.amount);
    const lineText = (Array.isArray(g.lines) ? g.lines : [])
      .map((line) => {
        const size = String(line?.size || "").trim();
        const qty = line?.qty === "" || line?.qty == null ? "" : `${line.qty}件`;
        return [size, qty].filter(Boolean).join(" ");
      })
      .filter(Boolean)
      .join("、");
    const purchasedAtText = `采购时间:${formatDateTimeText(g?.purchasedAt) || "-"}`;
    const arrivedAtText = status === "异常" ? "" : ` | 到货时间:${formatDateTimeText(g?.arrivedAt) || "-"}`;
    return `${idx + 1}.${[String(g.material || "").trim(), lineText].filter(Boolean).join(" ")} | 金额:${amount} | 状态:${status} | ${purchasedAtText}${arrivedAtText}`;
  });
  return [...header, ...body].join("\n");
}

function getSupplierFilterText(row, extra) {
  const groups = parseMaterialGroups(row, extra);
  const supplierList = groups.map((g) => String(g.supplier || "").trim()).filter(Boolean);
  const merged = [String(extra?.supplier || "").trim(), ...supplierList].filter(Boolean);
  return merged.join(" ").toLowerCase();
}

function render() {
  cleanupExtras();
  initSupplierFilterOptions();
  const list = getFilteredRows();
  const extraMap = buildExtraMap(list);
  renderOrderHints();
  if (!el.tableBody) return;
  el.tableBody.innerHTML = "";
  list.forEach((row) => {
    const extra = extraMap.get(row.id) || createDefaultExtra();
    const tr = document.createElement("tr");
    tr.addEventListener("click", () => {
      selectedRowId = row.id;
      render();
    });
    if (selectedRowId === row.id) tr.classList.add("material-row-selected");
    tr.appendChild(editCell(row, "orderNo"));
    tr.appendChild(textCell(row.customer || ""));
    tr.appendChild(materialDetailCell(row, extra));
    tr.appendChild(amountDetailCell(row, extra));
    tr.appendChild(statusDetailCell(row, extra));
    tr.appendChild(actionDetailCell(row, extra));
    tr.appendChild(summaryCell(buildContentSummary(row, extra)));
    el.tableBody.appendChild(tr);
  });
  requestAnimationFrame(syncGroupHeights);
}

function summaryCell(text) {
  const td = document.createElement("td");
  td.className = "material-summary-cell";
  td.textContent = String(text || "");
  td.title = "可选中后复制";
  // Keep text selection stable: avoid row click re-render when selecting/copying summary text.
  ["mousedown", "mouseup", "click", "dblclick"].forEach((evt) => {
    td.addEventListener(evt, (event) => event.stopPropagation());
  });
  return td;
}

function amountDetailCell(row, extra) {
  const td = document.createElement("td");
  td.className = "material-amount-cell";
  const groups = parseMaterialGroups(row, extra);
  if (!groups.length) {
    td.textContent = "未填写";
    return td;
  }
  groups.forEach((g, idx) => {
    const group = document.createElement("div");
    group.className = "material-amount-group";
    if (idx > 0) group.classList.add("is-group-gap");
    const value = Number(g.amount);
    const amountText = document.createElement("div");
    amountText.className = "material-amount-value";
    amountText.textContent = Number.isFinite(value) && value >= 0 ? formatCurrency(value) : "未填写";
    const groupActions = document.createElement("div");
    groupActions.className = "material-detail-group-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "material-icon-btn";
    editBtn.setAttribute("aria-label", "编辑");
    editBtn.title = "编辑";
    editBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void editGroupAmount(row.id, idx);
    });
    groupActions.appendChild(editBtn);
    group.appendChild(amountText);
    group.appendChild(groupActions);
    td.appendChild(group);
  });
  return td;
}

async function editGroupAmount(rowId, groupIndex) {
  const row = rows.find((r) => r.id === rowId);
  if (!row) return;
  const extra = getExtra(rowId);
  const groups = parseMaterialGroups(row, extra);
  if (!groups[groupIndex]) return;
  amountEditingRowId = rowId;
  amountEditingGroupIndex = groupIndex;
  if (el.amountInput) {
    const current = groups[groupIndex].amount == null || groups[groupIndex].amount === "" ? "" : String(groups[groupIndex].amount);
    el.amountInput.value = current;
  }
  openDialog(el.amountDialog);
  if (el.amountInput) el.amountInput.focus();
}

async function saveAmountEditDialog() {
  const row = rows.find((r) => r.id === amountEditingRowId);
  if (!row) return;
  const extra = getExtra(amountEditingRowId);
  const groups = parseMaterialGroups(row, extra);
  if (!groups[amountEditingGroupIndex]) return;
  const trimmed = String(el.amountInput?.value || "").trim();
  if (!trimmed) {
    groups[amountEditingGroupIndex].amount = "";
  } else {
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) {
      showInfo("金额必须是大于等于 0 的数字。", "校验失败");
      return;
    }
    groups[amountEditingGroupIndex].amount = Number(value.toFixed(2));
  }
  const serialized = serializeMaterialGroups(groups);
  row.material = serialized.material;
  row.spec = serialized.spec;
  row.quantity = serialized.quantity;
  row.amount = serialized.amount;
  saveExtra(row.id, { supplier: serialized.supplier });
  await persist({ changed: [row] });
  amountEditingRowId = "";
  amountEditingGroupIndex = -1;
  closeDialog(el.amountDialog);
  render();
}

function statusDetailCell(row, extra) {
  const td = document.createElement("td");
  td.className = "material-status-cell";
  const groups = parseMaterialGroups(row, extra);
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "material-status-group";
    empty.textContent = "下单";
    td.appendChild(empty);
    return td;
  }
  groups.forEach((g, idx) => {
    const group = document.createElement("div");
    group.className = "material-status-group";
    if (idx > 0) group.classList.add("is-group-gap");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-btn-secondary material-status-btn";
    const statusText = normalizeStatus(g?.status, row, extra);
    btn.textContent = statusText;
    btn.dataset.status = statusText;
    btn.title = "点击切换状态";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void cycleGroupStatus(row.id, idx);
    });
    group.appendChild(btn);
    td.appendChild(group);
  });
  return td;
}

async function cycleGroupStatus(rowId, groupIndex) {
  const row = rows.find((r) => r.id === rowId);
  if (!row) return;
  const extra = getExtra(row.id);
  const groups = parseMaterialGroups(row, extra);
  if (!groups[groupIndex]) return;
  const current = normalizeStatus(groups[groupIndex]?.status, row, extra);
  const idx = STATUS_LIST.indexOf(current);
  const next = STATUS_LIST[(idx + 1) % STATUS_LIST.length] || STATUS_LIST[0];
  groups[groupIndex].status = next;
  if (next === "采购" && !groups[groupIndex].purchasedAt) groups[groupIndex].purchasedAt = nowIso();
  if (next === "到货") groups[groupIndex].arrivedAt = nowIso();
  const serialized = serializeMaterialGroups(groups);
  row.material = serialized.material;
  row.spec = serialized.spec;
  row.quantity = serialized.quantity;
  row.amount = serialized.amount;
  const allArrived = groups.every((g) => normalizeStatus(g?.status, row, extra) === "到货");
  row.isReady = allArrived ? "是" : "否";
  const hasAbnormal = groups.some((g) => normalizeStatus(g?.status, row, extra) === "异常");
  const hasPurchased = groups.some((g) => normalizeStatus(g?.status, row, extra) === "采购");
  const hasOrdered = groups.some((g) => normalizeStatus(g?.status, row, extra) === "下单");
  saveExtra(row.id, {
    supplier: serialized.supplier,
    status: hasAbnormal ? "异常" : allArrived ? "到货" : hasPurchased ? "采购" : hasOrdered ? "下单" : "下单",
  });
  await persist({ changed: [row], notifyAuth: false });
  render();
}

function materialDetailCell(row, extra) {
  const td = document.createElement("td");
  td.className = "material-detail-cell";
  td.dataset.id = row.id;
  const groups = parseMaterialGroups(row, extra);
  const hasContent = groups.some((g) => g.material || g.supplier || g.lines.some((x) => x.size || x.qty !== ""));
  if (!hasContent) {
    const empty = document.createElement("div");
    empty.className = "material-detail-group";
    const emptyLine = document.createElement("div");
    emptyLine.className = "material-detail-line";
    emptyLine.textContent = "点击填写材质、尺寸、数量、供应商";
    empty.appendChild(emptyLine);
    const groupActions = document.createElement("div");
    groupActions.className = "material-detail-group-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "material-icon-btn";
    editBtn.setAttribute("aria-label", "编辑");
    editBtn.title = "编辑";
    editBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMaterialItemDialog(row.id, { groupIndex: 0 });
    });
    groupActions.appendChild(editBtn);
    empty.appendChild(groupActions);
    td.appendChild(empty);
  } else {
    groups.forEach((g, idx) => {
      const group = document.createElement("div");
      group.className = "material-detail-group";
      const screenshot = String(g?.screenshot || "").trim();
      if (screenshot) {
        group.classList.add("is-clickable");
        group.title = "点击预览截图";
        group.addEventListener("click", (event) => {
          const target = event.target;
          if (target instanceof HTMLElement && target.closest(".material-detail-group-actions")) return;
          void openImagePreview(screenshot);
        });
      }
      const head = document.createElement("div");
      head.className = "material-detail-head";
      head.textContent = [g.material, g.supplier].filter(Boolean).join(" / ");
      if (head.textContent) group.appendChild(head);
      g.lines.forEach((line) => {
        const item = document.createElement("div");
        item.className = "material-detail-line";
        const size = String(line.size || "").trim();
        const qty = String(line.qty ?? "").trim();
        const sizeText = document.createElement("span");
        sizeText.className = "material-detail-size";
        sizeText.textContent = size;
        item.appendChild(sizeText);
        const qtyTag = document.createElement("span");
        qtyTag.className = "material-detail-qty";
        if (qty) {
          qtyTag.textContent = `${qty}件`;
        } else {
          qtyTag.classList.add("is-empty");
          qtyTag.textContent = "-";
        }
        item.appendChild(qtyTag);
        group.appendChild(item);
      });
      const groupActions = document.createElement("div");
      groupActions.className = "material-detail-group-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "material-icon-btn";
      editBtn.setAttribute("aria-label", "编辑");
      editBtn.title = "编辑";
      editBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const kind = String(g?.itemKind || "material");
        if (kind === "other") {
          openOtherItemDialog(row.id, { groupIndex: idx });
        } else {
          openMaterialItemDialog(row.id, { groupIndex: idx });
        }
      });
      groupActions.appendChild(editBtn);
      group.appendChild(groupActions);
      if (idx > 0) group.classList.add("is-group-gap");
      td.appendChild(group);
    });
  }
  td.title = "";
  return td;
}

async function addMaterialForOrderRow(sourceRowId) {
  openMaterialItemDialog(sourceRowId, { appendGroup: true });
}

async function addOtherForOrderRow(sourceRowId) {
  openOtherItemDialog(sourceRowId, { appendGroup: true });
}

function renderKpi(list, extraMap = new Map()) {
  const getRowExtra = (row) => extraMap.get(row.id) || createDefaultExtra();
  const needOrder = list.filter((r) => getStatus(r, getRowExtra(r)) === "下单").length;
  const inTransit = list.filter((r) => getStatus(r, getRowExtra(r)) === "采购").length;
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

function actionDetailCell(row, extra) {
  const td = document.createElement("td");
  td.className = "material-op-cell";
  const groups = parseMaterialGroups(row, extra);
  if (!groups.length) {
    const group = document.createElement("div");
    group.className = "material-op-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-btn";
    btn.textContent = "删除";
    btn.addEventListener("click", () => void deleteRow(row.id));
    group.appendChild(btn);
    td.appendChild(group);
    return td;
  }
  groups.forEach((g, idx) => {
    const group = document.createElement("div");
    group.className = "material-op-group";
    if (idx > 0) group.classList.add("is-group-gap");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-btn";
    btn.textContent = "删除";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void deleteMaterialGroup(row.id, idx);
    });
    group.appendChild(btn);
    td.appendChild(group);
  });
  return td;
}

async function deleteMaterialGroup(rowId, groupIndex) {
  const row = rows.find((r) => r.id === rowId);
  if (!row) return;
  const extra = getExtra(row.id);
  const groups = parseMaterialGroups(row, extra);
  if (!groups[groupIndex]) return;
  if (!confirm("确认删除该物料分组吗？")) return;
  groups.splice(groupIndex, 1);
  if (!groups.length) {
    await deleteRow(row.id);
    return;
  }
  const serialized = serializeMaterialGroups(groups);
  row.material = serialized.material;
  row.spec = serialized.spec;
  row.quantity = serialized.quantity;
  row.amount = serialized.amount;
  const allArrived = groups.every((g) => normalizeStatus(g?.status, row, extra) === "到货");
  const hasAbnormal = groups.some((g) => normalizeStatus(g?.status, row, extra) === "异常");
  const hasPurchased = groups.some((g) => normalizeStatus(g?.status, row, extra) === "采购");
  const hasOrdered = groups.some((g) => normalizeStatus(g?.status, row, extra) === "下单");
  row.isReady = allArrived ? "是" : "否";
  saveExtra(row.id, {
    supplier: serialized.supplier,
    status: hasAbnormal ? "异常" : allArrived ? "到货" : hasPurchased ? "采购" : hasOrdered ? "下单" : "下单",
  });
  await persist({ changed: [row], notifyAuth: false });
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
  const extra = getExtra(row.id);
  const groups = parseMaterialGroups(row, extra);
  groups.forEach((g) => {
    g.status = "采购";
    if (!g.purchasedAt) g.purchasedAt = nowIso();
  });
  const serialized = serializeMaterialGroups(groups);
  row.material = serialized.material;
  row.spec = serialized.spec;
  row.quantity = serialized.quantity;
  row.amount = serialized.amount;
  saveExtra(row.id, {
    supplier: String(el.poSupplier?.value || "").trim(),
    promiseDate: String(el.poPromise?.value || "").trim(),
    inTransit: Math.max(0, Number(old.inTransit || 0) + qty),
    lastOrderQty: qty,
    lastOrderPrice: price,
    status: "采购",
  });
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
  const status = left > 0 ? "采购" : "到货";
  const extra = getExtra(row.id);
  const groups = parseMaterialGroups(row, extra);
  groups.forEach((g) => {
    g.status = status;
    if (status === "到货") g.arrivedAt = nowIso();
  });
  const serialized = serializeMaterialGroups(groups);
  row.material = serialized.material;
  row.spec = serialized.spec;
  row.quantity = serialized.quantity;
  row.amount = serialized.amount;
  saveExtra(row.id, { inTransit: left, actualDate: String(el.arrivalDate?.value || "").trim(), status });
  row.quantity = getCurrentStock(row) + qty;
  row.isReady = status === "到货" ? "是" : "否";
  await persist({ changed: [row] });
  closeDialog(el.arrivalDialog);
  render();
}

function openAbnormalDialog(id) { activeRowId = id; const e = getExtra(id); if (el.abnormalReason) el.abnormalReason.value = e.abnormalReason || ""; if (el.abnormalAlt) el.abnormalAlt.value = e.abnormalAltMaterial || ""; if (el.abnormalRecover) el.abnormalRecover.value = e.abnormalRecoverDate || ""; openDialog(el.abnormalDialog); }
async function saveAbnormal() {
  const row = rows.find((r) => r.id === activeRowId);
  if (!row) return;
  const extra = getExtra(row.id);
  const groups = parseMaterialGroups(row, extra);
  groups.forEach((g) => { g.status = "异常"; });
  const serialized = serializeMaterialGroups(groups);
  row.material = serialized.material;
  row.spec = serialized.spec;
  row.quantity = serialized.quantity;
  row.amount = serialized.amount;
  row.isReady = "否";
  saveExtra(row.id, { abnormalReason: String(el.abnormalReason?.value || "").trim(), abnormalAltMaterial: String(el.abnormalAlt?.value || "").trim(), abnormalRecoverDate: String(el.abnormalRecover?.value || "").trim(), status: "异常" });
  await persist({ changed: [row], notifyAuth: false });
  closeDialog(el.abnormalDialog);
  render();
}

function openDialog(d) { if (!d) return; d.hidden = false; document.body.style.overflow = "hidden"; }
function closeDialog(d) { if (!d) return; d.hidden = true; refreshBodyOverflow(); }
function refreshBodyOverflow() { const open = [el.authDialog, el.poDialog, el.arrivalDialog, el.abnormalDialog, el.materialItemDialog, el.otherDialog, el.amountDialog, el.infoDialog, el.imagePreviewDialog].some((d) => d && !d.hidden); if (!open) document.body.style.overflow = ""; }

async function openImagePreview(dataUrl) {
  if (!el.imagePreviewDialog || !el.imagePreviewBody) return;
  const src = await resolveScreenshotPreviewSrc(dataUrl);
  if (!src) {
    showInfo("截图预览加载失败。", "提示");
    return;
  }
  el.imagePreviewBody.innerHTML = "";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "截图预览";
  img.loading = "lazy";
  el.imagePreviewBody.appendChild(img);
  openDialog(el.imagePreviewDialog);
}

function closeImagePreview() {
  if (el.imagePreviewBody) el.imagePreviewBody.innerHTML = "";
  closeDialog(el.imagePreviewDialog);
}

function syncGroupHeights() {
  if (!el.tableBody) return;
  const wrapRect = el.tableWrap?.getBoundingClientRect?.() || null;
  const visiblePadding = 120;
  el.tableBody.querySelectorAll("tr").forEach((tr) => {
    if (wrapRect) {
      const rect = tr.getBoundingClientRect();
      if (rect.bottom < wrapRect.top - visiblePadding || rect.top > wrapRect.bottom + visiblePadding) return;
    }
    const materialGroups = tr.querySelectorAll("td:nth-child(3) .material-detail-group");
    const amountGroups = tr.querySelectorAll("td:nth-child(4) .material-amount-group");
    const statusGroups = tr.querySelectorAll("td:nth-child(5) .material-status-group");
    const opGroups = tr.querySelectorAll("td:nth-child(6) .material-op-group");
    if (!materialGroups.length || !amountGroups.length || !statusGroups.length || !opGroups.length) return;
    const count = Math.min(materialGroups.length, amountGroups.length, statusGroups.length, opGroups.length);
    for (let i = 0; i < count; i += 1) {
      const m = materialGroups[i];
      const a = amountGroups[i];
      const s = statusGroups[i];
      const o = opGroups[i];
      m.style.minHeight = "";
      a.style.minHeight = "";
      s.style.minHeight = "";
      o.style.minHeight = "";
      const height = Math.max(m.offsetHeight, a.offsetHeight, s.offsetHeight, o.offsetHeight);
      m.style.minHeight = `${height}px`;
      a.style.minHeight = `${height}px`;
      s.style.minHeight = `${height}px`;
      o.style.minHeight = `${height}px`;
    }
  });
}

function openMaterialItemDialog(rowId, options = {}) {
  const row = rows.find((r) => r.id === rowId);
  if (!row || !el.materialItemDialog) return;
  const extra = getExtra(rowId);
  materialItemEditingRowId = rowId;
  const groups = parseMaterialGroups(row, extra);
  materialItemEditingGroups = groups.map((g) => ({ ...g, lines: g.lines.map((line) => ({ ...line })) }));
  if (options.appendGroup) {
    materialItemEditingGroups.push(createEmptyMaterialGroup("material"));
    materialItemEditingGroupIndex = materialItemEditingGroups.length - 1;
  } else {
    materialItemEditingGroupIndex = Math.min(Math.max(0, Number(options.groupIndex || 0)), Math.max(0, materialItemEditingGroups.length - 1));
  }
  const currentGroup = materialItemEditingGroups[materialItemEditingGroupIndex] || createEmptyMaterialGroup();
  const currentMaterial = String(currentGroup.material || "");
  setSelectValueWithFallback(el.materialInput, currentMaterial, "请选择材质");
  renderMaterialLineRows(currentGroup.lines);
  setSelectValueWithFallback(el.materialSupplierInput, String(currentGroup.supplier || ""), "请选择供应商");
  openDialog(el.materialItemDialog);
  if (el.materialInput) el.materialInput.focus();
}

function clearMaterialItemDetail() {
  if (el.materialInput) el.materialInput.value = "";
  renderMaterialLineRows([{ size: "", qty: "" }]);
  if (el.materialSupplierInput) el.materialSupplierInput.value = "";
}

function createEmptyMaterialGroup(kind = "material") {
  return { itemKind: kind, material: "", supplier: "", amount: "", status: "下单", purchasedAt: "", arrivedAt: "", screenshot: "", lines: [{ size: "", qty: "" }] };
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

function appendOtherLineRow(size = "", qty = "") {
  if (!el.otherLineList) return;
  const row = document.createElement("div");
  row.className = "material-line-row";
  const sizeInput = document.createElement("input");
  sizeInput.type = "text";
  sizeInput.className = "other-line-size";
  sizeInput.placeholder = "规格";
  sizeInput.value = String(size || "");
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.min = "0";
  qtyInput.step = "1";
  qtyInput.className = "other-line-qty";
  qtyInput.placeholder = "数量";
  qtyInput.value = qty === "" ? "" : String(qty);
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "action-btn";
  removeBtn.textContent = "删除";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!el.otherLineList?.children.length) appendOtherLineRow("", "");
  });
  row.appendChild(sizeInput);
  row.appendChild(qtyInput);
  row.appendChild(removeBtn);
  el.otherLineList.appendChild(row);
}

function renderOtherLineRows(lines = []) {
  if (!el.otherLineList) return;
  el.otherLineList.innerHTML = "";
  if (!lines.length) {
    appendOtherLineRow("", "");
    return;
  }
  lines.forEach((line) => appendOtherLineRow(line.size, line.qty));
}

function collectOtherLineRows() {
  if (!el.otherLineList) return [];
  const lines = [];
  el.otherLineList.querySelectorAll(".material-line-row").forEach((rowEl) => {
    const size = String(rowEl.querySelector(".other-line-size")?.value || "").trim();
    const qtyRaw = String(rowEl.querySelector(".other-line-qty")?.value || "").trim();
    const qtyNum = qtyRaw === "" ? NaN : Number(qtyRaw);
    if (!size && !qtyRaw) return;
    lines.push({ size, qty: Number.isFinite(qtyNum) && qtyNum >= 0 ? Math.floor(qtyNum) : null });
  });
  return lines;
}

function openOtherItemDialog(rowId, options = {}) {
  const row = rows.find((r) => r.id === rowId);
  if (!row || !el.otherDialog) return;
  const extra = getExtra(rowId);
  const groups = parseMaterialGroups(row, extra).map((g) => ({ ...g, lines: g.lines.map((line) => ({ ...line })) }));
  if (options.appendGroup) {
    groups.push(createEmptyMaterialGroup("other"));
    otherItemEditingGroupIndex = groups.length - 1;
  } else {
    otherItemEditingGroupIndex = Math.min(Math.max(0, Number(options.groupIndex || 0)), Math.max(0, groups.length - 1));
  }
  const currentGroup = groups[otherItemEditingGroupIndex] || createEmptyMaterialGroup("other");
  otherItemEditingRowId = rowId;
  materialItemEditingGroups = groups;
  if (el.otherNameInput) el.otherNameInput.value = String(currentGroup.material || "");
  if (el.otherSupplierInput) el.otherSupplierInput.value = String(currentGroup.supplier || "");
  otherScreenshotDataUrl = String(currentGroup.screenshot || "");
  void renderOtherScreenshotPreview();
  if (el.otherScreenshotInput) el.otherScreenshotInput.value = "";
  renderOtherLineRows(currentGroup.lines);
  openDialog(el.otherDialog);
  if (el.otherNameInput) el.otherNameInput.focus();
}

function clearOtherItemDetail() {
  if (el.otherNameInput) el.otherNameInput.value = "";
  if (el.otherSupplierInput) el.otherSupplierInput.value = "";
  clearOtherScreenshot();
  renderOtherLineRows([{ size: "", qty: "" }]);
}

async function handleOtherScreenshotChange() {
  const file = el.otherScreenshotInput?.files?.[0];
  if (!file) return;
  await setOtherScreenshotFromFile(file);
}

async function captureOtherScreenshot() {
  if (!window.isSecureContext) {
    showInfo("当前环境不支持截屏，请使用文件上传。", "功能受限");
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showInfo("当前浏览器不支持截屏，请使用文件上传。", "功能受限");
    return;
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: false });
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error("截图尺寸无效");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("截图上下文创建失败");
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
    if (!blob) throw new Error("截图生成失败");
    const row = rows.find((r) => r.id === otherItemEditingRowId);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `material_screenshot_${row?.orderNo || row?.id || "row"}_${ts}.png`;
    const file = new File([blob], fileName, { type: "image/png" });
    await setOtherScreenshotFromFile(file);
    if (el.otherScreenshotInput) el.otherScreenshotInput.value = "";
  } catch (e) {
    const name = String(e?.name || "");
    if (name !== "NotAllowedError" && name !== "AbortError") {
      showInfo("截屏失败，请重试或使用文件上传。", "错误");
    }
  } finally {
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }
}

function clearOtherScreenshot() {
  otherScreenshotDataUrl = "";
  if (el.otherScreenshotInput) el.otherScreenshotInput.value = "";
  void renderOtherScreenshotPreview();
}

async function renderOtherScreenshotPreview() {
  if (!el.otherScreenshotPreview) return;
  const token = ++screenshotPreviewRenderToken;
  el.otherScreenshotPreview.innerHTML = "";
  if (!otherScreenshotDataUrl) {
    el.otherScreenshotPreview.textContent = "未上传截图";
    return;
  }
  const previewSrc = await resolveScreenshotPreviewSrc(otherScreenshotDataUrl);
  if (token !== screenshotPreviewRenderToken) return;
  if (!previewSrc) {
    el.otherScreenshotPreview.textContent = "截图预览加载失败";
    return;
  }
  const img = document.createElement("img");
  img.src = previewSrc;
  img.alt = "截图预览";
  img.loading = "lazy";
  el.otherScreenshotPreview.appendChild(img);
}

async function setOtherScreenshotFromFile(file) {
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    showInfo("请上传图片文件。", "校验失败");
    if (el.otherScreenshotInput) el.otherScreenshotInput.value = "";
    return;
  }
  const maxBytes = UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    showInfo(`截图大小不能超过 ${UPLOAD_MAX_MB}MB。`, "校验失败");
    if (el.otherScreenshotInput) el.otherScreenshotInput.value = "";
    return;
  }

  const row = rows.find((r) => r.id === otherItemEditingRowId);
  if (UPLOAD_API_BASE && row) {
    try {
      const uploadedRef = await uploadScreenshotToNas(row, file);
      if (uploadedRef) {
        otherScreenshotDataUrl = uploadedRef;
        await renderOtherScreenshotPreview();
        return;
      }
    } catch (e) {
      console.warn("截图上传 NAS 失败，将回退本地预览", e);
      showInfo("NAS 上传失败，已临时保存到本地。", "提示");
    }
  }
  if (!UPLOAD_API_BASE) {
    showInfo("未配置 NAS 上传服务，截图将仅保存在当前浏览器。", "提示");
  }

  const dataUrl = await readFileAsDataUrl(file);
  otherScreenshotDataUrl = String(dataUrl || "");
  await renderOtherScreenshotPreview();
}

async function readFileAsDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取截图失败"));
    reader.readAsDataURL(file);
  }).catch(() => "");
}

async function uploadScreenshotToNas(row, file) {
  if (!UPLOAD_API_BASE) return "";
  const form = new FormData();
  form.append("orderId", String(row.id || ""));
  form.append("lineId", String(row.id || ""));
  form.append("orderNo", String(row.orderNo || ""));
  form.append("drawingNo", "");
  form.append("partName", String(row.material || "其他采购截图"));
  form.append("file", file);
  const data = await apiFetchJson("/api/files/upload", { method: "POST", body: form });
  const ref = extractNasFileRef(data);
  if (!ref) throw new Error("上传成功但未返回文件引用");
  return ref;
}

function extractNasFileRef(data) {
  const url = String(
    data?.url
    || data?.fileUrl
    || data?.downloadUrl
    || data?.data?.url
    || data?.data?.fileUrl
    || ""
  ).trim();
  if (url) return url;

  const path = String(
    data?.path
    || data?.filePath
    || data?.data?.path
    || ""
  ).trim();
  if (path) {
    if (/^https?:\/\//i.test(path)) return path;
    return `${UPLOAD_API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  }

  const id = String(
    data?.id
    || data?.fileId
    || data?.data?.id
    || data?.file?.id
    || ""
  ).trim();
  if (id) return `nas:${id}`;
  return "";
}

async function resolveScreenshotPreviewSrc(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  if (/^(data:image|blob:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.startsWith("nas:")) {
    const fileId = raw.slice(4).trim();
    if (!fileId || !UPLOAD_API_BASE) return "";
    if (screenshotObjectUrlCache.has(fileId)) return screenshotObjectUrlCache.get(fileId);
    try {
      const blob = await apiFetchBlob(`/api/files/download/${encodeURIComponent(fileId)}`, { method: "GET" });
      const objectUrl = URL.createObjectURL(blob);
      screenshotObjectUrlCache.set(fileId, objectUrl);
      return objectUrl;
    } catch (e) {
      console.warn("加载 NAS 截图失败", e);
      return "";
    }
  }
  return raw;
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

function parseMaterialGroups(row, extra) {
  const rawSpec = String(row?.spec || "").trim();
  if (rawSpec.startsWith(MATERIAL_GROUPS_PREFIX)) {
    try {
      const parsed = JSON.parse(rawSpec.slice(MATERIAL_GROUPS_PREFIX.length));
      if (Array.isArray(parsed)) {
        const mapped = parsed
          .map((g) => ({
            material: String(g?.material || "").trim(),
            supplier: String(g?.supplier || "").trim(),
            itemKind: String(g?.itemKind || "material"),
            amount: g?.amount === "" || g?.amount == null ? "" : Math.max(0, Number(g.amount) || 0),
            status: normalizeStatus(g?.status, row, extra),
            purchasedAt: String(g?.purchasedAt || g?.pendingAt || ""),
            arrivedAt: String(g?.arrivedAt || ""),
            screenshot: String(g?.screenshot || ""),
            lines: Array.isArray(g?.lines)
              ? g.lines
                .map((line) => ({
                  size: String(line?.size || "").trim(),
                  qty: line?.qty === "" || line?.qty == null ? "" : Math.max(0, Math.floor(Number(line.qty) || 0)),
                }))
                .filter((line) => line.size || line.qty !== "")
              : [],
          }))
          .filter((g) => g.material || g.supplier || g.lines.length > 0 || g.amount !== "");
        const rowAmount = row?.amount == null || row?.amount === "" ? "" : Math.max(0, Number(row.amount) || 0);
        if (mapped.length > 0 && rowAmount !== "" && !mapped.some((g) => g.amount !== "")) {
          mapped[0].amount = rowAmount;
        }
        return mapped;
      }
    } catch {
      // ignore legacy fallback
    }
  }
  const fallbackLines = parseSpecLines(row?.spec, row?.quantity).lines;
  const fallbackMaterial = String(row?.material || "").trim();
  const fallbackSupplier = String(extra?.supplier || "").trim();
  const fallbackAmount = row?.amount == null || row?.amount === "" ? "" : Math.max(0, Number(row.amount) || 0);
  const fallbackStatus = normalizeStatus(extra?.status, row, extra);
  if (!fallbackMaterial && !fallbackSupplier && fallbackLines.length === 0 && fallbackAmount === "") return [];
  return [{ itemKind: "material", material: fallbackMaterial, supplier: fallbackSupplier, amount: fallbackAmount, status: fallbackStatus, purchasedAt: "", arrivedAt: "", screenshot: "", lines: fallbackLines }];
}

function serializeMaterialGroups(groups = []) {
  const normalized = groups
    .map((g) => ({
      material: String(g?.material || "").trim(),
      supplier: String(g?.supplier || "").trim(),
      itemKind: String(g?.itemKind || "material"),
      amount: g?.amount === "" || g?.amount == null ? "" : Number(Number(g.amount).toFixed(2)),
      status: normalizeStatus(g?.status),
      purchasedAt: String(g?.purchasedAt || ""),
      arrivedAt: String(g?.arrivedAt || ""),
      screenshot: String(g?.screenshot || ""),
      lines: (Array.isArray(g?.lines) ? g.lines : [])
        .map((line) => ({
          size: String(line?.size || "").trim(),
          qty: line?.qty === "" || line?.qty == null ? "" : Math.max(0, Math.floor(Number(line.qty) || 0)),
        }))
        .filter((line) => line.size || line.qty !== ""),
    }))
    .filter((g) => g.material || g.supplier || g.lines.length > 0 || g.amount !== "");
  if (!normalized.length) return { material: "", spec: "", quantity: "", supplier: "", amount: "" };
  const qtyTotal = normalized.reduce((sum, g) => {
    const groupQty = g.lines.reduce((sub, line) => sub + (line.qty === "" ? 0 : Number(line.qty)), 0);
    return sum + groupQty;
  }, 0);
  const amountTotal = normalized.reduce((sum, g) => sum + (g.amount === "" ? 0 : Number(g.amount)), 0);
  const materialText = normalized.map((g) => g.material).filter(Boolean).join(" / ");
  const primarySupplier = normalized.find((g) => g.supplier)?.supplier || "";
  return {
    material: materialText,
    spec: `${MATERIAL_GROUPS_PREFIX}${JSON.stringify(normalized)}`,
    quantity: qtyTotal > 0 ? String(qtyTotal) : "",
    supplier: primarySupplier,
    amount: amountTotal > 0 ? Number(amountTotal.toFixed(2)) : "",
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
  if (!material) {
    showInfo("请选择材质。", "校验失败");
    return;
  }
  if (!lines.length) {
    showInfo("请至少填写一行规格和数量。", "校验失败");
    return;
  }
  if (lines.some((line) => !line.size || line.qty == null)) {
    showInfo("每行都需要填写有效的规格和数量。", "校验失败");
    return;
  }
  const currentGroups = materialItemEditingGroups.length
    ? materialItemEditingGroups
    : parseMaterialGroups(row, getExtra(row.id));
  while (currentGroups.length <= materialItemEditingGroupIndex) currentGroups.push(createEmptyMaterialGroup());
  const existingAmount = currentGroups[materialItemEditingGroupIndex]?.amount ?? "";
  const existingStatus = normalizeStatus(currentGroups[materialItemEditingGroupIndex]?.status);
  const existingPurchasedAt = String(currentGroups[materialItemEditingGroupIndex]?.purchasedAt || "");
  const existingArrivedAt = String(currentGroups[materialItemEditingGroupIndex]?.arrivedAt || "");
  const existingScreenshot = String(currentGroups[materialItemEditingGroupIndex]?.screenshot || "");
  currentGroups[materialItemEditingGroupIndex] = { itemKind: "material", material, supplier, amount: existingAmount, status: existingStatus, purchasedAt: existingPurchasedAt, arrivedAt: existingArrivedAt, screenshot: existingScreenshot, lines };
  const serializedGroups = serializeMaterialGroups(currentGroups);
  row.material = serializedGroups.material;
  row.spec = serializedGroups.spec;
  row.quantity = serializedGroups.quantity;
  row.amount = serializedGroups.amount;
  saveExtra(row.id, { supplier: serializedGroups.supplier });
  await persist({ changed: [row] });
  materialItemEditingRowId = "";
  materialItemEditingGroups = [];
  materialItemEditingGroupIndex = 0;
  closeDialog(el.materialItemDialog);
  render();
}

async function saveOtherItemDetail() {
  const row = rows.find((r) => r.id === otherItemEditingRowId);
  if (!row) return;
  const material = String(el.otherNameInput?.value || "").trim();
  const supplier = String(el.otherSupplierInput?.value || "").trim();
  const lines = collectOtherLineRows();
  if (!material) {
    showInfo("请填写名称。", "校验失败");
    return;
  }
  if (!lines.length) {
    showInfo("请至少填写一行规格和数量。", "校验失败");
    return;
  }
  if (lines.some((line) => !line.size || line.qty == null)) {
    showInfo("每行都需要填写有效的规格和数量。", "校验失败");
    return;
  }
  const currentGroups = materialItemEditingGroups.length
    ? materialItemEditingGroups
    : parseMaterialGroups(row, getExtra(row.id));
  while (currentGroups.length <= otherItemEditingGroupIndex) currentGroups.push(createEmptyMaterialGroup("other"));
  const existingAmount = currentGroups[otherItemEditingGroupIndex]?.amount ?? "";
  const existingStatus = normalizeStatus(currentGroups[otherItemEditingGroupIndex]?.status);
  const existingPurchasedAt = String(currentGroups[otherItemEditingGroupIndex]?.purchasedAt || "");
  const existingArrivedAt = String(currentGroups[otherItemEditingGroupIndex]?.arrivedAt || "");
  currentGroups[otherItemEditingGroupIndex] = { itemKind: "other", material, supplier, amount: existingAmount, status: existingStatus, purchasedAt: existingPurchasedAt, arrivedAt: existingArrivedAt, screenshot: otherScreenshotDataUrl, lines };
  const serializedGroups = serializeMaterialGroups(currentGroups);
  row.material = serializedGroups.material;
  row.spec = serializedGroups.spec;
  row.quantity = serializedGroups.quantity;
  row.amount = serializedGroups.amount;
  saveExtra(row.id, { supplier: serializedGroups.supplier });
  await persist({ changed: [row] });
  otherItemEditingRowId = "";
  otherItemEditingGroupIndex = 0;
  materialItemEditingGroups = [];
  closeDialog(el.otherDialog);
  render();
}

function updateBackTopBtn() { if (!el.backTopBtn) return; const pageY = window.scrollY || 0; const tableY = el.tableWrap ? el.tableWrap.scrollTop : 0; el.backTopBtn.style.display = pageY > 120 || tableY > 120 ? "inline-flex" : "none"; }

async function initAuth() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  try { const { data, error } = await db.auth.getSession(); if (error) throw error; authSession = data?.session || null; } catch { authSession = null; }
  updateAuthUi();
  db.auth.onAuthStateChange(async (_e, session) => {
    authSession = session || null;
    updateAuthUi();
    if (shouldUseLocalOnlyMode()) {
      rows = loadLocalRows();
      await ensureTestRowExists();
      setModeText("本地调试模式（未登录）");
      render();
      setLastSyncTime();
      return;
    }
    setModeText(authSession ? "云端共享模式" : "云端只读（未登录）");
    if (remoteOnline) await refreshFromRemote(false);
  });
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
  if (shouldUseLocalOnlyMode()) {
    rows = loadLocalRows();
    await ensureTestRowExists();
    setModeText("本地调试模式（未登录）");
    render();
    setLastSyncTime();
    return;
  }
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
      const { data, error } = await db
        .from("mes_orders")
        .select("order_no,customer,item_name,drawing_no,note,updated_at")
        .neq("order_no", "")
        .order("updated_at", { ascending: true });
      if (error) throw error;
      const customerMap = new Map();
      const summaryMap = new Map();
      (data || []).forEach((item) => {
        const key = String(item.order_no || "").trim().toUpperCase();
        if (!key) return;
        customerMap.set(key, String(item.customer || "").trim());
        const summary = String(item.item_name || item.drawing_no || item.note || "").trim();
        if (summary) summaryMap.set(key, summary);
      });
      orderCustomerMap = customerMap;
      orderSummaryMap = summaryMap;
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
    const customerMap = new Map();
    const summaryMap = new Map();
    (Array.isArray(list) ? list : []).forEach((item) => {
      const key = String(item?.orderNo || item?.order_no || "").trim().toUpperCase();
      if (!key) return;
      customerMap.set(key, String(item?.customer || "").trim());
      const summary = String(item?.itemName || item?.item_name || item?.drawingNo || item?.drawing_no || item?.note || "").trim();
      if (summary) summaryMap.set(key, summary);
    });
    orderCustomerMap = customerMap;
    orderSummaryMap = summaryMap;
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

async function apiFetchJson(path, options = {}) {
  if (!UPLOAD_API_BASE) throw new Error("未配置上传服务地址");
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const resp = await fetch(`${UPLOAD_API_BASE}${path}`, { ...options, headers });
  if (!resp.ok) throw await parseHttpError(resp);
  if (resp.status === 204) return null;
  return await resp.json();
}

async function apiFetchBlob(path, options = {}) {
  if (!UPLOAD_API_BASE) throw new Error("未配置上传服务地址");
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const resp = await fetch(`${UPLOAD_API_BASE}${path}`, { ...options, headers });
  if (!resp.ok) throw await parseHttpError(resp);
  return await resp.blob();
}

async function getAccessToken() {
  if (authSession?.access_token) return authSession.access_token;
  if (!db?.auth) return "";
  try {
    const { data } = await db.auth.getSession();
    return data?.session?.access_token || "";
  } catch {
    return "";
  }
}

async function parseHttpError(resp) {
  let message = `HTTP ${resp.status}`;
  try {
    const data = await resp.json();
    message = data?.message || data?.error || message;
  } catch {
    // ignore parse error
  }
  return new Error(message);
}

function showInfo(message, title = "提示") {
  if (!el.infoDialog || !el.infoText) { alert(message); return; }
  if (el.infoTitle) el.infoTitle.textContent = title;
  el.infoText.textContent = String(message || "");
  openDialog(el.infoDialog);
}
function closeInfo() { closeDialog(el.infoDialog); }
