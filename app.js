﻿const STORAGE_KEY = "mini_mes_orders_v1";
const COL_WIDTH_KEY = "mini_mes_col_widths_v1";
const SHIFT_DEFAULTS_KEY = "mini_mes_shift_defaults_v1";

const STATUS = ["待排产", "已排产", "加工中", "完成待检", "返工", "可发货", "已发货"];
const KANBAN_STATUSES = STATUS.filter((s) => s !== "已发货");
const MACHINES = ["机台1", "机台2", "机台3", "机台4", "机台5"];
const FIXED_COL_WIDTHS = { 12: 90 };
const SURFACE_OPTIONS = ["", "阳极氧化", "发黑", "喷砂", "喷漆", "电镀", "拉丝", "抛光", "热处理", "钝化"];
const PROCESS_SEQUENCE_CRAFT = "CNC";
const PROCESS_SEQUENCE_MAX = 10;
const PROCESS_CRAFT_OPTIONS = ["下料", "车床", PROCESS_SEQUENCE_CRAFT, "钳工", "热处理", "表面处理", "外协"];
const XLSX_COLUMNS = [
  { key: "orderNo", title: "订单号" },
  { key: "customer", title: "客户" },
  { key: "name", title: "名称" },
  { key: "drawingNo", title: "图号" },
  { key: "qty", title: "数量" },
  { key: "programNo", title: "程序单" },
  { key: "processName", title: "工序" },
  { key: "plannedHours", title: "预计工时(分钟)" },
  { key: "machine", title: "机台" },
  { key: "lathe", title: "车床" },
  { key: "surface", title: "表面处理" },
  { key: "status", title: "状态" },
  { key: "startTime", title: "下单时间" },
  { key: "dueDate", title: "交期" },
  { key: "isDelayed", title: "是否延期" },
  { key: "note", title: "备注" },
];

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
const AUTO_REFRESH_MS = Math.max(5000, Number(MES_CONFIG.AUTO_REFRESH_SECONDS || 15) * 1000);
const ORDER_TEXT_BUCKET = String(MES_CONFIG.SUPABASE_STORAGE_BUCKET_ORDER_ATTACHMENTS || "order-attachments").trim();
const ORDER_BUTTON_BUCKET = String(MES_CONFIG.SUPABASE_STORAGE_BUCKET_TUZHI || "tuzhi").trim();
const UPLOAD_API_BASE =
  typeof MES_SHARED.normalizeUploadApiBase === "function"
    ? MES_SHARED.normalizeUploadApiBase(MES_CONFIG.UPLOAD_API_BASE, location.href)
    : String(MES_CONFIG.UPLOAD_API_BASE || "").trim();
const UPLOAD_MAX_MB = Math.max(1, Number(MES_CONFIG.UPLOAD_MAX_MB || 50));
const UPLOAD_ACCEPT = String(MES_CONFIG.UPLOAD_ACCEPT || ".pdf,.jpg,.jpeg,.png,.dwg,.step,.zip,.rar");
const db = supabaseSetup.db;
const FORCE_FULL_SYNC_INTERVAL = 12;
const VIRTUAL_ENABLED_THRESHOLD = 100;
const VIRTUAL_ROW_ESTIMATE = 46;
const VIRTUAL_OVERSCAN_ROWS = 18;
const DEBUG_PERF = Boolean(MES_CONFIG.DEBUG_PERF);
const BACKGROUND_REFRESH_MS = Math.max(AUTO_REFRESH_MS * 3, 30000);
window.__MES_BOOT__ = {
  href: location.href,
  hasSupabase: Boolean(window.supabase),
  supabaseUrl: MES_CONFIG.SUPABASE_URL || "",
  hasAnonKey: Boolean(MES_CONFIG.SUPABASE_ANON_KEY),
  remoteEnabled: REMOTE_ENABLED,
  orderTextBucket: ORDER_TEXT_BUCKET,
  orderButtonBucket: ORDER_BUTTON_BUCKET,
};

let orders = [];
let filters = {
  q: "",
  month: String(new Date().getMonth() + 1).padStart(2, "0"),
  machine: "",
  status: "",
  orderNo: "",
  statusColor: "",
};
let syncing = false;
let remoteOnline = REMOTE_ENABLED;
let remoteErrorNotified = false;
let reconnectTimer = null;
let reconnectDelayMs = 5000;
let syncPollTimer = 0;
let authSession = null;
let canViewAuditPage = false;
let authWriteHintNotified = false;
let abnormalOnly = false;
let lastSyncAt = "";
let stickyOffsetRaf = 0;
let columnWidths = loadColumnWidths();
let shiftDefaults = loadShiftDefaults();
let attachmentPanelOrderId = "";
let attachmentItems = [];
let attachmentLoading = false;
let previewObjectUrl = "";
let attachmentStateByLineId = new Map();
let attachmentStateLoading = new Set();
let processTimeEditingOrderId = "";
let statusEditingOrderId = "";
let dateEditingOrderId = "";
let dateEditingKey = "";
let surfaceEditingOrderId = "";
let noteEditingOrderId = "";
let quickEditOrderId = "";
let quickEditKey = "";
let transientCellErrors = new Map();
let ruleCellErrors = new Map();
let rowSavedUntil = new Map();
let saveFeedbackTimer = 0;
const kpiHighlightTimers = new Map();
let attachmentLatestTimeByLineId = new Map();
let dirtyCellMarks = new Set();
let pendingDeleteOrderId = "";
let authLoginSubmitting = false;
let authLoginSubmittingMode = "";
let authLoginCooldownUntil = 0;
let authLoginCooldownTimer = 0;
let actionConfirmResolver = null;
let processCraftOrderSeq = 0;
let ordersSyncCursor = "";
let orderIncrementalSyncCount = 0;
let currentRenderRows = [];
let currentRenderUnitFlags = new Map();
const orderRowDomCache = new Map();
let pendingViewportRenderRaf = 0;
let pendingFilterRenderTimer = 0;
let kanbanScaffoldReady = false;
let kanbanTotalPill = null;
const kanbanStatusPills = new Map();
const kanbanColState = new Map();
const kanbanCardCache = new Map();
let lastKanbanRenderStamp = "";
let lastKpiRenderStamp = "";
const orderLocalStore =
  typeof MES_SHARED.createBufferedJsonStorage === "function"
    ? MES_SHARED.createBufferedJsonStorage(STORAGE_KEY, () => orders, window.localStorage)
    : null;

const tableBody = document.getElementById("tableBody");
const systemMode = document.getElementById("systemMode");
const tableWrap = document.getElementById("tableWrap");
const backTopBtn = document.getElementById("backTopBtn");
const kpiGrid = document.getElementById("kpiGrid");
const kanbanBoard = document.getElementById("kanbanBoard");
const boardSummary = document.getElementById("boardSummary");
const reconnectBtn = document.getElementById("reconnectBtn");
const authUser = document.getElementById("authUser");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const auditPageLink = document.getElementById("auditPageLink");
const lastSyncTime = document.getElementById("lastSyncTime");
const abnormalFilterBtn = document.getElementById("abnormalFilterBtn");
const orderFilters = document.getElementById("orderFilters");
const filterToggleBtn = document.getElementById("filterToggleBtn");
const attachmentDialog = document.getElementById("attachmentDialog");
const attachmentTitle = document.getElementById("attachmentTitle");
const attachmentSubTitle = document.getElementById("attachmentSubTitle");
const attachmentHint = document.getElementById("attachmentHint");
const attachmentList = document.getElementById("attachmentList");
const attachmentUploadInput = document.getElementById("attachmentUploadInput");
const attachmentCloseBtn = document.getElementById("attachmentCloseBtn");
const previewDialog = document.getElementById("previewDialog");
const previewCloseBtn = document.getElementById("previewCloseBtn");
const previewTitle = document.getElementById("previewTitle");
const previewSubTitle = document.getElementById("previewSubTitle");
const previewBody = document.getElementById("previewBody");
const processTimeDialog = document.getElementById("processTimeDialog");
const processTimeTitle = document.getElementById("processTimeTitle");
const processTimeCloseBtn = document.getElementById("processTimeCloseBtn");
const processTimeCancelBtn = document.getElementById("processTimeCancelBtn");
const processTimeSaveBtn = document.getElementById("processTimeSaveBtn");
const processTimeClearBtn = document.getElementById("processTimeClearBtn");
const processTimeSubTitle = document.getElementById("processTimeSubTitle");
const processProgramInput = document.getElementById("processProgramInput");
const processCraftOptions = document.getElementById("processCraftOptions");
const processCraftPreview = document.getElementById("processCraftPreview");
const processCncStepWrap = document.getElementById("processCncStepWrap");
const processCncStepInput = document.getElementById("processCncStepInput");
const processSurfaceWrap = document.getElementById("processSurfaceWrap");
const processSurfaceInput = document.getElementById("processSurfaceInput");
const processMinutesInput = document.getElementById("processMinutesInput");
const processMachineInput = document.getElementById("processMachineInput");
const statusDialog = document.getElementById("statusDialog");
const statusTitle = document.getElementById("statusTitle");
const statusCloseBtn = document.getElementById("statusCloseBtn");
const statusCancelBtn = document.getElementById("statusCancelBtn");
const statusNextBtn = document.getElementById("statusNextBtn");
const statusSaveBtn = document.getElementById("statusSaveBtn");
const statusSubTitle = document.getElementById("statusSubTitle");
const statusInput = document.getElementById("statusInput");
const statusStepWrap = document.getElementById("statusStepWrap");
const statusStepInput = document.getElementById("statusStepInput");
const statusStepHint = document.getElementById("statusStepHint");
const statusProcessContext = document.getElementById("statusProcessContext");
const dateDialog = document.getElementById("dateDialog");
const dateTitle = document.getElementById("dateTitle");
const dateCloseBtn = document.getElementById("dateCloseBtn");
const dateCancelBtn = document.getElementById("dateCancelBtn");
const dateSaveBtn = document.getElementById("dateSaveBtn");
const dateClearBtn = document.getElementById("dateClearBtn");
const dateSubTitle = document.getElementById("dateSubTitle");
const dateMonthInput = document.getElementById("dateMonthInput");
const dateDayInput = document.getElementById("dateDayInput");
const surfaceDialog = document.getElementById("surfaceDialog");
const surfaceTitle = document.getElementById("surfaceTitle");
const surfaceCloseBtn = document.getElementById("surfaceCloseBtn");
const surfaceCancelBtn = document.getElementById("surfaceCancelBtn");
const surfaceSaveBtn = document.getElementById("surfaceSaveBtn");
const surfaceClearBtn = document.getElementById("surfaceClearBtn");
const surfaceSubTitle = document.getElementById("surfaceSubTitle");
const surfacePresetInput = document.getElementById("surfacePresetInput");
const surfaceCustomInput = document.getElementById("surfaceCustomInput");
const noteDialog = document.getElementById("noteDialog");
const noteTitle = document.getElementById("noteTitle");
const noteSubTitle = document.getElementById("noteSubTitle");
const noteInput = document.getElementById("noteInput");
const noteCloseBtn = document.getElementById("noteCloseBtn");
const noteCancelBtn = document.getElementById("noteCancelBtn");
const noteClearBtn = document.getElementById("noteClearBtn");
const noteSaveBtn = document.getElementById("noteSaveBtn");
const quickEditDialog = document.getElementById("quickEditDialog");
const quickEditTitle = document.getElementById("quickEditTitle");
const quickEditSubTitle = document.getElementById("quickEditSubTitle");
const quickEditInput = document.getElementById("quickEditInput");
const quickEditCloseBtn = document.getElementById("quickEditCloseBtn");
const quickEditCancelBtn = document.getElementById("quickEditCancelBtn");
const quickEditSaveBtn = document.getElementById("quickEditSaveBtn");
const saveFeedback = document.getElementById("saveFeedback");
const deleteConfirmDialog = document.getElementById("deleteConfirmDialog");
const deleteConfirmText = document.getElementById("deleteConfirmText");
const deleteConfirmCloseBtn = document.getElementById("deleteConfirmCloseBtn");
const deleteConfirmCancelBtn = document.getElementById("deleteConfirmCancelBtn");
const deleteConfirmOkBtn = document.getElementById("deleteConfirmOkBtn");
const authLoginDialog = document.getElementById("authLoginDialog");
const authLoginEmailInput = document.getElementById("authLoginEmailInput");
const authLoginPasswordInput = document.getElementById("authLoginPasswordInput");
const authLoginCloseBtn = document.getElementById("authLoginCloseBtn");
const authLoginCancelBtn = document.getElementById("authLoginCancelBtn");
const authPasswordLoginBtn = document.getElementById("authPasswordLoginBtn");
const authLoginSubmitBtn = document.getElementById("authLoginSubmitBtn");
const infoDialog = document.getElementById("infoDialog");
const infoDialogTitle = document.getElementById("infoDialogTitle");
const infoDialogText = document.getElementById("infoDialogText");
const infoDialogCloseBtn = document.getElementById("infoDialogCloseBtn");
const infoDialogOkBtn = document.getElementById("infoDialogOkBtn");
const actionConfirmDialog = document.getElementById("actionConfirmDialog");
const actionConfirmTitle = document.getElementById("actionConfirmTitle");
const actionConfirmText = document.getElementById("actionConfirmText");
const actionConfirmCloseBtn = document.getElementById("actionConfirmCloseBtn");
const actionConfirmCancelBtn = document.getElementById("actionConfirmCancelBtn");
const actionConfirmOkBtn = document.getElementById("actionConfirmOkBtn");
const PROCESS_TIME_TITLE_BASE = "预计工时设置";
const STATUS_TITLE_BASE = "状态设置";
const DATE_TITLE_BASE = "日期设置";
const SURFACE_TITLE_BASE = "表面处理设置";

init();

async function init() {
  syncPageActionLabels();
  bindEvents();
  updatePinnedOffsets();
  if (REMOTE_ENABLED) {
    await initAuth();
    setModeText(authSession ? "云端共享模式" : "云端只读（未登录）");
    await refreshFromRemoteIncremental(false, false);
    startAutoRefreshLoop();
  } else {
    setModeText("本地模式");
    orders = loadOrdersLocal();
    resetOrderDerivedCaches();
    ordersSyncCursor = computeOrdersSyncCursor(orders);
    render();
    setLastSyncTime();
  }
}

function setModeText(text) {
  if (systemMode) systemMode.textContent = text;
  syncReconnectButton();
  if (lastSyncTime && text.includes("失败")) lastSyncTime.classList.add("sync-warning");
  if (lastSyncTime && !text.includes("失败")) lastSyncTime.classList.remove("sync-warning");
  updatePinnedOffsets();
}

function setLastSyncTime() {
  lastSyncAt = new Date().toISOString();
  if (!lastSyncTime) return;
  const d = new Date(lastSyncAt);
  const t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  lastSyncTime.textContent = `最近同步 ${t}`;
}

function syncPageActionLabels() {
  const materialManageLink = document.querySelector('a[href="material.html"]');
  if (materialManageLink) materialManageLink.textContent = "物料管理";
}

function makeOrderFieldKey(orderId, key) {
  return `${orderId || ""}:${key || ""}`;
}

function getErrorKey(orderId, key) {
  return makeOrderFieldKey(orderId, key);
}

function getDirtyCellKey(orderId, key) {
  return makeOrderFieldKey(orderId, key);
}

function setDirtyCellMark(orderId, key, dirty) {
  const k = getDirtyCellKey(orderId, key);
  if (dirty) dirtyCellMarks.add(k);
  else dirtyCellMarks.delete(k);
}

function hasDirtyCellMark(orderId, key) {
  return dirtyCellMarks.has(getDirtyCellKey(orderId, key));
}

function appendDirtyCellDot(td, orderId, key) {
  if (!hasDirtyCellMark(orderId, key)) return;
  const dot = document.createElement("span");
  dot.className = "cell-dirty-dot";
  dot.title = "已修改未保存";
  td.appendChild(dot);
}

function setTransientCellError(orderId, key, message) {
  if (!orderId || !key) return;
  const k = getErrorKey(orderId, key);
  if (!message) transientCellErrors.delete(k);
  else transientCellErrors.set(k, String(message));
}

function clearTransientCellError(orderId, key) {
  if (!orderId || !key) return;
  transientCellErrors.delete(getErrorKey(orderId, key));
}

function getCellError(orderId, key) {
  const k = getErrorKey(orderId, key);
  if (transientCellErrors.has(k)) return transientCellErrors.get(k) || "";
  return ruleCellErrors.get(k) || "";
}

function appendCellError(td, orderId, key) {
  const msg = getCellError(orderId, key);
  if (!msg) return;
  td.classList.add("cell-has-error");
  const error = document.createElement("div");
  error.className = "cell-error";
  error.textContent = msg;
  td.appendChild(error);
}

function rebuildRuleCellErrors() {
  const next = new Map();
  const orderNoMap = new Map();

  orders.forEach((order) => {
    const no = String(order.orderNo || "").trim();
    if (!no) return;
    if (!orderNoMap.has(no)) orderNoMap.set(no, []);
    orderNoMap.get(no).push(order.id);
  });

  orderNoMap.forEach((ids) => {
    if (ids.length < 2) return;
    ids.forEach((id) => {
      next.set(getErrorKey(id, "orderNo"), "订单号重复");
    });
  });

  orders.forEach((order) => {
    const qtyRaw = String(order.qty ?? "").trim();
    const qtyNum = Number(qtyRaw);
    if (qtyRaw !== "" && (!Number.isFinite(qtyNum) || qtyNum < 0 || !Number.isInteger(qtyNum))) {
      next.set(getErrorKey(order.id, "qty"), "数量必须为大于等于0的整数");
    }
    const start = normalizeDateOnlyInput(order.startTime);
    const due = normalizeDateOnlyInput(order.dueDate);
    if (start && due && due < start) {
      const msg = "交期不能早于下单";
      next.set(getErrorKey(order.id, "startTime"), msg);
      next.set(getErrorKey(order.id, "dueDate"), msg);
    }
  });

  ruleCellErrors = next;
}

function markRowSaved(orderId) {
  if (!orderId) return;
  rowSavedUntil.set(orderId, Date.now() + 1500);
}

function showSaveFeedback(message = "已保存到 NAS") {
  if (!saveFeedback) return;
  saveFeedback.textContent = message;
  saveFeedback.classList.add("is-visible");
  if (saveFeedbackTimer) clearTimeout(saveFeedbackTimer);
  saveFeedbackTimer = setTimeout(() => {
    saveFeedback.classList.remove("is-visible");
  }, 1500);
}

function bindDialogEnterSave(dialogEl, saveFn) {
  if (!dialogEl) return;
  dialogEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const tag = String(event.target?.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") return;
    event.preventDefault();
    void saveFn();
  });
}

