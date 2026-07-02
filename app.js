// ============================================================
// app.js — Contador de Atendimentos
// ============================================================

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

let collaborators = [];
let entries       = [];
let goalEntries   = []; // entradas usadas SOMENTE para a barra de meta (mês anterior + atual, até 30/07/2026)
let currentMonth  = "";
let chartType     = "bar";
let mainChart     = null;
let dailyChart    = null;

// Meta de atendimentos exibida na barra de porcentagem do topo
var GOAL_TOTAL = 2637;

// Data limite: a partir dela, novos lançamentos deixam de contar para a meta
var GOAL_END_DATE = "2026-07-30";

function $(id) { return document.getElementById(id); }

// ────── INIT ──────
document.addEventListener("DOMContentLoaded", async function() {
  setCurrentMonth();
  bindUI();
  renderCountdown(); // não depende dos dados do Firebase, então já mostra na hora
  showToast("Conectando ao banco...");
  await loadCollaborators();
  await loadEntries();
  await loadGoalEntries();
  render();
  showToast("Dados carregados!");
});

function setCurrentMonth() {
  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, "0");
  currentMonth = y + "-" + m;
  $("currentMonthLabel").textContent = formatMonthLabel(currentMonth);
}

function formatMonthLabel(ym) {
  var parts  = ym.split("-");
  var y = parts[0], m = parts[1];
  var months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  return months[parseInt(m, 10) - 1] + " de " + y;
}

// Retorna o primeiro dia (YYYY-MM-01) do mês anterior ao mês informado (YYYY-MM)
function getPreviousMonthStart(ym) {
  var parts = ym.split("-");
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  return y + "-" + String(m).padStart(2, "0") + "-01";
}

// ────── BIND UI ──────
function bindUI() {
  $("btnAddEntry").onclick    = openModalEntry;
  $("fabAdd").onclick         = openModalEntry;
  $("btnExcel").onclick       = exportExcel;
  $("btnHistory").onclick     = openHistory;
  $("modalClose").onclick     = closeModalEntry;
  $("btnModalCancel").onclick = closeModalEntry;
  $("btnModalSave").onclick   = saveEntry;
  $("historyClose").onclick   = function() { closeOverlay("historyOverlay"); };
  $("collabClose").onclick    = function() { closeOverlay("collabOverlay"); };
  $("btnAddCollab").onclick   = function() {
    addCollaborator($("inputCollabName").value);
    $("inputCollabName").value = "";
  };
  $("inputCollabName").onkeydown = function(e) {
    if (e.key === "Enter") { addCollaborator(e.target.value); e.target.value = ""; }
  };
  $("filterCollab").onchange = renderTable;

  $("modalOverlay").onclick = function(e) {
    if (e.target === $("modalOverlay")) closeModalEntry();
  };
  $("historyOverlay").onclick = function(e) {
    if (e.target === $("historyOverlay")) closeOverlay("historyOverlay");
  };
  $("collabOverlay").onclick = function(e) {
    if (e.target === $("collabOverlay")) closeOverlay("collabOverlay");
  };

  $("cardColabs").parentElement.style.cursor = "pointer";
  $("cardColabs").parentElement.onclick = openCollabModal;

  document.querySelectorAll(".tab-btn").forEach(function(btn) {
    btn.onclick = function() {
      document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      chartType = btn.getAttribute("data-tab");
      renderMainChart();
    };
  });

  $("inputDate").value = new Date().toISOString().split("T")[0];
}

// ────── COLABORADORES ──────
async function loadCollaborators() {
  try {
    var snap = await db.collection("collaborators").get();
    collaborators = [];
    snap.forEach(function(d) { collaborators.push(Object.assign({ id: d.id }, d.data())); });
    collaborators.sort(function(a,b) { return a.name.localeCompare(b.name); });
    if (collaborators.length === 0) await seedDefaultCollaborators();
    populateCollabSelects();
  } catch(e) {
    console.error("loadCollaborators:", e);
    showToast("Erro Firebase: " + e.message, "error");
  }
}

