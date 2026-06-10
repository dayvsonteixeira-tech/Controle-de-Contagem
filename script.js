// ============================================================
// app.js — Contador de Atendimentos
// Firebase Firestore + Chart.js + SheetJS
// ============================================================

// Firebase carregado via CDN no HTML (compat mode)
const firebaseConfig = {
  apiKey:            "AIzaSyBEWnRuArK8F9Pt2Kq6wP3b4zaoFCGrdAQ",
  authDomain:        "controle-de-contagem.firebaseapp.com",
  projectId:         "controle-de-contagem",
  storageBucket:     "controle-de-contagem.firebasestorage.app",
  messagingSenderId: "55498480603",
  appId:             "1:55498480603:web:f9779f9824cd1a0ca0a5fe"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ────── STATE ──────
let collaborators = [];
let entries       = [];
let currentMonth  = "";
let chartType     = "bar";
let mainChart     = null;
let dailyChart    = null;

const $ = id => document.getElementById(id);

// ────── INIT ──────
window.addEventListener("DOMContentLoaded", async () => {
  setCurrentMonth();
  bindUI();
  await loadCollaborators();
  await loadEntries();
  render();
});

function setCurrentMonth() {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  currentMonth = `${y}-${m}`;
  $("currentMonthLabel").textContent = formatMonthLabel(currentMonth);
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split("-");
  const months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  return `${months[parseInt(m, 10) - 1]} de ${y}`;
}

// ────── BIND UI ──────
function bindUI() {
  $("btnAddEntry").addEventListener("click", openModalEntry);
  $("fabAdd").addEventListener("click", openModalEntry);
  $("btnExcel").addEventListener("click", exportExcel);
  $("btnHistory").addEventListener("click", openHistory);

  $("modalClose").addEventListener("click", closeModalEntry);
  $("btnModalCancel").addEventListener("click", closeModalEntry);
  $("btnModalSave").addEventListener("click", saveEntry);
  $("modalOverlay").addEventListener("click", e => {
    if (e.target === $("modalOverlay")) closeModalEntry();
  });

  $("historyClose").addEventListener("click", () => closeOverlay("historyOverlay"));
  $("historyOverlay").addEventListener("click", e => {
    if (e.target === $("historyOverlay")) closeOverlay("historyOverlay");
  });

  $("collabClose").addEventListener("click", () => closeOverlay("collabOverlay"));
  $("collabOverlay").addEventListener("click", e => {
    if (e.target === $("collabOverlay")) closeOverlay("collabOverlay");
  });

  $("cardColabs").closest(".card").style.cursor = "pointer";
  $("cardColabs").closest(".card").addEventListener("click", openCollabModal);

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      chartType = btn.dataset.tab;
      renderMainChart();
    });
  });

  $("filterCollab").addEventListener("change", renderTable);

  $("btnAddCollab").addEventListener("click", () => {
    addCollaborator($("inputCollabName").value);
    $("inputCollabName").value = "";
  });
  $("inputCollabName").addEventListener("keydown", e => {
    if (e.key === "Enter") { addCollaborator(e.target.value); e.target.value = ""; }
  });

  const today = new Date().toISOString().split("T")[0];
  $("inputDate").value = today;
}

// ────── FIREBASE: COLABORADORES ──────
async function loadCollaborators() {
  try {
    const snap = await db.collection("collaborators").get();
    collaborators = [];
    snap.forEach(d => collaborators.push({ id: d.id, ...d.data() }));
    collaborators.sort((a, b) => a.name.localeCompare(b.name));
    if (!collaborators.length) await seedDefaultCollaborators();
    populateCollabSelects();
  } catch(e) {
    console.error("loadCollaborators:", e);
    showToast("Erro ao carregar colaboradores: " + e.message, "error");
  }
}

async function seedDefaultCollaborators() {
  const defaults = ["Bruna","Dayvison","Fabiana","Márcio","Mário",
                    "Michelly","Tatiana","Marcelo","Camila"];
  for (const name of defaults) {
    const id = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"-");
    await db.collection("collaborators").doc(id).set({ name });
    collaborators.push({ id, name });
  }
}

