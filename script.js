// ======================================
// Estado global (SIN hoja externa)
// ======================================
const LS_KEY_PRACTICADOS = "mx_bateria_practicados_v1";

let tempo = 120;               // BPM
let isPlaying = false;
let playTimer = null;
let currentSeq = [];           // array de golpes ["B","R","P"]
let currentIndex = 0;
let currentTableRef = null;    // {type:'gen'|'custom', rowId: string|null}
let currentInterval = (60 / tempo) * 1000;
let onlyUnpracticed = false;

const sonidos = {
  B: new Audio("bombo.wav"),
  R: new Audio("redoblante.wav"),
  P: new Audio("platillo.wav")
};

// Datos
const generados = [];              // [{id, nombre, secuencia, longitud}]
const secuenciasGenerados = new Set();
let patronPersonalizado = [];

// Practicados
const practicados = new Set(JSON.parse(localStorage.getItem(LS_KEY_PRACTICADOS) || "[]"));

// ======================================
// Utilidades
// ======================================
function normalizarSecuencia(seq) {
  return String(seq).toUpperCase().trim().split(/\s+/).join(" ");
}
function idFromSeq(seq) {
  return normalizarSecuencia(seq); // usamos la secuencia como id
}
function savePracticados() {
  localStorage.setItem(LS_KEY_PRACTICADOS, JSON.stringify([...practicados]));
}
function togglePracticado(seq) {
  const id = idFromSeq(seq);
  if (practicados.has(id)) practicados.delete(id);
  else practicados.add(id);
  savePracticados();
  renderGeneradosPorLongitud(2);
  renderGeneradosPorLongitud(3);
  renderGeneradosPorLongitud(4);
}
function esPracticado(seq){ return practicados.has(idFromSeq(seq)); }

function generarCombinaciones(el, len) {
  if (len === 1) return el.map(e => [e]);
  const comb = [];
  generarCombinaciones(el, len - 1).forEach(prev => {
    el.forEach(x => comb.push([...prev, x]));
  });
  return comb;
}

function agregarGenerado({ nombre, secuencia }) {
  const clave = normalizarSecuencia(secuencia);
  if (secuenciasGenerados.has(clave)) return;
  secuenciasGenerados.add(clave);
  const golpes = clave.split(" ");
  generados.push({
    id: idFromSeq(clave),
    nombre,
    secuencia: clave,
    longitud: golpes.length
  });
}

// ======================================
// Generación de patrones básicos (2,3,4)
// ======================================
function generarPatronesBasicos() {
  [2, 3, 4].forEach(len => {
    const arrs = generarCombinaciones(["B", "R", "P"], len);
    arrs.forEach(p => {
      agregarGenerado({
        nombre: `Patrón (${len} golpes)`,
        secuencia: p.join(" ")
      });
    });
  });
}

