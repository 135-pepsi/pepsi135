const STORAGE_KEY = "mini_mes_materials_v1";
const COL_WIDTH_KEY = "mini_mes_materials_col_widths_v1";
const ORDER_STORAGE_KEY = "mini_mes_orders_v1";
const ORDER_SYNC_ENABLED = false;

const READY_OPTIONS = ["是", "否"];
const MES_CONFIG = window.MES_CONFIG || {};
const REMOTE_ENABLED = Boolean(MES_CONFIG.SUPABASE_URL && MES_CONFIG.SUPABASE_ANON_KEY && window.supabase);
const AUTO_REFRESH_MS = Math.max(5000, Number(MES_CONFIG.AUTO_REFRESH_SECONDS || 15) * 1000);
const db = REMOTE_ENABLED ? window.supabase.createClient(MES_CONFIG.SUPABASE_URL, MES_CONFIG.SUPABASE_ANON_KEY) : null;

let materials = [];
let filterText = "";
let syncing = false;
let remoteOnline = REMOTE_ENABLED;
let remoteErrorNotified = false;
let reconnectTimer = null;
let reconnectDelayMs = 5000;
let authSession = null;
let authWriteHintNotified = false;
let authLoginSubmitting = false;
let authLoginCooldownUntil = 0;
let authLoginCooldownTimer = 0;
let stickyOffsetRaf = 0;
let pageUnloading = false;
let orderCustomerMap = new Map();
let serialOrderNoMap = new Map();
let columnWidths = loadColumnWidths();

const tableBody = document.getElementById("tableBody");
const systemMode = document.getElementById("systemMode");
const tableWrap = document.getElementById("tableWrap");
const backTopBtn = document.getElementById("backTopBtn");
const reconnectBtn = document.getElementById("reconnectBtn");
const authUser = document.getElementById("authUser");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authLoginDialog = document.getElementById("authLoginDialog");
const authLoginEmailInput = document.getElementById("authLoginEmailInput");
const authLoginCloseBtn = document.getElementById("authLoginCloseBtn");
const authLoginCancelBtn = document.getElementById("authLoginCancelBtn");
const authLoginSubmitBtn = document.getElementById("authLoginSubmitBtn");
const lastSyncTime = document.getElementById("lastSyncTime");
const materialFilters = document.getElementById("materialFilters");
const materialFilterToggleBtn = document.getElementById("materialFilterToggleBtn");
const materialToolbar = document.querySelector(".material-page .toolbar");

init();

async function init() {
  bindEvents();
  setupColumnResizers();
  updateLayoutMetrics();
  if (REMOTE_ENABLED) {
    await initAuth();
    setModeText(authSession ? "云端共享模式" : "云端只读（未登录）");
    await refreshFromRemote();
    setInterval(async () => {
      if (!syncing && remoteOnline) {
        await refreshFromRemote(false);
      }
    }, AUTO_REFRESH_MS);
  } else {
    setModeText("本地模式");
    materials = loadLocal();
    render();
    syncQuickCustomer();
    setLastSyncTime();
  }
}

function setModeText(text) {
  if (systemMode) systemMode.textContent = text;
  if (lastSyncTime && text.includes("失败")) lastSyncTime.classList.add("sync-warning");
  if (lastSyncTime && !text.includes("失败")) lastSyncTime.classList.remove("sync-warning");
  syncReconnectButton();
}

function setLastSyncTime() {
  if (!lastSyncTime) return;
  const now = new Date();
  const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  lastSyncTime.textContent = `最近同步 ${t}`;
}