async function seedDefaultCollaborators() {
  var defaults = ["Bruna","Dayvison","Fabiana","Márcio","Mário","Michelly","Tatiana","Marcelo","Camila"];
  for (var i = 0; i < defaults.length; i++) {
    var name = defaults[i];
    var id = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"-");
    await db.collection("collaborators").doc(id).set({ name: name });
    collaborators.push({ id: id, name: name });
  }
}

async function addCollaborator(name) {
  if (!name.trim()) return;
  var id = name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"-") + "-" + Date.now();
  await db.collection("collaborators").doc(id).set({ name: name.trim() });
  collaborators.push({ id: id, name: name.trim() });
  collaborators.sort(function(a,b) { return a.name.localeCompare(b.name); });
  populateCollabSelects();
  renderCollabList();
  showToast("Colaborador adicionado!");
}

async function removeCollaborator(id, name) {
  if (!confirm('Remover "' + name + '"?')) return;
  await db.collection("collaborators").doc(id).delete();
  collaborators = collaborators.filter(function(c) { return c.id !== id; });
  populateCollabSelects();
  renderCollabList();
  showToast("Removido.");
}
window.removeCollab = removeCollaborator;

function populateCollabSelects() {
  var sel = $("inputCollab");
  var cur = sel.value;
  sel.innerHTML = '<option value="">Selecionar...</option>';
  collaborators.forEach(function(c) {
    var o = document.createElement("option");
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;

  var flt = $("filterCollab");
  var curF = flt.value;
  flt.innerHTML = '<option value="">Todos</option>';
  collaborators.forEach(function(c) {
    var o = document.createElement("option");
    o.value = c.id; o.textContent = c.name;
    flt.appendChild(o);
  });
  if (curF) flt.value = curF;
}

// ────── ENTRIES ──────
async function loadEntries() {
  try {
    var snap = await db.collection("entries").where("month","==",currentMonth).get();
    entries = [];
    snap.forEach(function(d) { entries.push(Object.assign({ id: d.id }, d.data())); });
    entries.sort(function(a,b) { return a.date.localeCompare(b.date); });
  } catch(e) {
    console.error("loadEntries:", e);
    showToast("Erro ao carregar: " + e.message, "error");
  }
}

// Carrega as entradas usadas para a barra de meta: do início do mês anterior
// até o limite de 30/07/2026 (o que vier depois dessa data não é somado).
async function loadGoalEntries() {
  try {
    var start = getPreviousMonthStart(currentMonth);
    var snap = await db.collection("entries")
      .where("date", ">=", start)
      .where("date", "<=", GOAL_END_DATE)
      .get();
    goalEntries = [];
    snap.forEach(function(d) { goalEntries.push(Object.assign({ id: d.id }, d.data())); });
  } catch(e) {
    console.error("loadGoalEntries:", e);
    // fallback: usa ao menos as entradas do mês atual já carregadas
    goalEntries = entries.slice();
  }
}

async function saveEntry() {
  var date   = $("inputDate").value;
  var collab = $("inputCollab").value;
  var hot    = parseInt($("inputHot").value)  || 0;
  var spot   = parseInt($("inputSpot").value) || 0;
  var status = $("inputStatus").value;

  if (!date || !collab) { showToast("Preencha data e colaborador!", "error"); return; }

  var found = collaborators.find(function(c) { return c.id === collab; });
  var collabName = found ? found.name : collab;
  var month = date.slice(0,7);
  var id    = date + "_" + collab;
  var entry = { date:date, collab:collab, collabName:collabName, hot:hot, spot:spot, status:status, month:month };

  try {
    await db.collection("entries").doc(id).set(entry);
    var idx = entries.findIndex(function(e) { return e.id === id; });
    if (idx >= 0) entries[idx] = Object.assign({ id:id }, entry);
    else          entries.push(Object.assign({ id:id }, entry));

    // Mantém a barra de meta sincronizada com o novo/editado lançamento,
    // respeitando a janela [mês anterior .. 30/07/2026]
    var goalStart = getPreviousMonthStart(currentMonth);
    if (date >= goalStart && date <= GOAL_END_DATE) {
      var gIdx = goalEntries.findIndex(function(e) { return e.id === id; });
      if (gIdx >= 0) goalEntries[gIdx] = Object.assign({ id:id }, entry);
      else           goalEntries.push(Object.assign({ id:id }, entry));
    }

    if (month === currentMonth) render();
    else renderGoalBar();

    closeModalEntry();
    showToast("Salvo!");
  } catch(e) {
    console.error("saveEntry:", e);
    showToast("Erro ao salvar: " + e.message, "error");
  }
}

// ────── RENDER ──────
function render() {
  renderGoalBar();
  renderCountdown();
  renderCards();
  renderTable();
  renderMainChart();
  renderDailyChart();
}

// ────── META: BARRA DE PORCENTAGEM ──────
function renderGoalBar() {
  var total = 0;
  goalEntries.forEach(function(e) {
    if (e.status === "normal") total += (e.hot || 0) + (e.spot || 0);
  });

  var pct = GOAL_TOTAL > 0 ? Math.round((total / GOAL_TOTAL) * 100) : 0;
  var pctClamped = Math.min(100, Math.max(0, pct));

  $("goalBarFill").style.width = pctClamped + "%";
  $("goalBarFill").classList.toggle("goal-complete", total >= GOAL_TOTAL);
  $("goalBarText").textContent = total.toLocaleString("pt-BR") + " / " + GOAL_TOTAL.toLocaleString("pt-BR") + " (" + pct + "%)";
}

// ────── CONTAGEM REGRESSIVA PARA 30 DE JULHO ──────
function renderCountdown() {
  var now = new Date();
  var year = now.getFullYear();

  // Alvo: 30 de Julho do ano corrente, às 23:59:59
  var target = new Date(year, 6, 30, 23, 59, 59, 999);

  // Se 30/07 deste ano já passou, conta para o 30/07 do próximo ano
  if (target.getTime() < now.getTime()) {
    target = new Date(year + 1, 6, 30, 23, 59, 59, 999);
  }

  var diffMs = target.getTime() - now.getTime();
  var days   = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  var text, urgent = false;
  if (days > 1) {
    text = "Faltam " + days + " dias para 30 de Julho";
  } else if (days === 1) {
    text = "Falta 1 dia para 30 de Julho";
    urgent = true;
  } else if (days === 0) {
    text = "Hoje é dia 30 de Julho! 🎉";
    urgent = true;
  } else {
    text = "O dia 30 de Julho já passou";
  }

  $("countdownText").textContent = text;
  $("countdownRow").classList.toggle("urgent", urgent || (days >= 0 && days <= 7));
}

function renderCards() {
  var today  = new Date().toISOString().split("T")[0];
  var active = entries.filter(function(e) { return e.date===today && e.status==="normal"; }).length;
  var total=0, hot=0, spot=0;
  entries.forEach(function(e) {
    if (e.status==="normal") { total+=(e.hot||0)+(e.spot||0); hot+=e.hot||0; spot+=e.spot||0; }
  });
  $("cardTotal").textContent = total;
  $("cardHot").textContent   = hot;
  $("cardSpot").textContent  = spot;
  $("cardColabs").textContent = active || collaborators.length;
}

function renderTable() {
  var filter = $("filterCollab").value;
  var dates  = [];
  entries.forEach(function(e) { if (dates.indexOf(e.date)===-1) dates.push(e.date); });
  dates.sort();

  var thead = $("tableHead");
  thead.innerHTML = '<th class="td-collab">Colaborador</th>' +
    dates.map(function(d){ return '<th>'+formatDateShort(d)+'</th>'; }).join("") +
    '<th>Total</th><th>Hot 🔥</th><th>Spot 📍</th>';

  var tbody = $("tableBody");
  tbody.innerHTML = "";

  var collabsToShow = filter
    ? collaborators.filter(function(c){ return c.id===filter; })
    : collaborators;

  collabsToShow.forEach(function(collab) {
    var tr = document.createElement("tr");
    var tH=0, tS=0;
    var tdHtml = '<td class="td-collab">'+collab.name+'</td>';

    dates.forEach(function(d) {
      var e = entries.find(function(x){ return x.date===d && x.collab===collab.id; });
      if (!e) {
        tdHtml += '<td><button class="btn-cell" onclick="window.openEditModal(\''+d+'\',\''+collab.id+'\')">+</button></td>';
      } else if (e.status==="DM") {
        tdHtml += '<td><span class="cell-dm">DM</span></td>';
      } else if (e.status==="absent") {
        tdHtml += '<td><span class="cell-absent">—</span></td>';
      } else {
        tH+=e.hot||0; tS+=e.spot||0;
        tdHtml += '<td><div class="cell-hs"><span class="cell-h">'+(e.hot||0)+'H</span><span class="cell-s">'+(e.spot||0)+'S</span></div>'
          +'<button class="btn-cell" onclick="window.openEditModal(\''+d+'\',\''+collab.id+'\')">✎</button></td>';
      }
    });

    tdHtml += '<td><strong>'+(tH+tS)+'</strong></td><td class="cell-h">'+tH+'</td><td class="cell-s">'+tS+'</td>';
    tr.innerHTML = tdHtml;
    tbody.appendChild(tr);
  });

  var tfoot = $("tableFoot");
  var totByDate = dates.map(function(d) {
    var de = entries.filter(function(e){ return e.date===d && e.status==="normal"; });
    var h  = de.reduce(function(s,e){ return s+(e.hot||0); },0);
    var s  = de.reduce(function(s,e){ return s+(e.spot||0); },0);
    return { total:h+s, hot:h, spot:s };
  });
  var grandH = totByDate.reduce(function(s,x){ return s+x.hot; },0);
  var grandS = totByDate.reduce(function(s,x){ return s+x.spot; },0);

  tfoot.innerHTML =
    '<tr><td>Total</td>'+totByDate.map(function(x){ return '<td><strong>'+x.total+'</strong></td>'; }).join("")+'<td>'+(grandH+grandS)+'</td><td class="cell-h">'+grandH+'</td><td class="cell-s">'+grandS+'</td></tr>'+
    '<tr><td>Hot 🔥</td>'+totByDate.map(function(x){ return '<td class="cell-h">'+x.hot+'</td>'; }).join("")+'<td colspan="3"></td></tr>'+
    '<tr><td>Spot 📍</td>'+totByDate.map(function(x){ return '<td class="cell-s">'+x.spot+'</td>'; }).join("")+'<td colspan="3"></td></tr>';
}

// ────── CHARTS ──────
var PALETTE = ["#2563EB","#EA580C","#0D9488","#7C3AED","#DC2626","#D97706","#059669","#DB2777","#0284C7","#65A30D"];

function renderMainChart() {
  var ctx = document.getElementById("mainChart").getContext("2d");
  if (mainChart) mainChart.destroy();
  var labels   = collaborators.map(function(c){ return c.name; });
  var hotData  = collaborators.map(function(c){ return entries.filter(function(e){ return e.collab===c.id&&e.status==="normal"; }).reduce(function(s,e){ return s+(e.hot||0); },0); });
  var spotData = collaborators.map(function(c){ return entries.filter(function(e){ return e.collab===c.id&&e.status==="normal"; }).reduce(function(s,e){ return s+(e.spot||0); },0); });

  if (chartType==="pie") {
    var totals = collaborators.map(function(c){ return entries.filter(function(e){ return e.collab===c.id&&e.status==="normal"; }).reduce(function(s,e){ return s+(e.hot||0)+(e.spot||0); },0); });
    mainChart = new Chart(ctx, { type:"pie", data:{ labels:labels, datasets:[{ data:totals, backgroundColor:PALETTE, borderWidth:2, borderColor:"#fff" }] }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:"bottom" } } } });
    return;
  }
  mainChart = new Chart(ctx, {
    type: chartType==="line" ? "line" : "bar",
    data: { labels:labels, datasets:[
      { label:"Hot 🔥",  data:hotData,  backgroundColor:"#EA580C", borderColor:"#EA580C", fill:false, tension:.3, borderRadius:6 },
      { label:"Spot 📍", data:spotData, backgroundColor:"#0D9488", borderColor:"#0D9488", fill:false, tension:.3, borderRadius:6 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } } }
  });
}

