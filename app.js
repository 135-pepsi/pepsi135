const STORAGE_KEY = "mini_mes_orders_v1";

const STATUS = ["待排产", "已排产", "加工中", "完成待检", "返工", "已发货"];
const MACHINES = ["CNC1", "CNC2", "CNC3", "CNC4", "CNC5"];
const XLSX_COLUMNS = [
  { key: "orderNo", title: "订单号" },
  { key: "customer", title: "客户" },
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

let orders = loadOrdersLocal();
let filters = { q: "", machine: "", status: "" };

const tableBody = document.getElementById("tableBody");

init();

function init() {
  bindEvents();
  render();
}

function bindEvents() {
  document.getElementById("quickAddBtn").addEventListener("click", quickAdd);
  document.getElementById("addRowBtn").addEventListener("click", addBlankRow);
  document.getElementById("saveBtn").addEventListener("click", exportXlsx);
  document.getElementById("importInput").addEventListener("change", importXlsx);

  document.getElementById("searchInput").addEventListener("input", (e) => {
    filters.q = e.target.value.trim().toLowerCase();
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

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      addBlankRow();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      exportXlsx();
    }
  });
}

function createEmptyOrder() {
  return {
    id: crypto.randomUUID(),
    orderNo: "",
    drawingNo: "",
    customer: "",
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

function quickAdd() {
  const orderNo = valueOf("qaOrderNo");
  const drawingNo = valueOf("qaDrawingNo");
  const customer = valueOf("qaCustomer");
  const qty = valueOf("qaQty");
  const plannedHours = valueOf("qaHours");
  const machine = valueOf("qaMachine");
  const dueDate = valueOf("qaDueDate");

  if (!orderNo || !drawingNo) {
    alert("请至少填写订单号和图号");
    return;
  }

  const order = {
    ...createEmptyOrder(),
    orderNo,
    drawingNo,
    customer,
    qty: normalizeValue("qty", qty),
    plannedHours: normalizeValue("plannedHours", plannedHours),
    machine,
    dueDate,
    status: "待排产",
    programNo: "未出",
    startTime: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
  order.isDelayed = calcDelayed(order);

  orders.unshift(order);
  saveOrdersLocal();
  clearQuickAdd();
  render();
}

function addBlankRow() {
  orders.unshift(createEmptyOrder());
  saveOrdersLocal();
  render();
  const firstEditable = tableBody.querySelector("td[data-key='orderNo']");
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
    tr.appendChild(editCell(o, "drawingNo"));
    tr.appendChild(editCell(o, "qty", "number"));
    tr.appendChild(selectCell(o, "programNo", ["已出", "未出"]));
    tr.appendChild(editCell(o, "plannedHours", "number"));
    tr.appendChild(selectCell(o, "machine", MACHINES));
    tr.appendChild(selectCell(o, "lathe", ["是", "否"]));
    tr.appendChild(editCell(o, "surface"));
    tr.appendChild(selectCell(o, "status", STATUS));
    tr.appendChild(editCell(o, "startTime"));
    tr.appendChild(editCell(o, "dueDate", "date"));
    tr.appendChild(textCell(o.isDelayed || ""));
    tr.appendChild(editCell(o, "note"));

    const opTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "action-btn";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", () => removeOrder(o.id));
    opTd.appendChild(delBtn);
    tr.appendChild(opTd);

    tableBody.appendChild(tr);
  });

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
  input.style.width = "100%";
  input.style.background = "#0b2748";
  input.style.border = "1px solid #42a5f5";
  input.style.color = "#e6f0ff";
  input.style.padding = "4px";

  if (key === "startTime" || key === "dueDate") {
    input.style.width = "70px";
    input.style.minWidth = "70px";
  }
  if (key === "customer") {
    input.style.width = "4.5em";
    input.style.minWidth = "4.5em";
  }

  td.appendChild(input);
  input.focus();
  input.select();

  const save = () => {
    td.classList.remove("editing");
    updateOrder(td.dataset.id, key, input.value);
  };

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
      jumpToNextRowSameColumn(td);
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

  sel.addEventListener("change", () => updateOrder(order.id, key, sel.value));
  td.appendChild(sel);
  return td;
}

function updateOrder(id, key, value) {
  const target = orders.find((o) => o.id === id);
  if (!target) return;

  target[key] = normalizeValue(key, value);
  target.isDelayed = calcDelayed(target);

  saveOrdersLocal();
  render();
}

function normalizeValue(key, value) {
  if (key === "qty" || key === "plannedHours") {
    if (value === "") return "";
    const num = Number(value);
    return Number.isFinite(num) ? num : "";
  }
  if (key === "dueDate") return value;
  return (value || "").trim();
}

function formatDisplayValue(key, value) {
  if (value == null || value === "") return "";
  if (key === "startTime" || key === "dueDate") {
    return toMonthDay(value);
  }
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
  orders = orders.filter((o) => o.id !== id);
  saveOrdersLocal();
  render();
}

function getFilteredOrders() {
  return orders.filter((o) => {
    const qOk =
      !filters.q ||
      [o.orderNo, o.drawingNo, o.customer, o.note].some((x) => (x || "").toString().toLowerCase().includes(filters.q));
    const mOk = !filters.machine || o.machine === filters.machine;
    const sOk = !filters.status || o.status === filters.status;
    return qOk && mOk && sOk;
  });
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

function saveOrdersLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

function loadOrdersLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data.map((x) => ({ ...createEmptyOrder(), ...x }));
    } catch (e) {
      console.warn("读取本地缓存失败", e);
    }
  }
  return demoData();
}

function demoData() {
  return [
    {
      ...createEmptyOrder(),
      orderNo: "ORD-2025-0003",
      drawingNo: "DW-2025-003",
      customer: "海尔",
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
  ["qaOrderNo", "qaDrawingNo", "qaCustomer", "qaQty", "qaHours", "qaMachine", "qaDueDate"].forEach((id) => {
    document.getElementById(id).value = "";
  });
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

function importXlsx(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!window.XLSX) {
    alert("Excel组件加载失败，请刷新页面后重试");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = new Uint8Array(reader.result);
      const wb = XLSX.read(data, { type: "array", cellDates: true });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
      const titleToKey = Object.fromEntries(XLSX_COLUMNS.map((x) => [x.title, x.key]));

      orders = rows.map((row) => {
        const next = createEmptyOrder();
        Object.keys(row).forEach((title) => {
          const key = titleToKey[title];
          if (!key) return;
          let value = row[title];
          if (key === "startTime" || key === "dueDate") value = normalizeImportedDate(value);
          if (key === "qty" || key === "plannedHours") value = value === "" ? "" : Number(value);
          next[key] = value;
        });
        next.id = crypto.randomUUID();
        next.isDelayed = calcDelayed(next);
        return next;
      });

      saveOrdersLocal();
      render();
      alert("导入成功");
    } catch (e) {
      console.error(e);
      alert("导入失败：请使用系统导出的 Excel 或包含标准列名的 Excel");
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = "";
}

function normalizeImportedDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim().replaceAll("/", "-");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const mm = m[2].padStart(2, "0");
    const dd = m[3].padStart(2, "0");
    return `${m[1]}-${mm}-${dd}`;
  }
  return s;
}