function bindEvents() {
  const quickAddBtn = document.getElementById("quickAddBtn");
  if (quickAddBtn) quickAddBtn.addEventListener("click", quickAdd);
  const addRowInlineBtn = document.getElementById("addRowInlineBtn");
  if (addRowInlineBtn) addRowInlineBtn.addEventListener("click", addBlankRow);
  const dedupeOrderBtn = document.getElementById("dedupeOrderBtn");
  if (dedupeOrderBtn) {
    dedupeOrderBtn.addEventListener("click", () => {
      void removeDuplicateOrderRows(true);
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
  if (authLoginCloseBtn) {
    authLoginCloseBtn.addEventListener("click", closeAuthLoginDialog);
  }
  if (authLoginCancelBtn) {
    authLoginCancelBtn.addEventListener("click", closeAuthLoginDialog);
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
        void submitEmailLoginFromDialog();
      }
    });
  }
  if (authLoginDialog) {
    authLoginDialog.addEventListener("click", (event) => {
      if (event.target === authLoginDialog) closeAuthLoginDialog();
    });
  }
  document.getElementById("qaOrderNo").addEventListener("input", syncQuickCustomer);
  document.getElementById("searchInput").addEventListener("input", (e) => {
    filterText = String(e.target.value || "").trim().toLowerCase();
    render();
  });
  if (materialFilterToggleBtn && materialFilters) {
    materialFilterToggleBtn.addEventListener("click", () => {
      const collapsed = materialFilters.classList.toggle("collapsed");
      materialFilterToggleBtn.textContent = collapsed ? "展开搜索" : "收起搜索";
      materialFilterToggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      updateLayoutMetrics();
    });
  }

  backTopBtn.addEventListener("click", () => {
    if (tableWrap) tableWrap.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  window.addEventListener("scroll", updateBackTopBtn);
  tableWrap.addEventListener("scroll", updateBackTopBtn);
  window.addEventListener("resize", () => {
    queueStickyColumnOffsets();
    syncFilterPanelForViewport();
    updateLayoutMetrics();
  });
  window.addEventListener("storage", (e) => {
    if (!ORDER_SYNC_ENABLED) return;
    if (e.key !== ORDER_STORAGE_KEY) return;
    loadOrderCustomerMapFromLocal();
    void syncInheritedOrderRows().then(() => {
      render();
      syncQuickCustomer();
    });
  });
  window.addEventListener("beforeunload", () => {
    pageUnloading = true;
  });
  updateBackTopBtn();
  updateAuthUi();
  syncReconnectButton();
  syncFilterPanelForViewport();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && authLoginDialog && !authLoginDialog.hidden) {
      e.preventDefault();
      closeAuthLoginDialog();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      void addBlankRow();
    }
  });
}

function syncFilterPanelForViewport() {
  if (!materialFilters || !materialFilterToggleBtn) return;
  if (window.innerWidth > 780) {
    materialFilters.classList.remove("collapsed");
    materialFilterToggleBtn.textContent = "收起搜索";
    materialFilterToggleBtn.setAttribute("aria-expanded", "true");
  }
  updateLayoutMetrics();
}

function updateLayoutMetrics() {
  const root = document.documentElement;
  const topbar = document.querySelector(".topbar");
  const topbarH = topbar ? Math.round(topbar.getBoundingClientRect().height) : 72;
  const toolbarH = materialToolbar ? Math.round(materialToolbar.getBoundingClientRect().height) : 92;
  root.style.setProperty("--topbar-h", `${topbarH}px`);
  root.style.setProperty("--material-toolbar-h", `${toolbarH}px`);
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
  openAuthLoginDialog();
}

function openAuthLoginDialog() {
  if (!REMOTE_ENABLED || !db?.auth || !authLoginDialog) return;
  if (authLoginEmailInput) authLoginEmailInput.value = "";
  authLoginDialog.hidden = false;
  refreshAuthLoginSubmitUi();
  document.body.style.overflow = "hidden";
  if (authLoginEmailInput) authLoginEmailInput.focus();
}

function closeAuthLoginDialog() {
  if (!authLoginDialog) return;
  authLoginDialog.hidden = true;
  setAuthLoginSubmitting(false);
  document.body.style.overflow = "";
}

function setAuthLoginSubmitting(submitting) {
  authLoginSubmitting = Boolean(submitting);
  refreshAuthLoginSubmitUi();
}

function getAuthLoginCooldownSeconds() {
  return Math.max(0, Math.ceil((authLoginCooldownUntil - Date.now()) / 1000));
}

