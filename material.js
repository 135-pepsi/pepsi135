const STORAGE_KEY = "mini_mes_materials_v1";
const COL_WIDTH_KEY = "mini_mes_materials_col_widths_v1";

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
let orderCustomerMap = new Map();
let serialOrderNoMap = new Map();
let columnWidths = loadColumnWidths();

const tableBody = document.getElementById("tableBody");
const systemMode = document.getElementById("systemMode");
const tableWrap = document.getElementById("tableWrap");
const backTopBtn = document.getElementById("backTopBtn");

init();

async function init() {
  bindEvents();
  setupColumnResizers();
  if (REMOTE_ENABLED) {
    setModeText("云端共享模式");
    await refreshOrderCustomerMap();
    await refreshFromRemote();
    setInterval(async () => {
      if (!syncing && remoteOnline) {
        await refreshOrderCustomerMap();
        await refreshFromRemote(false);
      }
    }, AUTO_REFRESH_MS);
  } else {
    setModeText("本地模式");
    materials = loadLocal();
    render();
    syncQuickCustomer();
  }
}

function setModeText(text) {
  if (systemMode) systemMode.textContent = text;
}

function bindEvents() {
  const quickAddBtn = document.getElementById("quickAddBtn");
  if (quickAddBtn) quickAddBtn.addEventListener("click", quickAdd);
  document.getElementById("addRowBtn").addEventListener("click", addBlankRow);
  const addRowInlineBtn = document.getElementById("addRowInlineBtn");
  if (addRowInlineBtn) addRowInlineBtn.addEventListener("click", addBlankRow);
  document.getElementById("qaOrderNo").addEventListener("input", syncQuickCustomer);
  document.getElementById("searchInput").addEventListener("input", (e) => {
    filterText = String(e.target.value || "").trim().toLowerCase();
    render();
  });

  backTopBtn.addEventListener("click", () => {
    if (tableWrap) tableWrap.scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  window.addEventListener("scroll", updateBackTopBtn);
  tableWrap.addEventListener("scroll", updateBackTopBtn);
  updateBackTopBtn();

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      void addBlankRow();
    }
  });
}

function updateBackTopBtn() {
  const pageY = window.scrollY || 0;
  const tableY = tableWrap ? tableWrap.scrollTop : 0;
  const show = pageY > 120 || tableY > 120;
  backTopBtn.style.display = show ? "inline-flex" : "none";
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
  const orderNo = normalizeOrderNoInput(orderNoInput);
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
    target.customer = resolveCustomerByOrderNo(target.orderNo, target.customer);
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

async function persist({ changed = [], deletedId = null } = {}) {
  saveLocal();
  if (!REMOTE_ENABLED || !remoteOnline) return;
  syncing = true;
  try {
    if (changed.length > 0) {
      const baseMs = Date.now();
      const payload = changed.map((item, idx) => toDbRow(item, new Date(baseMs + idx).toISOString()));
      const { error } = await db.from("mes_materials").upsert(payload, { onConflict: "id" });
      if (error) throw error;
    }
    if (deletedId) {
      const { error } = await db.from("mes_materials").delete().eq("id", deletedId);
      if (error) throw error;
    }
  } catch (e) {
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

    if (materials.length === 0) {
      materials = loadLocal();
      if (materials.length > 0) await persist({ changed: materials });
    }

    saveLocal();
    render();
    syncQuickCustomer();
    if (showAlert) alert("已从云端刷新最新物料数据");
  } catch (e) {
    handleRemoteError("物料云端读取失败", e);
    materials = loadLocal();
    render();
    syncQuickCustomer();
  }
}

async function refreshOrderCustomerMap() {
  if (!REMOTE_ENABLED || !remoteOnline) return;
  try {
    const { data, error } = await db
      .from("mes_orders")
      .select("order_no,customer,updated_at")
      .neq("order_no", "")
      .order("updated_at", { ascending: true });
    if (error) throw error;

    const map = new Map();
    const serialMap = new Map();
    (data || []).forEach((row) => {
      const orderNo = String(row.order_no || "").trim().toUpperCase();
      const customer = String(row.customer || "").trim();
      if (!orderNo) return;
      if (!customer) return;
      map.set(orderNo, customer);
      const serial = orderNo.slice(-3);
      if (/^\d{3}$/.test(serial)) serialMap.set(serial, orderNo);
    });
    orderCustomerMap = map;
    serialOrderNoMap = serialMap;
    syncQuickCustomer();
  } catch (e) {
    console.warn("读取订单-客户映射失败，继续使用本地客户值", e);
  }
}

function handleRemoteError(prefix, err) {
  console.error(prefix, err);
  remoteOnline = false;
  setModeText("本地模式（云连接失败）");
  if (!remoteErrorNotified) {
    remoteErrorNotified = true;
    const detail = err?.message || err?.error_description || "未知错误";
    alert(`${prefix}：${detail}\n已自动切换本地模式。`);
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
  const headers = document.querySelectorAll("#orderTable thead th");
  headers.forEach((th, index) => {
    if (th.querySelector(".col-resizer")) return;
    const handle = document.createElement("span");
    handle.className = "col-resizer";
    handle.addEventListener("mousedown", (e) => startResize(e, index + 1));
    th.appendChild(handle);
  });
  applyColumnWidths();
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