function bindEvents() {
  const quickAddBtn = document.getElementById("quickAddBtn");
  if (quickAddBtn) quickAddBtn.addEventListener("click", quickAdd);
  const addRowBtn = document.getElementById("addRowBtn");
  if (addRowBtn) addRowBtn.addEventListener("click", addBlankRow);
  const addBlankBottomBtn = document.getElementById("addBlankBottomBtn");
  if (addBlankBottomBtn) addBlankBottomBtn.addEventListener("click", addBlankRow);
  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.addEventListener("click", exportXlsx);
  const importInput = document.getElementById("importInput");
  if (importInput) importInput.addEventListener("change", importXlsx);
  if (backTopBtn) backTopBtn.addEventListener("click", scrollToTopRow);
  if (attachmentUploadInput) {
    attachmentUploadInput.accept = UPLOAD_ACCEPT;
    attachmentUploadInput.addEventListener("change", (event) => {
      void uploadAttachmentFromInput(event);
    });
  }
  if (attachmentCloseBtn) {
    attachmentCloseBtn.addEventListener("click", closeAttachmentDialog);
  }
  if (attachmentDialog) {
    attachmentDialog.addEventListener("click", (event) => {
      if (event.target === attachmentDialog) closeAttachmentDialog();
    });
  }
  if (previewCloseBtn) {
    previewCloseBtn.addEventListener("click", closePreviewDialog);
  }
  if (previewDialog) {
    previewDialog.addEventListener("click", (event) => {
      if (event.target === previewDialog) closePreviewDialog();
    });
  }
  initProcessTimeOptions();
  if (processTimeCloseBtn) {
    processTimeCloseBtn.addEventListener("click", closeProcessTimeDialog);
  }
  if (processTimeCancelBtn) {
    processTimeCancelBtn.addEventListener("click", closeProcessTimeDialog);
  }
  if (processTimeSaveBtn) {
    processTimeSaveBtn.addEventListener("click", () => {
      void saveProcessTimeDialog();
    });
  }
  if (processTimeClearBtn) {
    processTimeClearBtn.addEventListener("click", () => {
      if (processProgramInput) processProgramInput.value = "";
      if (processCraftOptions) {
        processCraftOptions.querySelectorAll('input[type="checkbox"]').forEach((el) => {
          el.checked = false;
        });
      }
      if (processCncStepInput) processCncStepInput.value = "1";
      if (processSurfaceInput) processSurfaceInput.value = "";
      syncProcessCraftPreview();
      if (processMinutesInput) processMinutesInput.value = "";
      if (processMachineInput) processMachineInput.value = "";
    });
  }
  if (processTimeDialog) {
    processTimeDialog.addEventListener("click", (event) => {
      if (event.target === processTimeDialog) closeProcessTimeDialog();
    });
  }
  bindDialogEnterSave(processTimeDialog, saveProcessTimeDialog);
  initStatusOptions();
  if (statusCloseBtn) {
    statusCloseBtn.addEventListener("click", closeStatusDialog);
  }
  if (statusCancelBtn) {
    statusCancelBtn.addEventListener("click", closeStatusDialog);
  }
  if (statusSaveBtn) {
    statusSaveBtn.addEventListener("click", () => {
      void saveStatusDialog();
    });
  }
  if (statusNextBtn) {
    statusNextBtn.addEventListener("click", () => {
      applyStatusNextStep();
    });
  }
  if (statusInput) {
    statusInput.addEventListener("change", () => {
      syncStatusStepVisibility();
      syncStatusStepHint();
      syncStatusNextButtonState();
    });
  }
  if (statusStepInput) {
    statusStepInput.addEventListener("change", () => {
      syncStatusStepHint();
      syncStatusNextButtonState();
    });
  }
  if (statusDialog) {
    statusDialog.addEventListener("click", (event) => {
      if (event.target === statusDialog) closeStatusDialog();
    });
  }
  bindDialogEnterSave(statusDialog, saveStatusDialog);
  initDateOptions();
  if (dateCloseBtn) {
    dateCloseBtn.addEventListener("click", closeDateDialog);
  }
  if (dateCancelBtn) {
    dateCancelBtn.addEventListener("click", closeDateDialog);
  }
  if (dateSaveBtn) {
    dateSaveBtn.addEventListener("click", () => {
      void saveDateDialog();
    });
  }
  if (dateClearBtn) {
    dateClearBtn.addEventListener("click", () => {
      void clearDateDialogValue();
    });
  }
  if (dateMonthInput) {
    dateMonthInput.addEventListener("change", () => {
      const m = Number(dateMonthInput.value || 0);
      rebuildDateDayOptions(getDaysInMonthForCurrentYear(m));
      if (dateDayInput && Number(dateDayInput.value || 0) > getDaysInMonthForCurrentYear(m)) {
        dateDayInput.value = "";
      }
    });
  }
  if (dateDayInput) {
    dateDayInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveDateDialog();
      }
    });
  }
  if (dateDialog) {
    dateDialog.addEventListener("click", (event) => {
      if (event.target === dateDialog) closeDateDialog();
    });
  }
  bindDialogEnterSave(dateDialog, saveDateDialog);
  initSurfaceOptions();
  if (surfaceCloseBtn) {
    surfaceCloseBtn.addEventListener("click", closeSurfaceDialog);
  }
  if (surfaceCancelBtn) {
    surfaceCancelBtn.addEventListener("click", closeSurfaceDialog);
  }
  if (surfaceSaveBtn) {
    surfaceSaveBtn.addEventListener("click", () => {
      void saveSurfaceDialog();
    });
  }
  if (surfaceClearBtn) {
    surfaceClearBtn.addEventListener("click", () => {
      void clearSurfaceDialogValue();
    });
  }
  if (surfacePresetInput) {
    surfacePresetInput.addEventListener("change", () => {
      if (surfaceCustomInput && surfacePresetInput.value) surfaceCustomInput.value = "";
    });
  }
  if (surfaceCustomInput) {
    surfaceCustomInput.addEventListener("input", () => {
      if (surfacePresetInput && surfaceCustomInput.value.trim()) surfacePresetInput.value = "";
    });
    surfaceCustomInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveSurfaceDialog();
      }
    });
  }
  if (surfaceDialog) {
    surfaceDialog.addEventListener("click", (event) => {
      if (event.target === surfaceDialog) closeSurfaceDialog();
    });
  }
  if (noteCloseBtn) {
    noteCloseBtn.addEventListener("click", closeNoteDialog);
  }
  if (noteCancelBtn) {
    noteCancelBtn.addEventListener("click", closeNoteDialog);
  }
  if (noteSaveBtn) {
    noteSaveBtn.addEventListener("click", () => {
      void saveNoteDialog();
    });
  }
  if (noteClearBtn) {
    noteClearBtn.addEventListener("click", () => {
      if (noteInput) noteInput.value = "";
    });
  }
  if (noteDialog) {
    noteDialog.addEventListener("click", (event) => {
      if (event.target === noteDialog) closeNoteDialog();
    });
  }
  bindDialogEnterSave(noteDialog, saveNoteDialog);
  if (quickEditCloseBtn) quickEditCloseBtn.addEventListener("click", closeQuickEditDialog);
  if (quickEditCancelBtn) quickEditCancelBtn.addEventListener("click", closeQuickEditDialog);
  if (quickEditSaveBtn) quickEditSaveBtn.addEventListener("click", () => {
    void saveQuickEditDialog();
  });
  if (quickEditDialog) {
    quickEditDialog.addEventListener("click", (event) => {
      if (event.target === quickEditDialog) closeQuickEditDialog();
    });
  }
  bindDialogEnterSave(quickEditDialog, saveQuickEditDialog);
  if (deleteConfirmCloseBtn) {
    deleteConfirmCloseBtn.addEventListener("click", closeDeleteConfirmDialog);
  }
  if (deleteConfirmCancelBtn) {
    deleteConfirmCancelBtn.addEventListener("click", closeDeleteConfirmDialog);
  }
  if (deleteConfirmOkBtn) {
    deleteConfirmOkBtn.addEventListener("click", () => {
      void confirmDeleteOrder();
    });
  }
  if (deleteConfirmDialog) {
    deleteConfirmDialog.addEventListener("click", (event) => {
      if (event.target === deleteConfirmDialog) closeDeleteConfirmDialog();
    });
  }
  if (authLoginCloseBtn) {
    authLoginCloseBtn.addEventListener("click", closeAuthLoginDialog);
  }
  if (authLoginCancelBtn) {
    authLoginCancelBtn.addEventListener("click", closeAuthLoginDialog);
  }
  if (authPasswordLoginBtn) {
    authPasswordLoginBtn.addEventListener("click", () => {
      void submitPasswordLoginFromDialog();
    });
  }
  if (authLoginSubmitBtn) {
    authLoginSubmitBtn.addEventListener("click", () => {
      void submitEmailLoginFromDialog();
    });
  }
  if (authLoginEmailInput) {
    authLoginEmailInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (String(authLoginPasswordInput?.value || "").trim()) {
          void submitPasswordLoginFromDialog();
        } else {
          void submitEmailLoginFromDialog();
        }
      }
    });
  }
  if (authLoginPasswordInput) {
    authLoginPasswordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submitPasswordLoginFromDialog();
      }
    });
  }
  if (authLoginDialog) {
    authLoginDialog.addEventListener("click", (event) => {
      if (event.target === authLoginDialog) closeAuthLoginDialog();
    });
  }
  if (infoDialogCloseBtn) {
    infoDialogCloseBtn.addEventListener("click", closeInfoDialog);
  }
  if (infoDialogOkBtn) {
    infoDialogOkBtn.addEventListener("click", closeInfoDialog);
  }
  if (infoDialog) {
    infoDialog.addEventListener("click", (event) => {
      if (event.target === infoDialog) closeInfoDialog();
    });
  }
  if (actionConfirmCloseBtn) {
    actionConfirmCloseBtn.addEventListener("click", () => closeActionConfirmDialog(false));
  }
  if (actionConfirmCancelBtn) {
    actionConfirmCancelBtn.addEventListener("click", () => closeActionConfirmDialog(false));
  }
  if (actionConfirmOkBtn) {
    actionConfirmOkBtn.addEventListener("click", () => closeActionConfirmDialog(true));
  }
  if (actionConfirmDialog) {
    actionConfirmDialog.addEventListener("click", (event) => {
      if (event.target === actionConfirmDialog) closeActionConfirmDialog(false);
    });
  }
  bindDialogEnterSave(surfaceDialog, saveSurfaceDialog);
  if (processMinutesInput) {
    processMinutesInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveProcessTimeDialog();
      }
    });
  }
  if (reconnectBtn) {
    reconnectBtn.addEventListener("click", () => {
      void tryReconnectRemote(true);
    });
  }
  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      void beginEmailLogin();
    });
  }
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      void logoutAuth();
    });
  }
  if (abnormalFilterBtn) {
    abnormalFilterBtn.addEventListener("click", () => {
      abnormalOnly = !abnormalOnly;
      abnormalFilterBtn.textContent = abnormalOnly ? "显示全部" : "只看异常";
      scheduleFilterRender();
    });
  }
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      filters.q = e.target.value.trim().toLowerCase();
      scheduleFilterRender();
    });
  }
  const filterMonth = document.getElementById("filterMonth");
  if (filterMonth) {
    filterMonth.value = filters.month;
    filterMonth.addEventListener("change", (e) => {
      filters.month = e.target.value;
      scheduleFilterRender();
    });
  }
  const filterOrderNo = document.getElementById("filterOrderNo");
  if (filterOrderNo) {
    filterOrderNo.addEventListener("input", (e) => {
      filters.orderNo = e.target.value.trim().toLowerCase();
      scheduleFilterRender();
    });
  }
  const statusColorFilters = document.getElementById("statusColorFilters");
  if (statusColorFilters) {
    statusColorFilters.addEventListener("click", (e) => {
      const btn = e.target.closest("button.status-color-btn");
      if (!btn) return;
      filters.statusColor = btn.dataset.color || "";
      syncStatusColorFilterButtons();
      scheduleFilterRender();
    });
    syncStatusColorFilterButtons();
  }
  const filterMachine = document.getElementById("filterMachine");
  if (filterMachine) {
    filterMachine.addEventListener("change", (e) => {
      filters.machine = e.target.value;
      scheduleFilterRender();
    });
  }
  const filterStatus = document.getElementById("filterStatus");
  if (filterStatus) {
    filterStatus.addEventListener("change", (e) => {
      filters.status = e.target.value;
      scheduleFilterRender();
    });
  }
  if (filterToggleBtn && orderFilters) {
    filterToggleBtn.addEventListener("click", () => {
      const collapsed = orderFilters.classList.toggle("collapsed");
      filterToggleBtn.textContent = collapsed ? "展开筛选" : "收起筛选";
      filterToggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      updatePinnedOffsets();
    });
  }
  window.addEventListener("scroll", updateBackTopBtn);
  if (tableWrap) tableWrap.addEventListener("scroll", handleTableWrapScroll);
  window.addEventListener("resize", updateStickyColumnOffsets);
  window.addEventListener("beforeunload", () => {
    saveOrdersLocal({ immediate: true });
  });
  window.addEventListener("resize", () => {
    updatePinnedOffsets();
    syncFilterPanelForViewport();
    if (isVirtualRenderEnabled(currentRenderRows.length)) scheduleViewportRender();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && previewDialog && !previewDialog.hidden) {
      e.preventDefault();
      closePreviewDialog();
      return;
    }
    if (e.key === "Escape" && processTimeDialog && !processTimeDialog.hidden) {
      e.preventDefault();
      closeProcessTimeDialog();
      return;
    }
    if (e.key === "Escape" && statusDialog && !statusDialog.hidden) {
      e.preventDefault();
      closeStatusDialog();
      return;
    }
    if (e.key === "Escape" && dateDialog && !dateDialog.hidden) {
      e.preventDefault();
      closeDateDialog();
      return;
    }
    if (e.key === "Escape" && surfaceDialog && !surfaceDialog.hidden) {
      e.preventDefault();
      closeSurfaceDialog();
      return;
    }
    if (e.key === "Escape" && noteDialog && !noteDialog.hidden) {
      e.preventDefault();
      closeNoteDialog();
      return;
    }
    if (e.key === "Escape" && quickEditDialog && !quickEditDialog.hidden) {
      e.preventDefault();
      closeQuickEditDialog();
      return;
    }
    if (e.key === "Escape" && attachmentDialog && !attachmentDialog.hidden) {
      e.preventDefault();
      closeAttachmentDialog();
      return;
    }
    if (e.key === "Escape" && deleteConfirmDialog && !deleteConfirmDialog.hidden) {
      e.preventDefault();
      closeDeleteConfirmDialog();
      return;
    }
    if (e.key === "Escape" && authLoginDialog && !authLoginDialog.hidden) {
      e.preventDefault();
      closeAuthLoginDialog();
      return;
    }
    if (e.key === "Escape" && actionConfirmDialog && !actionConfirmDialog.hidden) {
      e.preventDefault();
      closeActionConfirmDialog(false);
      return;
    }
    if (e.key === "Escape" && infoDialog && !infoDialog.hidden) {
      e.preventDefault();
      closeInfoDialog();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      void addBlankRow();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      exportXlsx();
    }
  });
  bindKpiJumpEvents();
  updateBackTopBtn();
  updateAuthUi();
  syncReconnectButton();
  syncFilterPanelForViewport();
  updatePinnedOffsets();
}

function updatePinnedOffsets() {
  const topbar = document.querySelector(".topbar");
  const root = document.documentElement;
  if (!root) return;
  const topbarH = topbar ? Math.round(topbar.getBoundingClientRect().height) : 72;
  const kpiH = kpiGrid ? Math.round(kpiGrid.getBoundingClientRect().height) : 110;
  root.style.setProperty("--topbar-h", `${topbarH}px`);
  root.style.setProperty("--kpi-h", `${kpiH}px`);
}

function syncFilterPanelForViewport() {
  if (!orderFilters || !filterToggleBtn) return;
  if (window.innerWidth > 780) {
    orderFilters.classList.remove("collapsed");
    filterToggleBtn.textContent = "收起筛选";
    filterToggleBtn.setAttribute("aria-expanded", "true");
  }
}

async function initAuth() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    authSession = data?.session || null;
  } catch (e) {
    if (isAbortError(e)) {
      console.warn("读取登录态被中断，稍后自动重试", e);
    } else {
      console.warn("读取登录态失败", e);
    }
    authSession = null;
  }
  await refreshAuditPageAccess();
  updateAuthUi();
  db.auth.onAuthStateChange((_event, session) => {
    authSession = session || null;
    authWriteHintNotified = false;
    void handleAuthStateChanged();
  });
}

function getRefreshDelayMs() {
  return document.hidden ? BACKGROUND_REFRESH_MS : AUTO_REFRESH_MS;
}

function stopAutoRefreshLoop() {
  if (!syncPollTimer) return;
  clearTimeout(syncPollTimer);
  syncPollTimer = 0;
}

function scheduleAutoRefreshLoop(delayMs = getRefreshDelayMs()) {
  stopAutoRefreshLoop();
  syncPollTimer = window.setTimeout(async () => {
    syncPollTimer = 0;
    try {
      if (!syncing && remoteOnline) await refreshFromRemoteIncremental(false, true);
    } finally {
      scheduleAutoRefreshLoop();
    }
  }, Math.max(1000, Number(delayMs) || AUTO_REFRESH_MS));
}

function startAutoRefreshLoop() {
  if (!REMOTE_ENABLED) return;
  document.addEventListener("visibilitychange", handleVisibilityRefreshChange);
  scheduleAutoRefreshLoop();
}

function handleVisibilityRefreshChange() {
  if (!REMOTE_ENABLED) return;
  if (!document.hidden && !syncing && remoteOnline) {
    scheduleAutoRefreshLoop(AUTO_REFRESH_MS);
    void refreshFromRemoteIncremental(false, true);
    return;
  }
  scheduleAutoRefreshLoop();
}