async function addCollaborator(name) {
  if (!name.trim()) return;
  const id = name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"-") + "-" + Date.now();
  await db.collection("collaborators").doc(id).set({ name: name.trim() });
  collaborators.push({ id, name: name.trim() });
  collaborators.sort((a, b) => a.name.localeCompare(b.name));
  populateCollabSelects();
  renderCollabList();
  showToast(`Colaborador "${name.trim()}" adicionado!`);
}

async function removeCollaborator(id, name) {
  if (!confirm(`Remover "${name}"?`)) return;
  await db.collection("collaborators").doc(id).delete();
  collaborators = collaborators.filter(c => c.id !== id);
  populateCollabSelects();
  renderCollabList();
  showToast(`Colaborador "${name}" removido.`);
}

window.removeCollab = removeCollaborator;

function populateCollabSelects() {
  const sel  = $("inputCollab");
  const cur  = sel.value;
  sel.innerHTML = `<option value="">Selecionar...</option>`;
  collaborators.forEach(c => {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;

  const flt  = $("filterCollab");
  const curF = flt.value;
  flt.innerHTML = `<option value="">Todos</option>`;
  collaborators.forEach(c => {
    const o = document.createElement("option");
    o.value = c.id; o.textContent = c.name;
    flt.appendChild(o);
  });
  if (curF) flt.value = curF;
}

// ────── FIREBASE: ENTRIES ──────
async function loadEntries() {
  try {
    const snap = await db.collection("entries")
      .where("month", "==", currentMonth)
      .orderBy("date")
      .get();
    entries = [];
    snap.forEach(d => entries.push({ id: d.id, ...d.data() }));
  } catch(e) {
    console.error("loadEntries:", e);
    // Se falhar por índice, tenta sem orderBy
    try {
      const snap2 = await db.collection("entries")
        .where("month", "==", currentMonth)
        .get();
      entries = [];
      snap2.forEach(d => entries.push({ id: d.id, ...d.data() }));
      entries.sort((a,b) => a.date.localeCompare(b.date));
    } catch(e2) {
      showToast("Erro ao carregar registros: " + e2.message, "error");
    }
  }
}

async function saveEntry() {
  const date   = $("inputDate").value;
  const collab = $("inputCollab").value;
  const hot    = parseInt($("inputHot").value)  || 0;
  const spot   = parseInt($("inputSpot").value) || 0;
  const status = $("inputStatus").value;

  if (!date || !collab) { showToast("Preencha data e colaborador!", "error"); return; }

  const collabName = collaborators.find(c => c.id === collab)?.name || collab;
  const month      = date.slice(0, 7);
  const id         = `${date}_${collab}`;
  const entry      = { date, collab, collabName, hot, spot, status, month };

  try {
    await db.collection("entries").doc(id).set(entry);
    const idx = entries.findIndex(e => e.id === id);
    if (idx >= 0) entries[idx] = { id, ...entry };
    else          entries.push({ id, ...entry });
    if (month === currentMonth) render();
    closeModalEntry();
    showToast("Registro salvo!");
  } catch(e) {
    console.error("saveEntry:", e);
    showToast("Erro ao salvar: " + e.message, "error");
  }
}

async function deleteEntry(id) {
  if (!confirm("Remover este registro?")) return;
  try {
    await db.collection("entries").doc(id).delete();
    entries = entries.filter(e => e.id !== id);
    render();
    showToast("Registro removido.");
  } catch(e) {
    showToast("Erro ao remover.", "error");
  }
}

// ────── RENDER ──────
function render() {
  renderCards();
  renderTable();
  renderMainChart();
  renderDailyChart();
}

function renderCards() {
  const today  = new Date().toISOString().split("T")[0];
  const active = entries.filter(e => e.date === today && e.status === "normal").length;
  let total = 0, hot = 0, spot = 0;
  entries.forEach(e => {
    if (e.status === "normal") { total += (e.hot||0)+(e.spot||0); hot += e.hot||0; spot += e.spot||0; }
  });
  $("cardTotal").textContent = total;
  $("cardHot").textContent   = hot;
  $("cardSpot").textContent  = spot;
  $("cardColabs").textContent = active || collaborators.length;
}

function renderTable() {
  const filter = $("filterCollab").value;
  const dates  = [...new Set(entries.map(e => e.date))].sort();

  const thead = $("tableHead");
  thead.innerHTML = `<th class="td-collab">Colaborador</th>` +
    dates.map(d => `<th>${formatDateShort(d)}</th>`).join("") +
    `<th>Total</th><th>Hot 🔥</th><th>Spot 📍</th>`;

  const tbody = $("tableBody");
  tbody.innerHTML = "";

  const collabsToShow = filter
    ? collaborators.filter(c => c.id === filter)
    : collaborators;

  collabsToShow.forEach(collab => {
    const tr = document.createElement("tr");
    let tH = 0, tS = 0;
    let tdHtml = `<td class="td-collab">${collab.name}</td>`;

    dates.forEach(d => {
      const e = entries.find(x => x.date === d && x.collab === collab.id);
      if (!e) {
        tdHtml += `<td><button class="btn-cell" onclick="window.openEditModal('${d}','${collab.id}')">+</button></td>`;
      } else if (e.status === "DM") {
        tdHtml += `<td><span class="cell-dm">DM</span></td>`;
      } else if (e.status === "absent") {
        tdHtml += `<td><span class="cell-absent">—</span></td>`;
      } else {
        tH += e.hot||0; tS += e.spot||0;
        tdHtml += `<td>
          <div class="cell-hs">
            <span class="cell-h">${e.hot||0}H</span>
            <span class="cell-s">${e.spot||0}S</span>
          </div>
          <button class="btn-cell" title="Editar" onclick="window.openEditModal('${d}','${collab.id}')">✎</button>
        </td>`;
      }
    });

    tdHtml += `<td><strong>${tH+tS}</strong></td><td class="cell-h">${tH}</td><td class="cell-s">${tS}</td>`;
    tr.innerHTML = tdHtml;
    tbody.appendChild(tr);
  });

  const tfoot = $("tableFoot");
  const totByDate = dates.map(d => {
    const de  = entries.filter(e => e.date === d && e.status === "normal");
    const hot  = de.reduce((s,e) => s+(e.hot||0),  0);
    const spot = de.reduce((s,e) => s+(e.spot||0), 0);
    return { total: hot+spot, hot, spot };
  });
  const grandH = totByDate.reduce((s,x) => s+x.hot,  0);
  const grandS = totByDate.reduce((s,x) => s+x.spot, 0);

  tfoot.innerHTML = `
    <tr>
      <td>Total</td>
      ${totByDate.map(x => `<td><strong>${x.total}</strong></td>`).join("")}
      <td>${grandH+grandS}</td><td class="cell-h">${grandH}</td><td class="cell-s">${grandS}</td>
    </tr>
    <tr>
      <td>Hot 🔥</td>
      ${totByDate.map(x => `<td class="cell-h">${x.hot}</td>`).join("")}
      <td colspan="3"></td>
    </tr>
    <tr>
      <td>Spot 📍</td>
      ${totByDate.map(x => `<td class="cell-s">${x.spot}</td>`).join("")}
      <td colspan="3"></td>
    </tr>`;
}

// ────── CHARTS ──────
const PALETTE = ["#2563EB","#EA580C","#0D9488","#7C3AED","#DC2626","#D97706","#059669","#DB2777","#0284C7","#65A30D"];

function renderMainChart() {
  const ctx = document.getElementById("mainChart").getContext("2d");
  if (mainChart) mainChart.destroy();

  const labels   = collaborators.map(c => c.name);
  const hotData  = collaborators.map(c => entries.filter(e => e.collab===c.id && e.status==="normal").reduce((s,e)=>s+(e.hot||0),0));
  const spotData = collaborators.map(c => entries.filter(e => e.collab===c.id && e.status==="normal").reduce((s,e)=>s+(e.spot||0),0));

  if (chartType === "pie") {
    const totals = collaborators.map(c => entries.filter(e => e.collab===c.id && e.status==="normal").reduce((s,e)=>s+(e.hot||0)+(e.spot||0),0));
    mainChart = new Chart(ctx, {
      type: "pie",
      data: { labels, datasets: [{ data: totals, backgroundColor: PALETTE, borderWidth: 2, borderColor: "#fff" }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { font: { family: "Inter", size: 11 }, padding: 12 } } } }
    });
    return;
  }

  mainChart = new Chart(ctx, {
    type: chartType === "line" ? "line" : "bar",
    data: {
      labels,
      datasets: [
        { label: "Hot 🔥",  data: hotData,  backgroundColor: "#EA580C", borderColor: "#EA580C", fill: false, tension: .3, borderRadius: 6 },
        { label: "Spot 📍", data: spotData, backgroundColor: "#0D9488", borderColor: "#0D9488", fill: false, tension: .3, borderRadius: 6 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { family: "Inter", size: 11 } } } }, scales: { x: { ticks: { font: { size: 10 } } }, y: { beginAtZero: true } } }
  });
}

