const STORAGE_KEY = "mini_mes_orders_v1";
const COL_WIDTH_KEY = "mini_mes_col_widths_v1";
const SHIFT_DEFAULTS_KEY = "mini_mes_shift_defaults_v1";
const COMPACT_MODE_KEY = "mini_mes_compact_mode_v1";

const STATUS = ["待排产", "已排产", "加工中", "完成待检", "返工", "已发货"];
const MACHINES = ["CNC1", "CNC2", "CNC3", "CNC4", "CNC5"];
const FIXED_COL_WIDTHS = {};
const SURFACE_OPTIONS = ["", "阳极氧化", "发黑", "喷砂", "喷漆", "电镀", "拉丝", "抛光", "热处理", "钝化"];
const PROCESS_OPTIONS = ["", "1", "2", "3", "4", "5", "6"];
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
  { key: "startTime", title: "开始时间" },
  { key: "dueDate", title: "交期" },
  { key: "isDelayed", title: "是否延期" },
  { key: "note", title: "备注" },
];

const MES_CONFIG = window.MES_CONFIG || {};
const REMOTE_ENABLED = Boolean(MES_CONFIG.SUPABASE_URL && MES_CONFIG.SUPABASE_ANON_KEY && window.supabase);
const AUTO_REFRESH_MS = Math.max(5000, Number(MES_CONFIG.AUTO_REFRESH_SECONDS || 15) * 1000);
const UPLOAD_API_BASE = String(MES_CONFIG.UPLOAD_API_BASE || "").replace(/\/+$/, "");
const UPLOAD_MAX_MB = Math.max(1, Number(MES_CONFIG.UPLOAD_MAX_MB || 50));
const UPLOAD_ACCEPT = String(MES_CONFIG.UPLOAD_ACCEPT || ".pdf,.jpg,.jpeg,.png,.dwg,.step,.zip,.rar");
const db = REMOTE_ENABLED ? window.supabase.createClient(MES_CONFIG.SUPABASE_URL, MES_CONFIG.SUPABASE_ANON_KEY) : null;

let orders = [];
let filters = { q: "", month: "", machine: "", status: "" };
let syncing = false;
let remoteOnline = REMOTE_ENABLED;
let remoteErrorNotified = false;
let reconnectTimer = null;
let reconnectDelayMs = 5000;
let authSession = null;
let authWriteHintNotified = false;
let abnormalOnly = false;
let lastSyncAt = "";
let stickyOffsetRaf = 0;
let columnWidths = loadColumnWidths();
let shiftDefaults = loadShiftDefaults();
let compactMode = loadCompactMode();
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
let transientCellErrors = new Map();
let ruleCellErrors = new Map();
let rowSavedUntil = new Map();
let saveFeedbackTimer = 0;
let attachmentLatestTimeByLineId = new Map();
let dirtyCellMarks = new Set();
let pendingDeleteOrderId = "";

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
const processNameInput = document.getElementById("processNameInput");
const processMinutesInput = document.getElementById("processMinutesInput");
const processMachineInput = document.getElementById("processMachineInput");
const processLatheInput = document.getElementById("processLatheInput");
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
const compactModeBtn = document.getElementById("compactModeBtn");
const saveFeedback = document.getElementById("saveFeedback");
const deleteConfirmDialog = document.getElementById("deleteConfirmDialog");
const deleteConfirmText = document.getElementById("deleteConfirmText");
const deleteConfirmCloseBtn = document.getElementById("deleteConfirmCloseBtn");
const deleteConfirmCancelBtn = document.getElementById("deleteConfirmCancelBtn");
const deleteConfirmOkBtn = document.getElementById("deleteConfirmOkBtn");
const PROCESS_TIME_TITLE_BASE = "预计工时设置";
const STATUS_TITLE_BASE = "状态设置";
const DATE_TITLE_BASE = "日期设置";
const SURFACE_TITLE_BASE = "表面处理设置";

init();

