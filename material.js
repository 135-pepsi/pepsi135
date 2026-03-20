﻿
const STORAGE_KEY = "mini_mes_materials_v2";
const EXTRA_KEY = "mini_mes_materials_extra_v2";
const ORDER_STORAGE_KEY = "mini_mes_orders_v1";
const SUPPLIER_CUSTOM_KEY = "mini_mes_supplier_options_v1";
const MATERIAL_CUSTOM_KEY = "mini_mes_material_options_v1";

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
const REMOTE_ENABLED = Boolean(supabaseSetup.remoteEnabled);
const IS_LOCAL_DEBUG = location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
const AUTO_REFRESH_MS = Math.max(5000, Number(MES_CONFIG.AUTO_REFRESH_SECONDS || 5) * 1000);
const SUMMARY_SELECTION_HOLD_MS = Math.max(5000, Number(MES_CONFIG.SUMMARY_SELECTION_HOLD_SECONDS || 15) * 1000);
const STORAGE_BUCKET = String(MES_CONFIG.SUPABASE_STORAGE_BUCKET || "material-screenshots").trim();
const STORAGE_SIGNED_EXPIRES = Math.max(60, Number(MES_CONFIG.SUPABASE_STORAGE_SIGNED_EXPIRES || 3600));
const UPLOAD_API_BASE =
  typeof MES_SHARED.normalizeUploadApiBase === "function"
    ? MES_SHARED.normalizeUploadApiBase(MES_CONFIG.UPLOAD_API_BASE, location.href)
    : String(MES_CONFIG.UPLOAD_API_BASE || "").trim();
const UPLOAD_MAX_MB = Math.max(1, Number(MES_CONFIG.UPLOAD_MAX_MB || 50));
const db = supabaseSetup.db;
const FORCE_FULL_SYNC_INTERVAL = 12;
const DEBUG_PERF = Boolean(MES_CONFIG.DEBUG_PERF);
const VIRTUAL_ENABLED_THRESHOLD = 120;
const VIRTUAL_ROW_ESTIMATE = 88;
const VIRTUAL_OVERSCAN_ROWS = 10;

function toSafeExternalHttpUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    const u = new URL(text, location.href);
    const protocol = String(u.protocol || "").toLowerCase();
    if (protocol !== "https:" && protocol !== "http:") return "";
    return u.href;
  } catch (_e) {
    return "";
  }
}

const STATUS_LIST = ["下单", "采购", "到货", "异常"];
const MATERIAL_BASE_OPTIONS = ["", "45#钢", "40Cr", "铝5052", "铝6061", "铝7075", "铝2A12", "不锈钢304", "不锈钢316", "铜", "POM", "尼龙"];
const SUPPLIER_BASE_OPTIONS = [""];
const SUPPLIER_BLOCKLIST = new Set(["供应商A", "供应商B", "供应商C", "供应商D", "sdf"]);
let materialOptions = buildMaterialOptions(loadCustomMaterialOptions());
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
let canViewAuditPage = false;
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
let summarySelectionHoldUntil = 0;
let materialCustomBound = false;
let supplierCustomBound = false;
let otherScreenshotDataUrl = "";
let screenshotPreviewRenderToken = 0;
const screenshotObjectUrlCache = new Map();
const parsedGroupCache = new Map();
let supplierFilterDirty = true;
let pendingGroupHeightRaf = 0;
let suppressNextGroupHeightSync = false;
const pendingStatusPersistKeys = new Set();
let materialSyncCursor = "";
let materialIncrementalSyncCount = 0;
const rowDomCache = new Map();
let currentRenderList = [];
let currentRenderExtraMap = new Map();
let pendingViewportRenderRaf = 0;
let tableDelegateBound = false;
let deleteConfirmResolver = null;
const materialLocalStore =
  typeof MES_SHARED.createBufferedJsonStorage === "function"
    ? MES_SHARED.createBufferedJsonStorage(STORAGE_KEY, () => rows, window.localStorage)
    : null;