// ======================================
/* Partitura – SVG con posiciones pedidas
   Líneas (de arriba hacia abajo): y=20,28,36,44,52
   5ª línea (arriba) = y=20 (Hi-hat / P)
   3er espacio (entre líneas 3 y 4) = y=(36+28)/2 = 32 (Redoblante / R)
   1er espacio (entre líneas 1 y 2, desde abajo) = y=(52+44)/2 = 48 (Bombo / B)
*/
// ======================================
function crearSVGPartitura(seq, idSuffix){
  const golpes = normalizarSecuencia(seq).split(" ");
  const w = Math.max(180, 30 * golpes.length + 20);
  const h = 72;
  const staffY = [20, 28, 36, 44, 52]; // 5 líneas (1=arriba, 5=abajo)
  const ns = "http://www.w3.org/2000/svg";

  // Posiciones solicitadas
  const Y_LINEA_5 = staffY[0];                 // 5ª línea (arriba)
  const Y_3ER_ESPACIO = (staffY[2] + staffY[1]) / 2; // entre 3ª y 4ª desde abajo → equivalencia visual arriba=20
  const Y_1ER_ESPACIO = (staffY[4] + staffY[3]) / 2; // entre 1ª y 2ª desde abajo

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "score");
  svg.dataset.seq = seq;

  // Líneas del pentagrama
  staffY.forEach(y=>{
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", "8"); line.setAttribute("y1", y);
    line.setAttribute("x2", w-8); line.setAttribute("y2", y);
    line.setAttribute("stroke", "#222"); line.setAttribute("stroke-width", "1");
    line.setAttribute("opacity", "0.25");
    svg.appendChild(line);
  });

  // Notas
  golpes.forEach((g, i)=>{
    const x = 20 + i*30;

    if (g === "P"){
      // Hi-hat en 5ª línea (arriba): X centrada en Y_LINEA_5
      const g1 = document.createElementNS(ns, "line");
      g1.setAttribute("x1", x-6); g1.setAttribute("y1", Y_LINEA_5-4);
      g1.setAttribute("x2", x+6); g1.setAttribute("y2", Y_LINEA_5+4);
      g1.setAttribute("stroke", "#111"); g1.setAttribute("stroke-width", "2");
      g1.setAttribute("class", `note-x note-${idSuffix}-${i}`);
      svg.appendChild(g1);

      const g2 = document.createElementNS(ns, "line");
      g2.setAttribute("x1", x+6); g2.setAttribute("y1", Y_LINEA_5-4);
      g2.setAttribute("x2", x-6); g2.setAttribute("y2", Y_LINEA_5+4);
      g2.setAttribute("stroke", "#111"); g2.setAttribute("stroke-width", "2");
      g2.setAttribute("class", `note-x note-${idSuffix}-${i}`);
      svg.appendChild(g2);
    } else {
      // R en 3er espacio, B en 1er espacio
      const y = (g === "R") ? Y_3ER_ESPACIO : Y_1ER_ESPACIO;
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", x); c.setAttribute("cy", y);
      c.setAttribute("r", "6");
      c.setAttribute("fill", "#111");
      c.setAttribute("class", `note-circle note-${idSuffix}-${i}`);
      svg.appendChild(c);
    }
  });

  return svg;
}

function resaltarNotaActual(tableRef, index){
  document.querySelectorAll(".note-active").forEach(n=> n.classList.remove("note-active"));
  if (!tableRef || index == null) return;

  const idPrefix = `${tableRef.type}-${tableRef.rowId}`;
  const selector = `.note-${idPrefix}-${index}`;
  document.querySelectorAll(selector).forEach(n=> n.classList.add("note-active"));
}