async function init() {
  bindEvents();
  applyCompactMode();
  setupColumnResizers();
  updatePinnedOffsets();
  if (REMOTE_ENABLED) {
    await initAuth();
    setModeText(authSession ? "云端共享模式" : "云端只读（未登录）");
    await refreshFromRemote();
    setInterval(async () => {
      if (!syncing && remoteOnline) await refreshFromRemote(false);
    }, AUTO_REFRESH_MS);
  } else {
    setModeText("本地模式");
    orders = loadOrdersLocal();
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

function getErrorKey(orderId, key) {
  return `${orderId || ""}:${key || ""}`;
}

function getDirtyCellKey(orderId, key) {
  return `${orderId || ""}:${key || ""}`;
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
    if (qtyRaw !== "" && !Number.isFinite(Number(qtyRaw))) {
      next.set(getErrorKey(order.id, "qty"), "数量必须为数字");
    }
    const start = normalizeDateOnlyInput(order.startTime);
    const due = normalizeDateOnlyInput(order.dueDate);
    if (start && due && due < start) {
      const msg = "交期不能早于开始时间";
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
  if (compactModeBtn) {
    compactModeBtn.addEventListener("click", () => {
      compactMode = !compactMode;
      saveCompactMode(compactMode);
      applyCompactMode();
    });
  }
  const addRowBtn = document.getElementById("addRowBtn");
  if (addRowBtn) addRowBtn.addEventListener("click", addBlankRow);
  const addBlankBottomBtn = document.getElementById("addBlankBottomBtn");
  if (addBlankBottomBtn) addBlankBottomBtn.addEventListener("click", addBlankRow);
  const saveBtn = document.getElementById("saveBtn");
  if (saveBtn) saveBtn.addEventListener("click", exportXlsx);
  const importInput = document.getElementById("importInput");
  if (importInput) importInput.addEventListener("change", importXlsx);
  backTopBtn.addEventListener("click", scrollToTopRow);
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
      if (processNameInput) processNameInput.value = "";
      if (processMinutesInput) processMinutesInput.value = "";
      if (processMachineInput) processMachineInput.value = "";
      if (processLatheInput) processLatheInput.value = "";
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
      render();
    });
  }
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      filters.q = e.target.value.trim().toLowerCase();
      render();
    });
  }
  const filterMonth = document.getElementById("filterMonth");
  if (filterMonth) {
    filterMonth.addEventListener("change", (e) => {
      filters.month = e.target.value;
      render();
    });
  }
  const filterMachine = document.getElementById("filterMachine");
  if (filterMachine) {
    filterMachine.addEventListener("change", (e) => {
      filters.machine = e.target.value;
      render();
    });
  }
  const filterStatus = document.getElementById("filterStatus");
  if (filterStatus) {
    filterStatus.addEventListener("change", (e) => {
      filters.status = e.target.value;
      render();
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
  tableWrap.addEventListener("scroll", updateBackTopBtn);
  window.addEventListener("resize", updateStickyColumnOffsets);
  window.addEventListener("resize", () => {
    updatePinnedOffsets();
    syncFilterPanelForViewport();
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
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      void addBlankRow();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      exportXlsx();
    }
  });
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
    console.warn("读取登录态失败", e);
    authSession = null;
  }
  updateAuthUi();
  db.auth.onAuthStateChange((_event, session) => {
    authSession = session || null;
    authWriteHintNotified = false;
    updateAuthUi();
    if (remoteOnline) {
      setModeText(authSession ? "云端共享模式" : "云端只读（未登录）");
    }
    if (authSession && remoteOnline) {
      void refreshFromRemote(false);
    }
  });
}

async function beginEmailLogin() {
  if (!REMOTE_ENABLED || !db?.auth) return;
  const email = (prompt("请输入登录邮箱（将发送登录链接）") || "").trim();
  if (!email) return;
  try {
    const { error } = await db.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.href.split("#")[0],
      },
    });
    if (error) throw error;
    alert("登录邮件已发送，请在邮箱中点击登录链接后返回本页。");
  } catch (e) {
    const detail = e?.message || e?.error_description || "未知错误";
    alert(`发送登录邮件失败：${detail}`);
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
    alert(`退出失败：${detail}`);
  }
}

