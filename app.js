const STORAGE_KEY = "mini_mes_orders_v1";
const COL_WIDTH_KEY = "mini_mes_col_widths_v1";

const STATUS = ["待排产", "已排产", "加工中", "完成待检", "返工", "已发货"];
const MACHINES = ["CNC1", "CNC2", "CNC3", "CNC4", "CNC5"];
const XLSX_COLUMNS = [
  { key: "orderNo", title: "订单号" },
  { key: "customer", title: "客户" },
  { key: "name", title: "名称" },
  { key: "drawingNo", title: "图号" },
  { key: "qty", title: "数量" },
  { key: "programNo", title: "程序单" },
  { key: "plannedHours", title: "预计工时" },
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
const db = REMOTE_ENABLED ? window.supabase.createClient(MES_CONFIG.SUPABASE_URL, MES_CONFIG.SUPABASE_ANON_KEY) : null;

let orders = [];
let filters = { q: "", month: "", machine: "", status: "" };
let syncing = false;
let remoteOnline = REMOTE_ENABLED;
let remoteErrorNotified = false;
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
    await refreshFromRemote();
    setInterval(async () => {
      if (!syncing && remoteOnline) await refreshFromRemote(false);
    }, AUTO_REFRESH_MS);
  } else {
    setModeText("本地模式");
    orders = loadOrdersLocal();
    render();
  }
}

function setModeText(text) {
  if (systemMode) systemMode.textContent = text;
}

function bindEvents() {
  document.getElementById("quickAddBtn").addEventListener("click", quickAdd);
  document.getElementById("addRowBtn").addEventListener("click", addBlankRow);
  document.getElementById("saveBtn").addEventListener("click", exportXlsx);
  document.getElementById("importInput").addEventListener("change", importXlsx);
  backTopBtn.addEventListener("click", scrollToTopRow);

  document.getElementById("searchInput").addEventListener("input", (e) => {
    filters.q = e.target.value.trim().toLowerCase();
    render();
  });
  document.getElementById("filterMonth").addEventListener("change", (e) => {
    filters.month = e.target.value;
    render();
  });
  document.getElementById("filterMachine").addEventListener("change", (e) => {
    filters.machine = e.target.value;
    render();
  });
  document.getElementById("filterStatus").addEventListener("change", (e) => {
    filters.status = e.target.value;
    render();
  });
  window.addEventListener("scroll", updateBackTopBtn);
  tableWrap.addEventListener("scroll", updateBackTopBtn);

  document.addEventListener("keydown", (e) => {
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
  const drawingNo = valueOf("qaDrawingNo");
  const customer = valueOf("qaCustomer");
  const name = valueOf("qaName");
  const qty = valueOf("qaQty");
  const plannedHours = valueOf("qaHours");
  const machine = valueOf("qaMachine");
  const dueDate = valueOf("qaDueDate");

  if (!orderNoInput || !drawingNo) {
    alert("请至少填写编号和图号");
    return;
  }
  if (!orderNo) {
    alert("编号格式无效，请输入1-3位数字（如 30 或 030）");
    return;
  }

  const order = {
    ...createEmptyOrder(),
    orderNo,
    drawingNo,
    customer,
    name,
    qty: normalizeValue("qty", qty),
    plannedHours: normalizeValue("plannedHours", plannedHours),
    machine,
    dueDate,
    status: "待排产",
    programNo: "未出",
    startTime: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
  order.isDelayed = calcDelayed(order);

  orders.push(order);
  await persistOrders({ changed: [order] });
  clearQuickAdd();
  render();
}

async function addBlankRow() {
  const order = createEmptyOrder();
  orders.push(order);
  await persistOrders({ changed: [order] });
  render();
  const rows = tableBody.querySelectorAll("tr");
  const lastRow = rows[rows.length - 1];
  const firstEditable = lastRow ? lastRow.querySelector("td[data-key='orderNo']") : null;
  if (firstEditable) beginEdit(firstEditable);
}

function render() {
  const rows = getFilteredOrders();
  tableBody.innerHTML = "";

  rows.forEach((o, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.id = o.id;

    const stateClass =
      o.isDelayed === "延期" ? "row-delayed" : o.status === "加工中" ? "row-working" : o.status === "已发货" ? "row-shipped" : "";
    if (stateClass) tr.classList.add(stateClass);

    tr.appendChild(textCell(idx + 1));
    tr.appendChild(editCell(o, "orderNo"));
    tr.appendChild(editCell(o, "customer"));
    tr.appendChild(editCell(o, "name"));
    tr.appendChild(editCell(o, "drawingNo"));
    tr.appendChild(editCell(o, "qty"));
    tr.appendChild(selectCell(o, "programNo", ["已出", "未出"]));
    tr.appendChild(editCell(o, "plannedHours"));
    tr.appendChild(selectCell(o, "machine", MACHINES));
    tr.appendChild(selectCell(o, "lathe", ["是", "否"]));
    tr.appendChild(editCell(o, "surface"));
    tr.appendChild(selectCell(o, "status", STATUS));
    tr.appendChild(editCell(o, "startTime"));
    tr.appendChild(editCell(o, "dueDate"));
    tr.appendChild(textCell(o.isDelayed || ""));
    tr.appendChild(editCell(o, "note"));

    const opTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "action-btn";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => {
      void removeOrder(o.id);
    });
    opTd.appendChild(delBtn);
    tr.appendChild(opTd);

    tableBody.appendChild(tr);
  });

  applyColumnWidths();
  renderKpis(orders);
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
  td.textContent = formatDisplayValue(key, rawValue);
  td.addEventListener("dblclick", () => beginEdit(td, type));
  return td;
}

function beginEdit(td, type = "text") {
  if (td.classList.contains("editing")) return;
  const oldValue = td.dataset.raw ?? td.textContent;
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
    await updateOrder(td.dataset.id, key, input.value);
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
      td.textContent = oldValue;
    }
  });
}