// ======================================
// Render de tablas por longitud
// ======================================
function renderGeneradosPorLongitud(len){
  const tbody = document.getElementById(`tbody-len${len}`);
  if (!tbody) return;
  tbody.innerHTML = "";

  let lista = generados.filter(p => p.longitud === len);
  if (onlyUnpracticed) lista = lista.filter(p => !esPracticado(p.secuencia));

  if (!lista.length){
    tbody.innerHTML = `<tr><td colspan="4">No hay patrones para mostrar con los filtros actuales.</td></tr>`;
    return;
  }

  lista.forEach((p) => {
    const tr = document.createElement("tr");
    tr.dataset.rowType = "gen";
    tr.dataset.rowId = p.id;

    const pract = esPracticado(p.secuencia);
    const badge = pract ? `<span class="badge">✔ Practicado</span>` : "";

    tr.innerHTML = `
      <td>${p.nombre} ${badge}</td>
      <td>${p.secuencia}</td>
      <td><div class="score-wrap" id="score-gen-${p.id}"></div></td>
      <td>
        <div class="table-actions">
          <button onclick="reproducirDesde('gen','${p.id}','${p.secuencia}')">Reproducir</button>
          <button onclick="togglePracticado('${p.secuencia}')">${pract ? 'Desmarcar' : 'Marcar practicado'}</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);

    // Partitura
    const wrap = document.getElementById(`score-gen-${p.id}`);
    wrap.innerHTML = "";
    wrap.appendChild(crearSVGPartitura(p.secuencia, `gen-${p.id}`));
  });
}

// ======================================
// Reproducción
// ======================================
function scheduleNextTick() {
  if (!isPlaying || currentSeq.length === 0) return;

  const g = currentSeq[currentIndex];
  const audio = sonidos[g];
  if (audio) {
    try { audio.currentTime = 0; audio.play(); } catch (e) {}
  }

  // Animar batería
  const el = document.getElementById(g === "B" ? "bombo" : g === "R" ? "redoblante" : "platillo");
  if (el) {
    el.classList.add("active");
    setTimeout(() => el.classList.remove("active"), currentInterval / 2);
  }

  // Resaltar nota en la partitura
  resaltarNotaActual(currentTableRef, currentIndex);

  currentIndex = (currentIndex + 1) % currentSeq.length;
  playTimer = setTimeout(scheduleNextTick, currentInterval);
}

function reproducirSecuencia(seqArray, tableRef = { type: null, rowId: null }) {
  if (isPlaying) pararReproduccion(false);
  currentSeq = seqArray.slice();
  currentIndex = 0;
  currentTableRef = tableRef;
  isPlaying = true;
  currentInterval = (60 / tempo) * 1000;
  scheduleNextTick();
}

function pararReproduccion(resetHighlights = true) {
  isPlaying = false;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  ["bombo","redoblante","platillo"].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.classList.remove("active");
  });
  if (resetHighlights) document.querySelectorAll(".note-active").forEach(n=> n.classList.remove("note-active"));
  currentSeq = [];
  currentIndex = 0;
  currentTableRef = null;
}

function reproducirDesde(type, rowId, seq){
  const arr = normalizarSecuencia(seq).split(" ");
  reproducirSecuencia(arr, { type, rowId });
}

// ======================================
// Creador personalizado
// ======================================
function agregarAlPatron(g) {
  patronPersonalizado.push(g);
  actualizarVistaPatron();
}
function limpiarPatron() {
  patronPersonalizado = [];
  actualizarVistaPatron();
}
function actualizarVistaPatron() {
  const txt = document.getElementById("current-pattern");
  txt.textContent = patronPersonalizado.join(" - ") || "Ningún golpe seleccionado";

  const score = document.getElementById("custom-score");
  score.innerHTML = "";
  if (patronPersonalizado.length){
    score.appendChild(crearSVGPartitura(patronPersonalizado.join(" "), `custom`));
  }
}
function reproducirPatronPersonalizado() {
  if (!patronPersonalizado.length) {
    alert("Agrega algunos golpes primero");
    return;
  }
  const seq = patronPersonalizado.slice();
  reproducirSecuencia(seq, { type: "custom", rowId: "custom" });
}

// ======================================
// Tabs + Filtros UI + Tempo
// ======================================
function setupTabs(){
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      tabs.forEach(t=> t.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach(p=> p.classList.remove("active"));
      document.getElementById(`panel-${tab}`).classList.add("active");
    });
  });
}

function setupOnlyUnpracticed(){
  const cb = document.getElementById("only-unpracticed");
  onlyUnpracticed = cb.checked;
  cb.addEventListener("change", ()=>{
    onlyUnpracticed = cb.checked;
    renderGeneradosPorLongitud(2);
    renderGeneradosPorLongitud(3);
    renderGeneradosPorLongitud(4);
  });
}

const tempoSlider = document.getElementById("tempo-slider");
const tempoDisplay = document.getElementById("tempo-display");
if (tempoSlider){
  tempoSlider.addEventListener("input", () => {
    tempo = Number(tempoSlider.value);
    tempoDisplay.textContent = tempo;
    currentInterval = (60 / tempo) * 1000;
    if (isPlaying) {
      if (playTimer) { clearTimeout(playTimer); playTimer = null; }
      playTimer = setTimeout(scheduleNextTick, currentInterval);
    }
  });
}

// ======================================
// Init
// ======================================
function init() {
  setupTabs();
  setupOnlyUnpracticed();

  generarPatronesBasicos();     // ← combinaciones 2,3,4 de B/R/P
  renderGeneradosPorLongitud(2);
  renderGeneradosPorLongitud(3);
  renderGeneradosPorLongitud(4);
}
window.onload = init;

// Exponer globales
window.pararReproduccion = pararReproduccion;
window.renderGeneradosPorLongitud = renderGeneradosPorLongitud;
window.reproducirDesde = reproducirDesde;
window.agregarAlPatron = agregarAlPatron;
window.limpiarPatron = limpiarPatron;
window.reproducirPatronPersonalizado = reproducirPatronPersonalizado;