function updateAuthUi() {
  if (authUser) {
    authUser.textContent = authSession?.user?.email || "未登录";
  }
  if (loginBtn) loginBtn.style.display = authSession ? "none" : "inline-flex";
  if (logoutBtn) logoutBtn.style.display = authSession ? "inline-flex" : "none";
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
function loadCompactMode() {
  try {
    return localStorage.getItem(COMPACT_MODE_KEY) === "1";
  } catch (_e) {
    return false;
  }
}

function saveCompactMode(enabled) {
  try {
    localStorage.setItem(COMPACT_MODE_KEY, enabled ? "1" : "0");
  } catch (_e) {
    // ignore write failure
  }
}

function applyCompactMode() {
  document.body.classList.toggle("compact-mode", compactMode);
  if (compactModeBtn) compactModeBtn.textContent = `紧凑模式: ${compactMode ? "开" : "关"}`;
  updatePinnedOffsets();
}
function canWriteRemote(notify = true) {
  if (!REMOTE_ENABLED) return false;
  if (authSession) return true;
  if (notify && !authWriteHintNotified) {
    authWriteHintNotified = true;
    alert("当前为只读模式，请先点击“邮箱登录”后再写入云端数据。");
  }
  return false;
}

function createEmptyOrder() {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
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
    alert("请填写编号");
    return;
  }
  if (!orderNo) {
    alert("编号格式无效，请输入1-3位数字（如 30 或 030）");
    return;
  }

  const order = {
    ...createEmptyOrder(),
    orderNo,
    customer,
    status: "待排产",
    programNo: "未出",
    startTime: "",
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

async function addBlankRow() {
  const order = createEmptyOrder();
  orders.push(order);
  await persistOrders({ changed: [order] });
  render();
  focusOrderRow(order.id);
  const firstEditable = tableBody.querySelector(`td[data-id="${order.id}"][data-key='orderNo']`);
  if (firstEditable) beginEdit(firstEditable);
}

function render() {
  ensureTableColGroup();
  rebuildRuleCellErrors();
  const rows = getFilteredOrders();
  tableBody.innerHTML = "";
  const now = Date.now();

  rows.forEach((o, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.id = o.id;

    const stateClass =
      o.isDelayed === "延期" ? "row-delayed" : o.status === "加工中" ? "row-working" : o.status === "已发货" ? "row-shipped" : "";
    if (stateClass) tr.classList.add(stateClass);
    if ((rowSavedUntil.get(o.id) || 0) > now) tr.classList.add("row-saved");

    tr.appendChild(textCell(idx + 1));
    tr.appendChild(editCell(o, "orderNo"));
    tr.appendChild(editCell(o, "customer"));
    tr.appendChild(previewEditCell(o, "name"));
    tr.appendChild(previewEditCell(o, "drawingNo"));
    tr.appendChild(editCell(o, "qty"));
    tr.appendChild(processTimeCell(o));
    tr.appendChild(surfaceCell(o));
    tr.appendChild(statusCell(o));
    tr.appendChild(dateCell(o, "startTime", "开始时间"));
    tr.appendChild(dateCell(o, "dueDate", "交期"));
    tr.appendChild(editCell(o, "note"));

    const opTd = document.createElement("td");
    const fileBtn = document.createElement("button");
    fileBtn.className = "action-btn-secondary";
    fileBtn.textContent = "图纸";
    fileBtn.addEventListener("click", () => {
      void openAttachmentDialog(o.id);
    });
    const delBtn = document.createElement("button");
    delBtn.className = "action-btn";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      void removeOrder(o.id);
    });
    opTd.appendChild(fileBtn);
    opTd.appendChild(delBtn);
    tr.appendChild(opTd);

    tableBody.appendChild(tr);
  });

  rowSavedUntil.forEach((until, id) => {
    if (until <= now) rowSavedUntil.delete(id);
  });

  applyColumnWidths();
  queueStickyColumnOffsets();
  renderKanban(rows);
  renderKpis(orders);
  void warmupAttachmentStates(rows);
}

function renderKanban(rows) {
  if (!kanbanBoard || !boardSummary) return;

  kanbanBoard.innerHTML = "";
  boardSummary.innerHTML = "";
  const effectiveOrderNoMap = buildEffectiveOrderNoMap(rows);

  const total = rows.length;
  const totalPill = document.createElement("span");
  totalPill.className = "board-pill";
  totalPill.textContent = `当前订单 ${total}`;
  boardSummary.appendChild(totalPill);

  STATUS.forEach((status) => {
    const list = rows.filter((o) => o.status === status);

    const statusPill = document.createElement("span");
    statusPill.className = "board-pill";
    statusPill.textContent = `${status} ${list.length}`;
    boardSummary.appendChild(statusPill);

    const col = document.createElement("article");
    col.className = "kanban-col";

    const head = document.createElement("div");
    head.className = "kanban-col-head";
    const title = document.createElement("strong");
    title.textContent = status;
    const count = document.createElement("span");
    count.textContent = `${list.length} 单`;
    head.appendChild(title);
    head.appendChild(count);

    const body = document.createElement("div");
    body.className = "kanban-col-body";

    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "kanban-empty";
      empty.textContent = "暂无订单";
      body.appendChild(empty);
    } else {
      list.forEach((order) => {
        body.appendChild(createKanbanCard(order, effectiveOrderNoMap.get(order.id) || ""));
      });
    }

    col.appendChild(head);
    col.appendChild(body);
    kanbanBoard.appendChild(col);
  });
}