function refreshAuthLoginSubmitUi() {
  if (!authLoginSubmitBtn) return;
  const remain = getAuthLoginCooldownSeconds();
  const locked = authLoginSubmitting || remain > 0;
  authLoginSubmitBtn.disabled = locked;
  if (authLoginSubmitting) {
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
    alert(`请求过于频繁，请 ${cooldown} 秒后重试。`);
    return;
  }
  const email = String(authLoginEmailInput?.value || "").trim().toLowerCase();
  if (!email) {
    alert("请输入登录邮箱。");
    return;
  }
  setAuthLoginSubmitting(true);
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
    alert("登录邮件已发送，请在邮箱中点击登录链接后返回本页。");
  } catch (e) {
    if (isRateLimitError(e)) {
      const retry = getRetryAfterSeconds(e, 120);
      startAuthLoginCooldown(retry);
      alert(`发送过于频繁，请 ${retry} 秒后再试。`);
      setAuthLoginSubmitting(false);
      return;
    }
    const detail = e?.message || e?.error_description || "未知错误";
    alert(`发送登录邮件失败：${detail}`);
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
    alert(`退出失败：${detail}`);
  }
}

function updateAuthUi() {
  if (authUser) {
    authUser.textContent = authSession?.user?.email || "未登录";
  }
  if (loginBtn) loginBtn.style.display = authSession ? "none" : "inline-flex";
  if (logoutBtn) logoutBtn.style.display = authSession ? "inline-flex" : "none";
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

function createEmptyMaterial() {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    orderNo: "",
    customer: "",
    material: "",
    spec: "",
    quantity: "",
    amount: "",
    isReady: "",
  };
}

function valueOf(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || "").trim() : "";
}

function clearQuickAdd() {
  syncQuickCustomer();
}

async function quickAdd() {
  const orderNoInput = valueOf("qaOrderNo");
  if (!orderNoInput) {
    alert("请先输入编号");
    return;
  }
  const orderNo = normalizeOrderNoInput(orderNoInput);
  if (!orderNo) {
    alert("订单号格式无效，请输入 1-3 位数字或完整单号（ZZYYMMNNN）");
    return;
  }
  const customer = resolveCustomerByOrderNo(orderNo, "");
  const next = {
    ...createEmptyMaterial(),
    orderNo,
    customer,
  };

  materials.push(next);
  await persist({ changed: [next] });
  clearQuickAdd();
  render();
}

async function addBlankRow() {
  const next = createEmptyMaterial();
  materials.push(next);
  await persist({ changed: [next] });
  render();
  const rows = tableBody.querySelectorAll("tr");
  const lastRow = rows[rows.length - 1];
  const firstEditable = lastRow ? lastRow.querySelector("td[data-key='material']") : null;
  if (firstEditable) beginEdit(firstEditable);
}

function getFilteredRows() {
  return materials.filter((m) => {
    if (!filterText) return true;
    return [m.orderNo, m.customer, m.material, m.spec, m.quantity].some((x) =>
      String(x || "").toLowerCase().includes(filterText)
    );
  });
}

function render() {
  ensureTableColGroup();
  const rows = getFilteredRows();
  tableBody.innerHTML = "";

  rows.forEach((m) => {
    const tr = document.createElement("tr");
    tr.dataset.id = m.id;
    tr.appendChild(editCell(m, "orderNo"));
    tr.appendChild(textCell(m.customer || ""));
    tr.appendChild(editCell(m, "material"));
    tr.appendChild(editCell(m, "spec"));
    tr.appendChild(editCell(m, "quantity"));
    tr.appendChild(editCell(m, "amount"));
    tr.appendChild(selectCell(m, "isReady", READY_OPTIONS));

    const opTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "action-btn";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      void removeItem(m.id);
    });
    opTd.appendChild(delBtn);
    tr.appendChild(opTd);
    tableBody.appendChild(tr);
  });

  applyColumnWidths();
  queueStickyColumnOffsets();
}

function textCell(value) {
  const td = document.createElement("td");
  td.textContent = value ?? "";
  return td;
}

function editCell(item, key, type = "text") {
  const td = document.createElement("td");
  td.dataset.key = key;
  td.dataset.id = item.id;
  const raw = String(item[key] ?? "");
  td.dataset.raw = raw;
  td.textContent = formatDisplayValue(key, raw);
  td.addEventListener("dblclick", () => beginEdit(td, type));
  return td;
}