function renderDailyChart() {
  var ctx = document.getElementById("dailyChart").getContext("2d");
  if (dailyChart) dailyChart.destroy();
  var dates=[];
  entries.forEach(function(e){ if(dates.indexOf(e.date)===-1) dates.push(e.date); });
  dates.sort();
  var hotData  = dates.map(function(d){ return entries.filter(function(e){ return e.date===d&&e.status==="normal"; }).reduce(function(s,e){ return s+(e.hot||0); },0); });
  var spotData = dates.map(function(d){ return entries.filter(function(e){ return e.date===d&&e.status==="normal"; }).reduce(function(s,e){ return s+(e.spot||0); },0); });
  dailyChart = new Chart(ctx, {
    type:"line",
    data:{ labels:dates.map(formatDateShort), datasets:[
      { label:"Hot 🔥",  data:hotData,  borderColor:"#EA580C", backgroundColor:"rgba(234,88,12,.12)",  fill:true, tension:.4, pointRadius:4 },
      { label:"Spot 📍", data:spotData, borderColor:"#0D9488", backgroundColor:"rgba(13,148,136,.12)", fill:true, tension:.4, pointRadius:4 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } } }
  });
}

// ────── MODALS ──────
function openModalEntry() {
  $("inputDate").value   = new Date().toISOString().split("T")[0];
  $("inputCollab").value = "";
  $("inputHot").value    = 0;
  $("inputSpot").value   = 0;
  $("inputStatus").value = "normal";
  $("modalTitle").textContent = "Registrar Atendimento";
  openOverlay("modalOverlay");
}
function closeModalEntry() { closeOverlay("modalOverlay"); }