function createKanbanCard(order, displayOrderNo = "") {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "kanban-card";
  card.addEventListener("click", () => focusOrderRow(order.id));

  const top = document.createElement("div");
  top.className = "kanban-card-top";
  const orderNo = document.createElement("span");
  orderNo.className = "kanban-order";
  orderNo.textContent = displayOrderNo || "未填订单号";
  top.appendChild(orderNo);

  const name = document.createElement("div");
  name.className = "kanban-name";
  name.textContent = order.name || order.drawingNo || "未命名零件";

  const meta = document.createElement("div");
  meta.className = "kanban-meta";
  meta.appendChild(createKanbanTag(order.customer || "未填客户"));
  if (order.machine) meta.appendChild(createKanbanTag(order.machine));
  if (order.status === "加工中" && normalizeStepValue(order.processStepCurrent)) {
    meta.appendChild(createKanbanTag(`加工中第${normalizeStepValue(order.processStepCurrent)}序`));
  }
  if (order.dueDate) meta.appendChild(createKanbanTag(`交期 ${toMonthDay(order.dueDate)}`));
  if (order.plannedHours !== "" && order.plannedHours != null) meta.appendChild(createKanbanTag(`工时 ${order.plannedHours}分`));
  if (order.isDelayed === "延期") meta.appendChild(createKanbanTag("延期", true));

  card.appendChild(top);
  card.appendChild(name);
  card.appendChild(meta);
  return card;
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

function createKanbanTag(text, delayed = false) {
  const tag = document.createElement("span");
  tag.className = delayed ? "kanban-tag kanban-delay" : "kanban-tag";
  tag.textContent = text;
  return tag;
}

function focusOrderRow(id) {
  const row = tableBody.querySelector(`tr[data-id="${id}"]`);
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
  td.addEventListener("dblclick", () => beginEdit(td, type));
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
  if (attachmentStateByLineId.get(order.id) === true) {
    text.classList.add("preview-text-has-file");
  }
  const display = formatDisplayValue(key, rawValue);
  text.textContent = display;
  text.title = display ? `${display}\n点击预览图纸` : "点击预览图纸";
  text.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openLinePreview(order.id);
  });
  text.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
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

  td.addEventListener("dblclick", () => beginEdit(td, type));
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

function formatProcessTimeLabel(order) {
  const minutes = normalizeValue("plannedHours", order.plannedHours);
  const process = String(order.processName || "").trim();
  const processText = process ? `共${process}序` : "";
  const parts = [];
  if (order.programNo) parts.push(`程序单${order.programNo}`);
  if (processText) parts.push(processText);
  if (minutes !== "") parts.push(`${minutes} 分钟`);
  if (order.machine) parts.push(order.machine);
  if (order.lathe) parts.push(`车床${order.lathe}`);
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
  td.textContent = formatDisplayValue(key, order[key] ?? "");
  td.title = `点击设置${label}（月/日）`;
  appendCellError(td, order.id, key);
  td.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openDateDialog(order.id, key, label);
  });
  return td;
}

function surfaceCell(order) {
  const td = document.createElement("td");
  td.dataset.key = "surface";
  td.dataset.id = order.id;
  td.className = "surface-cell";
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
  return step ? `加工中第${step}序` : "加工中";
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
  if (s === "已发货") return "status-done";
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
  if (!processNameInput) return;
  processNameInput.innerHTML = "";
  PROCESS_OPTIONS.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name ? `共${name}序` : "请选择工序";
    processNameInput.appendChild(option);
  });
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
  if (processLatheInput) {
    processLatheInput.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "请选择";
    processLatheInput.appendChild(blank);
    ["是", "否"].forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      processLatheInput.appendChild(option);
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
    alert("请选择月份和日期。");
    return;
  }
  const maxDay = getDaysInMonthForCurrentYear(month);
  if (day > maxDay) {
    alert("日期无效，请重新选择。");
    return;
  }
  const year = new Date().getFullYear();
  const next = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const nextStart = dateEditingKey === "startTime" ? next : normalizeDateOnlyInput(order.startTime);
  const nextDue = dateEditingKey === "dueDate" ? next : normalizeDateOnlyInput(order.dueDate);
  if (nextStart && nextDue && nextDue < nextStart) {
    const msg = "交期不能早于开始时间";
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

function getMaxProcessStep(order) {
  const max = Number(String(order?.processName || "").trim());
  if (Number.isFinite(max) && max >= 1) return Math.min(6, Math.floor(max));
  return 1;
}

function normalizeStepValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const v = Math.floor(n);
  if (v < 1 || v > 6) return "";
  return String(v);
}