function beginEdit(td, type = "text") {
  if (td.classList.contains("editing")) return;
  const oldValue = td.dataset.raw ?? td.textContent;
  const oldDisplay = td.textContent;
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

  const save = async () => {
    td.classList.remove("editing");
    await updateItem(td.dataset.id, key, input.value);
  };

  input.addEventListener("blur", () => {
    void save();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save().then(() => jumpToNextRowSameColumn(td));
    }
    if (e.key === "Escape") {
      td.classList.remove("editing");
      td.textContent = oldDisplay;
    }
  });
}

function formatDisplayValue(key, rawValue) {
  if (key !== "amount") return String(rawValue ?? "");
  const raw = String(rawValue ?? "").trim();
  if (raw === "") return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function jumpToNextRowSameColumn(currentTd) {
  const row = currentTd.parentElement;
  const nextRow = row ? row.nextElementSibling : null;
  if (!nextRow) return;
  const colIndex = [...row.children].indexOf(currentTd);
  const nextTd = nextRow.children[colIndex];
  if (nextTd && nextTd.dataset.key) beginEdit(nextTd);
}

function selectCell(item, key, options) {
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
    if (item[key] === opt) o.selected = true;
    sel.appendChild(o);
  });

  sel.addEventListener("change", () => {
    void updateItem(item.id, key, sel.value);
  });
  td.appendChild(sel);
  return td;
}

async function updateItem(id, key, value) {
  const target = materials.find((x) => x.id === id);
  if (!target) return;
  const normalized = normalizeValue(key, value);

  if (key === "orderNo") {
    if ((value || "").trim() !== "" && !normalized) {
      alert("订单号格式无效，请输入 1-3 位数字或完整单号（ZZYYMMNNN）");
      render();
      return;
    }
    target.orderNo = normalized;
    target.customer = resolveCustomerByOrderNo(target.orderNo, "");
  } else {
    target[key] = normalized;
  }

  await persist({ changed: [target] });
  render();
  syncQuickCustomer();
}

function normalizeValue(key, value) {
  const raw = String(value ?? "").trim();
  if (key === "orderNo") return normalizeOrderNoInput(raw);
  if (key === "amount") {
    if (raw === "") return "";
    const n = Number(raw);
    return Number.isFinite(n) ? n : "";
  }
  if (key === "quantity") {
    if (raw === "") return "";
    const n = Number(raw);
    return Number.isFinite(n) ? n : "";
  }
  if (key === "isReady") {
    return READY_OPTIONS.includes(raw) ? raw : "";
  }
  return raw;
}

function normalizeOrderNoInput(value) {
  const raw = (value || "").trim().toUpperCase();
  if (!raw) return "";
  if (/^ZZ\d{7}$/.test(raw)) return raw;
  if (!/^\d{1,3}$/.test(raw)) return "";
  const serial = raw.padStart(3, "0");
  const matchedOrderNo = serialOrderNoMap.get(serial);
  if (matchedOrderNo) return matchedOrderNo;
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `ZZ${yy}${mm}${serial}`;
}

function resolveCustomerByOrderNo(orderNo, fallbackCustomer = "") {
  const key = String(orderNo || "").trim().toUpperCase();
  if (!key) return String(fallbackCustomer || "").trim();
  return orderCustomerMap.get(key) || String(fallbackCustomer || "").trim();
}

function getLastOrderContext() {
  for (let i = materials.length - 1; i >= 0; i -= 1) {
    const orderNo = String(materials[i]?.orderNo || "").trim();
    if (!orderNo) continue;
    const customer = resolveCustomerByOrderNo(orderNo, materials[i]?.customer || "");
    return { orderNo, customer };
  }
  const orderRaw = valueOf("qaOrderNo");
  const orderNo = normalizeOrderNoInput(orderRaw);
  return { orderNo, customer: resolveCustomerByOrderNo(orderNo, "") };
}

function syncQuickCustomer() {
  const currentOrderNo = normalizeOrderNoInput(valueOf("qaOrderNo"));
  const context = getLastOrderContext();
  const orderNo = currentOrderNo || context.orderNo;
  const customer = resolveCustomerByOrderNo(orderNo, context.customer);
  const input = document.getElementById("qaCustomer");
  if (input) input.value = customer || "";
}