async function handleAuthStateChanged() {
  await refreshAuditPageAccess();
  updateAuthUi();
  if (remoteOnline) {
    setModeText(authSession ? "云端共享模式" : "云端只读（未登录）");
  }
  if (authSession && remoteOnline) {
    await refreshFromRemoteIncremental(false, false);
  }
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

async function beginEmailLogin() {
  openAuthLoginDialog();
}

function openAuthLoginDialog() {
  if (!REMOTE_ENABLED || !db?.auth || !authLoginDialog) return;
  if (authLoginEmailInput) authLoginEmailInput.value = "";
  if (authLoginPasswordInput) authLoginPasswordInput.value = "";
  authLoginDialog.hidden = false;
  refreshAuthLoginSubmitUi();
  document.body.style.overflow = "hidden";
  if (authLoginEmailInput) authLoginEmailInput.focus();
}

function closeAuthLoginDialog() {
  if (!authLoginDialog) return;
  authLoginDialog.hidden = true;
  setAuthLoginSubmitting(false);
  if (attachmentDialog && !attachmentDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (previewDialog && !previewDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (processTimeDialog && !processTimeDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (statusDialog && !statusDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (dateDialog && !dateDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (surfaceDialog && !surfaceDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (deleteConfirmDialog && !deleteConfirmDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

function showInfoDialog(message, title = "提示") {
  if (!infoDialog || !infoDialogText) {
    console.warn("info dialog not found", message);
    return;
  }
  if (infoDialogTitle) infoDialogTitle.textContent = title;
  infoDialogText.textContent = String(message || "");
  infoDialog.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeInfoDialog() {
  if (!infoDialog) return;
  infoDialog.hidden = true;
  if (attachmentDialog && !attachmentDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (previewDialog && !previewDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (processTimeDialog && !processTimeDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (statusDialog && !statusDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (dateDialog && !dateDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (surfaceDialog && !surfaceDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (deleteConfirmDialog && !deleteConfirmDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (authLoginDialog && !authLoginDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (actionConfirmDialog && !actionConfirmDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}


function showActionConfirmDialog(message, title = "确认操作", okText = "确认", cancelText = "取消") {
  if (!actionConfirmDialog || !actionConfirmText) {
    return Promise.resolve(false);
  }
  if (actionConfirmTitle) actionConfirmTitle.textContent = String(title || "确认操作");
  actionConfirmText.textContent = String(message || "");
  if (actionConfirmOkBtn) actionConfirmOkBtn.textContent = String(okText || "确认");
  if (actionConfirmCancelBtn) actionConfirmCancelBtn.textContent = String(cancelText || "取消");
  actionConfirmDialog.hidden = false;
  document.body.style.overflow = "hidden";
  return new Promise((resolve) => {
    actionConfirmResolver = resolve;
  });
}

function closeActionConfirmDialog(confirmed) {
  if (!actionConfirmDialog) return;
  actionConfirmDialog.hidden = true;
  const resolver = actionConfirmResolver;
  actionConfirmResolver = null;
  if (typeof resolver === "function") resolver(Boolean(confirmed));
  const hasOpenDialog = [
    attachmentDialog,
    previewDialog,
    processTimeDialog,
    statusDialog,
    dateDialog,
    surfaceDialog,
    noteDialog,
    deleteConfirmDialog,
    authLoginDialog,
    infoDialog,
    quickEditDialog,
  ].some((dialogEl) => dialogEl && !dialogEl.hidden);
  document.body.style.overflow = hasOpenDialog ? "hidden" : "";
}

function setAuthLoginSubmitting(submitting, mode = "") {
  authLoginSubmitting = Boolean(submitting);
  authLoginSubmittingMode = authLoginSubmitting ? String(mode || "") : "";
  refreshAuthLoginSubmitUi();
}

function getAuthLoginCooldownSeconds() {
  return Math.max(0, Math.ceil((authLoginCooldownUntil - Date.now()) / 1000));
}

function refreshAuthLoginSubmitUi() {
  const remain = getAuthLoginCooldownSeconds();
  const otpLocked = authLoginSubmitting || remain > 0;
  const pwdLocked = authLoginSubmitting;
  if (authPasswordLoginBtn) {
    authPasswordLoginBtn.disabled = pwdLocked;
    authPasswordLoginBtn.textContent = authLoginSubmitting && authLoginSubmittingMode === "password" ? "登录中..." : "密码登录";
  }
  if (!authLoginSubmitBtn) return;
  authLoginSubmitBtn.disabled = otpLocked;
  if (authLoginSubmitting && authLoginSubmittingMode === "otp") {
    authLoginSubmitBtn.textContent = "发送中...";
  } else if (remain > 0) {
    authLoginSubmitBtn.textContent = `请 ${remain}s 后重试`;
  } else {
    authLoginSubmitBtn.textContent = "发送登录邮件";
  }
}

function startAuthLoginCooldown(seconds) {
  authLoginCooldownUntil = Date.now() + Math.max(1, Number(seconds) || 0) * 1000;
  if (authLoginCooldownTimer) clearInterval(authLoginCooldownTimer);
  refreshAuthLoginSubmitUi();
  authLoginCooldownTimer = setInterval(() => {
    if (getAuthLoginCooldownSeconds() <= 0) {
      clearInterval(authLoginCooldownTimer);
      authLoginCooldownTimer = 0;
      authLoginCooldownUntil = 0;
    }
    refreshAuthLoginSubmitUi();
  }, 1000);
}

function isRateLimitError(err) {
  const msg = String(err?.message || err?.error_description || "").toLowerCase();
  return Number(err?.status) === 429 || msg.includes("rate limit");
}

function getRetryAfterSeconds(err, fallback = 60) {
  const v = Number(err?.retry_after || err?.retryAfter || 0);
  if (Number.isFinite(v) && v > 0) return Math.ceil(v);
  return fallback;
}

async function submitEmailLoginFromDialog() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  if (authLoginSubmitting) return;
  const cooldown = getAuthLoginCooldownSeconds();
  if (cooldown > 0) {
    showInfoDialog(`请求过于频繁，请 ${cooldown} 秒后重试。`);
    return;
  }
  const email = String(authLoginEmailInput?.value || "").trim().toLowerCase();
  if (!email) {
    showInfoDialog("请输入登录邮箱。");
    return;
  }
  setAuthLoginSubmitting(true, "otp");
  try {
    const { error } = await db.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.href.split("#")[0],
      },
    });
    if (error) throw error;
    startAuthLoginCooldown(60);
    closeAuthLoginDialog();
    showInfoDialog("登录邮件已发送，请在邮箱中点击登录链接后返回本页。");
  } catch (e) {
    if (isRateLimitError(e)) {
      const retry = getRetryAfterSeconds(e, 120);
      startAuthLoginCooldown(retry);
      showInfoDialog(`发送过于频繁，请 ${retry} 秒后再试。`);
      setAuthLoginSubmitting(false);
      return;
    }
    const detail = e?.message || e?.error_description || "未知错误";
    showInfoDialog(`发送登录邮件失败：${detail}`);
    setAuthLoginSubmitting(false);
  }
}

async function submitPasswordLoginFromDialog() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  if (authLoginSubmitting) return;
  const email = String(authLoginEmailInput?.value || "").trim().toLowerCase();
  const password = String(authLoginPasswordInput?.value || "");
  if (!email) {
    showInfoDialog("请输入登录邮箱。");
    return;
  }
  if (!password) {
    showInfoDialog("请输入登录密码。");
    return;
  }
  setAuthLoginSubmitting(true, "password");
  try {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    closeAuthLoginDialog();
    showInfoDialog("登录成功。", "登录成功");
  } catch (e) {
    const detail = e?.message || e?.error_description || "未知错误";
    showInfoDialog(`密码登录失败：${detail}`);
    setAuthLoginSubmitting(false);
  }
}

async function logoutAuth() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  try {
    const { error } = await db.auth.signOut();
    if (error) throw error;
    authSession = null;
    updateAuthUi();
    setModeText(remoteOnline ? "云端只读（未登录）" : "本地模式（云连接失败）");
  } catch (e) {
    const detail = e?.message || e?.error_description || "未知错误";
    showInfoDialog(`退出失败：${detail}`);
  }
}

function updateAuthUi() {
  if (authUser) {
    authUser.textContent = authSession?.user?.email || "未登录";
  }
  if (loginBtn) loginBtn.style.display = authSession ? "none" : "inline-flex";
  if (logoutBtn) logoutBtn.style.display = authSession ? "inline-flex" : "none";
  if (auditPageLink) {
    if (canViewAuditPage) {
      auditPageLink.hidden = false;
      auditPageLink.style.display = "inline-flex";
    } else {
      auditPageLink.hidden = true;
      auditPageLink.style.display = "none";
    }
  }
  updatePinnedOffsets();
}

function loadShiftDefaults() {
  try {
    const raw = localStorage.getItem(SHIFT_DEFAULTS_KEY);
    if (!raw) return { day: {}, night: {} };
    const parsed = JSON.parse(raw);
    return {
      day: parsed?.day || {},
      night: parsed?.night || {},
    };
  } catch (_e) {
    return { day: {}, night: {} };
  }
}

function getShiftTag() {
  const h = new Date().getHours();
  return h >= 8 && h < 20 ? "day" : "night";
}

function getShiftDefaults() {
  const tag = getShiftTag();
  return shiftDefaults?.[tag] || {};
}

function saveShiftDefaultsPatch(patch = {}) {
  const tag = getShiftTag();
  const next = {
    day: { ...(shiftDefaults?.day || {}) },
    night: { ...(shiftDefaults?.night || {}) },
  };
  next[tag] = { ...next[tag], ...patch };
  shiftDefaults = next;
  try {
    localStorage.setItem(SHIFT_DEFAULTS_KEY, JSON.stringify(next));
  } catch (_e) {
    // ignore write failure
  }
}
function canWriteRemote(notify = true) {
  if (!REMOTE_ENABLED) return false;
  if (authSession) return true;
  if (notify && !authWriteHintNotified) {
    authWriteHintNotified = true;
    showInfoDialog("当前为只读模式，请先点击“邮箱登录”后再写入云端数据。", "写入受限");
  }
  return false;
}

function createEmptyOrder() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    orderNo: "",
    drawingNo: "",
    customer: "",
    name: "",
    qty: "",
    programNo: "未出",
    processName: "",
    processStepCurrent: "",
    plannedHours: "",
    machine: "",
    lathe: "",
    surface: "",
    status: "待排产",
    startTime: "",
    completionDate: "",
    dueDate: "",
    isDelayed: "",
    note: "",
  };
}

async function quickAdd() {
  const orderNoInput = valueOf("qaOrderNo");
  const orderNo = normalizeOrderNoInput(orderNoInput);
  const customer = valueOf("qaCustomer");

  if (!orderNoInput) {
    showInfoDialog("请填写编号");
    return;
  }
  if (!orderNo) {
    showInfoDialog("编号格式无效，请输入1-3位数字（如 30 或 030）");
    return;
  }
  const duplicateOrderNo = orders.some((o) => String(o.orderNo || "").trim().toUpperCase() === orderNo);
  if (duplicateOrderNo) {
    showInfoDialog(`订单号 ${orderNo} 已存在，请更换编号。`);
    return;
  }

  const order = {
    ...createEmptyOrder(),
    orderNo,
    customer,
    status: "待排产",
    programNo: "未出",
    startTime: getTodayDateLocal(),
  };
  order.processStepCurrent = "";
  order.isDelayed = calcDelayed(order);

  orders.push(order);
  await persistOrders({ changed: [order] });
  clearQuickAdd();
  render();
  focusOrderRow(order.id);
  setTimeout(() => {
    const targetCell = tableBody.querySelector(`td[data-id="${order.id}"][data-key="name"]`);
    if (targetCell) beginEdit(targetCell);
  }, 0);
}

function getTodayDateLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function findBlankRowInsertIndex() {
  const orderNoFilter = String(filters.orderNo || "").trim().toLowerCase();
  if (!orderNoFilter) return orders.length;

  let lastMatchIndex = -1;
  for (let i = 0; i < orders.length; i += 1) {
    const effectiveOrderNo = String(getEffectiveOrderNoForMonthFilter(orders, i) || "").toLowerCase();
    if (effectiveOrderNo && effectiveOrderNo.includes(orderNoFilter)) {
      lastMatchIndex = i;
    }
  }

  return lastMatchIndex >= 0 ? lastMatchIndex + 1 : orders.length;
}

async function addBlankRow() {
  const order = createEmptyOrder();
  const insertIndex = findBlankRowInsertIndex();
  orders.splice(insertIndex, 0, order);
  await persistOrders({ changed: [order] });
  render();
  focusOrderRow(order.id);
}

function isVirtualRenderEnabled(total) {
  return Boolean(tableWrap && total >= VIRTUAL_ENABLED_THRESHOLD);
}

function getVirtualWindow(total) {
  if (!isVirtualRenderEnabled(total)) return { start: 0, end: total, topPad: 0, bottomPad: 0 };
  const scrollTop = tableWrap?.scrollTop || 0;
  const clientHeight = tableWrap?.clientHeight || 0;
  const estimatedStart = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_ESTIMATE) - VIRTUAL_OVERSCAN_ROWS);
  const estimatedVisible = Math.ceil(clientHeight / VIRTUAL_ROW_ESTIMATE) + VIRTUAL_OVERSCAN_ROWS * 2;
  const start = Math.min(Math.max(0, estimatedStart), Math.max(0, total - 1));
  const end = Math.min(total, start + Math.max(estimatedVisible, VIRTUAL_OVERSCAN_ROWS * 2));
  const topPad = start * VIRTUAL_ROW_ESTIMATE;
  const bottomPad = Math.max(0, (total - end) * VIRTUAL_ROW_ESTIMATE);
  return { start, end, topPad, bottomPad };
}

function makeOrderRowSignature(order, idx, flags, now) {
  const start = Boolean(flags?.start);
  const end = Boolean(flags?.end);
  const unit = Boolean(flags?.unit);
  const rootId = String(flags?.rootId || "");
  const hasFiles = attachmentStateByLineId.get(order.id) === true;
  const uploadedAt = String(attachmentLatestTimeByLineId.get(order.id) || "");
  const saved = (rowSavedUntil.get(order.id) || 0) > now;
  return JSON.stringify({
    i: idx,
    id: order.id,
    start,
    end,
    unit,
    rootId,
    saved,
    delayed: String(order.isDelayed || ""),
    status: String(order.status || ""),
    step: String(order.processStepCurrent || ""),
    orderNo: String(order.orderNo || ""),
    customer: String(order.customer || ""),
    name: String(order.name || ""),
    drawingNo: String(order.drawingNo || ""),
    qty: String(order.qty ?? ""),
    processName: String(order.processName || ""),
    plannedHours: String(order.plannedHours ?? ""),
    machine: String(order.machine || ""),
    dueDate: String(order.dueDate || ""),
    startTime: String(order.startTime || ""),
    note: String(order.note || ""),
    dirty: [
      hasDirtyCellMark(order.id, "orderNo"),
      hasDirtyCellMark(order.id, "customer"),
      hasDirtyCellMark(order.id, "name"),
      hasDirtyCellMark(order.id, "drawingNo"),
      hasDirtyCellMark(order.id, "qty"),
      hasDirtyCellMark(order.id, "note"),
    ],
    errs: [
      transientCellErrors.get(getErrorKey(order.id, "orderNo")) || "",
      transientCellErrors.get(getErrorKey(order.id, "qty")) || "",
      transientCellErrors.get(getErrorKey(order.id, "startTime")) || "",
      transientCellErrors.get(getErrorKey(order.id, "dueDate")) || "",
      transientCellErrors.get(getErrorKey(order.id, "note")) || "",
      ruleCellErrors.get(getErrorKey(order.id, "orderNo")) || "",
      ruleCellErrors.get(getErrorKey(order.id, "qty")) || "",
      ruleCellErrors.get(getErrorKey(order.id, "startTime")) || "",
      ruleCellErrors.get(getErrorKey(order.id, "dueDate")) || "",
      ruleCellErrors.get(getErrorKey(order.id, "note")) || "",
    ],
    hasFiles,
    uploadedAt,
  });
}

function buildOrderRow(order, idx, flags, now) {
  const tr = document.createElement("tr");
  tr.dataset.id = order.id;
  const stateClass =
    order.isDelayed === "延期" ? "row-delayed" : order.status === "加工中" ? "row-working" : order.status === "可发货" || order.status === "已发货" ? "row-shipped" : "";
  if (stateClass) tr.classList.add(stateClass);
  if ((rowSavedUntil.get(order.id) || 0) > now) tr.classList.add("row-saved");
  if (flags?.unit) tr.classList.add("order-unit");
  if (flags?.start) tr.classList.add("order-unit-start");
  if (flags?.end) tr.classList.add("order-unit-end");

  tr.appendChild(textCell(idx + 1));
  tr.appendChild(editCell(order, "orderNo"));
  tr.appendChild(editCell(order, "customer"));
  tr.appendChild(previewEditCell(order, "name"));
  tr.appendChild(previewEditCell(order, "drawingNo"));
  tr.appendChild(editCell(order, "qty"));
  tr.appendChild(processTimeCell(order));
  tr.appendChild(statusCell(order));
  tr.appendChild(dateCell(order, "startTime", "下单"));
  tr.appendChild(dateCell(order, "dueDate", "交期"));
  tr.appendChild(noteCell(order));

  const opTd = document.createElement("td");
  opTd.className = "op-cell";
  const opActions = document.createElement("div");
  opActions.className = "op-actions";
  if (flags?.start) {
    const fileBtn = document.createElement("button");
    fileBtn.className = "action-btn-secondary";
    fileBtn.textContent = "图纸";
    const targetId = flags?.rootId || order.id;
    fileBtn.addEventListener("click", () => {
      void openAttachmentDialog(targetId);
    });
    opActions.appendChild(fileBtn);
  }
  const delBtn = document.createElement("button");
  delBtn.className = "action-btn";
  delBtn.textContent = "删除";
  delBtn.addEventListener("click", () => {
    void removeOrder(order.id);
  });
  opActions.appendChild(delBtn);
  opTd.appendChild(opActions);
  tr.appendChild(opTd);
  return tr;
}

function getOrderRow(order, idx, flags, now) {
  const signature = makeOrderRowSignature(order, idx, flags, now);
  const hit = orderRowDomCache.get(order.id);
  if (hit && hit.signature === signature && hit.tr) return hit.tr;
  const tr = buildOrderRow(order, idx, flags, now);
  orderRowDomCache.set(order.id, { signature, tr });
  return tr;
}

function createVirtualPadRow(heightPx) {
  const tr = document.createElement("tr");
  tr.className = "order-virtual-pad-row";
  const td = document.createElement("td");
  td.colSpan = 12;
  td.style.height = `${Math.max(0, Math.floor(heightPx))}px`;
  td.style.padding = "0";
  td.style.border = "0";
  td.style.background = "transparent";
  tr.appendChild(td);
  return tr;
}

function createUnitGapRow() {
  const gapTr = document.createElement("tr");
  gapTr.className = "order-unit-gap";
  const gapTd = document.createElement("td");
  gapTd.colSpan = 12;
  gapTr.appendChild(gapTd);
  return gapTr;
}

function renderTableViewportRows() {
  if (!tableBody) return;
  const startTs = DEBUG_PERF ? performance.now() : 0;
  const rows = currentRenderRows;
  const total = rows.length;
  const { start, end, topPad, bottomPad } = getVirtualWindow(total);
  const frag = document.createDocumentFragment();
  const visibleRows = [];
  if (topPad > 0) frag.appendChild(createVirtualPadRow(topPad));
  const now = Date.now();
  for (let i = start; i < end; i += 1) {
    const order = rows[i];
    visibleRows.push(order);
    const flags = currentRenderUnitFlags.get(order.id);
    frag.appendChild(getOrderRow(order, i, flags, now));
    if (flags?.end && i < rows.length - 1) frag.appendChild(createUnitGapRow());
  }
  if (bottomPad > 0) frag.appendChild(createVirtualPadRow(bottomPad));
  tableBody.replaceChildren(frag);
  if (DEBUG_PERF) {
    const rendered = Math.max(0, end - start);
    const cost = performance.now() - startTs;
    console.debug(`[orders] render ${cost.toFixed(1)}ms (visible ${rendered}/${total})`);
  }
  void warmupAttachmentStates(visibleRows);
}

function scheduleViewportRender() {
  if (pendingViewportRenderRaf) return;
  pendingViewportRenderRaf = window.requestAnimationFrame(() => {
    pendingViewportRenderRaf = 0;
    renderTableViewportRows();
  });
}

function refreshFilteredTableState() {
  rebuildRuleCellErrors();
  currentRenderRows = getFilteredOrders();
  currentRenderUnitFlags = buildOrderUnitFlags(currentRenderRows);
  const aliveIds = new Set(orders.map((x) => x.id));
  orderRowDomCache.forEach((_v, id) => {
    if (!aliveIds.has(id)) orderRowDomCache.delete(id);
  });
  const now = Date.now();
  if (pendingViewportRenderRaf) {
    cancelAnimationFrame(pendingViewportRenderRaf);
    pendingViewportRenderRaf = 0;
  }
  renderTableViewportRows();
  queueStickyColumnOffsets();
}

function renderFilteredTableOnly() {
  refreshFilteredTableState();
}

function render() {
  refreshFilteredTableState();
  const now = Date.now();

  rowSavedUntil.forEach((until, id) => {
    if (until <= now) rowSavedUntil.delete(id);
  });

  renderKanban(orders);
  renderKpis(orders);
}

function buildOrderUnitFlags(rows) {
  const flags = new Map();
  let unitStartIndex = -1;
  let currentRootId = "";
  for (let i = 0; i < rows.length; i += 1) {
    const id = rows[i]?.id;
    if (!id) continue;
    const hasOrderNo = String(rows[i]?.orderNo || "").trim() !== "";
    if (hasOrderNo) {
      if (unitStartIndex >= 0) {
        const prevEndId = rows[i - 1]?.id;
        if (prevEndId) {
          const prevEnd = flags.get(prevEndId) || {};
          flags.set(prevEndId, { ...prevEnd, end: true });
        }
      }
      unitStartIndex = i;
      currentRootId = id;
      const startFlag = flags.get(id) || {};
      flags.set(id, { ...startFlag, unit: true, start: true, end: false, rootId: currentRootId });
      continue;
    }
    if (unitStartIndex >= 0) {
      const f = flags.get(id) || {};
      flags.set(id, { ...f, unit: true, rootId: currentRootId || id });
      continue;
    }
    flags.set(id, { unit: true, start: true, end: true, rootId: id });
  }
  if (rows.length > 0) {
    const lastId = rows[rows.length - 1]?.id;
    if (lastId) {
      const last = flags.get(lastId) || {};
      flags.set(lastId, { ...last, end: true });
    }
  }
  return flags;
}

function renderKanban(rows) {
  if (!kanbanBoard || !boardSummary) return;
  ensureKanbanScaffold();
  const stamp = buildOrdersOverviewStamp(rows);
  if (kanbanScaffoldReady && stamp === lastKanbanRenderStamp) return;
  lastKanbanRenderStamp = stamp;
  const effectiveOrderNoMap = buildEffectiveOrderNoMap(rows);
  const effectiveCustomerMap = buildEffectiveCustomerMap(rows);

  const total = rows.length;
  setNodeTextIfChanged(kanbanTotalPill, `全部订单 ${total}`);
  const activeCardIds = new Set();

  KANBAN_STATUSES.forEach((status) => {
    const list = rows.filter((o) => o.status === status);
    const statusPill = kanbanStatusPills.get(status);
    setNodeTextIfChanged(statusPill, `${status} ${list.length}`);
    const col = kanbanColState.get(status);
    if (!col) return;
    setNodeTextIfChanged(col.countEl, `${list.length} 单`);
    if (list.length === 0) {
      syncKanbanColumnChildren(col.bodyEl, [col.emptyEl]);
      return;
    }
    const nodes = list.map((order) => {
      activeCardIds.add(order.id);
      const displayOrderNo = effectiveOrderNoMap.get(order.id) || "";
      const displayCustomer = effectiveCustomerMap.get(order.id) || "";
      return getKanbanCardNode(order, displayOrderNo, displayCustomer);
    });
    syncKanbanColumnChildren(col.bodyEl, nodes);
  });

  kanbanCardCache.forEach((_value, id) => {
    if (!activeCardIds.has(id)) kanbanCardCache.delete(id);
  });
}

function syncKanbanColumnChildren(container, nodes) {
  if (!container) return;
  const current = Array.from(container.children);
  if (current.length === nodes.length) {
    let same = true;
    for (let i = 0; i < nodes.length; i += 1) {
      if (current[i] !== nodes[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
  }
  container.replaceChildren(...nodes);
}

function setNodeTextIfChanged(node, text) {
  if (!node) return;
  const next = String(text ?? "");
  if (node.textContent === next) return;
  node.textContent = next;
}

function createKanbanCard(order, displayOrderNo = "", displayCustomer = "") {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "kanban-card";
  card.addEventListener("click", () => focusOrderRow(order.id));

  const top = document.createElement("div");
  top.className = "kanban-card-top";
  const orderNo = document.createElement("span");
  orderNo.className = "kanban-order";
  orderNo.textContent = displayOrderNo;
  top.appendChild(orderNo);

  const name = document.createElement("div");
  name.className = "kanban-name";
  name.textContent = order.name || order.drawingNo || "未命名零件";

  const meta = document.createElement("div");
  meta.className = "kanban-meta";
  if (displayCustomer) meta.appendChild(createKanbanTag(displayCustomer));
  if (order.machine) meta.appendChild(createKanbanTag(order.machine));
  if (order.status === "加工中" && normalizeStepValue(order.processStepCurrent)) {
    const step = normalizeStepValue(order.processStepCurrent);
    const name = getProcessStepName(order, step);
    meta.appendChild(createKanbanTag(name ? `加工中·${name}` : `加工中第${step}序`));
  }
  if (order.dueDate) meta.appendChild(createKanbanTag(`交期 ${toMonthDay(order.dueDate)}`));
  if (order.plannedHours !== "" && order.plannedHours != null) meta.appendChild(createKanbanTag(`工时 ${order.plannedHours}分`));
  if (order.isDelayed === "延期") meta.appendChild(createKanbanTag("延期", true));

  card.appendChild(top);
  card.appendChild(name);
  card.appendChild(meta);
  return card;
}

function ensureKanbanScaffold() {
  if (!kanbanBoard || !boardSummary) return;
  if (kanbanScaffoldReady) return;
  kanbanBoard.innerHTML = "";
  boardSummary.innerHTML = "";
  kanbanStatusPills.clear();
  kanbanColState.clear();

  kanbanTotalPill = document.createElement("span");
  kanbanTotalPill.className = "board-pill";
  boardSummary.appendChild(kanbanTotalPill);

  KANBAN_STATUSES.forEach((status) => {
    const statusPill = document.createElement("span");
    statusPill.className = "board-pill";
    boardSummary.appendChild(statusPill);
    kanbanStatusPills.set(status, statusPill);

    const col = document.createElement("article");
    col.className = "kanban-col";
    const head = document.createElement("div");
    head.className = "kanban-col-head";
    const title = document.createElement("strong");
    title.textContent = status;
    const count = document.createElement("span");
    head.appendChild(title);
    head.appendChild(count);
    const body = document.createElement("div");
    body.className = "kanban-col-body";
    const empty = document.createElement("div");
    empty.className = "kanban-empty";
    empty.textContent = "暂无订单";
    body.appendChild(empty);
    col.appendChild(head);
    col.appendChild(body);
    kanbanBoard.appendChild(col);
    kanbanColState.set(status, { colEl: col, countEl: count, bodyEl: body, emptyEl: empty });
  });
  kanbanScaffoldReady = true;
}

function makeKanbanCardSignature(order, displayOrderNo = "", displayCustomer = "") {
  return JSON.stringify({
    id: order.id,
    orderNo: String(displayOrderNo || ""),
    name: String(order.name || ""),
    drawingNo: String(order.drawingNo || ""),
    customer: String(displayCustomer || ""),
    machine: String(order.machine || ""),
    status: String(order.status || ""),
    step: String(order.processStepCurrent || ""),
    dueDate: String(order.dueDate || ""),
    plannedHours: String(order.plannedHours ?? ""),
    delayed: String(order.isDelayed || ""),
  });
}

function getKanbanCardNode(order, displayOrderNo = "", displayCustomer = "") {
  const signature = makeKanbanCardSignature(order, displayOrderNo, displayCustomer);
  const hit = kanbanCardCache.get(order.id);
  if (hit && hit.signature === signature && hit.node) return hit.node;
  const node = createKanbanCard(order, displayOrderNo, displayCustomer);
  kanbanCardCache.set(order.id, { signature, node });
  return node;
}

function buildEffectiveOrderNoMap(rows) {
  const map = new Map();
  let current = "";
  rows.forEach((row) => {
    const raw = String(row.orderNo || "").trim();
    if (raw) current = raw;
    map.set(row.id, raw || current);
  });
  return map;
}


function buildEffectiveCustomerMap(rows) {
  const map = new Map();
  let current = "";
  rows.forEach((row) => {
    const raw = String(row.customer || "").trim();
    if (raw) current = raw;
    map.set(row.id, raw || current);
  });
  return map;
}
function createKanbanTag(text, delayed = false) {
  const tag = document.createElement("span");
  tag.className = delayed ? "kanban-tag kanban-delay" : "kanban-tag";
  tag.textContent = text;
  return tag;
}

function focusOrderRow(id) {
  let row = tableBody.querySelector(`tr[data-id="${id}"]`);
  if (!row && tableWrap) {
    const idx = currentRenderRows.findIndex((x) => x.id === id);
    if (idx >= 0 && isVirtualRenderEnabled(currentRenderRows.length)) {
      tableWrap.scrollTop = Math.max(0, idx * VIRTUAL_ROW_ESTIMATE - tableWrap.clientHeight / 2);
      renderTableViewportRows();
      row = tableBody.querySelector(`tr[data-id="${id}"]`);
    }
  }
  if (!row) return;
  row.classList.remove("row-focus");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  requestAnimationFrame(() => {
    row.classList.add("row-focus");
    setTimeout(() => row.classList.remove("row-focus"), 1000);
  });
}

function textCell(value) {
  const td = document.createElement("td");
  td.textContent = value ?? "";
  return td;
}

function editCell(order, key, type = "text") {
  const td = document.createElement("td");
  td.dataset.key = key;
  td.dataset.id = order.id;
  const rawValue = order[key] ?? "";
  td.dataset.raw = String(rawValue);
  const display = formatDisplayValue(key, rawValue);
  td.textContent = display;
  if (key === "note") td.title = String(display || "");
  appendDirtyCellDot(td, order.id, key);
  appendCellError(td, order.id, key);
  td.addEventListener("dblclick", () => {
    if (isQuickEditKey(key)) {
      openQuickEditDialog(order.id, key);
      return;
    }
    beginEdit(td, type);
  });
  return td;
}

function previewEditCell(order, key, type = "text") {
  const td = document.createElement("td");
  td.dataset.key = key;
  td.dataset.id = order.id;
  const rawValue = order[key] ?? "";
  td.dataset.raw = String(rawValue);

  const wrap = document.createElement("div");
  wrap.className = "cell-with-action";
  const text = document.createElement("span");
  text.className = "cell-main-text";
  text.classList.add("preview-text-link");
  const hasFiles = attachmentStateByLineId.get(order.id) === true;
  if (hasFiles) {
    text.classList.add("preview-text-has-file");
  }
  const display = formatDisplayValue(key, rawValue);
  text.textContent = display;
  const actionHint = hasFiles ? "点击预览图纸" : "点击截屏并上传图纸";
  text.title = display ? `${display}\n${actionHint}` : actionHint;
  text.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nowHasFiles = attachmentStateByLineId.get(order.id) === true;
    if (nowHasFiles) {
      void openLinePreview(order.id);
      return;
    }
    void captureAndUploadScreenshot(order.id);
  });
  text.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isQuickEditKey(key)) {
      openQuickEditDialog(order.id, key);
    }
  });
  wrap.appendChild(text);
  const uploadedAt = attachmentLatestTimeByLineId.get(order.id) || "";
  if (key === "name" && uploadedAt) {
    const timeTag = document.createElement("span");
    timeTag.className = "preview-upload-time";
    timeTag.textContent = `已上传 ${uploadedAt}`;
    wrap.appendChild(timeTag);
  }
  appendDirtyCellDot(td, order.id, key);
  td.appendChild(wrap);

  td.addEventListener("dblclick", () => {
    if (isQuickEditKey(key)) {
      openQuickEditDialog(order.id, key);
      return;
    }
    beginEdit(td, type);
  });
  return td;
}

function processTimeCell(order) {
  const td = document.createElement("td");
  td.dataset.key = "plannedHours";
  td.dataset.id = order.id;
  td.className = "process-time-cell";
  td.textContent = formatProcessTimeLabel(order);
  td.title = "点击设置工序和工时（分钟）";
  td.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openProcessTimeDialog(order.id);
  });
  return td;
}

function normalizeProcessRoute(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return [];
  if (/^\d+$/.test(raw)) {
    const max = Math.max(1, Math.min(200, Number(raw)));
    return Array.from({ length: max }, (_x, i) => `第${i + 1}序`);
  }
  return raw
    .split(/\s*(?:->|→|＞|>|\/)\s*/g)
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function serializeProcessRoute(route) {
  return route.join(" -> ");
}

function getProcessRoute(order) {
  return normalizeProcessRoute(order?.processName || "");
}

function getStatusProcessRoute(order) {
  const route = getProcessRoute(order);
  if (!route.length) return [];
  const hasOutsource = route.some((item) => normalizeCraftNameFromRouteItem(item) === "外协");
  if (hasOutsource) return ["外协"];
  return route;
}

function getProcessStepName(order, stepValue) {
  const step = Number(normalizeStepValue(stepValue) || 0);
  if (!step) return "";
  const route = getStatusProcessRoute(order);
  return route[step - 1] || `第${step}序`;
}

function getSelectedCraftRoute() {
  if (!processCraftOptions) return [];
  const selected = [];
  processCraftOptions.querySelectorAll('input[type="checkbox"]').forEach((el, idx) => {
    if (!el.checked) return;
    selected.push({
      name: String(el.value || "").trim(),
      order: Number(el.dataset.selectedOrder || 0),
      index: idx,
    });
  });
  selected.sort((a, b) => {
    if (a.order && b.order) return a.order - b.order;
    if (a.order) return -1;
    if (b.order) return 1;
    return a.index - b.index;
  });
  return selected.map((x) => x.name);
}

function getCncStepCountInput() {
  const v = Number(processCncStepInput?.value || 1);
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(PROCESS_SEQUENCE_MAX, Math.floor(v));
}

function syncProcessCncStepVisibility() {
  if (!processCncStepWrap) return;
  const hasCnc = getSelectedCraftRoute().includes(PROCESS_SEQUENCE_CRAFT);
  processCncStepWrap.style.display = hasCnc ? "grid" : "none";
}

function syncProcessSurfaceVisibility() {
  if (!processSurfaceWrap) return;
  const hasSurface = getSelectedCraftRoute().includes("表面处理");
  processSurfaceWrap.style.display = hasSurface ? "grid" : "none";
}

function getExpandedCraftRoute() {
  const selected = getSelectedCraftRoute();
  if (!selected.length) return [];
  const cncCount = getCncStepCountInput();
  const expanded = [];
  selected.forEach((name) => {
    if (name !== PROCESS_SEQUENCE_CRAFT) {
      expanded.push(name);
      return;
    }
    for (let i = 1; i <= cncCount; i += 1) {
      expanded.push(`第${i}序`);
    }
  });
  return expanded;
}

function normalizeCraftNameFromRouteItem(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  if (/^第\d+序$/i.test(s) || /^CNC\d*$/i.test(s) || /^工序\d*$/i.test(s)) return PROCESS_SEQUENCE_CRAFT;
  return s;
}

function getSelectedCraftOrderFromRoute(route) {
  const seen = new Set();
  const ordered = [];
  route.forEach((item) => {
    const base = normalizeCraftNameFromRouteItem(item);
    if (!base || seen.has(base)) return;
    seen.add(base);
    ordered.push(base);
  });
  return ordered;
}

function syncProcessCraftPreview() {
  if (!processCraftPreview) return;
  syncProcessCncStepVisibility();
  syncProcessSurfaceVisibility();
  const route = getExpandedCraftRoute();
  if (!route.length) {
    processCraftPreview.textContent = "未选择工艺";
    return;
  }
  processCraftPreview.textContent = route.join(" -> ");
}

function formatProcessTimeLabel(order) {
  const minutes = normalizeValue("plannedHours", order.plannedHours);
  const route = getProcessRoute(order);
  const processText = route.length ? route.join(" -> ") : "";
  const parts = [];
  if (order.programNo) parts.push(`程序单${order.programNo}`);
  if (processText) parts.push(processText);
  if (minutes !== "") parts.push(`${minutes} 分钟`);
  if (order.machine) parts.push(order.machine);
  if (order.surface) parts.push(order.surface);
  return parts.join(" · ");
}

function statusCell(order) {
  const td = document.createElement("td");
  td.dataset.key = "status";
  td.dataset.id = order.id;
  td.className = "status-cell";
  const wrap = document.createElement("div");
  wrap.className = "status-pill-wrap";
  const badge = document.createElement("span");
  const label = formatStatusLabel(order);
  badge.className = `status-pill ${getStatusClassName(order.status || "")}`;
  const dot = document.createElement("span");
  dot.className = "status-dot";
  const text = document.createElement("span");
  text.textContent = label;
  badge.appendChild(dot);
  badge.appendChild(text);
  wrap.appendChild(badge);
  const progress = buildStatusProgress(order);
  if (progress) wrap.appendChild(progress);
  td.appendChild(wrap);
  td.title = "点击设置状态";
  td.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openStatusDialog(order.id);
  });
  return td;
}

function dateCell(order, key, label) {
  const td = document.createElement("td");
  td.dataset.key = key;
  td.dataset.id = order.id;
  td.className = "date-cell";
  if (key === "startTime") {
    td.textContent = formatOrderCompletionLabel(order);
  } else if (key === "dueDate") {
    td.textContent = toMonthDay(order?.dueDate || "");
  } else {
    td.textContent = formatDisplayValue(key, order[key] ?? "");
  }
  td.title = `点击设置${label}（月/日）`;
  appendCellError(td, order.id, key);
  td.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openDateDialog(order.id, key, label);
  });
  return td;
}

function noteCell(order) {
  const td = document.createElement("td");
  td.dataset.key = "note";
  td.dataset.id = order.id;
  td.className = "note-cell";
  const text = String(order.note || "").trim();
  td.textContent = text;
  td.title = text || "点击设置备注";
  td.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openNoteDialog(order.id);
  });
  return td;
}