function rebuildStatusStepOptions(maxStep = 6) {
  if (!statusStepInput) return;
  statusStepInput.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "请选择";
  statusStepInput.appendChild(blank);
  for (let i = 1; i <= maxStep; i += 1) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `第${i}序`;
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
  rebuildStatusStepOptions(maxStep);
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
    parts.push(`最多第${maxStep}序`);
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
  if (statusProcessContext) statusProcessContext.textContent = "当前第0序 / 共1序 / 剩余1序";
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
  const maxStep = getMaxProcessStep(order);
  let nextStep = "";
  if (nextStatus === "加工中") {
    const rawStep = normalizeStepValue(statusStepInput?.value || "");
    if (!rawStep) {
      alert("请选择加工序号。");
      return;
    }
    if (Number(rawStep) > maxStep) {
      alert(`当前工序总数为 ${maxStep}，加工序号不能超过第${maxStep}序。`);
      return;
    }
    nextStep = rawStep;
  }
  const changed = order.status !== nextStatus || String(order.processStepCurrent || "") !== nextStep;
  order.status = nextStatus;
  order.processStepCurrent = nextStep;
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
    statusStepHint.textContent = `当前未选择序号，共${maxStep}序。`;
    syncStatusProcessContext();
    return;
  }
  const remain = Math.max(0, maxStep - currentStep);
  statusStepHint.textContent = `当前第${currentStep}序，剩余${remain}序。`;
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
  statusProcessContext.textContent = `当前第${currentStep}序 / 共${maxStep}序 / 剩余${remain}序`;
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
    statusNextBtn.textContent = "下一步：推进序号";
    return;
  }
  if (current === "完成待检") {
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
  if (processNameInput) processNameInput.value = order.processName || "";
  if (processMinutesInput) processMinutesInput.value = order.plannedHours === "" ? "" : String(order.plannedHours);
  if (processMachineInput) processMachineInput.value = order.machine || defaults.machine || "";
  if (processLatheInput) processLatheInput.value = order.lathe || defaults.lathe || "";
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
  const nextProcess = String(processNameInput?.value || "").trim();
  const minuteRaw = String(processMinutesInput?.value || "").trim();
  const nextMachine = String(processMachineInput?.value || "").trim();
  const nextLathe = String(processLatheInput?.value || "").trim();
  const nextMinutes = normalizeValue("plannedHours", minuteRaw);
  if (minuteRaw !== "" && nextMinutes === "") {
    alert("工时格式无效，请输入整数分钟。");
    return;
  }
  const prevStep = String(target.processStepCurrent || "");
  let changed =
    target.processName !== nextProcess ||
    target.plannedHours !== nextMinutes ||
    String(target.programNo || "") !== nextProgramNo ||
    String(target.machine || "") !== nextMachine ||
    String(target.lathe || "") !== nextLathe;
  target.programNo = nextProgramNo;
  target.processName = nextProcess;
  target.plannedHours = nextMinutes;
  target.machine = nextMachine;
  target.lathe = nextLathe;
  saveShiftDefaultsPatch({ machine: nextMachine, lathe: nextLathe });
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

function beginEdit(td, type = "text") {
  if (td.classList.contains("editing")) return;
  const oldValue = td.dataset.raw ?? td.textContent;
  const orderId = td.dataset.id;
  const key = td.dataset.key;
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
    if (!nextRow) return;
    const first = nextRow.querySelector('td[data-key="orderNo"]');
    if (first) beginEdit(first);
    return;
  }

  const nextRow = row.nextElementSibling;
  if (!nextRow) return;
  const colIndex = [...row.children].indexOf(currentTd);
  const nextTd = nextRow.children[colIndex];
  if (nextTd && nextTd.dataset.key) beginEdit(nextTd);
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
  if (key === "qty" && raw !== "" && !Number.isFinite(Number(raw))) {
    setDirtyCellMark(id, key, true);
    setTransientCellError(id, "qty", "数量必须为数字");
    render();
    return false;
  }
  if (key === "orderNo") {
    if (raw !== "" && normalized === "") {
      setDirtyCellMark(id, key, true);
      setTransientCellError(id, "orderNo", "订单号格式无效");
      render();
      return false;
    }
    const dup = normalized
      ? orders.some((o) => o.id !== id && String(o.orderNo || "").trim() === normalized)
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
    setTransientCellError(id, key, key === "dueDate" ? "交期格式无效" : "开始时间格式无效");
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
      const msg = "交期不能早于开始时间";
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
  if (key === "qty" || key === "plannedHours") {
    if (value === "") return "";
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    if (key === "plannedHours") return Math.max(0, Math.round(num));
    return num;
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
  if (!order.dueDate || order.status === "已发货") return "";
  const due = new Date(order.dueDate + "T23:59:59");
  return Date.now() > due.getTime() ? "延期" : "正常";
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
    const mOk = !filters.machine || o.machine === filters.machine;
    const sOk = !filters.status || o.status === filters.status;
    const abnormalOk = !abnormalOnly || isAbnormalOrder(o);
    return qOk && monthOk && mOk && sOk && abnormalOk;
  });
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

function renderKpis(data) {
  const totalOrders = data.length;
  const inProduction = data.filter((x) => x.status === "加工中").length;
  const dueToday = data.filter((x) => isDueToday(x.dueDate)).length;
  const abnormalCount = data.filter((x) => isAbnormalOrder(x)).length;

  document.getElementById("kpiTotalOrders").textContent = String(totalOrders);
  document.getElementById("kpiInProduction").textContent = String(inProduction);
  document.getElementById("kpiDueToday").textContent = String(dueToday);
  document.getElementById("kpiAbnormalCount").textContent = String(abnormalCount);
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
  saveOrdersLocal();
  setLastSyncTime();
  if (!REMOTE_ENABLED || !remoteOnline) return;
  if (!canWriteRemote(true)) return;

  syncing = true;
  try {
    if (changed.length > 0) {
      const baseMs = Date.now();
      const payload = changed.map((item, idx) => toDbRow(item, new Date(baseMs + idx).toISOString()));
      const { error } = await db.from("mes_orders").upsert(payload, { onConflict: "id" });
      if (error) throw error;
    }
    if (deletedId) {
      const { error } = await db.from("mes_orders").delete().eq("id", deletedId);
      if (error) throw error;
    }
  } catch (e) {
    if (isAuthError(e)) {
      authSession = null;
      authWriteHintNotified = false;
      updateAuthUi();
      setModeText(remoteOnline ? "云端只读（未登录）" : "本地模式（云连接失败）");
      alert("写入失败：登录态已失效，请重新登录。");
      return;
    }
    handleRemoteError("云端同步失败", e);
  } finally {
    syncing = false;
  }
}

function saveOrdersLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

function loadOrdersLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        return data.map((x, idx) => ({
          ...createEmptyOrder(),
          ...x,
          createdAt: x.createdAt || new Date(Date.now() + idx).toISOString(),
        }));
      }
    } catch (e) {
      console.warn("读取本地缓存失败", e);
    }
  }
  return demoData();
}