async function removeItem(id) {
  const confirmed = confirm("确认删除该物料行吗？");
  if (!confirmed) return;

  materials = materials.filter((x) => x.id !== id);
  await persist({ deletedId: id });
  render();
  syncQuickCustomer();
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(materials));
}

function loadLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map((x, idx) => ({
      ...createEmptyMaterial(),
      ...x,
      createdAt: x.createdAt || new Date(Date.now() + idx).toISOString(),
    }));
  } catch (e) {
    console.warn("读取本地物料缓存失败", e);
    return [];
  }
}

async function persist({ changed = [], deletedId = null, deletedIds = [], notifyAuth = true } = {}) {
  saveLocal();
  setLastSyncTime();
  if (!REMOTE_ENABLED || !remoteOnline) return;
  if (!canWriteRemote(notifyAuth)) return;
  syncing = true;
  try {
    if (changed.length > 0) {
      const baseMs = Date.now();
      const payload = changed.map((item, idx) => toDbRow(item, new Date(baseMs + idx).toISOString()));
      const { error } = await db.from("mes_materials").upsert(payload, { onConflict: "id" });
      if (error) throw error;
    }
    const idsToDelete = [];
    if (deletedId) idsToDelete.push(deletedId);
    if (Array.isArray(deletedIds) && deletedIds.length > 0) idsToDelete.push(...deletedIds);
    const uniqDeleteIds = Array.from(new Set(idsToDelete.filter(Boolean)));
    if (uniqDeleteIds.length > 0) {
      for (const id of uniqDeleteIds) {
        const { error } = await db.from("mes_materials").delete().eq("id", id);
        if (error) throw error;
      }
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
    handleRemoteError("物料云端同步失败", e);
  } finally {
    syncing = false;
  }
}

async function refreshFromRemote(showAlert = false) {
  if (!remoteOnline) return;
  try {
    const { data, error } = await db.from("mes_materials").select("*").order("updated_at", { ascending: true });
    if (error) throw error;
    materials = (data || [])
      .map(fromDbRow)
      .map((x) => ({ ...x, customer: resolveCustomerByOrderNo(x.orderNo, x.customer) }))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));

    await syncInheritedOrderRows();

    if (materials.length === 0) {
      materials = loadLocal();
      if (materials.length > 0) await persist({ changed: materials });
    }

    saveLocal();
    render();
    syncQuickCustomer();
    setLastSyncTime();
    reconnectDelayMs = 5000;
    remoteErrorNotified = false;
    if (showAlert) alert("已从云端刷新最新物料数据");
  } catch (e) {
    if (pageUnloading || isAbortLikeError(e)) return;
    if (isAuthError(e) && !authSession) {
      remoteOnline = true;
      remoteErrorNotified = false;
      setModeText("云端只读（未登录）");
      materials = loadLocal();
      render();
      syncQuickCustomer();
      setLastSyncTime();
      return;
    }
    handleRemoteError("物料云端读取失败", e);
    materials = loadLocal();
    render();
    syncQuickCustomer();
  }
}

async function refreshOrderCustomerMap() {
  if (!ORDER_SYNC_ENABLED) return;
  if (!REMOTE_ENABLED || !remoteOnline) {
    loadOrderCustomerMapFromLocal();
    await syncInheritedOrderRows();
    syncQuickCustomer();
    return;
  }
  try {
    const { data, error } = await db
      .from("mes_orders")
      .select("order_no,customer,updated_at")
      .neq("order_no", "")
      .order("updated_at", { ascending: true });
    if (error) throw error;

    const map = new Map();
    const serialCandidates = new Map();
    (data || []).forEach((row) => {
      const orderNo = String(row.order_no || "").trim().toUpperCase();
      const customer = String(row.customer || "").trim();
      if (!orderNo) return;
      map.set(orderNo, customer);
      const serial = orderNo.slice(-3);
      if (/^\d{3}$/.test(serial)) {
        const set = serialCandidates.get(serial) || new Set();
        set.add(orderNo);
        serialCandidates.set(serial, set);
      }
    });
    const serialMap = new Map();
    serialCandidates.forEach((set, serial) => {
      if (set.size !== 1) return;
      serialMap.set(serial, Array.from(set)[0]);
    });
    orderCustomerMap = map;
    serialOrderNoMap = serialMap;
    await syncInheritedOrderRows();
    syncQuickCustomer();
  } catch (e) {
    console.warn("读取订单-客户映射失败，改用本地订单缓存", e);
    loadOrderCustomerMapFromLocal();
    await syncInheritedOrderRows();
    syncQuickCustomer();
  }
}