function renderDailyChart() {
  const ctx = document.getElementById("dailyChart").getContext("2d");
  if (dailyChart) dailyChart.destroy();

  const dates    = [...new Set(entries.map(e => e.date))].sort();
  const hotData  = dates.map(d => entries.filter(e=>e.date===d&&e.status==="normal").reduce((s,e)=>s+(e.hot||0),0));
  const spotData = dates.map(d => entries.filter(e=>e.date===d&&e.status==="normal").reduce((s,e)=>s+(e.spot||0),0));
  const labels   = dates.map(d => formatDateShort(d));

  dailyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Hot 🔥",  data: hotData,  borderColor: "#EA580C", backgroundColor: "rgba(234,88,12,.12)",  fill: true, tension: .4, pointRadius: 4, pointHoverRadius: 6 },
        { label: "Spot 📍", data: spotData, borderColor: "#0D9488", backgroundColor: "rgba(13,148,136,.12)", fill: true, tension: .4, pointRadius: 4, pointHoverRadius: 6 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { family: "Inter", size: 11 } } } }, scales: { x: { ticks: { font: { size: 10 } } }, y: { beginAtZero: true } } }
  });
}

// ────── MODALS ──────
function openModalEntry() {
  const today = new Date().toISOString().split("T")[0];
  $("inputDate").value    = today;
  $("inputCollab").value  = "";
  $("inputHot").value     = 0;
  $("inputSpot").value    = 0;
  $("inputStatus").value  = "normal";
  $("modalTitle").textContent = "Registrar Atendimento";
  openOverlay("modalOverlay");
}