async function refreshFromRemote(showAlert = false) {
  if (!remoteOnline) return;
  try {
    const { data, error } = await db.from("mes_orders").select("*").order("updated_at", { ascending: true });
    if (error) throw error;
    orders = (data || [])
      .map(fromDbRow)
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));

    if (orders.length === 0) {
      orders = loadOrdersLocal();
      await persistOrders({ changed: orders });
    }

    saveOrdersLocal();
    render();
    setLastSyncTime();
    reconnectDelayMs = 5000;
    remoteErrorNotified = false;
    if (showAlert) alert("已从云端刷新最新数据");
  } catch (e) {
    if (isAuthError(e) && !authSession) {
      remoteOnline = true;
      remoteErrorNotified = false;
      setModeText("云端只读（未登录）");
      orders = loadOrdersLocal();
      render();
      setLastSyncTime();
      return;
    }
    handleRemoteError("云端读取失败", e);
    orders = loadOrdersLocal();
    render();
  }
}

function handleRemoteError(prefix, err) {
  console.error(prefix, err);
  remoteOnline = false;
  setModeText("本地模式（云连接失败）");
  scheduleReconnect();
  if (!remoteErrorNotified) {
    remoteErrorNotified = true;
    const detail = err?.message || err?.error_description || "未知错误";
    alert(`${prefix}：${detail}\n已自动切换本地模式。`);
  }
}