function formatOrderCompletionLabel(order) {
  const start = toMonthDay(order?.startTime || "");
  const done = toMonthDay(order?.completionDate || "");
  return `${start || "--"}/${done || "--"}`;
}

function surfaceCell(order) {
  const td = document.createElement("td");
  td.dataset.key = "surface";
  td.dataset.id = order.id;
  td.className = "surface-cell surface-col";
  td.textContent = String(order.surface || "");
  td.title = "点击设置表面处理";
  td.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSurfaceDialog(order.id);
  });
  return td;
}

function formatStatusLabel(order) {
  const base = String(order.status || "").trim() || "待排产";
  if (base !== "加工中") return base;
  const step = normalizeStepValue(order.processStepCurrent);
  if (!step) return "加工中";
  const name = getProcessStepName(order, step);
  return name ? `加工中 · ${name}` : `加工中第${step}序`;
}

function buildStatusProgress(order) {
  if (String(order.status || "").trim() !== "加工中") return null;
  const maxStep = Math.max(1, getMaxProcessStep(order));
  const currentRaw = Number(normalizeStepValue(order.processStepCurrent) || 0);
  const current = Math.max(0, Math.min(maxStep, currentRaw));
  const percent = Math.round((current / maxStep) * 100);

  const progress = document.createElement("div");
  progress.className = "status-progress";
  const track = document.createElement("div");
  track.className = "status-progress-track";
  const fill = document.createElement("div");
  fill.className = "status-progress-fill";
  fill.style.width = `${percent}%`;
  track.appendChild(fill);
  const text = document.createElement("span");
  text.className = "status-progress-text";
  text.textContent = `${current}/${maxStep}`;
  progress.appendChild(track);
  progress.appendChild(text);
  return progress;
}

function getStatusClassName(status) {
  const s = String(status || "").trim();
  if (s === "待排产") return "status-pending";
  if (s === "已排产") return "status-planned";
  if (s === "加工中") return "status-working";
  if (s === "完成待检") return "status-done";
  if (s === "返工") return "status-rework";
  if (s === "可发货" || s === "已发货") return "status-done";
  return "status-pending";
}

function initProcessTimeOptions() {
  if (processProgramInput) {
    processProgramInput.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "请选择";
    processProgramInput.appendChild(blank);
    ["已出", "未出"].forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      processProgramInput.appendChild(option);
    });
  }
  if (processCraftOptions) {
    processCraftOptions.innerHTML = "";
    processCraftOrderSeq = 0;
    PROCESS_CRAFT_OPTIONS.forEach((name) => {
      const label = document.createElement("label");
      label.className = "process-craft-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = name;
      input.addEventListener("change", () => {
        if (input.checked) {
          processCraftOrderSeq += 1;
          input.dataset.selectedOrder = String(processCraftOrderSeq);
        } else {
          delete input.dataset.selectedOrder;
        }
        syncProcessCraftPreview();
      });
      const text = document.createElement("span");
      text.textContent = name;
      label.appendChild(input);
      label.appendChild(text);
      processCraftOptions.appendChild(label);
    });
  }
  if (processCncStepInput) {
    processCncStepInput.innerHTML = "";
    for (let i = 1; i <= PROCESS_SEQUENCE_MAX; i += 1) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = `第${i}序`;
      processCncStepInput.appendChild(option);
    }
    processCncStepInput.value = "1";
    processCncStepInput.addEventListener("change", syncProcessCraftPreview);
  }
  if (processCncStepWrap) {
    const label = processCncStepWrap.querySelector("span");
    if (label) label.textContent = "CNC总序数";
  }
  syncProcessCraftPreview();
  if (processMachineInput) {
    processMachineInput.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "请选择机台";
    processMachineInput.appendChild(blank);
    MACHINES.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      processMachineInput.appendChild(option);
    });
  }
  if (processSurfaceInput) {
    processSurfaceInput.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "请选择";
    processSurfaceInput.appendChild(blank);
    SURFACE_OPTIONS.filter(Boolean).forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      processSurfaceInput.appendChild(option);
    });
  }
}

function initStatusOptions() {
  if (!statusInput) return;
  statusInput.innerHTML = "";
  STATUS.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    statusInput.appendChild(option);
  });
}

function initDateOptions() {
  if (!dateMonthInput) return;
  dateMonthInput.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "请选择";
  dateMonthInput.appendChild(blank);
  for (let i = 1; i <= 12; i += 1) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${i}月`;
    dateMonthInput.appendChild(opt);
  }
  rebuildDateDayOptions(31);
}

function initSurfaceOptions() {
  if (!surfacePresetInput) return;
  surfacePresetInput.innerHTML = "";
  SURFACE_OPTIONS.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name || "请选择";
    surfacePresetInput.appendChild(option);
  });
}

function rebuildDateDayOptions(dayCount = 31) {
  if (!dateDayInput) return;
  dateDayInput.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "请选择";
  dateDayInput.appendChild(blank);
  const max = Math.max(28, Math.min(31, Number(dayCount) || 31));
  for (let i = 1; i <= max; i += 1) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${i}日`;
    dateDayInput.appendChild(opt);
  }
}

function getDaysInMonthForCurrentYear(month) {
  const m = Number(month);
  if (!Number.isFinite(m) || m < 1 || m > 12) return 31;
  const y = new Date().getFullYear();
  return new Date(y, m, 0).getDate();
}

function formatDialogTitle(baseTitle, orderNo = "") {
  const no = String(orderNo || "").trim();
  return no ? `${baseTitle} · ${no}` : baseTitle;
}