function loadOrderCustomerMapFromLocal() {
  const raw = localStorage.getItem(ORDER_STORAGE_KEY);
  if (!raw) return;
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return;

    const map = new Map();
    const serialCandidates = new Map();
    rows.forEach((row) => {
      const orderNo = String(row?.orderNo || row?.order_no || "").trim().toUpperCase();
      const customer = String(row?.customer || "").trim();
      if (!orderNo) return;
      map.set(orderNo, customer);
      const serial = orderNo.slice(-3);
      if (/^\d{3}$/.test(serial)) {
        const set = serialCandidates.get(serial) || new Set();
        set.add(orderNo);
        serialCandidates.set(serial, set);
      }
    });

    const serialMap = new Map();
    serialCandidates.forEach((set, serial) => {
      if (set.size !== 1) return;
      serialMap.set(serial, Array.from(set)[0]);
    });

    orderCustomerMap = map;
    serialOrderNoMap = serialMap;
  } catch (e) {
    console.warn("读取本地订单缓存失败", e);
  }
}

async function syncInheritedOrderRows() {
  if (!ORDER_SYNC_ENABLED) return;
  if (!Array.isArray(materials)) return;

  const changedById = new Map();
  const byOrderNo = new Map();
  const deletedIdSet = new Set();

  const markChanged = (item) => {
    if (!item?.id) return;
    changedById.set(item.id, item);
  };

  materials.forEach((item) => {
    const key = String(item.orderNo || "").trim().toUpperCase();
    if (item.orderNo !== key) {
      item.orderNo = key;
      markChanged(item);
    }
    if (!key) return;
    const list = byOrderNo.get(key) || [];
    list.push(item);
    byOrderNo.set(key, list);

    const inheritedCustomer = orderCustomerMap.get(key);
    if (!inheritedCustomer) return;
    if (String(item.customer || "").trim() === inheritedCustomer) return;
    item.customer = inheritedCustomer;
    markChanged(item);
  });

  byOrderNo.forEach((rows) => {
    const placeholders = rows.filter(isPlaceholderRow);
    const realRows = rows.filter((row) => !isPlaceholderRow(row));

    if (realRows.length > 0 && placeholders.length > 0) {
      placeholders.forEach((row) => deletedIdSet.add(row.id));
      return;
    }

    if (placeholders.length > 1) {
      const sorted = placeholders
        .slice()
        .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
      sorted.slice(1).forEach((row) => deletedIdSet.add(row.id));
    }
  });

  if (deletedIdSet.size > 0) {
    materials = materials.filter((item) => !deletedIdSet.has(item.id));
  }

  const existingOrderNos = new Set(
    materials
      .map((item) => String(item.orderNo || "").trim().toUpperCase())
      .filter(Boolean)
  );

  orderCustomerMap.forEach((customer, orderNo) => {
    const key = String(orderNo || "").trim().toUpperCase();
    if (!key || existingOrderNos.has(key)) return;
    const next = {
      ...createEmptyMaterial(),
      orderNo: key,
      customer: customer || "",
    };
    materials.push(next);
    existingOrderNos.add(key);
    markChanged(next);
  });

  const changed = Array.from(changedById.values()).filter((item) => !deletedIdSet.has(item.id));
  const deletedIds = Array.from(deletedIdSet).filter(Boolean);
  if (changed.length > 0 || deletedIds.length > 0) {
    await persist({ changed, deletedIds, notifyAuth: false });
  }
}

function isPlaceholderRow(item) {
  if (!item) return false;
  const material = String(item.material || "").trim();
  const spec = String(item.spec || "").trim();
  const isReady = String(item.isReady || "").trim();
  const quantity = item.quantity == null ? "" : String(item.quantity).trim();
  const amount = item.amount == null ? "" : String(item.amount).trim();
  return material === "" && spec === "" && isReady === "" && quantity === "" && amount === "";
}