window.openEditModal = function(date, collabId) {
  var e = entries.find(function(x){ return x.date===date && x.collab===collabId; });
  $("inputDate").value    = date;
  $("inputCollab").value  = collabId;
  $("inputHot").value     = (e && e.hot)    ? e.hot    : 0;
  $("inputSpot").value    = (e && e.spot)   ? e.spot   : 0;
  $("inputStatus").value  = (e && e.status) ? e.status : "normal";
  $("modalTitle").textContent = "Editar — " + formatDateShort(date);
  openOverlay("modalOverlay");
};

function openCollabModal() { renderCollabList(); openOverlay("collabOverlay"); }

function renderCollabList() {
  var list = $("collabList");
  list.innerHTML = "";
  collaborators.forEach(function(c) {
    var div = document.createElement("div");
    div.className = "collab-item";
    div.innerHTML = '<span>'+c.name+'</span><button class="btn btn-danger" style="padding:5px 10px;font-size:.75rem" onclick="window.removeCollab(\''+c.id+'\',\''+c.name+'\')">Remover</button>';
    list.appendChild(div);
  });
}

// ────── HISTORY ──────
async function openHistory() {
  openOverlay("historyOverlay");
  $("historyBody").innerHTML = '<p class="loading-msg">Carregando...</p>';
  try {
    var snap = await db.collection("entries").get();
    var byMonth = {};
    snap.forEach(function(d) {
      var data = d.data();
      var m = data.month || (data.date ? data.date.slice(0,7) : null);
      if (!m) return;
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push(Object.assign({ id:d.id }, data));
    });
    var months = Object.keys(byMonth).sort().reverse();
    if (!months.length) { $("historyBody").innerHTML = '<p class="loading-msg">Sem registros ainda.</p>'; return; }

    var html = "";
    months.forEach(function(m) {
      var ents = byMonth[m];
      var collabIds = [];
      ents.forEach(function(e){ if(collabIds.indexOf(e.collab)===-1) collabIds.push(e.collab); });
      var rows = "";
      collabIds.forEach(function(cid) {
        var ce    = ents.filter(function(e){ return e.collab===cid && e.status==="normal"; });
        var found = ents.find(function(e){ return e.collab===cid; });
        var cName = found ? found.collabName : cid;
        var tH = ce.reduce(function(s,e){ return s+(e.hot||0); },0);
        var tS = ce.reduce(function(s,e){ return s+(e.spot||0); },0);
        rows += '<tr><td>'+cName+'</td><td>'+(tH+tS)+'</td><td>'+tH+'</td><td>'+tS+'</td></tr>';
      });
      var gH = ents.filter(function(e){ return e.status==="normal"; }).reduce(function(s,e){ return s+(e.hot||0); },0);
      var gS = ents.filter(function(e){ return e.status==="normal"; }).reduce(function(s,e){ return s+(e.spot||0); },0);
      html += '<div class="history-month"><h4>'+formatMonthLabel(m)+'<button class="btn btn-outline" style="float:right;padding:4px 10px;font-size:.75rem" onclick="window.exportHistoryMonth(\''+m+'\')">⬇ Excel</button></h4>'
        +'<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Colaborador</th><th>Total</th><th>Hot 🔥</th><th>Spot 📍</th></tr></thead>'
        +'<tbody>'+rows+'</tbody><tfoot><tr><td><strong>TOTAL</strong></td><td>'+(gH+gS)+'</td><td>'+gH+'</td><td>'+gS+'</td></tr></tfoot></table></div></div>';
    });
    $("historyBody").innerHTML = html;
  } catch(e) {
    $("historyBody").innerHTML = '<p class="loading-msg">Erro: '+e.message+'</p>';
  }
}