function closeModalEntry() { closeOverlay("modalOverlay"); }

window.openEditModal = (date, collabId) => {
  const e = entries.find(x => x.date === date && x.collab === collabId);
  $("inputDate").value    = date;
  $("inputCollab").value  = collabId;
  $("inputHot").value     = e?.hot    || 0;
  $("inputSpot").value    = e?.spot   || 0;
  $("inputStatus").value  = e?.status || "normal";
  $("modalTitle").textContent = `Editar — ${formatDateShort(date)}`;
  openOverlay("modalOverlay");
};

// ────── COLLAB MODAL ──────
function openCollabModal() {
  renderCollabList();
  openOverlay("collabOverlay");
}

function renderCollabList() {
  const list = $("collabList");
  list.innerHTML = "";
  collaborators.forEach(c => {
    const div = document.createElement("div");
    div.className = "collab-item";
    div.innerHTML = `<span>${c.name}</span>
      <button class="btn btn-danger" style="padding:5px 10px;font-size:.75rem"
        onclick="window.removeCollab('${c.id}','${c.name}')">Remover</button>`;
    list.appendChild(div);
  });
}

// ────── HISTORY ──────
async function openHistory() {
  openOverlay("historyOverlay");
  $("historyBody").innerHTML = `<p class="loading-msg">Carregando histórico...</p>`;
  try {
    const snap = await db.collection("entries").get();
    const byMonth = {};
    snap.forEach(d => {
      const data = d.data();
      const m    = data.month || data.date?.slice(0,7);
      if (!m) return;
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push({ id: d.id, ...data });
    });

    const months = Object.keys(byMonth).sort().reverse();
    if (!months.length) { $("historyBody").innerHTML = `<p class="loading-msg">Sem registros ainda.</p>`; return; }

    let html = "";
    months.forEach(m => {
      const ents = byMonth[m];
      const collabIds = [...new Set(ents.map(e => e.collab))];
      let rows = "";
      collabIds.forEach(cid => {
        const ce   = ents.filter(e => e.collab===cid && e.status==="normal");
        const cName = ents.find(e => e.collab===cid)?.collabName || cid;
        const tH = ce.reduce((s,e)=>s+(e.hot||0),0);
        const tS = ce.reduce((s,e)=>s+(e.spot||0),0);
        rows += `<tr><td>${cName}</td><td>${tH+tS}</td><td>${tH}</td><td>${tS}</td></tr>`;
      });
      const gH = ents.filter(e=>e.status==="normal").reduce((s,e)=>s+(e.hot||0),0);
      const gS = ents.filter(e=>e.status==="normal").reduce((s,e)=>s+(e.spot||0),0);

      html += `<div class="history-month">
        <h4>${formatMonthLabel(m)}
          <button class="btn btn-outline" style="float:right;padding:4px 10px;font-size:.75rem"
            onclick="window.exportHistoryMonth('${m}')">⬇ Excel</button>
        </h4>
        <div class="history-table-wrap">
          <table class="history-table">
            <thead><tr><th>Colaborador</th><th>Total</th><th>Hot 🔥</th><th>Spot 📍</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr><td><strong>TOTAL</strong></td><td>${gH+gS}</td><td>${gH}</td><td>${gS}</td></tr></tfoot>
          </table>
        </div></div>`;
    });
    $("historyBody").innerHTML = html;
  } catch(e) {
    console.error(e);
    $("historyBody").innerHTML = `<p class="loading-msg">Erro ao carregar histórico: ${e.message}</p>`;
  }
}