function materialRowSignature(item) {
  const orderNo = String(item?.orderNo || "").trim().toUpperCase();
  const customer = String(item?.customer || "").trim();
  const material = String(item?.material || "").trim();
  const spec = String(item?.spec || "").trim();
  const quantity = item?.quantity == null ? "" : String(item.quantity).trim();
  const amount = item?.amount == null ? "" : String(item.amount).trim();
  const isReady = String(item?.isReady || "").trim();
  return `${orderNo}|${customer}|${material}|${spec}|${quantity}|${amount}|${isReady}`;
}

async function removeDuplicateOrderRows(notify = false) {
  if (!Array.isArray(materials) || materials.length === 0) {
    if (notify) alert("当前没有可清理的数据。");
    return;
  }

  const sorted = materials
    .slice()
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const seen = new Set();
  const deletedIds = [];

  sorted.forEach((item) => {
    const sig = materialRowSignature(item);
    if (!sig || sig === "||||||") return;
    if (!seen.has(sig)) {
      seen.add(sig);
      return;
    }
    deletedIds.push(item.id);
  });

  if (deletedIds.length === 0) {
    if (notify) alert("没有发现重复订单行。");
    return;
  }

  const deletedIdSet = new Set(deletedIds);
  materials = materials.filter((item) => !deletedIdSet.has(item.id));
  await persist({ deletedIds });
  render();
  syncQuickCustomer();
  if (notify) alert(`已删除 ${deletedIds.length} 行重复订单记录。`);
}

function handleRemoteError(prefix, err) {
  if (pageUnloading || isAbortLikeError(err)) return;
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

function isAbortLikeError(err) {
  const code = String(err?.name || err?.code || "").toUpperCase();
  const msg = String(err?.message || err?.error_description || "").toUpperCase();
  return code.includes("ABORT") || code.includes("CANCEL") || msg.includes("ABORT") || msg.includes("CANCEL");
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
    const { error } = await db.from("mes_materials").select("id").limit(1);
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

function toDbRow(item, updatedAtOverride = "") {
  return {
    id: item.id,
    order_no: item.orderNo || "",
    customer: item.customer || "",
    material: item.material || "",
    spec: item.spec || "",
    quantity: toFiniteOrNull(item.quantity),
    amount: toFiniteOrNull(item.amount),
    is_ready: item.isReady || "",
    created_at: item.createdAt || updatedAtOverride || new Date().toISOString(),
    updated_at: updatedAtOverride || new Date().toISOString(),
  };
}

function fromDbRow(row) {
  return {
    id: row.id || crypto.randomUUID(),
    createdAt: row.created_at || row.updated_at || new Date().toISOString(),
    orderNo: row.order_no || "",
    customer: row.customer || "",
    material: row.material || "",
    spec: row.spec || "",
    quantity: row.quantity ?? "",
    amount: row.amount ?? "",
    isReady: row.is_ready || "",
  };
}

function toFiniteOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function setupColumnResizers() {
  ensureTableColGroup();
  const headers = document.querySelectorAll("#orderTable thead th");
  headers.forEach((th, index) => {
    if (th.querySelector(".col-resizer")) return;
    const handle = document.createElement("span");
    handle.className = "col-resizer";
    handle.addEventListener("mousedown", (e) => startResize(e, index + 1));
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
  const col = document.querySelector(`#orderTable colgroup col:nth-child(${colIndex})`);
  if (col) col.style.width = `${px}px`;

  const cells = document.querySelectorAll(`#orderTable tr > *:nth-child(${colIndex})`);
  cells.forEach((cell) => {
    cell.style.width = `${px}px`;
    cell.style.minWidth = `${px}px`;
    cell.style.maxWidth = `${px}px`;
  });
}

function applyColumnWidths() {
  Object.keys(columnWidths).forEach((k) => {
    const col = Number(k);
    const px = Number(columnWidths[k]);
    if (Number.isFinite(col) && Number.isFinite(px)) setColumnWidth(col, px);
  });
  queueStickyColumnOffsets();
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
  localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(columnWidths));
}

function loadColumnWidths() {
  try {
    const raw = localStorage.getItem(COL_WIDTH_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