const filterState = {
  month: String(new Date().getMonth() + 1).padStart(2, "0"),
  supplier: "",
  customer: "",
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
  auditPageLink: document.getElementById("auditPageLink"),
  reconnectBtn: document.getElementById("reconnectBtn"),

  filterMonth: document.getElementById("materialFilterMonth"),
  filterSupplier: document.getElementById("materialFilterSupplier"),
  filterCustomer: document.getElementById("materialFilterCustomer"),
  filterStatus: document.getElementById("materialFilterStatus"),
  summaryAmountTotal: document.getElementById("materialSummaryAmountTotal"),

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
  materialCustomDialog: document.getElementById("materialCustomDialog"),
  materialCustomClose: document.getElementById("materialCustomCloseBtn"),
  materialCustomCancel: document.getElementById("materialCustomCancelBtn"),
  materialCustomSave: document.getElementById("materialCustomSaveBtn"),
  materialCustomInput: document.getElementById("materialCustomInput"),
  supplierCustomDialog: document.getElementById("supplierCustomDialog"),
  supplierCustomClose: document.getElementById("supplierCustomCloseBtn"),
  supplierCustomCancel: document.getElementById("supplierCustomCancelBtn"),
  supplierCustomSave: document.getElementById("supplierCustomSaveBtn"),
  supplierCustomInput: document.getElementById("supplierCustomInput"),
  imagePreviewDialog: document.getElementById("imagePreviewDialog"),
  imagePreviewClose: document.getElementById("imagePreviewCloseBtn"),
  imagePreviewBody: document.getElementById("imagePreviewBody"),
  deleteConfirmDialog: document.getElementById("deleteConfirmDialog"),
  deleteConfirmClose: document.getElementById("deleteConfirmCloseBtn"),
  deleteConfirmCancel: document.getElementById("deleteConfirmCancelBtn"),
  deleteConfirmOk: document.getElementById("deleteConfirmOkBtn"),
  deleteConfirmText: document.getElementById("deleteConfirmText"),

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
  otherSupplierLinkInput: document.getElementById("otherItemSupplierLink"),
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
  ensureDeleteConfirmDialog();
  ensureMaterialCustomDialog();
  ensureSupplierCustomDialog();
  bindEvents();
  document.addEventListener("selectionchange", () => {
    if (hasActiveSummarySelection()) extendSummarySelectionHold();
  });
  initStatusFilterOptions();
  initCustomerFilterOptions();
  initSupplierFilterOptions();
  supplierFilterDirty = false;
  setFilterDefaults();
  rows = loadLocalRows();
  resetDerivedCaches();
  if (REMOTE_ENABLED) {
    await initAuth();
    if (shouldUseLocalOnlyMode()) {
      await refreshOrderCustomerMap();
      await ensureTestRowExists();
      setModeText("本地调试模式（未登录）");
      render();
      setLastSyncTime();
    } else {
      await refreshFromRemote(false, false);
      const testAdded = await ensureTestRowExists();
      if (testAdded) render();
    }
    setInterval(() => {
      if (Date.now() < summarySelectionHoldUntil || hasActiveSummarySelection()) return;
      if (isEditingDialogOpen()) return;
      if (!syncing && remoteOnline && !shouldUseLocalOnlyMode()) void refreshFromRemote(false, true);
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

function isInSummaryCell(node) {
  let cur = node;
  while (cur) {
    if (cur.nodeType === 1 && (cur.classList?.contains("material-summary-cell") || cur.classList?.contains("material-detail-cell"))) return true;
    cur = cur.parentNode;
  }
  return false;
}

function hasActiveSummarySelection() {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed) return false;
  return isInSummaryCell(sel.anchorNode) || isInSummaryCell(sel.focusNode);
}

function extendSummarySelectionHold(ms = SUMMARY_SELECTION_HOLD_MS) {
  summarySelectionHoldUntil = Math.max(summarySelectionHoldUntil, Date.now() + ms);
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
  bindTableDelegates();
  if (el.reconnectBtn) el.reconnectBtn.addEventListener("click", () => void tryReconnect(true));

  if (el.backTopBtn) {
    el.backTopBtn.addEventListener("click", () => {
      if (el.tableWrap) el.tableWrap.scrollTo({ top: 0, behavior: "smooth" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  if (el.tableWrap) el.tableWrap.addEventListener("scroll", handleTableWrapScroll);
  window.addEventListener("resize", () => {
    if (isVirtualRenderEnabled(currentRenderList.length)) scheduleViewportRender();
  });
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
      closeMaterialCustomDialog();
      closeSupplierCustomDialog();
      closeInfo();
      closeImagePreview();
      closeDeleteConfirm(false);
    }
  });
}

function bindTableDelegates() {
  if (!el.tableBody || tableDelegateBound) return;
  tableDelegateBound = true;
  el.tableBody.addEventListener("click", (event) => {
    const rawTarget = event.target;
    const target = rawTarget instanceof Element
      ? rawTarget
      : (rawTarget && rawTarget.parentElement ? rawTarget.parentElement : null);
    if (!target) return;
    const actionBtn = target.closest("button[data-action]");
    if (actionBtn instanceof HTMLButtonElement) {
      event.preventDefault();
      event.stopPropagation();
      const action = String(actionBtn.dataset.action || "");
      const rowId = String(actionBtn.dataset.rowId || "");
      const groupIndex = Number(actionBtn.dataset.groupIndex || "0");
      if (!rowId) return;
      if (action === "edit-amount") {
        void editGroupAmount(rowId, groupIndex);
        return;
      }
      if (action === "cycle-status") {
        void cycleGroupStatus(rowId, groupIndex);
        return;
      }
      if (action === "delete-group") {
        void deleteMaterialGroup(rowId, groupIndex);
        return;
      }
      if (action === "delete-row") {
        void deleteRow(rowId);
        return;
      }
      if (action === "edit-item") {
        const kind = String(actionBtn.dataset.itemKind || "material");
        if (kind === "other") {
          openOtherItemDialog(rowId, { groupIndex });
        } else {
          openMaterialItemDialog(rowId, { groupIndex });
        }
      }
      return;
    }

    if (target.closest("a,button,input,select,textarea")) return;
    const tr = target.closest("tr[data-row-id]");
    if (!(tr instanceof HTMLTableRowElement)) return;
    const rowId = String(tr.dataset.rowId || "");
    if (!rowId) return;
    const prev = selectedRowId;
    selectedRowId = rowId;
    updateSelectedRowClass(prev, false);
    updateSelectedRowClass(selectedRowId, true);
  });
}

function bindHeaderActions() {
  const addMaterialBtn = document.getElementById("materialHeaderAddMaterialBtn");
  const addOtherBtn = document.getElementById("materialHeaderAddOtherBtn");
  if (addMaterialBtn) addMaterialBtn.addEventListener("click", () => {
    if (!selectedRowId) {
      showInfo("请先选择订单（点击一行订单）再添加物料。", "提示");
      return;
    }
    void addMaterialForOrderRow(selectedRowId);
  });
  if (addOtherBtn) addOtherBtn.addEventListener("click", () => {
    if (!selectedRowId) {
      showInfo("请先选择订单（点击一行订单）再添加其他。", "提示");
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
    bindMaterialCustomAdd();
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
  bindMaterialCustomAdd();
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

function ensureDeleteConfirmDialog() {
  const existing = document.getElementById("deleteConfirmDialog");
  if (existing) {
    el.deleteConfirmDialog = existing;
    el.deleteConfirmClose = document.getElementById("deleteConfirmCloseBtn");
    el.deleteConfirmCancel = document.getElementById("deleteConfirmCancelBtn");
    el.deleteConfirmOk = document.getElementById("deleteConfirmOkBtn");
    el.deleteConfirmText = document.getElementById("deleteConfirmText");
    return;
  }
  const dialog = document.createElement("div");
  dialog.id = "deleteConfirmDialog";
  dialog.className = "dialog-backdrop";
  dialog.hidden = true;
  dialog.innerHTML = `
    <section class="dialog-panel confirm-panel" role="dialog" aria-modal="true" aria-labelledby="deleteConfirmTitle">
      <header class="dialog-head">
        <h3 id="deleteConfirmTitle">确认删除</h3>
        <button id="deleteConfirmCloseBtn" class="btn btn-secondary" type="button">关闭</button>
      </header>
      <p id="deleteConfirmText" class="dialog-subtitle">确认执行删除操作吗？</p>
      <div class="confirm-actions">
        <button id="deleteConfirmCancelBtn" class="btn btn-secondary" type="button">取消</button>
        <button id="deleteConfirmOkBtn" class="btn btn-danger" type="button">确认删除</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialog);
  el.deleteConfirmDialog = dialog;
  el.deleteConfirmClose = document.getElementById("deleteConfirmCloseBtn");
  el.deleteConfirmCancel = document.getElementById("deleteConfirmCancelBtn");
  el.deleteConfirmOk = document.getElementById("deleteConfirmOkBtn");
  el.deleteConfirmText = document.getElementById("deleteConfirmText");
}

function ensureSupplierCustomDialog() {
  const existing = document.getElementById("supplierCustomDialog");
  if (existing) {
    el.supplierCustomDialog = existing;
    el.supplierCustomClose = document.getElementById("supplierCustomCloseBtn");
    el.supplierCustomCancel = document.getElementById("supplierCustomCancelBtn");
    el.supplierCustomSave = document.getElementById("supplierCustomSaveBtn");
    el.supplierCustomInput = document.getElementById("supplierCustomInput");
    return;
  }
  const dialog = document.createElement("div");
  dialog.id = "supplierCustomDialog";
  dialog.className = "dialog-backdrop";
  dialog.hidden = true;
  dialog.innerHTML = `
    <section class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="supplierCustomTitle">
      <header class="dialog-head">
        <h3 id="supplierCustomTitle">新增供应商</h3>
        <button id="supplierCustomCloseBtn" class="btn btn-secondary" type="button">关闭</button>
      </header>
      <div class="auth-login-form">
        <label class="auth-login-field" for="supplierCustomInput">
          <span>供应商名称</span>
          <input id="supplierCustomInput" type="text" placeholder="请输入供应商名称" />
        </label>
      </div>
      <div class="auth-login-actions">
        <button id="supplierCustomCancelBtn" class="btn btn-secondary" type="button">取消</button>
        <button id="supplierCustomSaveBtn" class="btn btn-primary" type="button">保存</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialog);
  el.supplierCustomDialog = dialog;
  el.supplierCustomClose = document.getElementById("supplierCustomCloseBtn");
  el.supplierCustomCancel = document.getElementById("supplierCustomCancelBtn");
  el.supplierCustomSave = document.getElementById("supplierCustomSaveBtn");
  el.supplierCustomInput = document.getElementById("supplierCustomInput");
}

function ensureMaterialCustomDialog() {
  const existing = document.getElementById("materialCustomDialog");
  if (existing) {
    el.materialCustomDialog = existing;
    el.materialCustomClose = document.getElementById("materialCustomCloseBtn");
    el.materialCustomCancel = document.getElementById("materialCustomCancelBtn");
    el.materialCustomSave = document.getElementById("materialCustomSaveBtn");
    el.materialCustomInput = document.getElementById("materialCustomInput");
    return;
  }
  const dialog = document.createElement("div");
  dialog.id = "materialCustomDialog";
  dialog.className = "dialog-backdrop";
  dialog.hidden = true;
  dialog.innerHTML = `
    <section class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="materialCustomTitle">
      <header class="dialog-head">
        <h3 id="materialCustomTitle">新增材质</h3>
        <button id="materialCustomCloseBtn" class="btn btn-secondary" type="button">关闭</button>
      </header>
      <div class="auth-login-form">
        <label class="auth-login-field" for="materialCustomInput">
          <span>材质名称</span>
          <input id="materialCustomInput" type="text" placeholder="请输入材质名称" />
        </label>
      </div>
      <div class="auth-login-actions">
        <button id="materialCustomCancelBtn" class="btn btn-secondary" type="button">取消</button>
        <button id="materialCustomSaveBtn" class="btn btn-primary" type="button">保存</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialog);
  el.materialCustomDialog = dialog;
  el.materialCustomClose = document.getElementById("materialCustomCloseBtn");
  el.materialCustomCancel = document.getElementById("materialCustomCancelBtn");
  el.materialCustomSave = document.getElementById("materialCustomSaveBtn");
  el.materialCustomInput = document.getElementById("materialCustomInput");
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
    el.otherSupplierLinkInput = document.getElementById("otherItemSupplierLink");
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
          <label class="auth-login-field"><span>链接</span><input id="otherItemSupplierLink" type="text" placeholder="https://..." /></label>
        </div>
        <div class="material-item-col material-item-col-lines">
          <div class="auth-login-field">
            <span>规格与数量</span>
            <div id="otherLineList" class="material-line-list"></div>
            <button id="otherLineAddBtn" class="btn btn-secondary" type="button">新增规格行</button>
          </div>
          <div class="auth-login-field">
            <span>截图</span>
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
  el.otherSupplierLinkInput = document.getElementById("otherItemSupplierLink");
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
    materialOptions.forEach((name, idx) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = idx === 0 ? "请选择材质" : name;
      el.materialInput.appendChild(option);
    });
    const customOption = document.createElement("option");
    customOption.value = "__custom__";
    customOption.textContent = "＋ 自定义材质";
    el.materialInput.appendChild(customOption);
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

function bindMaterialCustomAdd() {
  if (!el.materialInput || materialCustomBound) return;
  materialCustomBound = true;
  el.materialInput.addEventListener("change", () => {
    if (el.materialInput.value !== "__custom__") return;
    openMaterialCustomDialog();
  });
}

function bindSupplierCustomAdd() {
  if (!el.materialSupplierInput || supplierCustomBound) return;
  supplierCustomBound = true;
  el.materialSupplierInput.addEventListener("change", () => {
    if (el.materialSupplierInput.value !== "__custom__") return;
    openSupplierCustomDialog();
  });
}
function loadCustomMaterialOptions() {
  const raw = localStorage.getItem(MATERIAL_CUSTOM_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function saveCustomMaterialOptions() {
  const custom = materialOptions.filter((name) => name && !MATERIAL_BASE_OPTIONS.includes(name));
  localStorage.setItem(MATERIAL_CUSTOM_KEY, JSON.stringify(custom));
}

function buildMaterialOptions(customList = []) {
  const set = new Set(MATERIAL_BASE_OPTIONS);
  customList.forEach((name) => {
    const v = String(name || "").trim();
    if (v) set.add(v);
  });
  return Array.from(set);
}

function addCustomMaterialOption(name) {
  const v = String(name || "").trim();
  if (!v) return;
  if (!materialOptions.includes(v)) {
    materialOptions.push(v);
    saveCustomMaterialOptions();
  }
}

function openMaterialCustomDialog() {
  if (!el.materialCustomDialog) return;
  if (el.materialInput) el.materialInput.value = "";
  if (el.materialCustomInput) {
    el.materialCustomInput.value = "";
  }
  openDialog(el.materialCustomDialog);
  if (el.materialCustomInput) {
    el.materialCustomInput.focus();
    el.materialCustomInput.select();
  }
}

function closeMaterialCustomDialog() {
  closeDialog(el.materialCustomDialog);
  if (el.materialCustomInput) el.materialCustomInput.value = "";
}

async function saveMaterialCustomDialog() {
  const raw = String(el.materialCustomInput?.value || "").trim();
  if (!raw) {
    showInfo("请输入材质名称。", "校验失败");
    return;
  }
  addCustomMaterialOption(raw);
  populateMaterialItemSelects();
  setSelectValueWithFallback(el.materialInput, raw, "请选择材质");
  closeMaterialCustomDialog();
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
    markSupplierFilterDirty();
    saveCustomSupplierOptions();
  }
}

function openSupplierCustomDialog() {
  if (!el.supplierCustomDialog) return;
  if (el.materialSupplierInput) el.materialSupplierInput.value = "";
  if (el.supplierCustomInput) {
    el.supplierCustomInput.value = "";
  }
  openDialog(el.supplierCustomDialog);
  if (el.supplierCustomInput) {
    el.supplierCustomInput.focus();
    el.supplierCustomInput.select();
  }
}

function closeSupplierCustomDialog() {
  closeDialog(el.supplierCustomDialog);
  if (el.supplierCustomInput) el.supplierCustomInput.value = "";
}

async function saveSupplierCustomDialog() {
  const raw = String(el.supplierCustomInput?.value || "").trim();
  if (!raw) {
    showInfo("请输入供应商名称。", "校验失败");
    return;
  }
  if (SUPPLIER_BLOCKLIST.has(raw)) {
    showInfo("该供应商名称不可用，请更换名称。", "校验失败");
    return;
  }
  addCustomSupplierOption(raw);
  populateMaterialItemSelects();
  setSelectValueWithFallback(el.materialSupplierInput, raw, "请选择供应商");
  closeSupplierCustomDialog();
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
    getCachedMaterialGroups(row, extra).forEach((g) => merged.push(String(g?.supplier || "").trim()));
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
  filterState.supplier = normalizeSupplierSearchText(el.filterSupplier.value || "");
}

function initCustomerFilterOptions() {
  if (!el.filterCustomer) return;
  const current = String(filterState.customer || el.filterCustomer.value || "").trim();
  const list = Array.from(
    new Set(
      rows
        .map((row) => String(row.customer || "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
    )
  );
  el.filterCustomer.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部";
  el.filterCustomer.appendChild(all);
  list.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    el.filterCustomer.appendChild(option);
  });
  el.filterCustomer.value = list.includes(current) ? current : "";
  filterState.customer = String(el.filterCustomer.value || "").trim();
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
  if (el.filterSupplier) el.filterSupplier.addEventListener("change", (e) => { filterState.supplier = normalizeSupplierSearchText(e.target.value || ""); render(); });
  if (el.filterCustomer) el.filterCustomer.addEventListener("change", (e) => { filterState.customer = String(e.target.value || "").trim(); render(); });
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
  bindActionDialog(el.materialCustomDialog, [el.materialCustomClose, el.materialCustomCancel], () => void saveMaterialCustomDialog(), el.materialCustomSave);
  bindActionDialog(el.supplierCustomDialog, [el.supplierCustomClose, el.supplierCustomCancel], () => void saveSupplierCustomDialog(), el.supplierCustomSave);
  if (el.materialItemClear) el.materialItemClear.addEventListener("click", clearMaterialItemDetail);
  if (el.otherClear) el.otherClear.addEventListener("click", clearOtherItemDetail);
  if (el.materialLineAddBtn) el.materialLineAddBtn.addEventListener("click", () => appendMaterialLineRow("", ""));
  if (el.otherLineAddBtn) el.otherLineAddBtn.addEventListener("click", () => appendOtherLineRow("", ""));
  if (el.otherScreenshotClearBtn) el.otherScreenshotClearBtn.addEventListener("click", clearOtherScreenshot);
  if (el.otherScreenshotCaptureBtn) el.otherScreenshotCaptureBtn.addEventListener("click", () => void captureOtherScreenshot());
  if (el.infoClose) el.infoClose.addEventListener("click", closeInfo);
  if (el.infoOk) el.infoOk.addEventListener("click", closeInfo);
  if (el.infoDialog) el.infoDialog.addEventListener("click", (e) => { if (e.target === el.infoDialog) closeInfo(); });
  if (el.imagePreviewClose) el.imagePreviewClose.addEventListener("click", closeImagePreview);
  if (el.imagePreviewDialog) el.imagePreviewDialog.addEventListener("click", (e) => { if (e.target === el.imagePreviewDialog) closeImagePreview(); });
  if (el.deleteConfirmClose) el.deleteConfirmClose.addEventListener("click", () => closeDeleteConfirm(false));
  if (el.deleteConfirmCancel) el.deleteConfirmCancel.addEventListener("click", () => closeDeleteConfirm(false));
  if (el.deleteConfirmOk) el.deleteConfirmOk.addEventListener("click", () => closeDeleteConfirm(true));
  if (el.deleteConfirmDialog) {
    el.deleteConfirmDialog.addEventListener("click", (e) => {
      if (e.target === el.deleteConfirmDialog) closeDeleteConfirm(false);
    });
  }
  if (el.materialCustomInput) {
    el.materialCustomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void saveMaterialCustomDialog();
      }
    });
  }
  if (el.supplierCustomInput) {
    el.supplierCustomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void saveSupplierCustomDialog();
      }
    });
  }
}

function bindActionDialog(dialogEl, closeButtons, saveFn, saveBtn) {
  closeButtons.forEach((b) => { if (b) b.addEventListener("click", () => closeDialog(dialogEl)); });
  if (saveBtn) saveBtn.addEventListener("click", saveFn);
  if (dialogEl) dialogEl.addEventListener("click", (e) => { if (e.target === dialogEl) closeDialog(dialogEl); });
}

function isEditingDialogOpen() {
  return [
    el.poDialog,
    el.arrivalDialog,
    el.abnormalDialog,
    el.materialItemDialog,
    el.otherDialog,
    el.amountDialog,
    el.materialCustomDialog,
    el.supplierCustomDialog,
  ].some((d) => d && !d.hidden);
}

function setFilterDefaults() {
  if (el.filterMonth) el.filterMonth.value = filterState.month;
  if (el.filterCustomer) el.filterCustomer.value = filterState.customer;
}
function createEmptyRow() {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, orderNo: "", customer: "", material: "", spec: "", quantity: "", amount: "", isReady: "" };
}
function createDefaultExtra() { return { ...DEFAULT_EXTRA }; }
function getExtra(id) { return { ...createDefaultExtra(), ...(extras[id] || {}) }; }
function markSupplierFilterDirty() { supplierFilterDirty = true; }
function invalidateRowCaches(id) {
  if (!id) return;
  parsedGroupCache.delete(id);
  rowDomCache.delete(id);
}
function resetDerivedCaches() {
  parsedGroupCache.clear();
  rowDomCache.clear();
  markSupplierFilterDirty();
}
function makeMaterialGroupCacheToken(row, extra) {
  return JSON.stringify({
    spec: String(row?.spec || ""),
    material: String(row?.material || ""),
    quantity: String(row?.quantity ?? ""),
    amount: String(row?.amount ?? ""),
    isReady: String(row?.isReady || ""),
    createdAt: String(row?.createdAt || ""),
    updatedAt: String(row?.updatedAt || ""),
    supplier: String(extra?.supplier || ""),
    status: String(extra?.status || ""),
    inTransit: Number(extra?.inTransit || 0),
  });
}
function getCachedMaterialGroups(row, extra) {
  const id = String(row?.id || "");
  if (!id) return parseMaterialGroups(row, extra);
  const token = makeMaterialGroupCacheToken(row, extra);
  const hit = parsedGroupCache.get(id);
  if (hit && hit.token === token) return hit.groups;
  const groups = parseMaterialGroups(row, extra);
  parsedGroupCache.set(id, { token, groups });
  return groups;
}
function saveExtra(id, patch) {
  extras[id] = { ...getExtra(id), ...patch };
  invalidateRowCaches(id);
  markSupplierFilterDirty();
  saveExtras();
}
function deleteExtra(id) {
  if (extras[id]) {
    delete extras[id];
    invalidateRowCaches(id);
    markSupplierFilterDirty();
    saveExtras();
  }
}
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
  const groups = getCachedMaterialGroups(row, extra);
  if (!groups.length) return normalizeStatus(extra?.status, row, extra);
  const statuses = groups.map((g) => normalizeStatus(g?.status, row, extra));
  if (statuses.some((s) => s === "异常")) return "异常";
  if (statuses.every((s) => s === "到货")) return "到货";
  if (statuses.some((s) => s === "采购")) return "采购";
  return "下单";
}

function summarizeGroupStatus(row, extra, groups = []) {
  const activeGroups = (Array.isArray(groups) ? groups : []).filter((g) => {
    const lines = Array.isArray(g?.lines) ? g.lines : [];
    return Boolean(
      String(g?.material || "").trim()
      || String(g?.supplier || "").trim()
      || lines.some((line) => String(line?.size || "").trim() || line?.qty !== "" || line?.amount !== "")
      || g?.amount !== ""
    );
  });

  if (!activeGroups.length) return { status: "下单", isReady: "否" };

  const statuses = activeGroups.map((g) => normalizeStatus(g?.status, row, extra));
  const hasAbnormal = statuses.some((s) => s === "异常");
  const allArrived = statuses.every((s) => s === "到货");
  const hasPurchased = statuses.some((s) => s === "采购");
  const status = hasAbnormal ? "异常" : allArrived ? "到货" : hasPurchased ? "采购" : "下单";
  return { status, isReady: allArrived ? "是" : "否" };
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

function getVisibleGroupEntries(row, extra) {
  const groups = getCachedMaterialGroups(row, extra);
  const entries = groups.map((group, index) => ({ group, index }));
  const supplierNeed = String(filterState.supplier || "").trim();
  const statusNeed = String(filterState.status || "").trim();
  if (!supplierNeed && !statusNeed) return entries;
  return entries.filter(({ group }) => {
    const supplierText = normalizeSupplierSearchText(String(group?.supplier || extra?.supplier || ""));
    const statusText = normalizeStatus(group?.status, row, extra);
    const supplierOk = !supplierNeed || supplierText.includes(supplierNeed);
    const statusOk = !statusNeed || statusText === statusNeed;
    return supplierOk && statusOk;
  });
}

function getFilteredRows() {
  return rows.filter((row) => {
    const extra = getExtra(row.id);
    const monthOk = !filterState.month || getMonthFromOrderNo(row.orderNo) === filterState.month;
    if (!monthOk) return false;
    const customerOk = !filterState.customer || String(row.customer || "").trim() === filterState.customer;
    if (!customerOk) return false;
    const hasGroupFilter = Boolean(filterState.supplier || filterState.status);
    if (!hasGroupFilter) return true;
    return getVisibleGroupEntries(row, extra).length > 0;
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

function todayLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function getLineAmountValue(line) {
  const value = Number(line?.amount);
  return Number.isFinite(value) && value >= 0 ? Number(value.toFixed(2)) : null;
}

function getGroupAmountValue(group) {
  const lines = Array.isArray(group?.lines) ? group.lines : [];
  const lineTotal = lines.reduce((sum, line) => {
    const amount = getLineAmountValue(line);
    return amount == null ? sum : sum + amount;
  }, 0);
  if (lineTotal > 0) return Number(lineTotal.toFixed(2));
  const fallback = Number(group?.amount);
  return Number.isFinite(fallback) && fallback >= 0 ? Number(fallback.toFixed(2)) : null;
}

function formatLineQtyText(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? String(Math.floor(num)) : "-";
}

function buildContentSummary(row, extra, visibleEntries = null) {
  const orderNo = String(row.orderNo || "").trim();
  const customer = String(row.customer || "").trim();
  const groups = Array.isArray(visibleEntries)
    ? visibleEntries.map((entry) => entry.group)
    : getCachedMaterialGroups(row, extra);

  const lines = [
    `订单号: ${orderNo || "-"}`,
    `客户: ${customer || "-"}`,
  ];

  if (!groups.length) {
    const fallback = getOrderSummary(row.orderNo, row.summary || "");
    lines.push("", `物料内容: ${fallback || "-"}`);
    return lines.join("\n");
  }

  groups.forEach((g, idx) => {
    const status = normalizeStatus(g?.status, row, extra);
    const groupAmount = getGroupAmountValue(g);
    const amountText = groupAmount == null ? "-" : formatCurrency(groupAmount);
    const detailLines = (Array.isArray(g.lines) ? g.lines : [])
      .map((line) => {
        const size = String(line?.size || "").trim();
        const qty = formatLineQtyText(line?.qty);
        const lineAmount = getLineAmountValue(line);
        const lineAmountText = lineAmount == null ? "-" : formatCurrency(lineAmount);
        const parts = [];
        if (size) parts.push(`尺寸 ${size}`);
        if (qty !== "-") parts.push(`数量 ${qty}`);
        if (lineAmountText !== "-") parts.push(`金额 ${lineAmountText}`);
        return parts.length ? `  - ${parts.join("   ")}` : "";
      })
      .filter(Boolean);

    const materialText = [String(g.material || "").trim(), String(g.supplier || "").trim()]
      .filter(Boolean)
      .join(" / ");
    const orderedAtValue = g?.orderedAt || (status === "下单" ? (row?.createdAt || row?.updatedAt || "") : "");
    const orderedAtText = formatDateTimeText(orderedAtValue) || "-";
    const purchasedAtText = formatDateTimeText(g?.purchasedAt) || "-";
    const arrivedAtText = status === "异常" ? "-" : (formatDateTimeText(g?.arrivedAt) || "-");

    lines.push("");
    lines.push(`${idx + 1}. ${materialText || "未填写材质/供应商"}`);
    if (detailLines.length) {
      lines.push("  明细:");
      lines.push(...detailLines);
    } else {
      lines.push("  明细: -");
    }
    lines.push(`  金额合计: ${amountText}`);
    lines.push(`  状态: ${status}`);
    lines.push(`  下单时间: ${orderedAtText}`);
    lines.push(`  采购时间: ${purchasedAtText}`);
    lines.push(`  到货时间: ${arrivedAtText}`);
  });

  return lines.join("\n");
}

function getSupplierFilterText(row, extra) {
  const groups = getCachedMaterialGroups(row, extra);
  const supplierList = groups.map((g) => String(g.supplier || "").trim()).filter(Boolean);
  const merged = [String(extra?.supplier || "").trim(), ...supplierList].filter(Boolean);
  return normalizeSupplierSearchText(merged.join(" "));
}

function normalizeSupplierSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\/|,，;；]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isVirtualRenderEnabled(total) {
  return Boolean(el.tableWrap && total >= VIRTUAL_ENABLED_THRESHOLD);
}

function getVirtualWindow(total) {
  if (!isVirtualRenderEnabled(total)) return { start: 0, end: total, topPad: 0, bottomPad: 0 };
  const wrap = el.tableWrap;
  const scrollTop = wrap?.scrollTop || 0;
  const clientHeight = wrap?.clientHeight || 0;
  const estimatedStart = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_ESTIMATE) - VIRTUAL_OVERSCAN_ROWS);
  const estimatedVisible = Math.ceil(clientHeight / VIRTUAL_ROW_ESTIMATE) + VIRTUAL_OVERSCAN_ROWS * 2;
  const start = Math.min(Math.max(0, estimatedStart), Math.max(0, total - 1));
  const end = Math.min(total, start + Math.max(estimatedVisible, VIRTUAL_OVERSCAN_ROWS * 2));
  const topPad = start * VIRTUAL_ROW_ESTIMATE;
  const bottomPad = Math.max(0, (total - end) * VIRTUAL_ROW_ESTIMATE);
  return { start, end, topPad, bottomPad };
}

function makeRowRenderSignature(row, extra, visibleEntries) {
  return JSON.stringify({
    selected: selectedRowId === row.id,
    orderNo: String(row.orderNo || ""),
    customer: String(row.customer || ""),
    material: String(row.material || ""),
    spec: String(row.spec || ""),
    quantity: String(row.quantity ?? ""),
    amount: String(row.amount ?? ""),
    isReady: String(row.isReady || ""),
    updatedAt: String(row.updatedAt || row.createdAt || ""),
    extraSupplier: String(extra?.supplier || ""),
    extraStatus: String(extra?.status || ""),
    visibleLen: Array.isArray(visibleEntries) ? visibleEntries.length : 0,
    visible: Array.isArray(visibleEntries)
      ? visibleEntries.map((entry) => ({
        i: Number(entry.index || 0),
        m: String(entry.group?.material || ""),
        s: String(entry.group?.supplier || ""),
        st: String(entry.group?.status || ""),
        a: String(entry.group?.amount ?? ""),
        l: Array.isArray(entry.group?.lines)
          ? entry.group.lines.map((line) => `${String(line?.size || "")}:${String(line?.qty ?? "")}:${String(line?.amount ?? "")}`).join("|")
          : "",
      }))
      : [],
  });
}

function buildRowTr(row, extra, visibleEntries) {
  const tr = document.createElement("tr");
  tr.dataset.rowId = row.id;
  if (selectedRowId === row.id) tr.classList.add("material-row-selected");
  tr.appendChild(editCell(row, "orderNo"));
  tr.appendChild(textCell(row.customer || ""));
  tr.appendChild(materialDetailCell(row, extra, visibleEntries));
  tr.appendChild(amountDetailCell(row, extra, visibleEntries));
  tr.appendChild(statusDetailCell(row, extra, visibleEntries));
  tr.appendChild(actionDetailCell(row, extra, visibleEntries));
  tr.appendChild(summaryCell(buildContentSummary(row, extra, visibleEntries)));
  return tr;
}

function getRowTr(row, extra, visibleEntries) {
  const signature = makeRowRenderSignature(row, extra, visibleEntries);
  const cached = rowDomCache.get(row.id);
  if (cached && cached.signature === signature && cached.tr) return cached.tr;
  const tr = buildRowTr(row, extra, visibleEntries);
  rowDomCache.set(row.id, { signature, tr });
  return tr;
}

function createPadRow(heightPx) {
  const tr = document.createElement("tr");
  tr.className = "material-virtual-pad-row";
  const td = document.createElement("td");
  td.colSpan = 7;
  td.style.height = `${Math.max(0, Math.floor(heightPx))}px`;
  td.style.padding = "0";
  td.style.border = "0";
  td.style.background = "transparent";
  tr.appendChild(td);
  return tr;
}

function renderViewportRows() {
  if (!el.tableBody) return;
  const startTs = DEBUG_PERF ? performance.now() : 0;
  const list = currentRenderList;
  const total = list.length;
  const { start, end, topPad, bottomPad } = getVirtualWindow(total);
  const frag = document.createDocumentFragment();
  if (topPad > 0) frag.appendChild(createPadRow(topPad));
  for (let i = start; i < end; i += 1) {
    const row = list[i];
    const extra = currentRenderExtraMap.get(row.id) || createDefaultExtra();
    const visibleEntries = getVisibleGroupEntries(row, extra);
    frag.appendChild(getRowTr(row, extra, visibleEntries));
  }
  if (bottomPad > 0) frag.appendChild(createPadRow(bottomPad));
  el.tableBody.replaceChildren(frag);
  if (shouldSyncGroupHeights(total)) {
    if (suppressNextGroupHeightSync) {
      suppressNextGroupHeightSync = false;
    } else {
      scheduleGroupHeightSync();
    }
  } else {
    suppressNextGroupHeightSync = false;
    if (pendingGroupHeightRaf) {
      cancelAnimationFrame(pendingGroupHeightRaf);
      pendingGroupHeightRaf = 0;
    }
  }
  if (DEBUG_PERF) {
    const cost = performance.now() - startTs;
    const rendered = Math.max(0, end - start);
    console.debug(`[material] render ${cost.toFixed(1)}ms (visible ${rendered}/${total})`);
  }
}

function scheduleViewportRender() {
  if (pendingViewportRenderRaf) return;
  pendingViewportRenderRaf = requestAnimationFrame(() => {
    pendingViewportRenderRaf = 0;
    renderViewportRows();
  });
}

function render() {
  cleanupExtras();
  initCustomerFilterOptions();
  if (supplierFilterDirty) {
    initSupplierFilterOptions();
    supplierFilterDirty = false;
  }
  currentRenderList = getFilteredRows();
  currentRenderExtraMap = buildExtraMap(currentRenderList);
  renderMaterialSummary(currentRenderList, currentRenderExtraMap);
  renderOrderHints();
  if (pendingViewportRenderRaf) {
    cancelAnimationFrame(pendingViewportRenderRaf);
    pendingViewportRenderRaf = 0;
  }
  renderViewportRows();
}

function renderMaterialSummary(list, extraMap = new Map()) {
  if (!el.summaryAmountTotal) return;
  const total = list.reduce((sum, row) => {
    const extra = extraMap.get(row.id) || createDefaultExtra();
    const visibleEntries = getVisibleGroupEntries(row, extra);
    const rowAmount = visibleEntries.reduce((groupSum, entry) => {
      const value = getGroupAmountValue(entry?.group);
      return value == null ? groupSum : groupSum + value;
    }, 0);
    return sum + rowAmount;
  }, 0);
  el.summaryAmountTotal.textContent = formatCurrency(total);
}

function summaryCell(text) {
  const td = document.createElement("td");
  td.className = "material-summary-cell";
  td.title = "可选中后复制";

  const box = document.createElement("div");
  box.className = "material-summary-box";
  box.textContent = String(text || "");
  td.appendChild(box);

  // Keep text selection stable: avoid row click re-render when selecting/copying summary text.
  ["mousedown", "mouseup", "click", "dblclick"].forEach((evt) => {
    td.addEventListener(evt, (event) => event.stopPropagation());
  });
  return td;
}

function amountDetailCell(row, extra, visibleEntries = null) {
  const td = document.createElement("td");
  td.className = "material-amount-cell";
  const groups = Array.isArray(visibleEntries)
    ? visibleEntries.map((entry) => ({ ...entry.group, __sourceIndex: entry.index }))
    : getCachedMaterialGroups(row, extra).map((g, idx) => ({ ...g, __sourceIndex: idx }));
  if (!groups.length) {
    td.textContent = "未填写";
    return td;
  }
  groups.forEach((g, idx) => {
    const group = document.createElement("div");
    group.className = "material-amount-group";
    if (idx > 0) group.classList.add("is-group-gap");
    const amountText = document.createElement("div");
    amountText.className = "material-amount-value";
    const value = getGroupAmountValue(g);
    amountText.textContent = value == null ? "未填写" : formatCurrency(value);
    group.appendChild(amountText);
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
  if (!row) {
    showInfo("当前记录已被刷新或删除，请关闭弹窗后重试。", "保存失败");
    amountEditingRowId = "";
    amountEditingGroupIndex = -1;
    closeDialog(el.amountDialog);
    return;
  }
  const extra = getExtra(amountEditingRowId);
  const groups = parseMaterialGroups(row, extra);
  if (!groups[amountEditingGroupIndex]) {
    showInfo("当前分组已变化，请重新打开后再保存。", "保存失败");
    amountEditingRowId = "";
    amountEditingGroupIndex = -1;
    closeDialog(el.amountDialog);
    return;
  }
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

function makeGroupActionKey(rowId, groupIndex) {
  return `${String(rowId || "")}:${Number(groupIndex || 0)}`;
}
function statusDetailCell(row, extra, visibleEntries = null) {
  const td = document.createElement("td");
  td.className = "material-status-cell";
  const groups = Array.isArray(visibleEntries)
    ? visibleEntries.map((entry) => ({ ...entry.group, __sourceIndex: entry.index }))
    : getCachedMaterialGroups(row, extra).map((g, idx) => ({ ...g, __sourceIndex: idx }));
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
    const sourceIndex = Number(g.__sourceIndex ?? idx);
    const pendingKey = makeGroupActionKey(row.id, sourceIndex);
    const isPending = pendingStatusPersistKeys.has(pendingKey);
    btn.textContent = isPending ? `${statusText}...` : statusText;
    btn.dataset.status = statusText;
    btn.title = isPending ? "同步中" : "点击切换状态";
    btn.dataset.action = "cycle-status";
    btn.dataset.rowId = row.id;
    btn.dataset.groupIndex = String(sourceIndex);
    btn.disabled = isPending;
    group.appendChild(btn);
    td.appendChild(group);
  });
  return td;
}

function patchRenderedRow(rowId) {
  if (!el.tableBody) return false;
  const row = rows.find((r) => r.id === rowId);
  if (!row) return false;
  const currentTr = el.tableBody.querySelector(`tr[data-row-id="${rowId}"]`);
  if (!(currentTr instanceof HTMLTableRowElement)) return false;
  const extra = getExtra(rowId);
  const visibleEntries = getVisibleGroupEntries(row, extra);
  currentRenderExtraMap.set(rowId, extra);
  rowDomCache.delete(rowId);
  const nextTr = getRowTr(row, extra, visibleEntries);
  currentTr.replaceWith(nextTr);
  syncGroupHeightsForRow(nextTr);
  return true;
}

function applyStatusUiUpdate(rowId) {
  const hasGroupFilter = Boolean(filterState.supplier || filterState.status);
  const isVirtual = isVirtualRenderEnabled(currentRenderList.length);
  const inCurrent = currentRenderList.some((x) => x.id === rowId);

  if (!hasGroupFilter && !isVirtual && inCurrent) {
    const patched = patchRenderedRow(rowId);
    if (patched) {
      renderMaterialSummary(currentRenderList, currentRenderExtraMap);
      renderKpi(currentRenderList, currentRenderExtraMap);
      return;
    }
  }

  suppressNextGroupHeightSync = true;
  render();
}
function cycleGroupStatus(rowId, groupIndex) {
  const key = makeGroupActionKey(rowId, groupIndex);
  if (pendingStatusPersistKeys.has(key)) return;

  const row = rows.find((r) => r.id === rowId);
  if (!row) return;
  const extra = getExtra(row.id);
  const groups = parseMaterialGroups(row, extra);
  if (!groups[groupIndex]) return;

  const current = normalizeStatus(groups[groupIndex]?.status, row, extra);
  const idx = STATUS_LIST.indexOf(current);
  const next = STATUS_LIST[(idx + 1) % STATUS_LIST.length] || STATUS_LIST[0];
  groups[groupIndex].status = next;
  if (next === "下单" && !groups[groupIndex].orderedAt) groups[groupIndex].orderedAt = nowIso();
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

  pendingStatusPersistKeys.add(key);
  applyStatusUiUpdate(row.id);

  void persist({ changed: [row], notifyAuth: false })
    .catch((e) => console.error("status persist failed", e))
    .finally(() => {
      pendingStatusPersistKeys.delete(key);
      rowDomCache.delete(row.id);
      applyStatusUiUpdate(row.id);
    });
}

function materialDetailCell(row, extra, visibleEntries = null) {
  const td = document.createElement("td");
  td.className = "material-detail-cell";
  td.dataset.id = row.id;
  td.title = "可选中后复制";
  ["mousedown", "mouseup", "click", "dblclick"].forEach((evt) => {
    td.addEventListener(evt, (event) => {
      event.stopPropagation();
      extendSummarySelectionHold();
    });
  });
  const groups = Array.isArray(visibleEntries)
    ? visibleEntries.map((entry) => ({ ...entry.group, __sourceIndex: entry.index }))
    : getCachedMaterialGroups(row, extra).map((g, idx) => ({ ...g, __sourceIndex: idx }));
  const hasContent = groups.some((g) => g.material || g.supplier || g.lines.some((x) => x.size || x.qty !== "" || x.amount !== ""));
  if (!hasContent) {
    const empty = document.createElement("div");
    empty.className = "material-detail-group";
    const emptyLine = document.createElement("div");
    emptyLine.className = "material-detail-line";
    emptyLine.textContent = "点击填写材质、尺寸、数量、金额、供应商";
    empty.appendChild(emptyLine);
    const groupActions = document.createElement("div");
    groupActions.className = "material-detail-group-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "material-icon-btn";
    editBtn.setAttribute("aria-label", "编辑");
    editBtn.title = "编辑";
    editBtn.dataset.action = "edit-item";
    editBtn.dataset.itemKind = "material";
    editBtn.dataset.rowId = row.id;
    editBtn.dataset.groupIndex = "0";
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
      const linkText = String(g?.supplierLink || "").trim();
      if (linkText) {
        const linkWrap = document.createElement("div");
        linkWrap.className = "material-detail-link";
        const safeHref = toSafeExternalHttpUrl(linkText);
        if (safeHref) {
          const link = document.createElement("a");
          link.href = safeHref;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = linkText;
          link.addEventListener("click", (event) => event.stopPropagation());
          linkWrap.appendChild(link);
        } else {
          const linkTextNode = document.createElement("span");
          linkTextNode.textContent = linkText;
          linkTextNode.title = "链接无效或协议不安全（仅允许 http/https）";
          linkWrap.appendChild(linkTextNode);
        }
        group.appendChild(linkWrap);
      }
      g.lines.forEach((line) => {
        const item = document.createElement("div");
        item.className = "material-detail-line";
        const size = String(line.size || "").trim() || "-";
        const qtyText = formatLineQtyText(line.qty);
        const amountValue = getLineAmountValue(line);
        const amountText = amountValue == null ? "-" : formatCurrency(amountValue);

        const hasQty = qtyText !== "-";
        const hasAmount = amountText !== "-";

        const sizeText = document.createElement("span");
        sizeText.className = "material-detail-size";
        sizeText.textContent = size;
        item.appendChild(sizeText);

        const qtyTag = document.createElement("span");
        qtyTag.className = "material-detail-qty";
        qtyTag.textContent = hasQty ? qtyText : "-";
        if (!hasQty) qtyTag.classList.add("is-empty");
        item.appendChild(qtyTag);

        const amountTag = document.createElement("span");
        amountTag.className = "material-detail-amount";
        amountTag.textContent = amountText;
        if (!hasAmount) amountTag.classList.add("is-empty");
        item.appendChild(amountTag);

        group.appendChild(item);
      });
      const groupActions = document.createElement("div");
      groupActions.className = "material-detail-group-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "material-icon-btn";
      editBtn.setAttribute("aria-label", "编辑");
      editBtn.title = "编辑";
      editBtn.dataset.action = "edit-item";
      editBtn.dataset.itemKind = String(g?.itemKind || "material");
      editBtn.dataset.rowId = row.id;
      editBtn.dataset.groupIndex = String(Number(g.__sourceIndex ?? idx));
      editBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const kind = String(g?.itemKind || "material");
        const sourceIndex = Number(g.__sourceIndex ?? idx);
        if (kind === "other") {
          openOtherItemDialog(row.id, { groupIndex: sourceIndex });
        } else {
          openMaterialItemDialog(row.id, { groupIndex: sourceIndex });
        }
      });
      groupActions.appendChild(editBtn);
      group.appendChild(groupActions);
      if (idx > 0) group.classList.add("is-group-gap");
      td.appendChild(group);
    });
  }
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
      if (next === "") {
        row[key] = "";
      } else {
        const n = Number(next);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          td.textContent = old;
          showInfo("数量必须为大于等于 0 的整数。", "校验失败");
          return;
        }
        next = String(Math.floor(n));
      }
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

function actionDetailCell(row, extra, visibleEntries = null) {
  const td = document.createElement("td");
  td.className = "material-op-cell";
  const groups = Array.isArray(visibleEntries)
    ? visibleEntries.map((entry) => ({ ...entry.group, __sourceIndex: entry.index }))
    : getCachedMaterialGroups(row, extra).map((g, idx) => ({ ...g, __sourceIndex: idx }));
  if (!groups.length) {
    const group = document.createElement("div");
    group.className = "material-op-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-btn";
    btn.textContent = "删除";
    btn.dataset.action = "delete-row";
    btn.dataset.rowId = row.id;
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
    btn.dataset.action = "delete-group";
    btn.dataset.rowId = row.id;
    btn.dataset.groupIndex = String(Number(g.__sourceIndex ?? idx));
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
  if (!(await openDeleteConfirm("确认删除该物料分组吗？"))) return;
  groups.splice(groupIndex, 1);
  if (!groups.length) {
    await deleteRow(row.id, true);
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

async function deleteRow(id, skipConfirm = false) {
  if (!skipConfirm && !(await openDeleteConfirm("确认删除该物料行吗？"))) return;
  rows = rows.filter((r) => r.id !== id);
  invalidateRowCaches(id);
  markSupplierFilterDirty();
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
  if (!row) {
    showInfo("当前记录已被刷新或删除，请关闭弹窗后重试。", "保存失败");
    activeRowId = "";
    closeDialog(el.poDialog);
    return;
  }
  const qtyRaw = String(el.poQty?.value || "").trim();
  const qtyNum = Number(qtyRaw);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
    showInfo("请填写大于 0 的下单数量。", "校验失败");
    return;
  }
  const qty = Math.floor(qtyNum);

  const priceRaw = String(el.poPrice?.value || "").trim();
  const priceNum = priceRaw === "" ? 0 : Number(priceRaw);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    showInfo("单价必须是大于等于 0 的数字。", "校验失败");
    return;
  }
  const price = Number(priceNum.toFixed(2));
  const old = getExtra(row.id);
  const extra = getExtra(row.id);
  const groups = parseMaterialGroups(row, extra);
  groups.forEach((g) => {
    if (!g.orderedAt) g.orderedAt = nowIso();
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

function openArrivalDialog(id) { activeRowId = id; if (el.arrivalQty) el.arrivalQty.value = ""; if (el.arrivalDate) el.arrivalDate.value = todayLocalDateString(); openDialog(el.arrivalDialog); }
async function saveArrival() {
  const row = rows.find((r) => r.id === activeRowId);
  if (!row) {
    showInfo("当前记录已被刷新或删除，请关闭弹窗后重试。", "保存失败");
    activeRowId = "";
    closeDialog(el.arrivalDialog);
    return;
  }
  const qtyRaw = String(el.arrivalQty?.value || "").trim();
  const qtyNum = Number(qtyRaw);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0 || !Number.isInteger(qtyNum)) { showInfo("请填写大于 0 的整数到货数量。", "校验失败"); return; }
  const qty = Math.floor(qtyNum);
  const stockBefore = getCurrentStock(row);
  const e = getExtra(row.id);
  const left = Math.max(0, Number(e.inTransit || 0) - qty);
  const status = left > 0 ? "采购" : "到货";
  const extra = getExtra(row.id);
  const groups = parseMaterialGroups(row, extra);
  groups.forEach((g) => {
    if (!g.orderedAt) g.orderedAt = nowIso();
    g.status = status;
    if (status === "到货") g.arrivedAt = nowIso();
  });
  const serialized = serializeMaterialGroups(groups);
  row.material = serialized.material;
  row.spec = serialized.spec;
  row.quantity = serialized.quantity;
  row.amount = serialized.amount;
  saveExtra(row.id, { inTransit: left, actualDate: String(el.arrivalDate?.value || "").trim(), status });
  row.quantity = stockBefore + qty;
  row.isReady = status === "到货" ? "是" : "否";
  await persist({ changed: [row] });
  closeDialog(el.arrivalDialog);
  render();
}

function openAbnormalDialog(id) { activeRowId = id; const e = getExtra(id); if (el.abnormalReason) el.abnormalReason.value = e.abnormalReason || ""; if (el.abnormalAlt) el.abnormalAlt.value = e.abnormalAltMaterial || ""; if (el.abnormalRecover) el.abnormalRecover.value = e.abnormalRecoverDate || ""; openDialog(el.abnormalDialog); }
async function saveAbnormal() {
  const row = rows.find((r) => r.id === activeRowId);
  if (!row) {
    showInfo("当前记录已被刷新或删除，请关闭弹窗后重试。", "保存失败");
    activeRowId = "";
    closeDialog(el.abnormalDialog);
    return;
  }
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
function refreshBodyOverflow() {
  const open = [
    el.authDialog,
    el.poDialog,
    el.arrivalDialog,
    el.abnormalDialog,
    el.materialItemDialog,
    el.otherDialog,
    el.amountDialog,
    el.materialCustomDialog,
    el.supplierCustomDialog,
    el.infoDialog,
    el.imagePreviewDialog,
    el.deleteConfirmDialog,
  ].some((d) => d && !d.hidden);
  if (!open) document.body.style.overflow = "";
}

function openDeleteConfirm(message) {
  return new Promise((resolve) => {
    if (!el.deleteConfirmDialog) {
      showInfo(message || "确认执行删除操作吗？", "确认删除");
      resolve(false);
      return;
    }
    deleteConfirmResolver = resolve;
    if (el.deleteConfirmText) el.deleteConfirmText.textContent = message || "确认执行删除操作吗？";
    openDialog(el.deleteConfirmDialog);
    if (el.deleteConfirmCancel) el.deleteConfirmCancel.focus();
  });
}

function closeDeleteConfirm(confirmed) {
  if (el.deleteConfirmDialog) closeDialog(el.deleteConfirmDialog);
  const resolver = deleteConfirmResolver;
  deleteConfirmResolver = null;
  if (resolver) resolver(Boolean(confirmed));
}

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

function updateSelectedRowClass(rowId, selected) {
  if (!el.tableBody || !rowId) return;
  const tr = el.tableBody.querySelector(`tr[data-row-id="${rowId}"]`);
  if (!tr) return;
  tr.classList.toggle("material-row-selected", Boolean(selected));
}

function shouldSyncGroupHeights(totalRows = currentRenderList.length) {
  return !isVirtualRenderEnabled(totalRows);
}

function scheduleGroupHeightSync() {
  if (!shouldSyncGroupHeights()) return;
  if (pendingGroupHeightRaf) cancelAnimationFrame(pendingGroupHeightRaf);
  pendingGroupHeightRaf = requestAnimationFrame(() => {
    pendingGroupHeightRaf = 0;
    syncGroupHeights();
  });
}

function syncGroupHeightsForRow(tr) {
  if (!(tr instanceof HTMLElement)) return;
  const materialGroups = tr.querySelectorAll("td:nth-child(3) .material-detail-group");
  const amountGroups = tr.querySelectorAll("td:nth-child(4) .material-amount-group");
  const statusGroups = tr.querySelectorAll("td:nth-child(5) .material-status-group");
  const opGroups = tr.querySelectorAll("td:nth-child(6) .material-op-group");
  const summaryBox = tr.querySelector("td:nth-child(7) .material-summary-box");

  if (!materialGroups.length || !amountGroups.length || !statusGroups.length || !opGroups.length) {
    if (summaryBox instanceof HTMLElement) {
      const fallbackHeight = 80;
      summaryBox.style.height = `${fallbackHeight}px`;
      summaryBox.style.maxHeight = `${fallbackHeight}px`;
    }
    return;
  }

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

  if (summaryBox instanceof HTMLElement) {
    let materialTotalHeight = 0;
    for (let i = 0; i < materialGroups.length; i += 1) {
      materialTotalHeight += materialGroups[i].offsetHeight;
      if (i > 0) materialTotalHeight += 5;
    }
    const targetHeight = Math.max(80, Math.floor(materialTotalHeight));
    summaryBox.style.height = `${targetHeight}px`;
    summaryBox.style.maxHeight = `${targetHeight}px`;
  }
}

function syncGroupHeights() {
  if (!shouldSyncGroupHeights()) return;
  if (!el.tableBody) return;
  const wrapRect = el.tableWrap?.getBoundingClientRect?.() || null;
  const visiblePadding = 120;
  el.tableBody.querySelectorAll("tr").forEach((tr) => {
    if (wrapRect) {
      const rect = tr.getBoundingClientRect();
      if (rect.bottom < wrapRect.top - visiblePadding || rect.top > wrapRect.bottom + visiblePadding) return;
    }
    syncGroupHeightsForRow(tr);
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
  renderMaterialLineRows([{ size: "", qty: "", amount: "" }]);
  if (el.materialSupplierInput) el.materialSupplierInput.value = "";
}

function createEmptyMaterialGroup(kind = "material") {
  return { itemKind: kind, material: "", supplier: "", supplierLink: "", amount: "", status: "下单", orderedAt: "", purchasedAt: "", arrivedAt: "", screenshot: "", lines: [{ size: "", qty: "", amount: "" }] };
}

function appendMaterialLineRow(size = "", qty = "", amount = "") {
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

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "0.01";
  amountInput.className = "material-line-amount";
  amountInput.placeholder = "金额";
  amountInput.value = amount === "" ? "" : String(amount);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "action-btn";
  removeBtn.textContent = "删除";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!el.materialLineList?.children.length) appendMaterialLineRow("", "", "");
  });

  row.appendChild(sizeInput);
  row.appendChild(qtyInput);
  row.appendChild(amountInput);
  row.appendChild(removeBtn);
  el.materialLineList.appendChild(row);
}

function renderMaterialLineRows(lines = []) {
  if (!el.materialLineList) return;
  el.materialLineList.innerHTML = "";
  if (!lines.length) {
    appendMaterialLineRow("", "", "");
    return;
  }
  lines.forEach((line) => appendMaterialLineRow(line.size, line.qty, line.amount));
}

function collectMaterialLineRows() {
  if (!el.materialLineList) return [];
  const lines = [];
  el.materialLineList.querySelectorAll(".material-line-row").forEach((rowEl) => {
    const size = String(rowEl.querySelector(".material-line-size")?.value || "").trim();
    const qtyRaw = String(rowEl.querySelector(".material-line-qty")?.value || "").trim();
    const amountRaw = String(rowEl.querySelector(".material-line-amount")?.value || "").trim();
    const qtyNum = qtyRaw === "" ? NaN : Number(qtyRaw);
    const amountNum = amountRaw === "" ? NaN : Number(amountRaw);
    if (!size && !qtyRaw && !amountRaw) return;
    if (!size) return;
    lines.push({
      size,
      qty: Number.isFinite(qtyNum) && qtyNum >= 0 ? Math.floor(qtyNum) : null,
      amount: Number.isFinite(amountNum) && amountNum >= 0 ? Number(amountNum.toFixed(2)) : null,
    });
  });
  return lines;
}

function appendOtherLineRow(size = "", qty = "", amount = "") {
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

  const amountInput = document.createElement("input");
  amountInput.type = "number";
  amountInput.min = "0";
  amountInput.step = "0.01";
  amountInput.className = "other-line-amount";
  amountInput.placeholder = "金额";
  amountInput.value = amount === "" ? "" : String(amount);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "action-btn";
  removeBtn.textContent = "删除";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!el.otherLineList?.children.length) appendOtherLineRow("", "", "");
  });

  row.appendChild(sizeInput);
  row.appendChild(qtyInput);
  row.appendChild(amountInput);
  row.appendChild(removeBtn);
  el.otherLineList.appendChild(row);
}

function renderOtherLineRows(lines = []) {
  if (!el.otherLineList) return;
  el.otherLineList.innerHTML = "";
  if (!lines.length) {
    appendOtherLineRow("", "", "");
    return;
  }
  lines.forEach((line) => appendOtherLineRow(line.size, line.qty, line.amount));
}

function collectOtherLineRows() {
  if (!el.otherLineList) return [];
  const lines = [];
  el.otherLineList.querySelectorAll(".material-line-row").forEach((rowEl) => {
    const size = String(rowEl.querySelector(".other-line-size")?.value || "").trim();
    const qtyRaw = String(rowEl.querySelector(".other-line-qty")?.value || "").trim();
    const amountRaw = String(rowEl.querySelector(".other-line-amount")?.value || "").trim();
    const qtyNum = qtyRaw === "" ? NaN : Number(qtyRaw);
    const amountNum = amountRaw === "" ? NaN : Number(amountRaw);
    if (!size && !qtyRaw && !amountRaw) return;
    if (!size) return;
    lines.push({
      size,
      qty: Number.isFinite(qtyNum) && qtyNum >= 0 ? Math.floor(qtyNum) : null,
      amount: Number.isFinite(amountNum) && amountNum >= 0 ? Number(amountNum.toFixed(2)) : null,
    });
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
  if (el.otherSupplierLinkInput) el.otherSupplierLinkInput.value = String(currentGroup.supplierLink || "");
  otherScreenshotDataUrl = String(currentGroup.screenshot || "");
  void renderOtherScreenshotPreview();
  renderOtherLineRows(currentGroup.lines);
  openDialog(el.otherDialog);
  if (el.otherNameInput) el.otherNameInput.focus();
}

function clearOtherItemDetail() {
  if (el.otherNameInput) el.otherNameInput.value = "";
  if (el.otherSupplierInput) el.otherSupplierInput.value = "";
  if (el.otherSupplierLinkInput) el.otherSupplierLinkInput.value = "";
  clearOtherScreenshot();
  renderOtherLineRows([{ size: "", qty: "", amount: "" }]);
}

async function captureOtherScreenshot() {
  if (!window.isSecureContext) {
    showInfo("当前环境不支持截屏。", "功能受限");
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showInfo("当前浏览器不支持截屏。", "功能受限");
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
  } catch (e) {
    const name = String(e?.name || "");
    if (name !== "NotAllowedError" && name !== "AbortError") {
      showInfo("截屏失败，请重试。", "错误");
    }
  } finally {
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }
}

function clearOtherScreenshot() {
  otherScreenshotDataUrl = "";
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
    return;
  }
  const maxBytes = UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    showInfo(`截图大小不能超过 ${UPLOAD_MAX_MB}MB。`, "校验失败");
    return;
  }

  const row = rows.find((r) => r.id === otherItemEditingRowId);
  if (REMOTE_ENABLED && db && STORAGE_BUCKET && row && authSession?.user?.id) {
    try {
      const uploadedRef = await uploadScreenshotToSupabase(row, file);
      if (uploadedRef) {
        otherScreenshotDataUrl = uploadedRef;
        await renderOtherScreenshotPreview();
        return;
      }
    } catch (e) {
      console.warn("截图上传 Supabase Storage 失败，将回退本地预览", e);
      showInfo("Storage 上传失败，已临时保存到本地。", "提示");
    }
  }
  if (!(REMOTE_ENABLED && db && STORAGE_BUCKET && authSession?.user?.id)) {
    showInfo("未登录或未配置 Storage bucket，截图将仅保存在当前浏览器。", "提示");
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

async function uploadScreenshotToSupabase(row, file) {
  if (!db || !STORAGE_BUCKET) return "";
  const userId = String(authSession?.user?.id || "").trim();
  if (!userId) throw new Error("未登录，无法上传到 Storage");
  const ext = (() => {
    const byName = `.${(String(file.name || "").split(".").pop() || "").toLowerCase()}`;
    if (/^\.[a-z0-9]+$/i.test(byName) && byName.length <= 10) return byName;
    const byType = String(file.type || "").toLowerCase();
    if (byType.includes("png")) return ".png";
    if (byType.includes("jpeg") || byType.includes("jpg")) return ".jpg";
    if (byType.includes("webp")) return ".webp";
    return ".png";
  })();
  const datePart = new Date().toISOString().slice(0, 10);
  const orderNoSafe = String(row.orderNo || "no-order").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  const path = `${userId}/${datePart}/${orderNoSafe}_${String(row.id || "").slice(0, 8)}_${Date.now()}${ext}`;
  const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, file, {
    upsert: true,
    contentType: String(file.type || "image/png"),
    cacheControl: "3600",
  });
  if (error) throw error;
  return `sb:${STORAGE_BUCKET}/${path}`;
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
  if (raw.startsWith("sb:")) {
    const full = raw.slice(3);
    const slashIndex = full.indexOf("/");
    if (slashIndex <= 0 || !db) return "";
    const bucket = full.slice(0, slashIndex);
    const path = full.slice(slashIndex + 1);
    const cacheKey = `sb:${bucket}/${path}`;
    if (screenshotObjectUrlCache.has(cacheKey)) return screenshotObjectUrlCache.get(cacheKey);
    try {
      const { data, error } = await db.storage.from(bucket).createSignedUrl(path, STORAGE_SIGNED_EXPIRES);
      if (error) throw error;
      const signed = String(data?.signedUrl || "").trim();
      if (!signed) return "";
      screenshotObjectUrlCache.set(cacheKey, signed);
      return signed;
    } catch (e) {
      console.warn("加载 Storage 截图失败", e);
      return "";
    }
  }
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
              amount: Number.isFinite(Number(x?.amount)) ? Number(Math.max(0, Number(x.amount)).toFixed(2)) : "",
            }))
            .filter((x) => x.size || x.qty !== "" || x.amount !== ""),
        };
      }
    } catch {
      // ignore
    }
  }
  return {
    lines: [{ size: raw, qty: qtyValue === "" ? "" : Number(qtyValue) || "", amount: "" }],
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
            supplierLink: String(g?.supplierLink || g?.link || "").trim(),
            itemKind: String(g?.itemKind || "material"),
            amount: g?.amount === "" || g?.amount == null ? "" : Math.max(0, Number(g.amount) || 0),
            status: normalizeStatus(g?.status, row, extra),
            orderedAt: String(g?.orderedAt || g?.pendingAt || (normalizeStatus(g?.status, row, extra) === "下单" ? (row?.createdAt || row?.updatedAt || "") : "")),
            purchasedAt: String(g?.purchasedAt || ""),
            arrivedAt: String(g?.arrivedAt || ""),
            screenshot: String(g?.screenshot || ""),
            lines: Array.isArray(g?.lines)
              ? g.lines
                .map((line) => ({
                  size: String(line?.size || "").trim(),
                  qty: line?.qty === "" || line?.qty == null ? "" : Math.max(0, Math.floor(Number(line.qty) || 0)),
                  amount: line?.amount === "" || line?.amount == null ? "" : Number(Math.max(0, Number(line.amount) || 0).toFixed(2)),
                }))
                .filter((line) => line.size || line.qty !== "" || line.amount !== "")
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
  return [{
    itemKind: "material",
    material: fallbackMaterial,
    supplier: fallbackSupplier,
    supplierLink: "",
    amount: fallbackAmount,
    status: fallbackStatus,
    orderedAt: fallbackStatus === "下单" ? String(row?.createdAt || row?.updatedAt || "") : "",
    purchasedAt: "",
    arrivedAt: "",
    screenshot: "",
    lines: fallbackLines.map((line) => ({ ...line, amount: line?.amount ?? "" })),
  }];
}

function serializeMaterialGroups(groups = []) {
  const normalized = groups
    .map((g) => ({
      material: String(g?.material || "").trim(),
      supplier: String(g?.supplier || "").trim(),
      supplierLink: String(g?.supplierLink || "").trim(),
      itemKind: String(g?.itemKind || "material"),
      amount: g?.amount === "" || g?.amount == null ? "" : Number(Number(g.amount).toFixed(2)),
      status: normalizeStatus(g?.status),
      orderedAt: String(g?.orderedAt || ""),
      purchasedAt: String(g?.purchasedAt || ""),
      arrivedAt: String(g?.arrivedAt || ""),
      screenshot: String(g?.screenshot || ""),
      lines: (Array.isArray(g?.lines) ? g.lines : [])
        .map((line) => ({
          size: String(line?.size || "").trim(),
          qty: line?.qty === "" || line?.qty == null ? "" : Math.max(0, Math.floor(Number(line.qty) || 0)),
          amount: line?.amount === "" || line?.amount == null ? "" : Number(Math.max(0, Number(line.amount) || 0).toFixed(2)),
        }))
        .filter((line) => line.size || line.qty !== "" || line.amount !== ""),
    }))
    .filter((g) => g.material || g.supplier || g.lines.length > 0 || g.amount !== "");
  if (!normalized.length) return { material: "", spec: "", quantity: "", supplier: "", amount: "" };
  const qtyTotal = normalized.reduce((sum, g) => {
    const groupQty = g.lines.reduce((sub, line) => sub + (line.qty === "" ? 0 : Number(line.qty)), 0);
    return sum + groupQty;
  }, 0);
  const amountTotal = normalized.reduce((sum, g) => {
    const groupAmount = getGroupAmountValue(g);
    return groupAmount == null ? sum : sum + groupAmount;
  }, 0);
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
  if (!row) {
    showInfo("当前记录已被刷新或删除，请关闭弹窗后重试。", "保存失败");
    materialItemEditingRowId = "";
    materialItemEditingGroups = [];
    materialItemEditingGroupIndex = 0;
    closeDialog(el.materialItemDialog);
    return;
  }
  const material = String(el.materialInput?.value || "").trim();
  const supplier = String(el.materialSupplierInput?.value || "").trim();
  const lines = collectMaterialLineRows();

  const currentGroups = materialItemEditingGroups.length
    ? materialItemEditingGroups
    : parseMaterialGroups(row, getExtra(row.id));
  while (currentGroups.length <= materialItemEditingGroupIndex) currentGroups.push(createEmptyMaterialGroup());
  const existingAmount = currentGroups[materialItemEditingGroupIndex]?.amount ?? "";
  const existingStatus = normalizeStatus(currentGroups[materialItemEditingGroupIndex]?.status);
  const existingOrderedAt = String(currentGroups[materialItemEditingGroupIndex]?.orderedAt || "");
  const existingPurchasedAt = String(currentGroups[materialItemEditingGroupIndex]?.purchasedAt || "");
  const existingArrivedAt = String(currentGroups[materialItemEditingGroupIndex]?.arrivedAt || "");
  const existingScreenshot = String(currentGroups[materialItemEditingGroupIndex]?.screenshot || "");
  const existingSupplierLink = String(currentGroups[materialItemEditingGroupIndex]?.supplierLink || "");
  currentGroups[materialItemEditingGroupIndex] = { itemKind: "material", material, supplier, supplierLink: existingSupplierLink, amount: existingAmount, status: existingStatus, orderedAt: existingOrderedAt || nowIso(), purchasedAt: existingPurchasedAt, arrivedAt: existingArrivedAt, screenshot: existingScreenshot, lines };
  const serializedGroups = serializeMaterialGroups(currentGroups);
  row.material = serializedGroups.material;
  row.spec = serializedGroups.spec;
  row.quantity = serializedGroups.quantity;
  row.amount = serializedGroups.amount;
  const statusSummary = summarizeGroupStatus(row, getExtra(row.id), currentGroups);
  row.isReady = statusSummary.isReady;
  saveExtra(row.id, { supplier: serializedGroups.supplier, status: statusSummary.status });
  await persist({ changed: [row] });
  materialItemEditingRowId = "";
  materialItemEditingGroups = [];
  materialItemEditingGroupIndex = 0;
  closeDialog(el.materialItemDialog);
  render();
}

async function saveOtherItemDetail() {
  const row = rows.find((r) => r.id === otherItemEditingRowId);
  if (!row) {
    showInfo("当前记录已被刷新或删除，请关闭弹窗后重试。", "保存失败");
    otherItemEditingRowId = "";
    otherItemEditingGroupIndex = 0;
    materialItemEditingGroups = [];
    closeDialog(el.otherDialog);
    return;
  }
  const material = String(el.otherNameInput?.value || "").trim();
  const supplier = String(el.otherSupplierInput?.value || "").trim();
  const supplierLink = String(el.otherSupplierLinkInput?.value || "").trim();
  const lines = collectOtherLineRows();

  const currentGroups = materialItemEditingGroups.length
    ? materialItemEditingGroups
    : parseMaterialGroups(row, getExtra(row.id));
  while (currentGroups.length <= otherItemEditingGroupIndex) currentGroups.push(createEmptyMaterialGroup("other"));
  const existingAmount = currentGroups[otherItemEditingGroupIndex]?.amount ?? "";
  const existingStatus = normalizeStatus(currentGroups[otherItemEditingGroupIndex]?.status);
  const existingOrderedAt = String(currentGroups[otherItemEditingGroupIndex]?.orderedAt || "");
  const existingPurchasedAt = String(currentGroups[otherItemEditingGroupIndex]?.purchasedAt || "");
  const existingArrivedAt = String(currentGroups[otherItemEditingGroupIndex]?.arrivedAt || "");
  currentGroups[otherItemEditingGroupIndex] = { itemKind: "other", material, supplier, supplierLink, amount: existingAmount, status: existingStatus, orderedAt: existingOrderedAt || nowIso(), purchasedAt: existingPurchasedAt, arrivedAt: existingArrivedAt, screenshot: otherScreenshotDataUrl, lines };
  const serializedGroups = serializeMaterialGroups(currentGroups);
  row.material = serializedGroups.material;
  row.spec = serializedGroups.spec;
  row.quantity = serializedGroups.quantity;
  row.amount = serializedGroups.amount;
  const statusSummary = summarizeGroupStatus(row, getExtra(row.id), currentGroups);
  row.isReady = statusSummary.isReady;
  saveExtra(row.id, { supplier: serializedGroups.supplier, status: statusSummary.status });
  await persist({ changed: [row] });
  otherItemEditingRowId = "";
  otherItemEditingGroupIndex = 0;
  materialItemEditingGroups = [];
  closeDialog(el.otherDialog);
  render();
}

function handleTableWrapScroll() {
  updateBackTopBtn();
  if (isVirtualRenderEnabled(currentRenderList.length)) scheduleViewportRender();
}

function updateBackTopBtn() { if (!el.backTopBtn) return; const pageY = window.scrollY || 0; const tableY = el.tableWrap ? el.tableWrap.scrollTop : 0; el.backTopBtn.style.display = pageY > 120 || tableY > 120 ? "inline-flex" : "none"; }

async function initAuth() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  try { const { data, error } = await db.auth.getSession(); if (error) throw error; authSession = data?.session || null; } catch { authSession = null; }
  await refreshAuditPageAccess();
  updateAuthUi();
  db.auth.onAuthStateChange(async (_e, session) => {
    authSession = session || null;
    await refreshAuditPageAccess();
    updateAuthUi();
    if (shouldUseLocalOnlyMode()) {
      rows = loadLocalRows();
      resetDerivedCaches();
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
  } catch {
    canViewAuditPage = false;
  }
}

function updateAuthUi() { if (el.authUser) el.authUser.textContent = authSession?.user?.email || "未登录"; if (el.loginBtn) el.loginBtn.style.display = authSession ? "none" : "inline-flex"; if (el.logoutBtn) el.logoutBtn.style.display = authSession ? "inline-flex" : "none"; if (el.auditPageLink) el.auditPageLink.style.display = canViewAuditPage ? "inline-flex" : "none"; }
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
  if (changed.length > 0) {
    const base = Date.now();
    changed.forEach((r, i) => {
      const ts = new Date(base + i).toISOString();
      r.updatedAt = ts;
      invalidateRowCaches(r.id);
    });
    markSupplierFilterDirty();
  }
  if (deletedId) {
    invalidateRowCaches(deletedId);
    markSupplierFilterDirty();
  }
  saveLocalRows();
  setLastSyncTime();
  if (!REMOTE_ENABLED || !remoteOnline) return;
  if (!canWriteRemote(notifyAuth)) return;
  syncing = true;
  try {
    if (typeof MES_SHARED.syncSupabaseChanges === "function") {
      await MES_SHARED.syncSupabaseChanges({
        db,
        tableName: "mes_materials",
        changed,
        deletedId,
        onConflict: "id",
        mapChangedRow: (r) => toDbRow(r, r.updatedAt || new Date().toISOString()),
      });
    } else {
      if (changed.length > 0) {
        const payload = changed.map((r) => toDbRow(r, r.updatedAt || new Date().toISOString()));
        const { error } = await db.from("mes_materials").upsert(payload, { onConflict: "id" });
        if (error) throw error;
      }
      if (deletedId) {
        const { error } = await db.from("mes_materials").delete().eq("id", deletedId);
        if (error) throw error;
      }
    }
  } catch (e) {
    handleRemoteError("物料云端同步失败", e);
  } finally { syncing = false; }
}
function computeMaterialSyncCursor(list = []) {
  if (typeof MES_SHARED.computeLatestCursor === "function") {
    return MES_SHARED.computeLatestCursor(list, (row) => String(row?.updatedAt || row?.createdAt || ""));
  }
  return list.reduce((max, row) => {
    const value = String(row?.updatedAt || row?.createdAt || "");
    return value > max ? value : max;
  }, "");
}

function mergeRemoteRows(remoteList = []) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  remoteList.forEach((remoteRow) => {
    if (!remoteRow?.id) return;
    byId.set(remoteRow.id, { ...remoteRow, customer: resolveCustomer(remoteRow.orderNo, remoteRow.customer) });
  });
  rows = Array.from(byId.values()).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

async function refreshFromRemote(showAlert = false, preferIncremental = false) {
  if (!REMOTE_ENABLED || !remoteOnline) return;
  if (shouldUseLocalOnlyMode()) {
    rows = loadLocalRows();
    resetDerivedCaches();
    await ensureTestRowExists();
    setModeText("本地调试模式（未登录）");
    render();
    setLastSyncTime();
    return;
  }
  try {
    await refreshOrderCustomerMap(false);
    const shouldFullSync = !preferIncremental || !materialSyncCursor || materialIncrementalSyncCount >= FORCE_FULL_SYNC_INTERVAL;
    const remoteList =
      typeof MES_SHARED.fetchSupabaseRows === "function"
        ? await MES_SHARED.fetchSupabaseRows({
            db,
            tableName: "mes_materials",
            select: "*",
            orderBy: "updated_at",
            ascending: true,
            useCursor: !shouldFullSync,
            cursor: materialSyncCursor,
            cursorColumn: "updated_at",
            mapRow: fromDbRow,
          })
        : await (async () => {
            let query = db.from("mes_materials").select("*").order("updated_at", { ascending: true });
            if (!shouldFullSync && materialSyncCursor) query = query.gt("updated_at", materialSyncCursor);
            const { data, error } = await query;
            if (error) throw error;
            return (data || []).map(fromDbRow);
          })();
    if (shouldFullSync) {
      rows = remoteList
        .map((r) => ({ ...r, customer: resolveCustomer(r.orderNo, r.customer) }))
        .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
      materialIncrementalSyncCount = 0;
      resetDerivedCaches();
    } else if (remoteList.length > 0) {
      mergeRemoteRows(remoteList);
      materialIncrementalSyncCount += 1;
      markSupplierFilterDirty();
      remoteList.forEach((r) => invalidateRowCaches(r.id));
    } else {
      materialIncrementalSyncCount += 1;
    }
    materialSyncCursor = computeMaterialSyncCursor(rows);
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
    resetDerivedCaches();
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

function cleanupExtras() {
  const ids = new Set(rows.map((r) => r.id));
  let changed = false;
  Object.keys(extras).forEach((id) => {
    if (!ids.has(id)) {
      delete extras[id];
      changed = true;
    }
  });
  parsedGroupCache.forEach((_, id) => {
    if (!ids.has(id)) parsedGroupCache.delete(id);
  });
  rowDomCache.forEach((_, id) => {
    if (!ids.has(id)) rowDomCache.delete(id);
  });
  if (changed) saveExtras();
}
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
function fromDbRow(row) {
  const updatedAt = row.updated_at || row.created_at || new Date().toISOString();
  return {
    id: row.id || crypto.randomUUID(),
    createdAt: row.created_at || updatedAt,
    updatedAt,
    orderNo: String(row.order_no || ""),
    customer: String(row.customer || ""),
    material: String(row.material || ""),
    spec: String(row.spec || ""),
    quantity: row.quantity == null ? "" : Number(row.quantity),
    amount: row.amount == null ? "" : Number(row.amount),
    isReady: String(row.is_ready || ""),
  };
}
function toFiniteOrNull(v) { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

function saveLocalRows(options = {}) {
  if (materialLocalStore) {
    materialLocalStore.save(options);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}
function loadLocalRows() {
  if (typeof MES_SHARED.loadJsonList === "function") {
    return MES_SHARED.loadJsonList(STORAGE_KEY, {
      storage: window.localStorage,
      fallback: () => [],
      mapItem: (r, i) => {
        const fallbackTime = new Date(Date.now() + i).toISOString();
        const createdAt = r.createdAt || fallbackTime;
        const updatedAt = r.updatedAt || r.createdAt || fallbackTime;
        return { ...createEmptyRow(), ...r, createdAt, updatedAt };
      },
    });
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map((r, i) => {
      const fallbackTime = new Date(Date.now() + i).toISOString();
      const createdAt = r.createdAt || fallbackTime;
      const updatedAt = r.updatedAt || r.createdAt || fallbackTime;
      return { ...createEmptyRow(), ...r, createdAt, updatedAt };
    });
  } catch {
    return [];
  }
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
  if (!el.infoDialog || !el.infoText) { console.warn("info dialog not found", title, message); return; }
  if (el.infoTitle) el.infoTitle.textContent = title;
  el.infoText.textContent = String(message || "");
  openDialog(el.infoDialog);
}
function closeInfo() { closeDialog(el.infoDialog); }