window.exportHistoryMonth = async (month) => {
  try {
    const snap = await db.collection("entries").where("month","==",month).get();
    const ents = [];
    snap.forEach(d => ents.push({ id: d.id, ...d.data() }));
    buildAndDownloadExcel(ents, `Atendimentos_${month}`);
  } catch(e) { showToast("Erro ao exportar.", "error"); }
};

// ────── EXCEL ──────
function exportExcel() { buildAndDownloadExcel(entries, `Atendimentos_${currentMonth}`); }

function buildAndDownloadExcel(ents, filename) {
  const dates = [...new Set(ents.map(e => e.date))].sort();
  const rows  = [["Colaborador", ...dates.flatMap(d => [`${formatDateShort(d)} Hot`, `${formatDateShort(d)} Spot`]), "Total Hot", "Total Spot", "Total Geral"]];

  collaborators.forEach(c => {
    const row = [c.name]; let tH = 0, tS = 0;
    dates.forEach(d => {
      const e = ents.find(x => x.date===d && x.collab===c.id);
      if (!e || e.status!=="normal") { row.push(0,0); }
      else { row.push(e.hot||0, e.spot||0); tH+=e.hot||0; tS+=e.spot||0; }
    });
    row.push(tH, tS, tH+tS); rows.push(row);
  });

  const footerH  = dates.map(d => ents.filter(e=>e.date===d&&e.status==="normal").reduce((s,e)=>s+(e.hot||0),0));
  const footerS  = dates.map(d => ents.filter(e=>e.date===d&&e.status==="normal").reduce((s,e)=>s+(e.spot||0),0));
  const footerRow = ["TOTAL"];
  footerH.forEach((h,i) => footerRow.push(h, footerS[i]));
  footerRow.push(footerH.reduce((s,x)=>s+x,0), footerS.reduce((s,x)=>s+x,0), footerH.reduce((s,x)=>s+x,0)+footerS.reduce((s,x)=>s+x,0));
  rows.push(footerRow);

  const ws  = XLSX.utils.aoa_to_sheet(rows);
  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Atendimentos");

  const daily = [["Data","Hot","Spot","Total"]];
  dates.forEach(d => {
    const h = ents.filter(e=>e.date===d&&e.status==="normal").reduce((s,e)=>s+(e.hot||0),0);
    const s = ents.filter(e=>e.date===d&&e.status==="normal").reduce((s,e)=>s+(e.spot||0),0);
    daily.push([d, h, s, h+s]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(daily), "Resumo Diário");
  XLSX.writeFile(wb, `${filename}.xlsx`);
  showToast("Excel baixado!");
}

// ────── HELPERS ──────
function formatDateShort(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}
function openOverlay(id)  { $(id).classList.add("open"); }
function closeOverlay(id) { $(id).classList.remove("open"); }
function showToast(msg, type = "success") {
  const t = $("toast");
  t.textContent = msg;
  t.style.background = type === "error" ? "#DC2626" : "#0F172A";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}