window.exportHistoryMonth = async function(month) {
  try {
    var snap = await db.collection("entries").where("month","==",month).get();
    var ents = [];
    snap.forEach(function(d){ ents.push(Object.assign({ id:d.id }, d.data())); });
    buildAndDownloadExcel(ents, "Atendimentos_"+month);
  } catch(e) { showToast("Erro ao exportar.", "error"); }
};

// ────── EXCEL ──────
function exportExcel() { buildAndDownloadExcel(entries, "Atendimentos_"+currentMonth); }

function buildAndDownloadExcel(ents, filename) {
  var dates = [];
  ents.forEach(function(e){ if(dates.indexOf(e.date)===-1) dates.push(e.date); });
  dates.sort();

  var header = ["Colaborador"];
  dates.forEach(function(d){ header.push(formatDateShort(d)+" Hot", formatDateShort(d)+" Spot"); });
  header.push("Total Hot","Total Spot","Total Geral");
  var rows = [header];

  collaborators.forEach(function(c) {
    var row=[c.name]; var tH=0,tS=0;
    dates.forEach(function(d){
      var e=ents.find(function(x){ return x.date===d&&x.collab===c.id; });
      if(!e||e.status!=="normal"){ row.push(0,0); }
      else{ row.push(e.hot||0,e.spot||0); tH+=e.hot||0; tS+=e.spot||0; }
    });
    row.push(tH,tS,tH+tS); rows.push(row);
  });

  var fH=dates.map(function(d){ return ents.filter(function(e){ return e.date===d&&e.status==="normal"; }).reduce(function(s,e){ return s+(e.hot||0); },0); });
  var fS=dates.map(function(d){ return ents.filter(function(e){ return e.date===d&&e.status==="normal"; }).reduce(function(s,e){ return s+(e.spot||0); },0); });
  var foot=["TOTAL"];
  fH.forEach(function(h,i){ foot.push(h,fS[i]); });
  var gH=fH.reduce(function(s,x){ return s+x; },0);
  var gS=fS.reduce(function(s,x){ return s+x; },0);
  foot.push(gH,gS,gH+gS);
  rows.push(foot);

  var ws=XLSX.utils.aoa_to_sheet(rows);
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Atendimentos");

  var daily=[["Data","Hot","Spot","Total"]];
  dates.forEach(function(d){
    var h=ents.filter(function(e){ return e.date===d&&e.status==="normal"; }).reduce(function(s,e){ return s+(e.hot||0); },0);
    var s=ents.filter(function(e){ return e.date===d&&e.status==="normal"; }).reduce(function(s,e){ return s+(e.spot||0); },0);
    daily.push([d,h,s,h+s]);
  });
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(daily),"Resumo Diário");
  XLSX.writeFile(wb,filename+".xlsx");
  showToast("Excel baixado!");
}

// ────── HELPERS ──────
function formatDateShort(dateStr) {
  var parts = dateStr.split("-");
  return parts[2]+"/"+parts[1];
}
function openOverlay(id)  { $(id).classList.add("open"); }
function closeOverlay(id) { $(id).classList.remove("open"); }
function showToast(msg, type) {
  var t = $("toast");
  t.textContent = msg;
  t.style.background = (type==="error") ? "#DC2626" : "#0F172A";
  t.classList.add("show");
  setTimeout(function(){ t.classList.remove("show"); }, 3000);
}