function jumpToNextRowSameColumn(currentTd) {
  const row = currentTd.parentElement;
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
  if (!target) return;

  const normalized = normalizeValue(key, value);
  if ((key === "dueDate" || key === "startTime") && (value || "").trim() !== "" && normalized === "") {
    alert(key === "dueDate" ? "交期格式无效，请输入 YYYY-MM-DD 或 M-D（如 2-20）" : "开始时间格式无效，请输入 YYYY-MM-DD HH:mm 或 M-D H:mm");
    render();
    return;
  }

  target[key] = normalized;
  target.isDelayed = calcDelayed(target);

  await persistOrders({ changed: [target] });
  render();
}

function normalizeValue(key, value) {
  if (key === "qty" || key === "plannedHours") {
    if (value === "") return "";
    const num = Number(value);
    return Number.isFinite(num) ? num : "";
  }
  if (key === "dueDate") return normalizeDateOnlyInput(value);
  if (key === "startTime") return normalizeStartTimeInput(value);
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

async function removeOrder(id) {
  orders = orders.filter((o) => o.id !== id);
  await persistOrders({ deletedId: id });
  render();
}

function getFilteredOrders() {
  return orders.filter((o, idx, arr) => {
    const qOk =
      !filters.q ||
      [o.orderNo, o.drawingNo, o.customer, o.name, o.note].some((x) => (x || "").toString().toLowerCase().includes(filters.q));
    const effectiveOrderNo = getEffectiveOrderNoForMonthFilter(arr, idx);
    const monthOk = !filters.month || getMonthFromOrderNo(effectiveOrderNo) === filters.month;
    const mOk = !filters.machine || o.machine === filters.machine;
    const sOk = !filters.status || o.status === filters.status;
    return qOk && monthOk && mOk && sOk;
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
  const planned = sum(data.filter((x) => x.status === "已排产"), "plannedHours");
  const working = sum(data.filter((x) => x.status === "加工中"), "plannedHours");
  const delayed = data.filter((x) => x.isDelayed === "延期").length;
  const total = data.length;
  const done = data.filter((x) => x.status === "已发货").length;
  const completion = total ? (done / total) * 100 : 0;

  document.getElementById("kpiPlannedHours").textContent = planned.toFixed(1);
  document.getElementById("kpiWorkingHours").textContent = working.toFixed(1);
  document.getElementById("kpiDelayedCount").textContent = String(delayed);
  document.getElementById("kpiCompletion").textContent = `${completion.toFixed(1)}%`;
}

function sum(arr, key) {
  return arr.reduce((s, item) => s + (Number(item[key]) || 0), 0);
}

async function persistOrders({ changed = [], deletedId = null } = {}) {
  saveOrdersLocal();
  if (!REMOTE_ENABLED || !remoteOnline) return;

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
    if (showAlert) alert("已从云端刷新最新数据");
  } catch (e) {
    handleRemoteError("云端读取失败", e);
    orders = loadOrdersLocal();
    render();
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

function toDbRow(order, updatedAtOverride = "") {
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
    note: order.note || "",
    created_at: order.createdAt || updatedAtOverride || new Date().toISOString(),
    updated_at: updatedAtOverride || new Date().toISOString(),
  };
}

function fromDbRow(row) {
  const o = createEmptyOrder();
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
  o.note = row.note || "";
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
  ["qaOrderNo", "qaDrawingNo", "qaCustomer", "qaName", "qaQty", "qaHours", "qaMachine", "qaDueDate"].forEach((id) => {
    document.getElementById(id).value = "";
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

      orders = rows.map((row, idx) => {
        const next = createEmptyOrder();
        Object.keys(row).forEach((title) => {
          const key = titleToKey[title];
          if (!key) return;
          let value = row[title];
          if (key === "startTime" || key === "dueDate") value = normalizeImportedDate(value);
          if (key === "qty" || key === "plannedHours") value = normalizeImportedNumber(value);
          next[key] = value;
        });
        next.id = crypto.randomUUID();
        next.createdAt = new Date(Date.now() + idx).toISOString();
        next.isDelayed = calcDelayed(next);
        return next;
      });

      if (REMOTE_ENABLED && remoteOnline) {
        const { error } = await db.from("mes_orders").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        if (error) {
          // 某些环境/RLS下可能不允许全量删除，不中断导入流程
          console.warn("云端清空旧数据失败，改为直接覆盖写入", error);
        }
      }

      await persistOrders({ changed: orders });
      render();
      alert("导入成功");
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
  const s = normalizeStartTimeInput(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(s)) return `${s.replace(" ", "T")}:00Z`;
  return null;
}

function toDbDueDate(v) {
  const s = normalizeImportedDate(v);
  return s || null;
}

function formatStartTimeFromDb(v) {
  if (!v) return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 16).replace("T", " ");
  return s;
}

function formatDueDateFromDb(v) {
  return normalizeImportedDate(v);
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
    if (Number.isFinite(col) && Number.isFinite(px)) {
      setColumnWidth(col, px);
    }
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