function isAuthError(err) {
  const code = String(err?.status || err?.code || "").toUpperCase();
  const msg = String(err?.message || err?.error_description || "").toUpperCase();
  return code === "401" || code === "403" || code === "PGRST301" || msg.includes("JWT") || msg.includes("AUTH");
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
    await refreshFromRemote(false);
    if (manual) alert("云端连接已恢复");
  } catch (e) {
    remoteOnline = false;
    setModeText("本地模式（云连接失败）");
    scheduleReconnect();
    if (manual) {
      const detail = e?.message || e?.error_description || "未知错误";
      alert(`重连失败：${detail}`);
    }
  }
}

function toDbRow(order, updatedAtOverride = "") {
  const normalizedProcess = String(order.processName || "").trim();
  const normalizedStep = order.status === "加工中" ? normalizeStepValue(order.processStepCurrent) : "";
  const mergedNote = mergeOrderMetaIntoNote(order.note || "", {
    processName: normalizedProcess,
    processStepCurrent: normalizedStep,
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
  return document.getElementById(id).value.trim();
}

function clearQuickAdd() {
  ["qaOrderNo", "qaCustomer"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function scrollToTopRow() {
  if (tableWrap) tableWrap.scrollTo({ top: 0, behavior: "smooth" });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateBackTopBtn() {
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
  if (!UPLOAD_API_BASE) {
    alert("未配置上传服务地址，请先设置 config.js 的 UPLOAD_API_BASE。");
    return;
  }
  try {
    const data = await apiFetchJson(`/api/files/list?orderId=${encodeURIComponent(orderId)}`, { method: "GET" });
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    setAttachmentStateFromItems(orderId, items);
    if (items.length === 0) {
      alert("该零件暂无图纸，请先上传。");
      await openAttachmentDialog(orderId);
      return;
    }
    const previewable = items.find((item) => isPreviewableFile(item));
    if (!previewable) {
      alert("当前图纸类型不支持在线预览，请在附件列表中下载查看。");
      await openAttachmentDialog(orderId);
      return;
    }
    await previewOrderFile(previewable, order);
  } catch (e) {
    const detail = e?.message || "未知错误";
    alert(`预览失败：${detail}`);
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
    const parts = [];
    if (order.orderNo) parts.push(`订单号 ${order.orderNo}`);
    if (order.drawingNo) parts.push(`图号 ${order.drawingNo}`);
    if (order.name) parts.push(`名称 ${order.name}`);
    attachmentSubTitle.textContent = parts.join(" · ") || "未填写订单基础信息";
  }
  if (attachmentHint) {
    attachmentHint.textContent = `支持类型: ${UPLOAD_ACCEPT}，单文件上限 ${UPLOAD_MAX_MB}MB`;
  }
}

function renderAttachmentList() {
  if (!attachmentList) return;
  attachmentList.innerHTML = "";

  if (!UPLOAD_API_BASE) {
    const empty = document.createElement("div");
    empty.className = "attachment-empty";
    empty.textContent = "未配置上传服务地址，请在 config.js 中设置 UPLOAD_API_BASE。";
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
  if (!UPLOAD_API_BASE) {
    attachmentLoading = false;
    renderAttachmentList();
    return;
  }
  attachmentLoading = true;
  renderAttachmentList();
  try {
    const data = await apiFetchJson(`/api/files/list?orderId=${encodeURIComponent(orderId)}`, { method: "GET" });
    attachmentItems = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    setAttachmentStateFromItems(orderId, attachmentItems);
  } catch (e) {
    const detail = e?.message || "未知错误";
    alert(`加载附件失败：${detail}`);
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
  if (!UPLOAD_API_BASE) {
    alert("未配置上传服务地址，请先设置 config.js 的 UPLOAD_API_BASE。");
    return;
  }
  const maxBytes = UPLOAD_MAX_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    alert(`文件过大，当前限制 ${UPLOAD_MAX_MB}MB。`);
    return;
  }
  const ext = `.${(file.name.split(".").pop() || "").toLowerCase()}`;
  const allowList = UPLOAD_ACCEPT.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (allowList.length > 0 && !allowList.includes(ext)) {
    alert(`文件类型不支持：${ext || "未知"}。`);
    return;
  }

  try {
    const form = new FormData();
    const order = orders.find((x) => x.id === attachmentPanelOrderId);
    form.append("orderId", attachmentPanelOrderId);
    form.append("lineId", attachmentPanelOrderId);
    form.append("orderNo", order?.orderNo || "");
    form.append("drawingNo", order?.drawingNo || "");
    form.append("partName", order?.name || "");
    form.append("file", file);
    await apiFetchJson("/api/files/upload", { method: "POST", body: form });
    setAttachmentState(attachmentPanelOrderId, true);
    await loadOrderFiles(attachmentPanelOrderId);
    render();
  } catch (e) {
    const detail = e?.message || "未知错误";
    alert(`上传失败：${detail}`);
  }
}

async function deleteOrderFile(item) {
  const id = item?.id;
  if (!id) return;
  if (!confirm(`确认删除附件“${getAttachmentName(item)}”吗？`)) return;
  try {
    await apiFetchJson(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    attachmentItems = attachmentItems.filter((x) => x.id !== id);
    setAttachmentStateFromItems(attachmentPanelOrderId, attachmentItems);
    renderAttachmentList();
    render();
  } catch (e) {
    const detail = e?.message || "未知错误";
    alert(`删除失败：${detail}`);
  }
}

async function downloadOrderFile(item) {
  const id = item?.id;
  if (!id) return;
  try {
    const blob = await apiFetchBlob(`/api/files/download/${encodeURIComponent(id)}`);
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
    alert(`下载失败：${detail}`);
  }
}

async function previewOrderFile(item, orderOverride = null) {
  const id = item?.id;
  if (!id || !previewDialog || !previewBody) return;
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
    const blob = await apiFetchBlob(`/api/files/download/${encodeURIComponent(id)}`);
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
    previewBody.innerHTML = `<div class="preview-empty">预览失败：${detail}</div>`;
  }
}

function getAttachmentName(item) {
  return item?.file_name || item?.name || item?.filename || "未命名附件";
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
  if (!UPLOAD_API_BASE) return;
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
    const data = await apiFetchJson(`/api/files/list?orderId=${encodeURIComponent(orderId)}`, { method: "GET" });
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
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
    alert("Excel组件加载失败，请刷新页面后重试");
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
    alert("Excel组件加载失败，请刷新页面后重试");
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

      const imported = rows.map((row, idx) => {
        const next = createEmptyOrder();
        Object.keys(row).forEach((title) => {
          const key = titleToKey[title];
          if (!key) return;
          let value = row[title];
          if (key === "startTime" || key === "dueDate") value = normalizeImportedDate(value);
          if (key === "qty" || key === "plannedHours") value = normalizeImportedNumber(value);
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
      const untouched = Math.max(0, previousCount - updateCount);
      const confirmed = confirm(
        `导入预览：\n新增 ${insertCount} 条\n覆盖 ${updateCount} 条\n保留历史 ${untouched} 条\n\n确认继续导入吗？`
      );
      if (!confirmed) return;
      orders = merged;
      await persistOrders({ changed: imported });
      render();
      alert("导入成功：已覆盖同键订单并新增新订单，未删除未包含在Excel中的历史订单。");
    } catch (e) {
      console.error(e);
      const msg = (e && e.message) ? e.message : "";
      if (msg.includes("item_name")) {
        alert("导入失败：云端表缺少 item_name 字段，请在 Supabase 执行最新 supabase_schema.sql 后重试。");
      } else {
        alert("导入失败：请使用系统导出的 Excel 或包含标准列名的 Excel");
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
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  return null;
}

function toDbDueDate(v) {
  const s = normalizeImportedDate(v);
  return s || null;
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

  clean = clean.replace(/\s*\[STEP:([^\]]*)\]\s*/g, (_all, v) => {
    processStepCurrent = normalizeStepValue(v || "");
    return " ";
  });
  clean = clean.replace(/\s*\[PROC:([^\]]*)\]\s*/g, (_all, v) => {
    processName = String(v || "").trim();
    return " ";
  });
  clean = clean.replace(/\s+/g, " ").trim();

  return {
    note: clean,
    processName,
    processStepCurrent,
  };
}

function mergeOrderMetaIntoNote(noteValue, { processName = "", processStepCurrent = "" } = {}) {
  const base = splitNoteAndMeta(noteValue).note;
  const process = String(processName || "").trim();
  const step = normalizeStepValue(processStepCurrent);
  const tail = [];
  if (step) tail.push(`[STEP:${step}]`);
  if (process) tail.push(`[PROC:${process}]`);
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
  ensureTableColGroup();
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
  applyColumnWidths();
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