function openDateDialog(orderId, key, label) {
  const order = orders.find((x) => x.id === orderId);
  if (!order || !dateDialog) return;
  dateEditingOrderId = orderId;
  dateEditingKey = key;
  if (dateTitle) dateTitle.textContent = formatDialogTitle(DATE_TITLE_BASE, order.orderNo);

  const normalized = normalizeDateOnlyInput(order[key] || "");
  let month = "";
  let day = "";
  if (normalized) {
    const m = normalized.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (m) {
      month = String(Number(m[1]));
      day = String(Number(m[2]));
    }
  }

  if (dateMonthInput) dateMonthInput.value = month;
  rebuildDateDayOptions(getDaysInMonthForCurrentYear(month));
  if (dateDayInput) dateDayInput.value = day;

  if (dateSubTitle) {
    const parts = [];
    if (order.orderNo) parts.push(`订单号 ${order.orderNo}`);
    if (order.drawingNo) parts.push(`图号 ${order.drawingNo}`);
    if (order.name) parts.push(`名称 ${order.name}`);
    parts.push(`设置${label}（仅月/日）`);
    dateSubTitle.textContent = parts.join(" · ");
  }
  dateDialog.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDateDialog() {
  if (!dateDialog) return;
  dateDialog.hidden = true;
  dateEditingOrderId = "";
  dateEditingKey = "";
  if (dateTitle) dateTitle.textContent = DATE_TITLE_BASE;
  if (attachmentDialog && !attachmentDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (previewDialog && !previewDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (processTimeDialog && !processTimeDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (statusDialog && !statusDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

async function saveDateDialog() {
  if (!dateEditingOrderId || !dateEditingKey) return;
  const order = orders.find((x) => x.id === dateEditingOrderId);
  if (!order) {
    closeDateDialog();
    return;
  }
  const month = Number(dateMonthInput?.value || 0);
  const day = Number(dateDayInput?.value || 0);
  if (!month || !day) {
    showInfoDialog("请选择月份和日期。");
    return;
  }
  const maxDay = getDaysInMonthForCurrentYear(month);
  if (day > maxDay) {
    showInfoDialog("日期无效，请重新选择。");
    return;
  }
  const year = new Date().getFullYear();
  const next = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const nextStart = dateEditingKey === "startTime" ? next : normalizeDateOnlyInput(order.startTime);
  const nextDue = dateEditingKey === "dueDate" ? next : normalizeDateOnlyInput(order.dueDate);
  if (nextStart && nextDue && nextDue < nextStart) {
    const msg = "交期不能早于下单";
    setTransientCellError(order.id, "startTime", msg);
    setTransientCellError(order.id, "dueDate", msg);
    render();
    return;
  }
  clearTransientCellError(order.id, "startTime");
  clearTransientCellError(order.id, "dueDate");
  if (order[dateEditingKey] !== next) {
    order[dateEditingKey] = next;
    if (dateEditingKey === "dueDate") {
      order.isDelayed = calcDelayed(order);
    }
    await persistOrders({ changed: [order] });
    markRowSaved(order.id);
    showSaveFeedback();
    render();
  }
  closeDateDialog();
}

async function clearDateDialogValue() {
  if (!dateEditingOrderId || !dateEditingKey) return;
  const order = orders.find((x) => x.id === dateEditingOrderId);
  if (!order) {
    closeDateDialog();
    return;
  }
  if (order[dateEditingKey] !== "") {
    order[dateEditingKey] = "";
    clearTransientCellError(order.id, "startTime");
    clearTransientCellError(order.id, "dueDate");
    if (dateEditingKey === "dueDate") {
      order.isDelayed = calcDelayed(order);
    }
    await persistOrders({ changed: [order] });
    markRowSaved(order.id);
    showSaveFeedback();
    render();
  }
  closeDateDialog();
}

function openSurfaceDialog(orderId) {
  const order = orders.find((x) => x.id === orderId);
  if (!order || !surfaceDialog) return;
  surfaceEditingOrderId = orderId;
  if (surfaceTitle) surfaceTitle.textContent = formatDialogTitle(SURFACE_TITLE_BASE, order.orderNo);
  const defaults = getShiftDefaults();
  const current = String(order.surface || defaults.surface || "").trim();
  const existsInPreset = SURFACE_OPTIONS.includes(current);
  if (surfacePresetInput) surfacePresetInput.value = existsInPreset ? current : "";
  if (surfaceCustomInput) surfaceCustomInput.value = existsInPreset ? "" : current;
  if (surfaceSubTitle) {
    const parts = [];
    if (order.orderNo) parts.push(`订单号 ${order.orderNo}`);
    if (order.drawingNo) parts.push(`图号 ${order.drawingNo}`);
    if (order.name) parts.push(`名称 ${order.name}`);
    surfaceSubTitle.textContent = parts.join(" · ") || "设置表面处理";
  }
  surfaceDialog.hidden = false;
  document.body.style.overflow = "hidden";
  if (surfaceCustomInput) surfaceCustomInput.focus();
}

function closeSurfaceDialog() {
  if (!surfaceDialog) return;
  surfaceDialog.hidden = true;
  surfaceEditingOrderId = "";
  if (surfaceTitle) surfaceTitle.textContent = SURFACE_TITLE_BASE;
  if (attachmentDialog && !attachmentDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (previewDialog && !previewDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (processTimeDialog && !processTimeDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (statusDialog && !statusDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (dateDialog && !dateDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (noteDialog && !noteDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

async function saveSurfaceDialog() {
  if (!surfaceEditingOrderId) return;
  const order = orders.find((x) => x.id === surfaceEditingOrderId);
  if (!order) {
    closeSurfaceDialog();
    return;
  }
  const custom = String(surfaceCustomInput?.value || "").trim();
  const preset = String(surfacePresetInput?.value || "").trim();
  const next = custom || preset;
  if (String(order.surface || "") !== next) {
    order.surface = next;
    await persistOrders({ changed: [order] });
    markRowSaved(order.id);
    showSaveFeedback();
    render();
  }
  if (next) saveShiftDefaultsPatch({ surface: next });
  closeSurfaceDialog();
}

async function clearSurfaceDialogValue() {
  if (!surfaceEditingOrderId) return;
  const order = orders.find((x) => x.id === surfaceEditingOrderId);
  if (!order) {
    closeSurfaceDialog();
    return;
  }
  if (String(order.surface || "") !== "") {
    order.surface = "";
    await persistOrders({ changed: [order] });
    markRowSaved(order.id);
    showSaveFeedback();
    render();
  }
  closeSurfaceDialog();
}

function openNoteDialog(orderId) {
  const order = orders.find((x) => x.id === orderId);
  if (!order || !noteDialog) return;
  noteEditingOrderId = orderId;
  if (noteTitle) noteTitle.textContent = formatDialogTitle("备注设置", order.orderNo);
  if (noteInput) noteInput.value = String(order.note || "");
  if (noteSubTitle) {
    const parts = [];
    if (order.orderNo) parts.push(`订单号 ${order.orderNo}`);
    if (order.drawingNo) parts.push(`图号 ${order.drawingNo}`);
    if (order.name) parts.push(`名称 ${order.name}`);
    noteSubTitle.textContent = parts.join(" · ") || "设置备注";
  }
  noteDialog.hidden = false;
  document.body.style.overflow = "hidden";
  if (noteInput) noteInput.focus();
}

function closeNoteDialog() {
  if (!noteDialog) return;
  noteDialog.hidden = true;
  noteEditingOrderId = "";
  if (noteTitle) noteTitle.textContent = "备注设置";
  if (attachmentDialog && !attachmentDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (previewDialog && !previewDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (processTimeDialog && !processTimeDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (statusDialog && !statusDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (dateDialog && !dateDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (surfaceDialog && !surfaceDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

async function saveNoteDialog() {
  if (!noteEditingOrderId) return;
  const order = orders.find((x) => x.id === noteEditingOrderId);
  if (!order) {
    closeNoteDialog();
    return;
  }
  const next = String(noteInput?.value || "").trim();
  if (String(order.note || "") !== next) {
    order.note = next;
    await persistOrders({ changed: [order] });
    markRowSaved(order.id);
    showSaveFeedback();
    render();
  }
  closeNoteDialog();
}

function getMaxProcessStep(order) {
  const max = getStatusProcessRoute(order).length;
  if (Number.isFinite(max) && max >= 1) return Math.min(200, Math.floor(max));
  return 1;
}

function normalizeStepValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const v = Math.floor(n);
  if (v < 1 || v > 200) return "";
  return String(v);
}

function rebuildStatusStepOptions(order, maxStep = 1) {
  if (!statusStepInput) return;
  statusStepInput.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "请选择";
  statusStepInput.appendChild(blank);
  const route = getStatusProcessRoute(order);
  for (let i = 1; i <= maxStep; i += 1) {
    const option = document.createElement("option");
    option.value = String(i);
    const name = route[i - 1];
    option.textContent = name ? `第${i}序 · ${name}` : `第${i}序`;
    statusStepInput.appendChild(option);
  }
}

function syncStatusStepVisibility() {
  if (!statusInput || !statusStepWrap) return;
  const show = statusInput.value === "加工中";
  statusStepWrap.style.display = show ? "grid" : "none";
  if (statusNextBtn) statusNextBtn.style.display = show || statusInput.value ? "inline-flex" : "none";
  syncStatusNextButtonState();
}

function openStatusDialog(orderId) {
  const order = orders.find((x) => x.id === orderId);
  if (!order || !statusDialog) return;
  statusEditingOrderId = orderId;
  if (statusTitle) statusTitle.textContent = formatDialogTitle(STATUS_TITLE_BASE, order.orderNo);
  if (statusInput) statusInput.value = order.status || "待排产";
  const maxStep = getMaxProcessStep(order);
  rebuildStatusStepOptions(order, maxStep);
  const normalizedStep = normalizeStepValue(order.processStepCurrent);
  const clampedStep = normalizedStep && Number(normalizedStep) <= maxStep ? normalizedStep : "";
  if (statusStepInput) statusStepInput.value = clampedStep;
  syncStatusStepVisibility();
  syncStatusStepHint();
  if (statusSubTitle) {
    const parts = [];
    if (order.orderNo) parts.push(`订单号 ${order.orderNo}`);
    if (order.drawingNo) parts.push(`图号 ${order.drawingNo}`);
    if (order.name) parts.push(`名称 ${order.name}`);
    const route = getStatusProcessRoute(order);
    parts.push(route.length ? route.join(" -> ") : `最多第${maxStep}序`);
    statusSubTitle.textContent = parts.join(" · ");
  }
  statusDialog.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeStatusDialog() {
  if (!statusDialog) return;
  statusDialog.hidden = true;
  statusEditingOrderId = "";
  if (statusTitle) statusTitle.textContent = STATUS_TITLE_BASE;
  if (statusProcessContext) statusProcessContext.textContent = "当前未选择工艺 / 共1序 / 剩余1序";
  if (attachmentDialog && !attachmentDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (previewDialog && !previewDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (processTimeDialog && !processTimeDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

async function saveStatusDialog() {
  if (!statusEditingOrderId) return;
  const order = orders.find((x) => x.id === statusEditingOrderId);
  if (!order) {
    closeStatusDialog();
    return;
  }
  const nextStatus = String(statusInput?.value || "待排产").trim() || "待排产";
  const prevStatus = String(order.status || "").trim();
  const prevStep = String(order.processStepCurrent || "");
  const prevCompletionDate = String(order.completionDate || "");
  const prevNote = String(order.note || "");
  const maxStep = getMaxProcessStep(order);
  let nextStep = "";
  if (nextStatus === "加工中") {
    const rawStep = normalizeStepValue(statusStepInput?.value || "");
    if (!rawStep) {
      showInfoDialog("请选择加工序号。");
      return;
    }
    if (Number(rawStep) > maxStep) {
      showInfoDialog(`当前工序总数为 ${maxStep}，加工序号不能超过第${maxStep}序。`);
      return;
    }
    nextStep = rawStep;
  }

  order.status = nextStatus;
  order.processStepCurrent = nextStep;

  if (nextStatus === "可发货") {
    order.completionDate = new Date().toISOString().slice(0, 10);
  } else if (nextStatus === "已发货") {
    if (!normalizeDateOnlyInput(order.completionDate)) {
      order.completionDate = new Date().toISOString().slice(0, 10);
    }
  } else if ((prevStatus === "可发货" || prevStatus === "已发货") && nextStatus !== "可发货" && nextStatus !== "已发货") {
    order.completionDate = "";
  }

  if (nextStatus === "已发货") {
    order.note = upsertShipTimeInNote(order.note, getTodayDateLocal());
  }

  const changed =
    prevStatus !== String(order.status || "") ||
    prevStep !== String(order.processStepCurrent || "") ||
    prevCompletionDate !== String(order.completionDate || "") ||
    prevNote !== String(order.note || "");

  if (changed) {
    await persistOrders({ changed: [order] });
    markRowSaved(order.id);
    showSaveFeedback();
    render();
  }
  closeStatusDialog();
}

function applyStatusNextStep() {
  if (!statusInput) return;
  const current = String(statusInput.value || "").trim() || "待排产";
  if (current === "待排产") {
    statusInput.value = "已排产";
    syncStatusStepVisibility();
    syncStatusStepHint();
    return;
  }
  if (current === "已排产") {
    statusInput.value = "加工中";
    if (statusStepInput && !normalizeStepValue(statusStepInput.value)) statusStepInput.value = "1";
    syncStatusStepVisibility();
    syncStatusStepHint();
    return;
  }
  if (current === "加工中") {
    const maxStep = statusEditingOrderId ? getMaxProcessStep(orders.find((x) => x.id === statusEditingOrderId) || {}) : 1;
    const nowStep = Number(normalizeStepValue(statusStepInput?.value || "1") || 1);
    if (nowStep < maxStep) {
      if (statusStepInput) statusStepInput.value = String(nowStep + 1);
      syncStatusStepHint();
      return;
    }
    statusInput.value = "完成待检";
    if (statusStepInput) statusStepInput.value = "";
    syncStatusStepVisibility();
    syncStatusStepHint();
    return;
  }
  if (current === "完成待检") {
    statusInput.value = "可发货";
    if (statusStepInput) statusStepInput.value = "";
    syncStatusStepVisibility();
    syncStatusStepHint();
    return;
  }
  if (current === "可发货") {
    statusInput.value = "已发货";
    if (statusStepInput) statusStepInput.value = "";
    syncStatusStepVisibility();
    syncStatusStepHint();
    return;
  }
}

function syncStatusStepHint() {
  if (!statusStepHint || !statusInput) return;
  if (statusInput.value !== "加工中") {
    statusStepHint.textContent = "";
    syncStatusProcessContext();
    return;
  }
  const order = orders.find((x) => x.id === statusEditingOrderId);
  const maxStep = getMaxProcessStep(order || {});
  const currentStep = Number(normalizeStepValue(statusStepInput?.value || "") || 0);
  if (!currentStep) {
    statusStepHint.textContent = `当前未选择工艺，共${maxStep}序。`;
    syncStatusProcessContext();
    return;
  }
  const remain = Math.max(0, maxStep - currentStep);
  const name = getProcessStepName(order, String(currentStep));
  statusStepHint.textContent = name ? `当前${name}，剩余${remain}序。` : `当前第${currentStep}序，剩余${remain}序。`;
  syncStatusProcessContext();
}

function syncStatusProcessContext() {
  if (!statusProcessContext) return;
  const order = orders.find((x) => x.id === statusEditingOrderId) || {};
  const maxStep = getMaxProcessStep(order);
  const status = String(statusInput?.value || order.status || "").trim();
  let currentStep = 0;
  if (status === "加工中") {
    currentStep = Number(normalizeStepValue(statusStepInput?.value || "") || 0);
  } else if (String(order.status || "").trim() === "加工中") {
    currentStep = Number(normalizeStepValue(order.processStepCurrent) || 0);
  }
  currentStep = Math.max(0, Math.min(maxStep, currentStep));
  const remain = Math.max(0, maxStep - currentStep);
  const name = currentStep ? getProcessStepName(order, String(currentStep)) : "";
  const currentText = name ? `当前${name}` : `当前第${currentStep}序`;
  statusProcessContext.textContent = `${currentText} / 共${maxStep}序 / 剩余${remain}序`;
}

function syncStatusNextButtonState() {
  if (!statusNextBtn || !statusInput) return;
  const current = String(statusInput.value || "").trim() || "待排产";
  statusNextBtn.disabled = current === "已发货";
  if (current === "待排产") {
    statusNextBtn.textContent = "下一步：已排产";
    return;
  }
  if (current === "已排产") {
    statusNextBtn.textContent = "下一步：加工中";
    return;
  }
  if (current === "加工中") {
    statusNextBtn.textContent = "下一步：推进工艺";
    return;
  }
  if (current === "完成待检") {
    statusNextBtn.textContent = "下一步：可发货";
    return;
  }
  if (current === "可发货") {
    statusNextBtn.textContent = "下一步：已发货";
    return;
  }
  statusNextBtn.textContent = "已完成";
}

function openProcessTimeDialog(orderId) {
  const order = orders.find((x) => x.id === orderId);
  if (!order || !processTimeDialog) return;
  const defaults = getShiftDefaults();
  processTimeEditingOrderId = orderId;
  if (processTimeTitle) processTimeTitle.textContent = formatDialogTitle(PROCESS_TIME_TITLE_BASE, order.orderNo);
  if (processProgramInput) processProgramInput.value = order.programNo || "未出";
  const route = getProcessRoute(order);
  const selectedOrder = getSelectedCraftOrderFromRoute(route);
  const selected = new Set(selectedOrder);
  const cncCount = route.filter((x) => normalizeCraftNameFromRouteItem(x) === PROCESS_SEQUENCE_CRAFT).length;
  if (processCraftOptions) {
    processCraftOrderSeq = 0;
    processCraftOptions.querySelectorAll('input[type="checkbox"]').forEach((el) => {
      const v = String(el.value || "").trim();
      const checked = selected.has(v);
      el.checked = checked;
      delete el.dataset.selectedOrder;
      if (checked) {
        const orderIndex = selectedOrder.indexOf(v);
        const orderNo = orderIndex >= 0 ? orderIndex + 1 : processCraftOrderSeq + 1;
        el.dataset.selectedOrder = String(orderNo);
        processCraftOrderSeq = Math.max(processCraftOrderSeq, orderNo);
      }
    });
  }
  if (processCncStepInput) processCncStepInput.value = String(Math.max(1, Math.min(PROCESS_SEQUENCE_MAX, cncCount || 1)));
  syncProcessCraftPreview();
  if (processMinutesInput) processMinutesInput.value = order.plannedHours === "" ? "" : String(order.plannedHours);
  if (processMachineInput) processMachineInput.value = order.machine || defaults.machine || "";
  if (processSurfaceInput) processSurfaceInput.value = String(order.surface || "").trim();
  if (processTimeSubTitle) {
    const parts = [];
    if (order.orderNo) parts.push(`订单号 ${order.orderNo}`);
    if (order.drawingNo) parts.push(`图号 ${order.drawingNo}`);
    if (order.name) parts.push(`名称 ${order.name}`);
    processTimeSubTitle.textContent = parts.join(" · ") || "设置工序与工时";
  }
  processTimeDialog.hidden = false;
  document.body.style.overflow = "hidden";
  if (processMinutesInput) processMinutesInput.focus();
}

function closeProcessTimeDialog() {
  if (!processTimeDialog) return;
  processTimeDialog.hidden = true;
  processTimeEditingOrderId = "";
  if (processTimeTitle) processTimeTitle.textContent = PROCESS_TIME_TITLE_BASE;
  if (attachmentDialog && !attachmentDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else if (previewDialog && !previewDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

async function saveProcessTimeDialog() {
  if (!processTimeEditingOrderId) return;
  const target = orders.find((x) => x.id === processTimeEditingOrderId);
  if (!target) {
    closeProcessTimeDialog();
    return;
  }
  const nextProgramNo = String(processProgramInput?.value || "").trim();
  const nextProcess = serializeProcessRoute(getExpandedCraftRoute());
  const minuteRaw = String(processMinutesInput?.value || "").trim();
  const nextMachine = String(processMachineInput?.value || "").trim();
  const hasSurfaceCraft = getSelectedCraftRoute().includes("表面处理");
  const nextSurface = hasSurfaceCraft ? String(processSurfaceInput?.value || "").trim() : "";
  const nextMinutes = normalizeValue("plannedHours", minuteRaw);
  if (minuteRaw !== "" && nextMinutes === "") {
    showInfoDialog("工时格式无效，请输入整数分钟。");
    return;
  }
  const prevStep = String(target.processStepCurrent || "");
  let changed =
    target.processName !== nextProcess ||
    target.plannedHours !== nextMinutes ||
    String(target.programNo || "") !== nextProgramNo ||
    String(target.machine || "") !== nextMachine ||
    String(target.surface || "") !== nextSurface;
  target.programNo = nextProgramNo;
  target.processName = nextProcess;
  target.plannedHours = nextMinutes;
  target.machine = nextMachine;
  target.surface = nextSurface;
  saveShiftDefaultsPatch({ machine: nextMachine, surface: nextSurface });
  const maxStep = getMaxProcessStep(target);
  const currentStep = normalizeStepValue(target.processStepCurrent);
  if (currentStep && Number(currentStep) > maxStep) {
    target.processStepCurrent = String(maxStep);
  }
  if (String(target.processStepCurrent || "") !== prevStep) changed = true;
  if (changed) {
    await persistOrders({ changed: [target] });
    markRowSaved(target.id);
    showSaveFeedback();
    render();
  }
  closeProcessTimeDialog();
}

const QUICK_EDIT_FIELDS = {
  orderNo: { label: "订单号", type: "text", placeholder: "请输入订单号（如 30 或 ZZ2602030）" },
  customer: { label: "客户", type: "text", placeholder: "请输入客户" },
  name: { label: "名称", type: "text", placeholder: "请输入名称" },
  drawingNo: { label: "图号", type: "text", placeholder: "请输入图号" },
  qty: { label: "数量", type: "number", placeholder: "请输入数量" },
};

function isQuickEditKey(key) {
  return Object.prototype.hasOwnProperty.call(QUICK_EDIT_FIELDS, String(key || ""));
}

function openQuickEditDialog(orderId, key) {
  if (!isQuickEditKey(key) || !quickEditDialog || !quickEditInput) return;
  const order = orders.find((x) => x.id === orderId);
  if (!order) return;
  const meta = QUICK_EDIT_FIELDS[String(key)];
  quickEditOrderId = orderId;
  quickEditKey = String(key);
  if (quickEditTitle) quickEditTitle.textContent = `${meta.label}编辑`;
  if (quickEditSubTitle) {
    const parts = [];
    if (order.orderNo) parts.push(`订单号 ${order.orderNo}`);
    if (order.drawingNo) parts.push(`图号 ${order.drawingNo}`);
    if (order.name) parts.push(`名称 ${order.name}`);
    quickEditSubTitle.textContent = parts.join(" · ") || "编辑字段";
  }
  quickEditInput.type = meta.type;
  quickEditInput.placeholder = meta.placeholder;
  quickEditInput.removeAttribute("min");
  quickEditInput.removeAttribute("step");
  quickEditInput.removeAttribute("inputmode");
  if (quickEditKey === "qty") {
    quickEditInput.min = "0";
    quickEditInput.step = "1";
    quickEditInput.setAttribute("inputmode", "numeric");
  }
  quickEditInput.value = String(order[key] ?? "");
  quickEditDialog.hidden = false;
  document.body.style.overflow = "hidden";
  quickEditInput.focus();
  quickEditInput.select();
}

function closeQuickEditDialog() {
  if (!quickEditDialog) return;
  quickEditDialog.hidden = true;
  quickEditOrderId = "";
  quickEditKey = "";
  if (quickEditTitle) quickEditTitle.textContent = "字段编辑";
  const hasOpenDialog = [
    attachmentDialog,
    previewDialog,
    processTimeDialog,
    statusDialog,
    dateDialog,
    surfaceDialog,
    noteDialog,
    deleteConfirmDialog,
    authLoginDialog,
    infoDialog,
  ].some((dialogEl) => dialogEl && !dialogEl.hidden);
  document.body.style.overflow = hasOpenDialog ? "hidden" : "";
}

async function saveQuickEditDialog() {
  if (!quickEditOrderId || !quickEditKey || !quickEditInput) return;
  const ok = await updateOrder(quickEditOrderId, quickEditKey, quickEditInput.value);
  if (!ok) return;
  closeQuickEditDialog();
}
function beginEdit(td, type = "text") {
  if (!td) return;
  const orderId = td.dataset.id;
  const key = td.dataset.key;
  if (isQuickEditKey(key)) {
    openQuickEditDialog(orderId, key);
    return;
  }
  if (td.classList.contains("editing")) return;
  const oldValue = td.dataset.raw ?? td.textContent;
  td.classList.add("editing");
  td.innerHTML = "";

  const input = document.createElement("input");
  input.type = type;
  input.value = oldValue;
  input.style.display = "block";
  input.style.width = "100%";
  input.style.boxSizing = "border-box";
  input.style.margin = "0";
  input.style.background = "#0b2748";
  input.style.border = "1px solid #42a5f5";
  input.style.color = "#e6f0ff";
  input.style.padding = "4px";
  input.style.textAlign = "center";
  td.appendChild(input);
  input.focus();
  input.select();
  const refreshDirtyMark = () => {
    const dirty = String(input.value ?? "") !== String(oldValue ?? "");
    setDirtyCellMark(orderId, key, dirty);
  };

  const save = async () => {
    td.classList.remove("editing");
    const ok = await updateOrder(orderId, key, input.value);
    if (ok) setDirtyCellMark(orderId, key, false);
  };

  input.addEventListener("input", refreshDirtyMark);
  input.addEventListener("blur", () => {
    void save();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save().then(() => jumpToNextPreferredField(td));
    }
    if (e.key === "Escape") {
      setDirtyCellMark(orderId, key, false);
      td.classList.remove("editing");
      render();
    }
  });
}

function jumpToNextPreferredField(currentTd) {
  const preferred = ["orderNo", "customer", "name", "drawingNo", "qty", "surface", "note"];
  const currentKey = String(currentTd?.dataset?.key || "");
  const row = currentTd?.parentElement;
  if (!row) return;

  const index = preferred.indexOf(currentKey);
  if (index >= 0) {
    for (let i = index + 1; i < preferred.length; i += 1) {
      const next = row.querySelector(`td[data-key="${preferred[i]}"]`);
      if (next) {
        beginEdit(next);
        return;
      }
    }
    const nextRow = row.nextElementSibling;
    if (nextRow) {
      const first = nextRow.querySelector('td[data-key="orderNo"]');
      if (first) {
        beginEdit(first);
        return;
      }
    }
    const currentId = String(row.dataset.id || "");
    const currentIdx = currentRenderRows.findIndex((x) => x.id === currentId);
    if (currentIdx >= 0 && currentIdx < currentRenderRows.length - 1) {
      const nextId = currentRenderRows[currentIdx + 1]?.id;
      if (nextId) {
        focusOrderRow(nextId);
        setTimeout(() => {
          const first = tableBody.querySelector(`tr[data-id="${nextId}"] td[data-key="orderNo"]`);
          if (first) beginEdit(first);
        }, 0);
      }
    }
    return;
  }

  const nextRow = row.nextElementSibling;
  if (nextRow) {
    const colIndex = [...row.children].indexOf(currentTd);
    const nextTd = nextRow.children[colIndex];
    if (nextTd && nextTd.dataset.key) {
      beginEdit(nextTd);
      return;
    }
  }
  const currentId = String(row.dataset.id || "");
  const currentIdx = currentRenderRows.findIndex((x) => x.id === currentId);
  if (currentIdx >= 0 && currentIdx < currentRenderRows.length - 1) {
    const nextId = currentRenderRows[currentIdx + 1]?.id;
    const key = currentKey || "orderNo";
    if (nextId) {
      focusOrderRow(nextId);
      setTimeout(() => {
        const nextTd = tableBody.querySelector(`tr[data-id="${nextId}"] td[data-key="${key}"]`);
        if (nextTd) beginEdit(nextTd);
      }, 0);
    }
  }
}

function selectCell(order, key, options) {
  const td = document.createElement("td");
  const sel = document.createElement("select");
  sel.className = "cell-select";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "";
  sel.appendChild(blank);

  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (order[key] === opt) o.selected = true;
    sel.appendChild(o);
  });

  sel.addEventListener("change", () => {
    void updateOrder(order.id, key, sel.value);
  });
  td.appendChild(sel);
  return td;
}

async function updateOrder(id, key, value) {
  const target = orders.find((o) => o.id === id);
  if (!target) return false;

  const raw = String(value ?? "").trim();
  const normalized = normalizeValue(key, value);
  if (key === "qty" && raw !== "") {
    const qtyNum = Number(raw);
    if (!Number.isFinite(qtyNum) || qtyNum < 0 || !Number.isInteger(qtyNum)) {
      setDirtyCellMark(id, key, true);
      setTransientCellError(id, "qty", "数量必须为大于等于0的整数");
      render();
      return false;
    }
  }
  if (key === "orderNo") {
    if (raw !== "" && normalized === "") {
      setDirtyCellMark(id, key, true);
      setTransientCellError(id, "orderNo", "订单号格式无效");
      render();
      return false;
    }
    const dup = normalized
      ? orders.some((o) => o.id !== id && String(o.orderNo || "").trim().toUpperCase() === normalized)
      : false;
    if (dup) {
      setDirtyCellMark(id, key, true);
      setTransientCellError(id, "orderNo", "订单号重复");
      render();
      return false;
    }
  }
  if ((key === "dueDate" || key === "startTime") && raw !== "" && normalized === "") {
    setDirtyCellMark(id, key, true);
    setTransientCellError(id, key, key === "dueDate" ? "交期格式无效" : "下单格式无效");
    render();
    return false;
  }

  clearTransientCellError(id, key);
  if ((target[key] ?? "") === normalized) {
    setDirtyCellMark(id, key, false);
    return true;
  }
  if (key === "startTime" || key === "dueDate") {
    const nextStart = key === "startTime" ? normalized : normalizeDateOnlyInput(target.startTime);
    const nextDue = key === "dueDate" ? normalized : normalizeDateOnlyInput(target.dueDate);
    if (nextStart && nextDue && nextDue < nextStart) {
      const msg = "交期不能早于下单";
      setDirtyCellMark(id, key, true);
      setTransientCellError(id, "startTime", msg);
      setTransientCellError(id, "dueDate", msg);
      render();
      return false;
    }
    clearTransientCellError(id, "startTime");
    clearTransientCellError(id, "dueDate");
  }
  target[key] = normalized;
  target.isDelayed = calcDelayed(target);

  await persistOrders({ changed: [target] });
  markRowSaved(id);
  showSaveFeedback();
  setDirtyCellMark(id, key, false);
  render();
  return true;
}

function normalizeValue(key, value) {
  if (key === "qty") {
    const raw = String(value ?? "").trim();
    if (raw === "") return "";
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) return "";
    return num;
  }
  if (key === "plannedHours") {
    const raw = String(value ?? "").trim();
    if (raw === "") return "";
    const num = Number(raw);
    if (!Number.isFinite(num)) return "";
    return Math.max(0, Math.round(num));
  }
  if (key === "dueDate") return normalizeDateOnlyInput(value);
  if (key === "startTime") return normalizeDateOnlyInput(value);
  if (key === "orderNo") return normalizeOrderNoInput(value);
  return (value || "").trim();
}

function normalizeOrderNoInput(value) {
  const raw = (value || "").trim().toUpperCase();
  if (!raw) return "";

  // Allow full order number input like ZZ2602030.
  if (/^ZZ\d{7}$/.test(raw)) return raw;

  // Serial-only input: 1-3 digits, padded to 3 digits.
  if (!/^\d{1,3}$/.test(raw)) return "";
  const serial = raw.padStart(3, "0");
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `ZZ${yy}${mm}${serial}`;
}

function formatDisplayValue(key, value) {
  if (value == null || value === "") return "";
  if (key === "startTime" || key === "dueDate") return toMonthDay(value);
  return value;
}

function toMonthDay(value) {
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}-${m[3]}`;
  return s;
}

function calcDelayed(order) {
  if (!order.dueDate || order.status === "可发货" || order.status === "已发货") return "";
  const due = new Date(order.dueDate + "T23:59:59");
  return Date.now() > due.getTime() ? "延期" : "正常";
}

function upsertShipTimeInNote(noteValue, shipDate = "") {
  const shipped = normalizeDateOnlyInput(shipDate) || getTodayDateLocal();
  const base = String(noteValue || "")
    .replace(/\s*发货时间\s*[:：]\s*\d{4}-\d{2}-\d{2}\s*/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return base ? `${base}\n发货时间：${shipped}` : `发货时间：${shipped}`;
}

function removeOrder(id) {
  openDeleteConfirmDialog(id);
}

function openDeleteConfirmDialog(id) {
  const order = orders.find((o) => o.id === id);
  if (!order || !deleteConfirmDialog) return;
  pendingDeleteOrderId = id;
  const no = String(order.orderNo || "").trim() || "未填写";
  if (deleteConfirmText) deleteConfirmText.textContent = `确认删除订单号 ${no} 吗？此操作不可撤销。`;
  deleteConfirmDialog.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDeleteConfirmDialog() {
  if (!deleteConfirmDialog) return;
  deleteConfirmDialog.hidden = true;
  pendingDeleteOrderId = "";
  const hasOpenDialog = [
    attachmentDialog,
    previewDialog,
    processTimeDialog,
    statusDialog,
    dateDialog,
    surfaceDialog,
    quickEditDialog,
  ].some((dialogEl) => dialogEl && !dialogEl.hidden);
  document.body.style.overflow = hasOpenDialog ? "hidden" : "";
}

async function confirmDeleteOrder() {
  if (!pendingDeleteOrderId) return;
  const id = pendingDeleteOrderId;
  closeDeleteConfirmDialog();
  orders = orders.filter((o) => o.id !== id);
  await persistOrders({ deletedId: id });
  render();
}

function getFilteredOrders() {
  return orders.filter((o, idx, arr) => {
    const qOk =
      !filters.q ||
      [o.orderNo, o.drawingNo, o.customer, o.name, o.processName, o.note].some((x) =>
        (x || "").toString().toLowerCase().includes(filters.q)
      );
    const effectiveOrderNo = getEffectiveOrderNoForMonthFilter(arr, idx);
    const monthOk = !filters.month || getMonthFromOrderNo(effectiveOrderNo) === filters.month;
    const orderNoOk =
      !filters.orderNo || String(effectiveOrderNo || "").toLowerCase().includes(filters.orderNo);
    const statusColorOk = !filters.statusColor || isStatusColorMatch(o.status, filters.statusColor);
    const mOk = !filters.machine || o.machine === filters.machine;
    const sOk = !filters.status || o.status === filters.status;
    const abnormalOk = !abnormalOnly || isAbnormalOrder(o);
    return qOk && monthOk && orderNoOk && statusColorOk && mOk && sOk && abnormalOk;
  });
}

function syncStatusColorFilterButtons() {
  const root = document.getElementById("statusColorFilters");
  if (!root) return;
  const buttons = root.querySelectorAll("button.status-color-btn");
  buttons.forEach((btn) => {
    const active = (btn.dataset.color || "") === (filters.statusColor || "");
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function isStatusColorMatch(status, color) {
  const s = String(status || "").trim();
  if (color === "yellow") return s === "待排产";
  if (color === "blue") return s === "已排产";
  if (color === "orange") return s === "加工中";
  if (color === "green") return s === "完成待检" || s === "可发货" || s === "已发货";
  if (color === "red") return s === "返工";
  return true;
}

function getEffectiveOrderNoForMonthFilter(rows, index) {
  const current = String(rows[index]?.orderNo || "").trim();
  if (current) return current;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = String(rows[i]?.orderNo || "").trim();
    if (prev) return prev;
  }
  return "";
}

function getMonthFromOrderNo(v) {
  if (!v) return "";
  const s = String(v).trim().toUpperCase();
  const m = s.match(/^ZZ\d{2}(\d{2})\d{3}$/);
  if (m) return m[1];
  return "";
}

function clearOrderFiltersForKpiJump() {
  filters.q = "";
  filters.month = "";
  filters.machine = "";
  filters.status = "";
  filters.orderNo = "";
  filters.statusColor = "";
  const searchInput = document.getElementById("searchInput");
  const filterMonth = document.getElementById("filterMonth");
  const filterMachine = document.getElementById("filterMachine");
  const filterStatus = document.getElementById("filterStatus");
  const filterOrderNo = document.getElementById("filterOrderNo");
  if (searchInput) searchInput.value = "";
  if (filterMonth) filterMonth.value = "";
  if (filterMachine) filterMachine.value = "";
  if (filterStatus) filterStatus.value = "";
  if (filterOrderNo) filterOrderNo.value = "";
  syncStatusColorFilterButtons();
}

function highlightOrderRowForKpi(orderId, durationMs = 3000) {
  if (!tableBody) return;
  const row = tableBody.querySelector(`tr[data-id="${orderId}"]`);
  if (!row) return;
  const prevTimer = kpiHighlightTimers.get(orderId);
  if (prevTimer) clearTimeout(prevTimer);
  row.classList.remove("row-kpi-hit");
  requestAnimationFrame(() => {
    row.classList.add("row-kpi-hit");
    const timer = setTimeout(() => {
      row.classList.remove("row-kpi-hit");
      kpiHighlightTimers.delete(orderId);
    }, Math.max(500, Number(durationMs) || 3000));
    kpiHighlightTimers.set(orderId, timer);
  });
}

function jumpToOrderFromKpi(kind) {
  const getTarget = () => {
    if (kind === "total") return orders[0] || null;
    if (kind === "production") return orders.find((x) => x.status === "加工中") || null;
    if (kind === "dueToday") return orders.find((x) => isDueToday(x.dueDate)) || null;
    if (kind === "abnormal") return orders.find((x) => isAbnormalOrder(x)) || null;
    return null;
  };
  const target = getTarget();
  if (!target) {
    showInfoDialog("当前指标没有可跳转的明细。", "提示");
    return;
  }
  if (!currentRenderRows.some((x) => x.id === target.id)) {
    clearOrderFiltersForKpiJump();
    render();
  }
  focusOrderRow(target.id);
  setTimeout(() => highlightOrderRowForKpi(target.id, 3000), 120);
}

function bindKpiCard(cardId, kind) {
  const valueEl = document.getElementById(cardId);
  if (!valueEl) return;
  const card = valueEl.closest(".kpi-card");
  if (!card) return;
  if (card.dataset.kpiJumpBound === "1") return;
  card.dataset.kpiJumpBound = "1";
  card.classList.add("kpi-jumpable");
  card.addEventListener("click", () => jumpToOrderFromKpi(kind));
}

function bindKpiJumpEvents() {
  bindKpiCard("kpiTotalOrders", "total");
  bindKpiCard("kpiInProduction", "production");
  bindKpiCard("kpiDueToday", "dueToday");
  bindKpiCard("kpiAbnormalCount", "abnormal");
}
function renderKpis(data) {
  const stamp = buildOrdersOverviewStamp(data);
  if (stamp === lastKpiRenderStamp) return;
  lastKpiRenderStamp = stamp;
  const totalOrders = data.length;
  const inProduction = data.filter((x) => x.status === "加工中").length;
  const dueToday = data.filter((x) => isDueToday(x.dueDate)).length;
  const abnormalCount = data.filter((x) => isAbnormalOrder(x)).length;

  setNodeTextIfChanged(document.getElementById("kpiTotalOrders"), String(totalOrders));
  setNodeTextIfChanged(document.getElementById("kpiInProduction"), String(inProduction));
  setNodeTextIfChanged(document.getElementById("kpiDueToday"), String(dueToday));
  setNodeTextIfChanged(document.getElementById("kpiAbnormalCount"), String(abnormalCount));
}

function isAbnormalOrder(order) {
  return order.isDelayed === "延期" || order.status === "返工" || isDueToday(order.dueDate);
}

function isDueToday(dueDate) {
  const normalized = normalizeDateOnlyInput(dueDate);
  if (!normalized) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return normalized === today;
}

async function persistOrders({ changed = [], deletedId = null } = {}) {
  if (changed.length > 0) {
    const baseMs = Date.now();
    changed.forEach((item, idx) => {
      item.updatedAt = new Date(baseMs + idx).toISOString();
      invalidateOrderCaches(item.id);
    });
  }
  if (deletedId) invalidateOrderCaches(deletedId);
  saveOrdersLocal();
  ordersSyncCursor = computeOrdersSyncCursor(orders);
  setLastSyncTime();
  if (!REMOTE_ENABLED || !remoteOnline) return;
  if (!canWriteRemote(true)) return;

  syncing = true;
  try {
    if (typeof MES_SHARED.syncSupabaseChanges === "function") {
      await MES_SHARED.syncSupabaseChanges({
        db,
        tableName: "mes_orders",
        changed,
        deletedId,
        onConflict: "id",
        mapChangedRow: (item) => toDbRow(item, item.updatedAt || new Date().toISOString()),
      });
    } else {
      if (changed.length > 0) {
        const payload = changed.map((item) => toDbRow(item, item.updatedAt || new Date().toISOString()));
        const { error } = await db.from("mes_orders").upsert(payload, { onConflict: "id" });
        if (error) throw error;
      }
      if (deletedId) {
        const { error } = await db.from("mes_orders").delete().eq("id", deletedId);
        if (error) throw error;
      }
    }
  } catch (e) {
    if (isAuthError(e)) {
      authSession = null;
      authWriteHintNotified = false;
      updateAuthUi();
      setModeText(remoteOnline ? "云端只读（未登录）" : "本地模式（云连接失败）");
      showInfoDialog("写入失败：登录态已失效，请重新登录。");
      return;
    }
    handleRemoteError("云端同步失败", e);
  } finally {
    syncing = false;
  }
}

function buildOrdersOverviewStamp(rows = []) {
  const parts = [String(ordersSyncCursor || ""), String(rows.length)];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    parts.push(
      [
        row.id || "",
        row.updatedAt || row.createdAt || "",
        row.status || "",
        row.dueDate || "",
        row.isDelayed || "",
        row.machine || "",
        row.processStepCurrent || "",
      ].join("|")
    );
  }
  return parts.join("||");
}

function saveOrdersLocal({ immediate = false, delayMs = 120 } = {}) {
  if (orderLocalStore) {
    orderLocalStore.save({ immediate, delayMs });
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

function flushOrdersLocalSave() {
  if (orderLocalStore) {
    orderLocalStore.flush();
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

function loadOrdersLocal() {
  if (typeof MES_SHARED.loadJsonList === "function") {
    return MES_SHARED.loadJsonList(STORAGE_KEY, {
      storage: window.localStorage,
      fallback: demoData,
      onError: (error) => console.warn("读取本地缓存失败", error),
      mapItem: (x, idx) => ({
        ...createEmptyOrder(),
        ...x,
        createdAt: x.createdAt || new Date(Date.now() + idx).toISOString(),
        updatedAt: x.updatedAt || x.createdAt || new Date(Date.now() + idx).toISOString(),
      }),
    });
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        return data.map((x, idx) => ({
          ...createEmptyOrder(),
          ...x,
          createdAt: x.createdAt || new Date(Date.now() + idx).toISOString(),
          updatedAt: x.updatedAt || x.createdAt || new Date(Date.now() + idx).toISOString(),
        }));
      }
    } catch (e) {
      console.warn("读取本地缓存失败", e);
    }
  }
  return demoData();
}

async function refreshFromRemote(showAlert = false) {
  await refreshFromRemoteIncremental(showAlert, false);
}

function computeOrdersSyncCursor(list = []) {
  if (typeof MES_SHARED.computeLatestCursor === "function") {
    return MES_SHARED.computeLatestCursor(list, (row) => String(row?.updatedAt || row?.createdAt || ""));
  }
  return list.reduce((max, row) => {
    const value = String(row?.updatedAt || row?.createdAt || "");
    return value > max ? value : max;
  }, "");
}

function mergeRemoteOrders(remoteList = []) {
  const byId = new Map(orders.map((item) => [item.id, item]));
  remoteList.forEach((item) => {
    if (!item?.id) return;
    byId.set(item.id, item);
    invalidateOrderCaches(item.id);
  });
  orders = Array.from(byId.values()).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

async function refreshFromRemoteIncremental(showAlert = false, preferIncremental = false) {
  if (!remoteOnline) return;
  try {
    const shouldFullSync = !preferIncremental || !ordersSyncCursor || orderIncrementalSyncCount >= FORCE_FULL_SYNC_INTERVAL;
    const remoteList =
      typeof MES_SHARED.fetchSupabaseRows === "function"
        ? await MES_SHARED.fetchSupabaseRows({
            db,
            tableName: "mes_orders",
            select: "*",
            orderBy: "updated_at",
            ascending: true,
            useCursor: !shouldFullSync,
            cursor: ordersSyncCursor,
            cursorColumn: "updated_at",
            mapRow: fromDbRow,
          })
        : await (async () => {
            let query = db.from("mes_orders").select("*").order("updated_at", { ascending: true });
            if (!shouldFullSync && ordersSyncCursor) query = query.gte("updated_at", ordersSyncCursor);
            const { data, error } = await query;
            if (error) throw error;
            return (data || []).map(fromDbRow);
          })();
    let hasChanges = false;

    if (shouldFullSync) {
      const prevCursor = ordersSyncCursor;
      const nextCursor = computeOrdersSyncCursor(remoteList);
      const prevLen = orders.length;
      orders = remoteList.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
      orderIncrementalSyncCount = 0;
      resetOrderDerivedCaches();
      hasChanges = nextCursor !== prevCursor || prevLen !== orders.length;
    } else if (remoteList.length > 0) {
      mergeRemoteOrders(remoteList);
      orderIncrementalSyncCount += 1;
      hasChanges = true;
    } else {
      orderIncrementalSyncCount += 1;
    }

    ordersSyncCursor = computeOrdersSyncCursor(orders);

    if (hasChanges) {
      saveOrdersLocal();
      render();
    }
    setLastSyncTime();
    reconnectDelayMs = 5000;
    remoteErrorNotified = false;
    if (showAlert) showInfoDialog("已从云端刷新最新数据");
  } catch (e) {
    if (isAuthError(e) && !authSession) {
      remoteOnline = true;
      remoteErrorNotified = false;
      setModeText("云端只读（未登录）");
      orders = loadOrdersLocal();
      resetOrderDerivedCaches();
      ordersSyncCursor = computeOrdersSyncCursor(orders);
      render();
      setLastSyncTime();
      return;
    }
    handleRemoteError("云端读取失败", e);
    orders = loadOrdersLocal();
    resetOrderDerivedCaches();
    ordersSyncCursor = computeOrdersSyncCursor(orders);
    render();
  }
}

function handleRemoteError(prefix, err) {
  if (isAbortError(err)) {
    console.warn(`${prefix}（请求被中断）`, err);
    scheduleReconnect();
    return;
  }
  console.error(prefix, err);
  remoteOnline = false;
  setModeText("本地模式（云连接失败）");
  scheduleReconnect();
  if (!remoteErrorNotified) {
    remoteErrorNotified = true;
    const detail = err?.message || err?.error_description || "未知错误";
    showInfoDialog(`${prefix}：${detail}\n已自动切换本地模式。`);
  }
}

function isAuthError(err) {
  const code = String(err?.status || err?.code || "").toUpperCase();
  const msg = String(err?.message || err?.error_description || "").toUpperCase();
  return code === "401" || code === "403" || code === "PGRST301" || msg.includes("JWT") || msg.includes("AUTH");
}

function isAbortError(err) {
  const name = String(err?.name || "");
  const msg = String(err?.message || err?.error_description || "").toLowerCase();
  return name === "AbortError" || msg.includes("signal is aborted") || msg.includes("aborterror");
}

function scheduleReconnect() {
  if (!REMOTE_ENABLED || remoteOnline || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void tryReconnectRemote(false);
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 60000);
}

async function tryReconnectRemote(manual = false) {
  if (!REMOTE_ENABLED) return;
  try {
    const { error } = await db.from("mes_orders").select("id").limit(1);
    if (error) throw error;
    remoteOnline = true;
    reconnectDelayMs = 5000;
    setModeText(authSession ? "云端共享模式" : "云端只读（未登录）");
    await refreshFromRemoteIncremental(false, false);
    if (manual) showInfoDialog("云端连接已恢复");
  } catch (e) {
    remoteOnline = false;
    setModeText("本地模式（云连接失败）");
    scheduleReconnect();
    if (manual) {
      const detail = e?.message || e?.error_description || "未知错误";
      showInfoDialog(`重连失败：${detail}`);
    }
  }
}

function toDbRow(order, updatedAtOverride = "") {
  const normalizedProcess = String(order.processName || "").trim();
  const normalizedStep = order.status === "加工中" ? normalizeStepValue(order.processStepCurrent) : "";
  const mergedNote = mergeOrderMetaIntoNote(order.note || "", {
    processName: normalizedProcess,
    processStepCurrent: normalizedStep,
    completionDate: normalizeDateOnlyInput(order.completionDate),
  });
  return {
    id: order.id,
    order_no: order.orderNo || "",
    drawing_no: order.drawingNo || "",
    customer: order.customer || "",
    item_name: order.name || "",
    qty: toFiniteOrNull(order.qty),
    program_no: order.programNo || "",
    planned_hours: toFiniteOrNull(order.plannedHours),
    machine: order.machine || "",
    lathe: order.lathe || "",
    surface: order.surface || "",
    status: order.status || "待排产",
    start_time: toDbStartTime(order.startTime),
    due_date: toDbDueDate(order.dueDate),
    is_delayed: order.isDelayed || "",
    note: mergedNote,
    created_at: order.createdAt || updatedAtOverride || new Date().toISOString(),
    updated_at: updatedAtOverride || new Date().toISOString(),
  };
}

function fromDbRow(row) {
  const o = createEmptyOrder();
  const parsedNote = splitNoteAndMeta(row.note || "");
  o.id = row.id || crypto.randomUUID();
  o.createdAt = row.created_at || row.updated_at || new Date().toISOString();
  o.orderNo = row.order_no || "";
  o.drawingNo = row.drawing_no || "";
  o.customer = row.customer || "";
  o.name = row.item_name || "";
  o.qty = row.qty ?? "";
  o.programNo = row.program_no || "未出";
  o.plannedHours = row.planned_hours ?? "";
  o.machine = row.machine || "";
  o.lathe = row.lathe || "";
  o.surface = row.surface || "";
  o.status = row.status || "待排产";
  o.startTime = formatStartTimeFromDb(row.start_time);
  o.dueDate = formatDueDateFromDb(row.due_date);
  o.processName = parsedNote.processName || "";
  o.processStepCurrent = parsedNote.processStepCurrent || "";
  o.completionDate = normalizeDateOnlyInput(parsedNote.completionDate || "");
  o.note = parsedNote.note || "";
  o.updatedAt = row.updated_at || "";
  o.isDelayed = calcDelayed(o);
  return o;
}

function demoData() {
  return [
    {
      ...createEmptyOrder(),
      orderNo: "ORD-2025-0003",
      drawingNo: "DW-2025-003",
      customer: "海尔",
      name: "壳体A",
      qty: 289,
      programNo: "已出",
      plannedHours: 19.1,
      machine: "CNC1",
      lathe: "是",
      surface: "阳极氧化",
      status: "已排产",
      startTime: "2026-02-14 08:30",
      dueDate: "2026-02-18",
      note: "优先订单",
    },
    {
      ...createEmptyOrder(),
      orderNo: "ORD-2025-0004",
      drawingNo: "DW-2025-003",
      customer: "比亚迪",
      name: "支架B",
      qty: 758,
      programNo: "已出",
      plannedHours: 38.5,
      machine: "CNC3",
      lathe: "否",
      surface: "发黑",
      status: "加工中",
      startTime: "2026-02-14 09:20",
      dueDate: "2026-02-16",
      note: "夜班跟进",
    },
    {
      ...createEmptyOrder(),
      orderNo: "ORD-2025-0005",
      drawingNo: "DW-2025-004",
      customer: "联想",
      name: "端盖C",
      qty: 403,
      programNo: "未出",
      plannedHours: 22.8,
      machine: "CNC5",
      lathe: "是",
      surface: "喷砂",
      status: "待排产",
      startTime: "",
      dueDate: "2026-02-15",
      note: "",
    },
  ].map((o) => ({ ...o, isDelayed: calcDelayed(o) }));
}

function valueOf(id) {
  const el = document.getElementById(id);
  return String(el?.value || "").trim();
}

function clearQuickAdd() {
  ["qaOrderNo", "qaCustomer"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function scheduleFilterRender(delayMs = 80) {
  if (pendingFilterRenderTimer) clearTimeout(pendingFilterRenderTimer);
  pendingFilterRenderTimer = setTimeout(() => {
    pendingFilterRenderTimer = 0;
    renderFilteredTableOnly();
  }, Math.max(0, Number(delayMs) || 0));
}

function invalidateOrderCaches(id) {
  if (!id) return;
  orderRowDomCache.delete(id);
}

function resetOrderDerivedCaches() {
  orderRowDomCache.clear();
}

function scrollToTopRow() {
  if (tableWrap) tableWrap.scrollTo({ top: 0, behavior: "smooth" });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function handleTableWrapScroll() {
  updateBackTopBtn();
  if (isVirtualRenderEnabled(currentRenderRows.length)) scheduleViewportRender();
}

function updateBackTopBtn() {
  if (!backTopBtn) return;
  const pageY = window.scrollY || 0;
  const tableY = tableWrap ? tableWrap.scrollTop : 0;
  const show = pageY > 120 || tableY > 120;
  backTopBtn.style.display = show ? "inline-flex" : "none";
}

function syncReconnectButton() {
  if (!reconnectBtn) return;
  if (!REMOTE_ENABLED) {
    reconnectBtn.style.display = "none";
    return;
  }
  reconnectBtn.style.display = remoteOnline ? "none" : "inline-flex";
}

function closeAttachmentDialog() {
  if (previewDialog && !previewDialog.hidden) closePreviewDialog();
  if (!attachmentDialog) return;
  attachmentDialog.hidden = true;
  document.body.style.overflow = "";
  attachmentPanelOrderId = "";
  attachmentItems = [];
  attachmentLoading = false;
}

function closePreviewDialog() {
  if (!previewDialog) return;
  previewDialog.hidden = true;
  if (previewBody) previewBody.innerHTML = "";
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }
  if (attachmentDialog && !attachmentDialog.hidden) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

async function openLinePreview(orderId) {
  const order = orders.find((x) => x.id === orderId);
  if (!order) return;
  if (!canUseStorageBucket(ORDER_TEXT_BUCKET)) {
    showInfoDialog(`未登录或未配置 Storage bucket，请先设置 order-attachments（当前: ${ORDER_TEXT_BUCKET || "未配置"}）。`);
    return;
  }
  try {
    const items = await storageListOrderFiles(orderId, ORDER_TEXT_BUCKET);
    setAttachmentStateFromItems(orderId, items);
    if (items.length === 0) {
      showInfoDialog("该零件暂无可预览图纸，请点击文字执行截图上传。");
      return;
    }
    const previewable = items.find((item) => isPreviewableFile(item));
    if (!previewable) {
      showInfoDialog("当前图纸类型不支持在线预览。");
      return;
    }
    await previewOrderFile(previewable, order);
  } catch (e) {
    const detail = e?.message || "未知错误";
    showInfoDialog(`预览失败：${detail}`);
  }
}

async function openAttachmentDialog(orderId) {
  const order = orders.find((x) => x.id === orderId);
  if (!order || !attachmentDialog) return;
  attachmentPanelOrderId = orderId;
  attachmentItems = [];
  attachmentLoading = true;
  syncAttachmentHeader(order);
  renderAttachmentList();
  attachmentDialog.hidden = false;
  document.body.style.overflow = "hidden";
  await loadOrderFiles(orderId);
}

function syncAttachmentHeader(order) {
  if (attachmentTitle) attachmentTitle.textContent = "零件图纸";
  if (attachmentSubTitle) {
    attachmentSubTitle.textContent = order.orderNo ? `订单号 ${order.orderNo}` : "未填写订单号";
  }
  if (attachmentHint) {
    attachmentHint.textContent = `支持类型: ${UPLOAD_ACCEPT}，单文件上限 ${UPLOAD_MAX_MB}MB`;
  }
}

function renderAttachmentList() {
  if (!attachmentList) return;
  attachmentList.innerHTML = "";

  if (!canUseStorageBucket(ORDER_BUTTON_BUCKET)) {
    const empty = document.createElement("div");
    empty.className = "attachment-empty";
    empty.textContent = `未登录或未配置 Storage bucket（图纸按钮使用: ${ORDER_BUTTON_BUCKET || "未配置"}）。`;
    attachmentList.appendChild(empty);
    return;
  }

  if (attachmentLoading) {
    const empty = document.createElement("div");
    empty.className = "attachment-empty";
    empty.textContent = "附件加载中...";
    attachmentList.appendChild(empty);
    return;
  }

  if (attachmentItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "attachment-empty";
    empty.textContent = "暂无附件";
    attachmentList.appendChild(empty);
    return;
  }

  attachmentItems.forEach((item) => {
    const row = document.createElement("article");
    row.className = "attachment-item";

    const meta = document.createElement("div");
    meta.className = "attachment-meta";
    const name = document.createElement("div");
    name.className = "attachment-name";
    name.textContent = getAttachmentName(item);
    const desc = document.createElement("div");
    desc.className = "attachment-desc";
    desc.textContent = `${formatFileSize(item.size_bytes || item.size || 0)} · ${formatDateTime(item.created_at || item.createdAt || "")}`;
    meta.appendChild(name);
    meta.appendChild(desc);

    const actions = document.createElement("div");
    actions.className = "attachment-actions";
    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.className = "action-btn-secondary";
    previewBtn.textContent = "预览";
    previewBtn.addEventListener("click", () => {
      void previewOrderFile(item);
    });
    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "action-btn-secondary";
    downloadBtn.textContent = "下载";
    downloadBtn.addEventListener("click", () => {
      void downloadOrderFile(item);
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "action-btn";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", () => {
      void deleteOrderFile(item);
    });
    actions.appendChild(previewBtn);
    actions.appendChild(downloadBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(meta);
    row.appendChild(actions);
    attachmentList.appendChild(row);
  });
}

async function loadOrderFiles(orderId) {
  if (!orderId) return;
  if (!canUseStorageBucket(ORDER_BUTTON_BUCKET)) {
    attachmentLoading = false;
    renderAttachmentList();
    return;
  }
  attachmentLoading = true;
  renderAttachmentList();
  try {
    attachmentItems = await storageListOrderFiles(orderId, ORDER_BUTTON_BUCKET);
    window.__lastAttachmentItems = attachmentItems;
    console.info(
      "[attachments:button:list]",
      ORDER_BUTTON_BUCKET,
      attachmentItems.map((x) => ({ name: getAttachmentName(x), bucket: x.bucket_id, path: x.path }))
    );
  } catch (e) {
    const detail = e?.message || "未知错误";
    showInfoDialog(`加载附件失败：${detail}`);
    attachmentItems = [];
  } finally {
    attachmentLoading = false;
    renderAttachmentList();
  }
}

async function uploadAttachmentFromInput(event) {
  const file = event?.target?.files?.[0];
  event.target.value = "";
  if (!file || !attachmentPanelOrderId) return;
  await uploadAttachmentFile(attachmentPanelOrderId, file, true);
}

async function uploadAttachmentFile(orderId, file, refreshDialogList = false) {
  if (!file || !orderId) return;
  if (!canUseStorageBucket(ORDER_BUTTON_BUCKET)) {
    showInfoDialog(`未登录或未配置 Storage bucket（图纸按钮使用: ${ORDER_BUTTON_BUCKET || "未配置"}）。`);
    return;
  }
  const validateMsg = validateAttachmentFile(file);
  if (validateMsg) {
    showInfoDialog(validateMsg);
    return;
  }

  try {
    const saved = await storageUploadOrderFile(orderId, file, ORDER_BUTTON_BUCKET);
    console.info("[attachments:button:upload]", { bucket: ORDER_BUTTON_BUCKET, orderId, path: saved?.path || "" });
    if (refreshDialogList && attachmentPanelOrderId === orderId) {
      await loadOrderFiles(orderId);
    }
    render();
  } catch (e) {
    const detail = e?.message || "未知错误";
    showInfoDialog(`上传失败：${detail}`);
  }
}

async function captureAndUploadScreenshot(orderId) {
  const order = orders.find((x) => x.id === orderId);
  if (!order) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showInfoDialog("当前浏览器不支持截屏上传，请使用图纸按钮手动上传。");
    return;
  }
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false,
    });
    const track = stream.getVideoTracks?.()[0];
    if (!track) throw new Error("未获取到屏幕画面");
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await new Promise((resolve) => {
      if (video.readyState >= 2) resolve();
      else video.onloadeddata = () => resolve();
    });
    const width = video.videoWidth || 1920;
    const height = video.videoHeight || 1080;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建截图画布");
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
    if (!blob) throw new Error("截图失败");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new File([blob], `screenshot_${order.orderNo || orderId}_${ts}.png`, { type: "image/png" });
    await uploadLinePreviewFile(orderId, file);
  } catch (e) {
    const message = String(e?.message || "");
    const canceled = message.toLowerCase().includes("permission denied") || message.toLowerCase().includes("cancel");
    if (!canceled) {
      showInfoDialog(`截屏上传失败：${message || "未知错误"}`);
    }
  } finally {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }
}

async function uploadLinePreviewFile(orderId, file) {
  if (!file || !orderId) return;
  if (!canUseStorageBucket(ORDER_TEXT_BUCKET)) {
    showInfoDialog(`未登录或未配置 Storage bucket（文字点击使用: ${ORDER_TEXT_BUCKET || "未配置"}）。`);
    return;
  }
  const validateMsg = validateAttachmentFile(file);
  if (validateMsg) {
    showInfoDialog(validateMsg);
    return;
  }
  await storageUploadOrderFile(orderId, file, ORDER_TEXT_BUCKET);
  await fetchAndSetAttachmentState(orderId);
  render();
}

async function deleteOrderFile(item) {
  const path = String(item?.path || "");
  if (!path) return;
  const confirmedDelete = await showActionConfirmDialog(`确认删除附件“${getAttachmentName(item)}”吗？`, "确认删除", "确认", "取消");
  if (!confirmedDelete) return;
  try {
    await storageDeleteOrderFile(path, String(item?.bucket_id || ORDER_BUTTON_BUCKET));
    attachmentItems = attachmentItems.filter((x) => String(x?.path || "") !== path);
    renderAttachmentList();
    render();
  } catch (e) {
    const detail = e?.message || "未知错误";
    showInfoDialog(`删除失败：${detail}`);
  }
}

async function downloadOrderFile(item) {
  const path = String(item?.path || "");
  if (!path) return;
  try {
    const blob = await storageDownloadOrderFile(path, String(item?.bucket_id || ORDER_BUTTON_BUCKET));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getAttachmentName(item);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    const detail = e?.message || "未知错误";
    showInfoDialog(`下载失败：${detail}`);
  }
}

async function previewOrderFile(item, orderOverride = null) {
  const path = String(item?.path || "");
  if (!path || !previewDialog || !previewBody) return;
  const order = orderOverride || orders.find((x) => x.id === attachmentPanelOrderId) || null;
  if (previewTitle) previewTitle.textContent = "图纸预览";
  if (previewSubTitle) {
    const seg = [];
    if (order?.orderNo) seg.push(`订单号 ${order.orderNo}`);
    if (order?.drawingNo) seg.push(`图号 ${order.drawingNo}`);
    seg.push(getAttachmentName(item));
    previewSubTitle.textContent = seg.join(" · ");
  }
  previewBody.innerHTML = `<div class="preview-empty">加载中...</div>`;
  previewDialog.hidden = false;
  document.body.style.overflow = "hidden";

  try {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = "";
    }
    const blob = await storageDownloadOrderFile(path, String(item?.bucket_id || ORDER_TEXT_BUCKET));
    previewObjectUrl = URL.createObjectURL(blob);
    const kind = getPreviewKind(item, blob.type || "");
    previewBody.innerHTML = "";
    if (kind === "image") {
      const img = document.createElement("img");
      img.className = "preview-image";
      img.alt = getAttachmentName(item);
      img.src = previewObjectUrl;
      previewBody.appendChild(img);
      return;
    }
    if (kind === "pdf") {
      const frame = document.createElement("iframe");
      frame.className = "preview-pdf";
      frame.src = previewObjectUrl;
      frame.title = getAttachmentName(item);
      previewBody.appendChild(frame);
      return;
    }
    previewBody.innerHTML = `<div class="preview-empty">该文件类型暂不支持在线预览，请下载查看。</div>`;
  } catch (e) {
    const detail = e?.message || "未知错误";
    previewBody.innerHTML = "";
    const msg = document.createElement("div");
    msg.className = "preview-empty";
    msg.textContent = `预览失败：${detail}`;
    previewBody.appendChild(msg);
  }
}

function getAttachmentName(item) {
  return item?.display_name || item?.file_name || item?.name || item?.filename || "未命名附件";
}

function setAttachmentState(orderId, hasFiles) {
  if (!orderId) return;
  attachmentStateByLineId.set(orderId, Boolean(hasFiles));
  syncPreviewCellState(orderId, Boolean(hasFiles));
}

function setAttachmentStateFromItems(orderId, items) {
  const list = Array.isArray(items) ? items : [];
  const hasFiles = list.length > 0;
  setAttachmentState(orderId, hasFiles);
  if (!hasFiles) {
    attachmentLatestTimeByLineId.delete(orderId);
    syncPreviewUploadedTime(orderId, "");
    return;
  }
  const latest = list
    .map((x) => x?.created_at || x?.createdAt || "")
    .filter(Boolean)
    .sort()
    .pop();
  const short = formatDateTimeShort(latest || "");
  attachmentLatestTimeByLineId.set(orderId, short);
  syncPreviewUploadedTime(orderId, short);
}

function syncPreviewCellState(orderId, hasFiles) {
  const selector = `td[data-id="${orderId}"][data-key="name"] .preview-text-link, td[data-id="${orderId}"][data-key="drawingNo"] .preview-text-link`;
  const nodes = document.querySelectorAll(selector);
  nodes.forEach((node) => {
    if (hasFiles) node.classList.add("preview-text-has-file");
    else node.classList.remove("preview-text-has-file");
    const currentText = (node.textContent || "").trim();
    const actionHint = hasFiles ? "点击预览图纸" : "点击截屏并上传图纸";
    node.title = currentText ? `${currentText}\n${actionHint}` : actionHint;
  });
}

function syncPreviewUploadedTime(orderId, uploadedAt = "") {
  const cells = document.querySelectorAll(`td[data-id="${orderId}"][data-key="name"]`);
  cells.forEach((cell) => {
    const wrap = cell.querySelector(".cell-with-action");
    if (!wrap) return;
    let node = wrap.querySelector(".preview-upload-time");
    if (!uploadedAt) {
      if (node) node.remove();
      return;
    }
    if (!node) {
      node = document.createElement("span");
      node.className = "preview-upload-time";
      wrap.appendChild(node);
    }
    node.textContent = `已上传 ${uploadedAt}`;
  });
}

async function warmupAttachmentStates(rows, forceAll = false) {
  if (!canUseStorageBucket(ORDER_TEXT_BUCKET)) return;
  const targets = rows
    .map((row) => row.id)
    .filter((id) => id && (forceAll || !attachmentStateByLineId.has(id)) && !attachmentStateLoading.has(id))
    .slice(0, forceAll ? 200 : 12);
  if (targets.length === 0) return;
  await Promise.all(targets.map((id) => fetchAndSetAttachmentState(id)));
}

async function fetchAndSetAttachmentState(orderId) {
  attachmentStateLoading.add(orderId);
  try {
    const items = await storageListOrderFiles(orderId, ORDER_TEXT_BUCKET);
    setAttachmentStateFromItems(orderId, items);
  } catch (_e) {
    attachmentStateByLineId.set(orderId, false);
    attachmentLatestTimeByLineId.delete(orderId);
  } finally {
    attachmentStateLoading.delete(orderId);
  }
}

function isPreviewableFile(item) {
  const kind = getPreviewKind(item, String(item?.mime_type || item?.content_type || ""));
  return kind === "image" || kind === "pdf";
}

function getPreviewKind(item, mimeRaw = "") {
  const mime = String(mimeRaw || item?.mime_type || item?.content_type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("pdf")) return "pdf";
  const name = getAttachmentName(item).toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if ([".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp"].includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  return "unknown";
}

function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value) {
  if (!value) return "时间未知";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function canUseStorageBucket(bucketName) {
  return Boolean(REMOTE_ENABLED && db && String(bucketName || "").trim() && authSession?.user?.id);
}

function orderAttachmentFolder(orderId) {
  return `orders/${orderId}`;
}

function sanitizeAttachmentFileName(name) {
  const base = String(name || "").trim() || "unnamed";
  const dot = base.lastIndexOf(".");
  const stemRaw = dot > 0 ? base.slice(0, dot) : base;
  const extRaw = dot > 0 ? base.slice(dot + 1) : "";
  const stem = stemRaw
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9._()-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "") || "unnamed";
  const ext = extRaw
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toLowerCase();
  return `${stem.slice(0, 96)}${ext ? `.${ext.slice(0, 12)}` : ""}`;
}

function buildAttachmentItemFromStorage(bucketName, folder, entry) {
  const rawName = String(entry?.name || "");
  const displayName = rawName.replace(/^\d+_[a-f0-9]{8}_/i, "") || rawName || "未命名附件";
  const path = `${folder}/${rawName}`;
  const size = Number(entry?.metadata?.size || entry?.metadata?.fileSize || entry?.size || 0) || 0;
  const mime = String(entry?.metadata?.mimetype || entry?.metadata?.contentType || "");
  return {
    id: `sb:${bucketName}/${path}`,
    bucket_id: bucketName,
    path,
    name: rawName,
    display_name: displayName,
    file_name: displayName,
    size_bytes: size,
    mime_type: mime,
    created_at: entry?.created_at || entry?.updated_at || "",
  };
}

async function storageListOrderFiles(orderId, bucketName) {
  if (!db || !bucketName) return [];
  const folder = orderAttachmentFolder(orderId);
  const { data, error } = await db.storage.from(bucketName).list(folder, {
    limit: 200,
    offset: 0,
    sortBy: { column: "name", order: "desc" },
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : [])
    .filter((entry) => String(entry?.name || "") && String(entry?.name || "") !== ".emptyFolderPlaceholder")
    .map((entry) => buildAttachmentItemFromStorage(bucketName, folder, entry));
}

async function storageUploadOrderFile(orderId, file, bucketName) {
  if (!db || !bucketName) throw new Error("Storage 未配置");
  const folder = orderAttachmentFolder(orderId);
  const safeName = sanitizeAttachmentFileName(file.name);
  const path = `${folder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;
  const { error } = await db.storage.from(bucketName).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
    cacheControl: "3600",
  });
  if (error) throw error;
  return { bucket_id: bucketName, path };
}

async function storageDeleteOrderFile(path, bucketName) {
  if (!db || !bucketName) throw new Error("Storage 未配置");
  const { error } = await db.storage.from(bucketName).remove([path]);
  if (error) throw error;
}

async function storageDownloadOrderFile(path, bucketName) {
  if (!db || !bucketName) throw new Error("Storage 未配置");
  const { data, error } = await db.storage.from(bucketName).download(path);
  if (error) throw error;
  return data;
}

function validateAttachmentFile(file) {
  if (!file) return "未选择文件。";
  const maxBytes = UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size > maxBytes) return `文件过大，当前限制 ${UPLOAD_MAX_MB}MB。`;
  const ext = `.${(file.name.split(".").pop() || "").toLowerCase()}`;
  const allowList = UPLOAD_ACCEPT.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (allowList.length > 0 && !allowList.includes(ext)) return `文件类型不支持：${ext || "未知"}。`;
  return "";
}

function formatDateTimeShort(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

async function apiFetchJson(path, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const resp = await fetch(`${UPLOAD_API_BASE}${path}`, { ...options, headers });
  if (!resp.ok) throw await parseHttpError(resp);
  if (resp.status === 204) return null;
  return await resp.json();
}

async function apiFetchBlob(path, options = {}) {
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
  const { data } = await db.auth.getSession();
  return data?.session?.access_token || "";
}

async function parseHttpError(resp) {
  let message = `HTTP ${resp.status}`;
  try {
    const data = await resp.json();
    message = data?.message || data?.error || message;
  } catch (_e) {
    // ignore parse error
  }
  return new Error(message);
}

function exportXlsx() {
  if (!window.XLSX) {
    showInfoDialog("Excel组件加载失败，请刷新页面后重试");
    return;
  }
  const rows = orders.map((o) => {
    const row = {};
    XLSX_COLUMNS.forEach(({ key, title }) => {
      row[title] = o[key] ?? "";
    });
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(rows, { header: XLSX_COLUMNS.map((x) => x.title) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "生产数据");
  XLSX.writeFile(wb, `mes_orders_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.xlsx`);
}

async function importXlsx(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!window.XLSX) {
    showInfoDialog("Excel组件加载失败，请刷新页面后重试");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = new Uint8Array(reader.result);
      const wb = XLSX.read(data, { type: "array", cellDates: true });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
      const titleToKey = Object.fromEntries(XLSX_COLUMNS.map((x) => [x.title, x.key]));
      titleToKey["预计工时"] = "plannedHours";
      const existingIdByKey = new Map();
      const usedIds = new Set();
      orders.forEach((item) => {
        const key = getOrderImportMatchKey(item);
        if (!key || existingIdByKey.has(key)) return;
        existingIdByKey.set(key, item.id);
      });

      const invalidOrderNoRows = [];
      const invalidQtyRows = [];
      const imported = rows.map((row, idx) => {
        const next = createEmptyOrder();
        const rowNo = idx + 2;
        Object.keys(row).forEach((title) => {
          const key = titleToKey[title];
          if (!key) return;
          let value = row[title];
          if (key === "startTime" || key === "dueDate") value = normalizeImportedDate(value);
          if (key === "orderNo") {
            const rawOrderNo = String(value ?? "").trim();
            const normalizedOrderNo = normalizeOrderNoInput(rawOrderNo);
            if (rawOrderNo !== "" && normalizedOrderNo === "") invalidOrderNoRows.push(rowNo);
            value = normalizedOrderNo;
          }
          if (key === "qty") {
            const qtySource = normalizeImportedNumber(value);
            const normalizedQty = normalizeValue("qty", qtySource);
            if (String(value ?? "").trim() !== "" && normalizedQty === "") invalidQtyRows.push(rowNo);
            value = normalizedQty;
          }
          if (key === "plannedHours") value = normalizeImportedNumber(value);
          next[key] = value;
        });
        next.processName = String(next.processName || "").trim();
        next.plannedHours = normalizeValue("plannedHours", next.plannedHours);
        const key = getOrderImportMatchKey(next);
        const matchedId = key ? existingIdByKey.get(key) : "";
        if (matchedId && !usedIds.has(matchedId)) {
          next.id = matchedId;
          usedIds.add(matchedId);
        } else {
          next.id = crypto.randomUUID();
        }
        next.createdAt = new Date(Date.now() + idx).toISOString();
        next.isDelayed = calcDelayed(next);
        return next;
      });
      if (invalidOrderNoRows.length) {
        const rowsText = Array.from(new Set(invalidOrderNoRows)).sort((a, b) => a - b).join("、");
        showInfoDialog(`导入失败：订单号格式无效（仅支持 ZZ+7位数字，或1-3位编号）\n问题行：${rowsText}`);
        return;
      }
      if (invalidQtyRows.length) {
        const rowsText = Array.from(new Set(invalidQtyRows)).sort((a, b) => a - b).join("、");
        showInfoDialog(`导入失败：数量必须为大于等于0的整数\n问题行：${rowsText}`);
        return;
      }
      const incomingKeys = new Set(imported.map((x) => getOrderImportMatchKey(x)).filter(Boolean));
      const previousCount = orders.length;
      let updateCount = 0;
      let insertCount = 0;
      const merged = orders.map((x) => ({ ...x }));
      const indexById = new Map();
      merged.forEach((x, idx) => {
        indexById.set(x.id, idx);
      });
      imported.forEach((row) => {
        const idx = indexById.get(row.id);
        if (typeof idx === "number") {
          merged[idx] = row;
          updateCount += 1;
        } else {
          merged.push(row);
          insertCount += 1;
        }
      });
      const duplicateOrderNos = findDuplicateOrderNos(merged);
      if (duplicateOrderNos.length) {
        const sample = duplicateOrderNos.slice(0, 6).join("、");
        const extra = duplicateOrderNos.length > 6 ? ` 等${duplicateOrderNos.length}个` : "";
        showInfoDialog(`导入失败：存在重复订单号（${sample}${extra}），请先处理重复后再导入。`);
        return;
      }
      const untouched = Math.max(0, previousCount - updateCount);
      const confirmed = await showActionConfirmDialog(
        `导入预览：\n新增 ${insertCount} 条\n覆盖 ${updateCount} 条\n保留历史 ${untouched} 条\n\n确认继续导入吗？`
      );
      if (!confirmed) return;
      orders = merged;
      await persistOrders({ changed: imported });
      render();
      showInfoDialog("导入成功：已覆盖同键订单并新增新订单，未删除未包含在Excel中的历史订单。");
    } catch (e) {
      console.error(e);
      const msg = (e && e.message) ? e.message : "";
      if (msg.includes("item_name")) {
        showInfoDialog("导入失败：云端表缺少 item_name 字段，请在 Supabase 执行最新 supabase_schema.sql 后重试。");
      } else {
        showInfoDialog("导入失败：请使用系统导出的 Excel 或包含标准列名的 Excel");
      }
    }
  };

  reader.readAsArrayBuffer(file);
  event.target.value = "";
}

function getOrderImportMatchKey(order) {
  const orderNo = String(order?.orderNo || "").trim().toUpperCase();
  const drawingNo = String(order?.drawingNo || "").trim().toUpperCase();
  const name = String(order?.name || "").trim().toUpperCase();
  if (!orderNo && !drawingNo && !name) return "";
  return `${orderNo}|${drawingNo}|${name}`;
}

function findDuplicateOrderNos(list = []) {
  const countByNo = new Map();
  list.forEach((row) => {
    const orderNo = String(row?.orderNo || "").trim().toUpperCase();
    if (!orderNo) return;
    countByNo.set(orderNo, (countByNo.get(orderNo) || 0) + 1);
  });
  return Array.from(countByNo.entries())
    .filter(([, count]) => count > 1)
    .map(([orderNo]) => orderNo)
    .sort((a, b) => a.localeCompare(b));
}

function normalizeImportedDate(v) {
  return normalizeDateOnlyInput(v);
}

function normalizeImportedNumber(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function toFiniteOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDbStartTime(v) {
  const s = normalizeDateOnlyInput(v);
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  return "";
}

function toDbDueDate(v) {
  const s = normalizeImportedDate(v);
  return s || "";
}

function formatStartTimeFromDb(v) {
  if (!v) return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

function formatDueDateFromDb(v) {
  return normalizeImportedDate(v);
}

function splitNoteAndMeta(noteValue) {
  let clean = String(noteValue || "");
  let processName = "";
  let processStepCurrent = "";
  let completionDate = "";

  clean = clean.replace(/\s*\[STEP:([^\]]*)\]\s*/g, (_all, v) => {
    processStepCurrent = normalizeStepValue(v || "");
    return " ";
  });
  clean = clean.replace(/\s*\[PROC:([^\]]*)\]\s*/g, (_all, v) => {
    processName = String(v || "").trim();
    return " ";
  });
  clean = clean.replace(/\s*\[DONE:([^\]]*)\]\s*/g, (_all, v) => {
    completionDate = normalizeDateOnlyInput(v || "");
    return " ";
  });
  clean = clean.replace(/\s+/g, " ").trim();

  return {
    note: clean,
    processName,
    processStepCurrent,
    completionDate,
  };
}

function mergeOrderMetaIntoNote(noteValue, { processName = "", processStepCurrent = "", completionDate = "" } = {}) {
  const base = splitNoteAndMeta(noteValue).note;
  const process = String(processName || "").trim();
  const step = normalizeStepValue(processStepCurrent);
  const done = normalizeDateOnlyInput(completionDate);
  const tail = [];
  if (step) tail.push(`[STEP:${step}]`);
  if (process) tail.push(`[PROC:${process}]`);
  if (done) tail.push(`[DONE:${done}]`);
  if (!base && tail.length === 0) return "";
  if (!base) return tail.join(" ");
  if (tail.length === 0) return base;
  return `${base} ${tail.join(" ")}`;
}

function normalizeDateOnlyInput(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim().replaceAll("/", "-");
  const m = s.match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (!m) return "";
  const year = Number(m[1] || new Date().getFullYear());
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeStartTimeInput(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 16).replace("T", " ");
  const s = String(v).trim().replaceAll("/", "-").replace("T", " ");
  if (!s) return "";
  const m = s.match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:\s(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!m) return "";
  const year = Number(m[1] || new Date().getFullYear());
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4] || 0);
  const minute = Number(m[5] || 0);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day ||
    dt.getUTCHours() !== hour ||
    dt.getUTCMinutes() !== minute
  ) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}


function setupColumnResizers() {
  const headers = document.querySelectorAll("#orderTable thead th");
  headers.forEach((th, index) => {
    const colIndex = index + 1;
    const fixed = isFixedWidthColumn(colIndex);
    th.classList.toggle("col-fixed", fixed);
    if (fixed) return;
    if (th.querySelector(".col-resizer")) return;
    const handle = document.createElement("span");
    handle.className = "col-resizer";
    handle.addEventListener("mousedown", (e) => startResize(e, colIndex));
    th.appendChild(handle);
  });
  queueStickyColumnOffsets();
}

function ensureTableColGroup() {
  const table = document.getElementById("orderTable");
  if (!table) return;
  const headers = table.querySelectorAll("thead th");
  if (headers.length === 0) return;

  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    table.insertBefore(colgroup, table.firstChild);
  }

  const existing = colgroup.querySelectorAll("col").length;
  if (existing !== headers.length) {
    colgroup.innerHTML = "";
    headers.forEach(() => {
      colgroup.appendChild(document.createElement("col"));
    });
  }
}

function startResize(event, colIndex) {
  if (isFixedWidthColumn(colIndex)) return;
  event.preventDefault();
  const header = document.querySelector(`#orderTable thead th:nth-child(${colIndex})`);
  if (!header) return;
  const startX = event.clientX;
  const startWidth = header.getBoundingClientRect().width;

  const onMove = (e) => {
    const next = Math.max(48, Math.round(startWidth + (e.clientX - startX)));
    columnWidths[String(colIndex)] = next;
    setColumnWidth(colIndex, next);
    queueStickyColumnOffsets();
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    saveColumnWidths();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function setColumnWidth(colIndex, px) {
  const fixedPx = getFixedColumnWidth(colIndex);
  const targetPx = Number.isFinite(fixedPx) ? fixedPx : px;
  if (!Number.isFinite(targetPx)) return;
  const col = document.querySelector(`#orderTable colgroup col:nth-child(${colIndex})`);
  if (col) col.style.width = `${targetPx}px`;

  // Keep sticky/fixed columns and headers stable in all browsers.
  const cells = document.querySelectorAll(`#orderTable tr > *:nth-child(${colIndex})`);
  cells.forEach((cell) => {
    cell.style.width = `${targetPx}px`;
    cell.style.minWidth = `${targetPx}px`;
    cell.style.maxWidth = `${targetPx}px`;
  });
}

function applyColumnWidths() {
  Object.keys(FIXED_COL_WIDTHS).forEach((k) => {
    const col = Number(k);
    const px = Number(FIXED_COL_WIDTHS[k]);
    if (Number.isFinite(col) && Number.isFinite(px)) {
      setColumnWidth(col, px);
    }
  });
  Object.keys(columnWidths).forEach((k) => {
    const col = Number(k);
    const px = Number(columnWidths[k]);
    if (isFixedWidthColumn(col)) return;
    if (Number.isFinite(col) && Number.isFinite(px)) {
      setColumnWidth(col, px);
    }
  });
  queueStickyColumnOffsets();
}

function isFixedWidthColumn(colIndex) {
  return Number.isFinite(Number(colIndex)) && Object.prototype.hasOwnProperty.call(FIXED_COL_WIDTHS, String(colIndex));
}

function getFixedColumnWidth(colIndex) {
  if (!isFixedWidthColumn(colIndex)) return NaN;
  return Number(FIXED_COL_WIDTHS[String(colIndex)]);
}

function updateStickyColumnOffsets() {
  const table = document.getElementById("orderTable");
  if (!table) return;
  const w1 = getColumnWidth(1);
  const w2 = getColumnWidth(2);
  const w3 = getColumnWidth(3);
  table.style.setProperty("--sticky-left-1", "0px");
  table.style.setProperty("--sticky-left-2", `${w1}px`);
  table.style.setProperty("--sticky-left-3", `${w1 + w2}px`);
  table.style.setProperty("--sticky-left-4", `${w1 + w2 + w3}px`);
}

function queueStickyColumnOffsets() {
  if (stickyOffsetRaf) return;
  stickyOffsetRaf = window.requestAnimationFrame(() => {
    stickyOffsetRaf = 0;
    updateStickyColumnOffsets();
  });
}

function getColumnWidth(colIndex) {
  const header = document.querySelector(`#orderTable thead th:nth-child(${colIndex})`);
  if (!header) return 0;
  return Math.round(header.getBoundingClientRect().width);
}

function saveColumnWidths() {
  columnWidths = sanitizeColumnWidths(columnWidths);
  localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(columnWidths));
}

function loadColumnWidths() {
  try {
    const raw = localStorage.getItem(COL_WIDTH_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const sanitized = sanitizeColumnWidths(parsed);
    if (raw && JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
      localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(sanitized));
    }
    return sanitized;
  } catch {
    return {};
  }
}

function sanitizeColumnWidths(input) {
  if (!input || typeof input !== "object") return {};
  const next = {};
  Object.keys(input).forEach((k) => {
    const col = Number(k);
    const px = Number(input[k]);
    if (!Number.isFinite(col) || !Number.isFinite(px)) return;
    if (isFixedWidthColumn(col)) return;
    if (px < 48 || px > 1200) return;
    next[String(col)] = Math.round(px);
  });
  return next;
}















































