import { EXAM, D, T, buildPlan } from "./config.js";
import {
  getAuth, loadSavedSession, clearSession,
  authLogin, authSignup,
  fetchUserState, upsertUserState,
  uploadAvatarBlob, upsertRanking, fetchRankingList
} from "./supabase.js";

const P = buildPlan();

// Estado principal do usuário
let S = {
  start: "",
  done: {},
  log: [],
  errors: [],
  sim: null,
  rank: { alias: "", avatarUrl: "", active: true }
};

let rankingCache = [];
let rankSort = "nota";
let errFilter = "all";

const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const addD = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return d; };
const fmt = d => pad(d.getDate()) + "/" + pad(d.getMonth() + 1);
const pct = (a, q) => q ? Math.round((100 * a) / q) : 0;
const cls = p => (p >= 75 ? "good" : p >= 60 ? "mid" : "low");
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function initials(name) {
  const parts = String(name || "U").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderAvatarHtml(url, name, sizeClass = "") {
  const safeName = esc(name || "Usuário");
  if (url) {
    return `<img class="av ${sizeClass}" src="${esc(url)}" alt="${safeName}" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';"><span class="av ${sizeClass}" style="display:none">${esc(initials(name))}</span>`;
  }
  return `<span class="av ${sizeClass}">${esc(initials(name))}</span>`;
}

function compressImageFile(file, maxSize = 256, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Arquivo de imagem inválido."));
      img.onload = () => {
        const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) reject(new Error("Falha ao processar imagem."));
          else resolve({ blob, mimeType: "image/jpeg" });
        }, "image/jpeg", quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function setStatus(state, msg) {
  const dot = $("#sdot"), txt = $("#stxt");
  if (!dot || !txt) return;
  dot.className = "dot " + (state || "");
  txt.textContent = msg;
}

function showAuthMsg(text, isErr) {
  const el = $("#amsg");
  el.textContent = text;
  el.className = "msg" + (isErr ? " err" : "");
  el.classList.remove("hide");
}

function showView(logged) {
  $("#authView").classList.toggle("hide", logged);
  $("#appView").classList.toggle("hide", !logged);
  const auth = getAuth();
  if (logged && auth && auth.user) {
    $("#uemail").textContent = auth.user.email || "";
  }
}

function cacheKey() {
  const auth = getAuth();
  return "cb26_" + (auth && auth.user ? auth.user.id : "local");
}

function defaultAlias() {
  const auth = getAuth();
  const email = auth?.user?.email || "";
  return email ? email.split("@")[0] : "Concurseiro";
}

function normalizeState(raw) {
  const base = {
    start: "",
    done: {},
    log: [],
    errors: [],
    sim: null,
    rank: { alias: defaultAlias(), avatarUrl: "", active: true }
  };
  const merged = Object.assign(base, raw || {});
  if (!Array.isArray(merged.log)) merged.log = [];
  if (!Array.isArray(merged.errors)) merged.errors = [];
  if (!merged.done || typeof merged.done !== "object") merged.done = {};
  if (!merged.rank || typeof merged.rank !== "object") {
    merged.rank = { alias: defaultAlias(), avatarUrl: "", active: true };
  }
  if (!merged.rank.alias) merged.rank.alias = defaultAlias();
  if (typeof merged.rank.avatarUrl !== "string") merged.rank.avatarUrl = "";
  return merged;
}

function loadLocal() {
  try {
    const l = localStorage.getItem(cacheKey()) || localStorage.getItem("cb26");
    if (l) S = normalizeState(JSON.parse(l));
    else S = normalizeState({});
  } catch (e) {
    S = normalizeState({});
  }
}

function stats() {
  const R = {};
  Object.keys(D).forEach(k => (R[k] = { q: 0, a: 0 }));
  S.log.forEach(e => {
    if (R[e.d]) {
      R[e.d].q += e.q;
      R[e.d].a += e.a;
    }
  });
  return R;
}

function est(R) {
  let avgQ = 0, avgA = 0;
  Object.keys(R).forEach(k => { avgQ += R[k].q; avgA += R[k].a; });
  const av = avgQ ? avgA / avgQ : 0;
  let hg = 0, he = 0, n = 0;
  Object.keys(D).forEach(k => {
    const r = R[k].q ? R[k].a / R[k].q : av;
    if (R[k].q) n++;
    const h = r * D[k].q;
    D[k].g ? (hg += h) : (he += h);
  });
  return { f: ((hg / 30) * 10 + 2 * ((he / 40) * 10)) / 3, hg, he, n };
}

function computeSummary() {
  const R = stats();
  const E = est(R);
  const tq = Object.values(R).reduce((s, x) => s + x.q, 0);
  const ta = Object.values(R).reduce((s, x) => s + x.a, 0);
  const doneCount = Object.keys(S.done).length;
  return {
    dias_concluidos: doneCount,
    questoes_feitas: tq,
    acerto_geral: tq ? Number(((ta / tq) * 100).toFixed(1)) : 0,
    nota_estimada: tq ? Number(E.f.toFixed(2)) : 0
  };
}

async function syncRankingNow() {
  const sum = computeSummary();
  await upsertRanking({
    apelido: (S.rank.alias || defaultAlias()).trim().slice(0, 30),
    avatar_url: S.rank.avatarUrl || null,
    ativo: Boolean(S.rank.active),
    ...sum
  });
}

async function pullCloud() {
  setStatus("sync", "Sincronizando...");
  try {
    const remote = await fetchUserState();
    if (remote) {
      S = normalizeState(remote);
      localStorage.setItem(cacheKey(), JSON.stringify(S));
      render();
    } else if (Object.keys(S.done).length || S.log.length || S.errors.length || S.start) {
      await upsertUserState(S);
    }
    await syncRankingNow();
    setStatus("ok", "Sincronizado na nuvem");
  } catch (e) {
    if (e.message === "UNAUTH") {
      showView(false);
      return;
    }
    setStatus("err", "Offline — usando cache local");
  }
}

let tm;
function save() {
  try { localStorage.setItem(cacheKey(), JSON.stringify(S)); } catch (e) {}
  clearTimeout(tm);
  tm = setTimeout(async () => {
    setStatus("sync", "Salvando...");
    try {
      await upsertUserState(S);
      await syncRankingNow();
      setStatus("ok", "Salvo na nuvem");
    } catch (e) {
      setStatus("err", "Erro ao salvar na nuvem (salvo local)");
    }
  }, 500);
}

// === RENDERIZAÇÃO GERAL ===
function render() {
  const st = S.start || iso(new Date());
  $("#st").value = st;
  const left = Math.ceil((EXAM - new Date(new Date().toDateString())) / 864e5);
  $("#cd").textContent = left;
  renderA(st);
  renderB();
  renderSim();
  renderErrors();
  renderC();
  renderRanking();
}

// === ABA A: CRONOGRAMA ===
function streak() {
  let n = 0;
  for (let i = 60; i >= 1; i--) {
    if (S.done[i]) n++;
    else if (n) break;
  }
  return n;
}

function renderA(st) {
  const today = iso(new Date());
  const done = Object.keys(S.done).length;
  let h = `<div class="kp">
    <div class="card"><b>${done}/60</b><span>dias concluídos</span></div>
    <div class="card"><b>${pct(done, 60)}%</b><span>do plano</span></div>
    <div class="card"><b>${streak()}</b><span>dias seguidos</span></div>
  </div><div class="leg">`;
  Object.keys(D).forEach(k => (h += `<i style="background:${D[k].c}">${esc(D[k].n)}</i>`));
  h += `<i style="background:#e5f5d8">Simulados e revisão</i></div><div class="grid">`;

  P.forEach((p, i) => {
    const dt = addD(st, i);
    const c = p.d ? D[p.d].c : p.s ? "#ffe0b8" : "#d8f0c4";
    const nm = p.d ? D[p.d].n : p.s ? "Simulado " + p.s : p.r == 2 ? "Véspera" : "Revisão";
    h += `<button class="day${S.done[i + 1] ? " done" : ""}${iso(dt) == today ? " now" : ""}" data-i="${i}">
      <div class="t" style="background:${c}"><span>Dia ${pad(i + 1)}</span><span>${fmt(dt)}</span></div>
      <div class="b"><b>${esc(nm)}</b><em>${esc(p.t)}</em></div>
    </button>`;
  });
  $("#a").innerHTML = h + "</div>";
  document.querySelectorAll(".day").forEach(b => (b.onclick = () => openDay(+b.dataset.i)));
}

function openDay(i) {
  const p = P[i];
  const e = S.log.find(x => x.src == "dia" + (i + 1)) || {};
  let h = `<h2 style="margin-top:0">Dia ${i + 1}: ${esc(p.d ? D[p.d].n : p.s ? "Simulado " + p.s : "Revisão")}</h2><p>${esc(p.t)}</p>`;
  if (p.d) {
    h += `<p>Roteiro sugerido: estudar o tópico (1h30), resolver 20 questões e revisar cada erro.</p>
    <div class="row">
      <div><label>Questões feitas</label><input type="number" min="0" id="dq" value="${e.q || ""}"></div>
      <div><label>Acertos</label><input type="number" min="0" id="da" value="${e.a || ""}"></div>
    </div>`;
  } else if (p.s) {
    h += `<p>Lance as notas por disciplina na aba Registro, em “Lançar simulado”.</p>`;
  }
  h += `<div class="row" style="margin-top:14px">
    <button class="btn ${S.done[i + 1] ? "" : "p"}" id="dd">${S.done[i + 1] ? "Desmarcar dia" : "Concluir dia ✓"}</button>
    <button class="btn" id="dc">Fechar</button>
  </div>`;
  $("#md").innerHTML = h;
  $("#ov").classList.add("on");
  $("#dc").onclick = () => $("#ov").classList.remove("on");
  $("#dd").onclick = () => {
    if (p.d) {
      const q = +$("#dq").value || 0;
      const a = Math.min(+$("#da").value || 0, q);
      S.log = S.log.filter(x => x.src != "dia" + (i + 1));
      if (q) {
        S.log.push({
          id: Date.now(),
          date: iso(addD(S.start || iso(new Date()), i)),
          d: p.d,
          q,
          a,
          src: "dia" + (i + 1)
        });
      }
    }
    if (S.done[i + 1]) delete S.done[i + 1];
    else S.done[i + 1] = 1;
    save();
    $("#ov").classList.remove("on");
    render();
  };
}

// === ABA B: DESEMPENHO ===
function renderB() {
  const R = stats(), E = est(R);
  const tq = Object.values(R).reduce((s, x) => s + x.q, 0);
  const ta = Object.values(R).reduce((s, x) => s + x.a, 0);
  const rows = Object.keys(D).map(k => {
    const r = R[k], p = pct(r.a, r.q), w = D[k].g ? 1 / 9 : 1 / 6;
    const gain = r.q ? D[k].q * (1 - r.a / r.q) * w : null;
    return { k, r, p, gain };
  });
  const order = rows.filter(x => x.gain !== null).sort((a, b) => b.gain - a.gain);

  let h = `<div class="kp">
    <div class="card"><b>${tq}</b><span>questões registradas</span></div>
    <div class="card"><b class="${cls(pct(ta, tq))}">${pct(ta, tq)}%</b><span>acerto geral</span></div>
    <div class="card"><b class="${E.f >= 6 ? "good" : "low"}">${tq ? E.f.toFixed(2).replace(".", ",") : "--"}</b><span>nota final estimada (mínimo 6,00)</span></div>
    <div class="card"><b>${E.n}/9</b><span>disciplinas com dados</span></div>
  </div>
  <p class="mut">A nota estimada usa o critério do edital: média ponderada (Gerais peso 1, Específicos peso 2), projetando a sua taxa de acerto em cada disciplina sobre o número de questões da prova. Disciplinas sem dados usam o seu acerto médio.</p>
  <h2>Por disciplina</h2>
  <div class="card table-wrap"><table><tr><th>Disciplina</th><th>Prova</th><th>Feitas</th><th>Acertos</th><th>%</th><th></th></tr>`;
  rows.forEach(x => {
    h += `<tr>
      <td><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${D[x.k].c}"></i> ${esc(D[x.k].n)}</td>
      <td>${D[x.k].q}q</td>
      <td>${x.r.q}</td>
      <td>${x.r.a}</td>
      <td class="${cls(x.p)}"><b>${x.r.q ? x.p + "%" : "--"}</b></td>
      <td><div class="bar"><div style="width:${x.p}%;background:${x.p >= 75 ? "#6cbf4a" : x.p >= 60 ? "#ff9a3c" : "#ef6a3a"}"></div></div></td>
    </tr>`;
  });
  h += `</table></div><h2>Prioridade de revisão</h2><div class="card">`;
  h += order.length
    ? `<p style="margin-top:0">Onde cada acerto a mais vale mais nota (peso na prova × erros):</p><ol>` +
      order.slice(0, 5).map(x => `<li><b>${esc(D[x.k].n)}</b>: ${x.p}% de acerto, potencial de +${x.gain.toFixed(2).replace(".", ",")} pontos</li>`).join("") +
      `</ol>`
    : "Registre questões para ver o ranking.";
  $("#b").innerHTML = h + "</div>";
}

// === ABA D: SIMULADOR DE NOTA ===
function initSimValues() {
  if (!S.sim) {
    const R = stats();
    S.sim = {};
    Object.keys(D).forEach(k => {
      const rate = R[k].q ? R[k].a / R[k].q : 0.6;
      S.sim[k] = Math.round(rate * D[k].q);
    });
  }
}

function calcSimScore(simObj) {
  let hg = 0, he = 0;
  Object.keys(D).forEach(k => {
    const val = Math.max(0, Math.min(D[k].q, Number(simObj[k]) || 0));
    D[k].g ? (hg += val) : (he += val);
  });
  const ng = (hg / 30) * 10;
  const ne = (he / 40) * 10;
  const nf = (ng + 2 * ne) / 3;
  return { hg, he, ng, ne, nf, aprovado: nf >= 6 && hg > 0 && he > 0 };
}

function renderSim() {
  initSimValues();
  const sc = calcSimScore(S.sim);
  let h = `<div class="kp">
    <div class="card"><b class="${sc.aprovado ? "good" : "low"}">${sc.nf.toFixed(2).replace(".", ",")}</b><span>nota final simulada (corte 6,00)</span></div>
    <div class="card"><b>${sc.hg}/30</b><span>Gerais (${sc.ng.toFixed(2).replace(".", ",")} pts · peso 1)</span></div>
    <div class="card"><b>${sc.he}/40</b><span>Específicos (${sc.ne.toFixed(2).replace(".", ",")} pts · peso 2)</span></div>
    <div class="card"><b class="${sc.aprovado ? "good" : "low"}">${sc.aprovado ? "Aprovado" : "Abaixo do corte"}</b><span>status no critério mínimo</span></div>
  </div>
  <div class="card" style="margin-top:12px">
    <div class="row" style="align-items:center;justify-content:space-between">
      <h2 style="margin:0">Simular acertos na prova (70 questões)</h2>
      <div style="flex:0 0 auto;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm" id="simFromReal">Puxar meu % atual</button>
        <button class="btn sm" id="sim60">Cenário 60%</button>
        <button class="btn sm" id="sim80">Cenário 80%</button>
      </div>
    </div>
    <p class="mut">Arraste os controles para testar quanto cada acerto adicional pesa na nota ponderada: <b>NF = (Gerais + 2 × Específicos) / 3</b>.</p>
    <div class="table-wrap"><table>
      <tr><th>Disciplina</th><th>Bloco</th><th>Peso/questão</th><th>Acertos simulados</th><th>%</th></tr>`;

  Object.keys(D).forEach(k => {
    const val = S.sim[k] ?? 0;
    const p = pct(val, D[k].q);
    const pesoQ = D[k].g ? (10 / 90) : (20 / 120);
    h += `<tr>
      <td><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${D[k].c}"></i> ${esc(D[k].n)}</td>
      <td>${D[k].g ? "Gerais (p.1)" : "Específicos (p.2)"}</td>
      <td>+${pesoQ.toFixed(2).replace(".", ",")} pt</td>
      <td style="min-width:190px">
        <div style="display:flex;align-items:center;gap:8px">
          <input type="range" min="0" max="${D[k].q}" value="${val}" data-simk="${k}">
          <b style="min-width:44px;text-align:right">${val}/${D[k].q}</b>
        </div>
      </td>
      <td class="${cls(p)}"><b>${p}%</b></td>
    </tr>`;
  });

  h += `</table></div></div>`;
  $("#d").innerHTML = h;

  document.querySelectorAll("[data-simk]").forEach(inp => {
    inp.oninput = () => {
      S.sim[inp.dataset.simk] = Number(inp.value);
      save();
      renderSim();
    };
  });

  $("#simFromReal").onclick = () => {
    const R = stats();
    Object.keys(D).forEach(k => {
      const rate = R[k].q ? R[k].a / R[k].q : 0.6;
      S.sim[k] = Math.round(rate * D[k].q);
    });
    save();
    renderSim();
  };
  $("#sim60").onclick = () => {
    Object.keys(D).forEach(k => (S.sim[k] = Math.ceil(0.6 * D[k].q)));
    save();
    renderSim();
  };
  $("#sim80").onclick = () => {
    Object.keys(D).forEach(k => (S.sim[k] = Math.round(0.8 * D[k].q)));
    save();
    renderSim();
  };
}

// === ABA E: ERROS & REVISÕES ===
function renderErrors() {
  const totalErr = S.errors.length;
  const pendErr = S.errors.filter(x => !x.reviewedCount).length;
  const revErr = totalErr - pendErr;

  const filtered = S.errors.slice().reverse().filter(item => {
    if (errFilter === "pending") return !item.reviewedCount;
    if (errFilter !== "all") return item.d === errFilter;
    return true;
  });

  let h = `<div class="kp">
    <div class="card"><b>${totalErr}</b><span>erros catalogados</span></div>
    <div class="card"><b class="${pendErr ? "mid" : "good"}">${pendErr}</b><span>pendentes de revisão</span></div>
    <div class="card"><b class="good">${revErr}</b><span>já revisados</span></div>
  </div>

  <div class="card" style="margin-top:12px">
    <h2 style="margin-top:0">Registrar erro ou ponto de atenção</h2>
    <div class="row">
      <div>
        <label>Disciplina</label>
        <select id="ed">${Object.keys(D).map(k => `<option value="${k}">${esc(D[k].n)}</option>`).join("")}</select>
      </div>
      <div>
        <label>Motivo do erro</label>
        <select id="er">
          <option value="Falta de teoria">Falta de teoria</option>
          <option value="Pegadinha da banca (FCC)">Pegadinha da banca (FCC)</option>
          <option value="Falta de atenção / conta">Falta de atenção / conta</option>
          <option value="Lei / Resolução / Prazo">Lei / Resolução / Prazo</option>
        </select>
      </div>
      <div>
        <label>Tópico do edital</label>
        <select id="et"></select>
      </div>
    </div>
    <label>Resumo do erro e regra correta (para revisar depois)</label>
    <textarea id="en" rows="2" placeholder="Ex.: Confundi atribuição do CMN com a do Banco Central na fixação da meta de inflação vs. execução..."></textarea>
    <p><button class="btn p" id="eb">Salvar no caderno de erros</button></p>
  </div>

  <div class="row" style="align-items:center;justify-content:space-between;margin-top:14px">
    <h2 style="margin:0">Caderno de Erros (${filtered.length})</h2>
    <div style="flex:0 0 auto">
      <select id="efilter">
        <option value="all"${errFilter === "all" ? " selected" : ""}>Todos os registros</option>
        <option value="pending"${errFilter === "pending" ? " selected" : ""}>Somente pendentes de revisão</option>
        ${Object.keys(D).map(k => `<option value="${k}"${errFilter === k ? " selected" : ""}>${esc(D[k].n)}</option>`).join("")}
      </select>
    </div>
  </div>`;

  if (!filtered.length) {
    h += `<div class="card" style="margin-top:8px"><p class="mut" style="margin:0">Nenhum erro encontrado neste filtro.</p></div>`;
  } else {
    h += `<div style="margin-top:8px">`;
    filtered.forEach(item => {
      const dObj = D[item.d] || { n: item.d, c: "#ccc" };
      const isRev = (item.reviewedCount || 0) > 0;
      h += `<div class="err-item ${isRev ? "rev" : "pend"}">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
          <div>
            <span class="badge" style="background:${dObj.c};color:#1d3318">${esc(dObj.n)}</span>
            <span class="badge warn">${esc(item.reason)}</span>
            <span class="mut"> · ${esc((item.date || "").split("-").reverse().join("/"))}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <span class="mut">${isRev ? `Revisado ${item.reviewedCount}x` : "Não revisado"}</span>
            <button class="btn sm ${isRev ? "" : "p"}" data-rev="${item.id}">${isRev ? "+1 Revisão ✓" : "Marcar revisado ✓"}</button>
            <button class="btn sm danger" data-delerr="${item.id}">✕</button>
          </div>
        </div>
        <div style="margin-top:6px;font-weight:600">${esc(item.topic || "")}</div>
        <div style="margin-top:4px;font-size:14px">${esc(item.note || "")}</div>
      </div>`;
    });
    h += `</div>`;
  }

  $("#e").innerHTML = h;

  const populateTopics = () => {
    const k = $("#ed").value;
    const topics = T[k] || [];
    $("#et").innerHTML = topics.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("") + `<option value="Outro / Simulado geral">Outro / Simulado geral</option>`;
  };
  populateTopics();
  $("#ed").onchange = populateTopics;

  $("#eb").onclick = () => {
    const note = ($("#en").value || "").trim();
    if (!note) {
      alert("Escreva uma breve anotação sobre o erro para facilitar sua revisão.");
      return;
    }
    S.errors.push({
      id: Date.now(),
      date: iso(new Date()),
      d: $("#ed").value,
      topic: $("#et").value,
      reason: $("#er").value,
      note,
      reviewedCount: 0,
      lastReviewed: ""
    });
    save();
    renderErrors();
  };

  $("#efilter").onchange = e => {
    errFilter = e.target.value;
    renderErrors();
  };

  document.querySelectorAll("[data-rev]").forEach(btn => {
    btn.onclick = () => {
      const id = String(btn.dataset.rev);
      const item = S.errors.find(x => String(x.id) === id);
      if (item) {
        item.reviewedCount = (item.reviewedCount || 0) + 1;
        item.lastReviewed = iso(new Date());
        save();
        renderErrors();
      }
    };
  });

  document.querySelectorAll("[data-delerr]").forEach(btn => {
    btn.onclick = () => {
      const id = String(btn.dataset.delerr);
      S.errors = S.errors.filter(x => String(x.id) !== id);
      save();
      renderErrors();
    };
  });
}

// === ABA C: REGISTRO ===
function renderC() {
  let h = `<div class="card"><h2 style="margin-top:0">Registrar questões</h2>
    <div class="row">
      <div><label>Data</label><input type="date" id="rd" value="${iso(new Date())}"></div>
      <div><label>Disciplina</label><select id="rs">${Object.keys(D).map(k => `<option value="${k}">${esc(D[k].n)}</option>`).join("")}</select></div>
      <div><label>Feitas</label><input type="number" min="0" id="rq"></div>
      <div><label>Acertos</label><input type="number" min="0" id="ra"></div>
    </div>
    <p><button class="btn p" id="rb">Adicionar</button></p>
  </div>
  <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Lançar simulado</h2>
    <label>Qual simulado</label>
    <select id="sn"><option>1</option><option>2</option><option>3</option><option>4</option></select>
    <div class="sim">${Object.keys(D).map(k => `<div><label>${esc(D[k].n)} (de ${D[k].q})</label><input type="number" min="0" max="${D[k].q}" data-k="${k}" class="sa"></div>`).join("")}</div>
    <p><button class="btn o" id="sb">Lançar simulado</button></p>
  </div>
  <h2>Histórico</h2>
  <div class="card table-wrap"><table><tr><th>Data</th><th>Disciplina</th><th>Origem</th><th>Acertos</th><th></th></tr>`;
  S.log.slice().reverse().forEach(e => {
    h += `<tr>
      <td>${esc(e.date.split("-").reverse().join("/"))}</td>
      <td>${esc(D[e.d] ? D[e.d].n : e.d)}</td>
      <td>${esc(e.src || "avulso")}</td>
      <td>${e.a}/${e.q} (${pct(e.a, e.q)}%)</td>
      <td><button class="btn sm" data-x="${e.id}">✕</button></td>
    </tr>`;
  });
  h += `</table></div>
  <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Backup manual (JSON)</h2>
    <p class="mut">Seus dados já sincronizam automaticamente na nuvem. Use o campo abaixo apenas se quiser exportar ou restaurar um backup manual.</p>
    <textarea id="bk" rows="3">${esc(JSON.stringify(S))}</textarea>
    <p><button class="btn" id="br">Restaurar backup</button></p>
  </div>`;
  $("#c").innerHTML = h;

  $("#rb").onclick = () => {
    const q = +$("#rq").value || 0;
    const a = Math.min(+$("#ra").value || 0, q);
    if (!q) return;
    S.log.push({ id: Date.now(), date: $("#rd").value || iso(new Date()), d: $("#rs").value, q, a, src: "avulso" });
    save();
    render();
  };
  $("#sb").onclick = () => {
    const n = $("#sn").value;
    document.querySelectorAll(".sa").forEach(i => {
      if (i.value !== "") {
        const k = i.dataset.k;
        S.log = S.log.filter(x => !(x.src == "simulado " + n && x.d == k));
        S.log.push({ id: Date.now() + Math.random(), date: iso(new Date()), d: k, q: D[k].q, a: Math.min(+i.value, D[k].q), src: "simulado " + n });
      }
    });
    save();
    render();
  };
  document.querySelectorAll("[data-x]").forEach(b => (b.onclick = () => {
    S.log = S.log.filter(x => String(x.id) !== b.dataset.x);
    save();
    render();
  }));
  $("#br").onclick = () => {
    try {
      const o = JSON.parse($("#bk").value);
      if (o && Array.isArray(o.log)) {
        S = normalizeState(o);
        save();
        render();
      }
    } catch (e) {
      alert("Backup inválido");
    }
  };
}

// === ABA F: RANKING DOS AMIGOS & EDITAR PERFIL ===
async function refreshRanking() {
  try {
    await syncRankingNow();
    rankingCache = await fetchRankingList();
    renderRanking();
  } catch (e) {
    // mantém cache atual
  }
}

function renderRanking() {
  const auth = getAuth();
  const myId = auth?.user?.id;
  const currentAlias = S.rank.alias || defaultAlias();
  const list = rankingCache.filter(r => r.ativo || r.user_id === myId).slice();

  list.sort((a, b) => {
    if (rankSort === "questoes") return (b.questoes_feitas - a.questoes_feitas) || (b.nota_estimada - a.nota_estimada);
    if (rankSort === "dias") return (b.dias_concluidos - a.dias_concluidos) || (b.questoes_feitas - a.questoes_feitas);
    if (rankSort === "acerto") return (b.acerto_geral - a.acerto_geral) || (b.questoes_feitas - a.questoes_feitas);
    return (b.nota_estimada - a.nota_estimada) || (b.questoes_feitas - a.questoes_feitas);
  });

  let h = `<div class="card">
    <h2 style="margin-top:0">Editar perfil do ranking</h2>
    <div class="prof-box">
      <div class="av-wrap">
        <div id="avPreview">${renderAvatarHtml(S.rank.avatarUrl, currentAlias)}</div>
        <div>
          <label for="ravfile" style="margin-top:0">Foto de perfil (JPG, PNG ou WEBP)</label>
          <input type="file" id="ravfile" accept="image/jpeg,image/png,image/webp">
          <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${S.rank.avatarUrl ? `<button type="button" class="btn sm danger" id="ravremove">Remover foto</button>` : ""}
            <span class="mut" id="ravstatus"></span>
          </div>
        </div>
      </div>

      <div style="flex:1;min-width:220px">
        <label for="ralias" style="margin-top:0">Apelido no ranking</label>
        <input type="text" id="ralias" maxlength="30" value="${esc(currentAlias)}">
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
          <input type="checkbox" id="ractive" ${S.rank.active ? "checked" : ""}>
          <label for="ractive" style="margin:0;cursor:pointer">Participar do ranking dos amigos</label>
        </div>
      </div>

      <div style="flex:0 0 auto">
        <button class="btn p" id="rsave">Salvar perfil</button>
      </div>
    </div>
  </div>

  <div class="row" style="align-items:center;justify-content:space-between;margin-top:14px">
    <h2 style="margin:0">Placar do grupo (${list.length})</h2>
    <div style="flex:0 0 auto">
      <select id="rsort">
        <option value="nota"${rankSort === "nota" ? " selected" : ""}>Ordenar por Nota Estimada</option>
        <option value="questoes"${rankSort === "questoes" ? " selected" : ""}>Ordenar por Questões Feitas</option>
        <option value="dias"${rankSort === "dias" ? " selected" : ""}>Ordenar por Dias Concluídos</option>
        <option value="acerto"${rankSort === "acerto" ? " selected" : ""}>Ordenar por % de Acerto</option>
      </select>
    </div>
  </div>

  <div class="card table-wrap" style="margin-top:8px">`;

  if (!list.length) {
    h += `<p class="mut" style="margin:0">Nenhum participante no placar ainda. Clique em "Salvar perfil" para aparecer aqui.</p>`;
  } else {
    h += `<table>
      <tr><th>#</th><th>Participante</th><th>Nota Est.</th><th>Questões</th><th>Acerto</th><th>Dias</th><th>Atualizado</th></tr>`;
    list.forEach((r, idx) => {
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `${idx + 1}º`;
      const isMe = r.user_id === myId;
      const dt = r.atualizado_em ? new Date(r.atualizado_em).toLocaleDateString("pt-BR") : "--";
      const displayName = r.apelido || "Concurseiro";
      h += `<tr class="${isMe ? "rank-me" : ""}">
        <td><b>${medal}</b></td>
        <td>
          <div class="user-cell">
            ${renderAvatarHtml(r.avatar_url, displayName, "sm")}
            <span>${esc(displayName)}${isMe ? " <span class='badge'>você</span>" : ""}${!r.ativo ? " <span class='badge warn'>oculto</span>" : ""}</span>
          </div>
        </td>
        <td class="${Number(r.nota_estimada) >= 6 ? "good" : "low"}"><b>${Number(r.nota_estimada).toFixed(2).replace(".", ",")}</b></td>
        <td>${r.questoes_feitas}</td>
        <td>${Number(r.acerto_geral).toFixed(1).replace(".", ",")}%</td>
        <td>${r.dias_concluidos}/60</td>
        <td class="mut">${dt}</td>
      </tr>`;
    });
    h += `</table>`;
  }
  h += `</div>`;
  $("#f").innerHTML = h;

  $("#ravfile").onchange = async ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      $("#ravstatus").textContent = "Escolha uma imagem de até 4 MB.";
      return;
    }
    try {
      $("#ravstatus").textContent = "Enviando foto...";
      const { blob, mimeType } = await compressImageFile(file, 256, 0.82);
      const url = await uploadAvatarBlob(blob, mimeType);
      S.rank.avatarUrl = url;
      S.rank.alias = ($("#ralias").value || "").trim() || defaultAlias();
      save();
      await refreshRanking();
      $("#ravstatus").textContent = "Foto atualizada!";
    } catch (err) {
      $("#ravstatus").textContent = err.message || "Erro ao enviar foto.";
    }
  };

  const rmBtn = $("#ravremove");
  if (rmBtn) {
    rmBtn.onclick = async () => {
      S.rank.avatarUrl = "";
      save();
      await refreshRanking();
    };
  }

  $("#rsave").onclick = async () => {
    S.rank.alias = ($("#ralias").value || "").trim() || defaultAlias();
    S.rank.active = $("#ractive").checked;
    save();
    await refreshRanking();
  };

  $("#rsort").onchange = e => {
    rankSort = e.target.value;
    renderRanking();
  };
}

// === MANIFEST PWA ===
(function setupPWA() {
  const iconSvg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#6cbf4a"/><circle cx="64" cy="66" r="34" fill="#ff9a3c"/><path d="M64 20c10 0 16 6 16 12-6 2-12 1-16-4-4 5-10 6-16 4 0-6 6-12 16-12z" fill="#e5f5d8"/></svg>`);
  const lnk = document.createElement("link");
  lnk.rel = "icon";
  lnk.href = "data:image/svg+xml," + iconSvg;
  document.head.appendChild(lnk);

  const manifest = {
    name: "Cronograma Banestes 2026",
    short_name: "Banestes 2026",
    start_url: ".",
    display: "standalone",
    background_color: "#f4fbee",
    theme_color: "#6cbf4a",
    icons: [{ src: "data:image/svg+xml," + iconSvg, sizes: "128x128", type: "image/svg+xml", purpose: "any" }]
  };
  const mLink = document.createElement("link");
  mLink.rel = "manifest";
  mLink.href = "data:application/manifest+json," + encodeURIComponent(JSON.stringify(manifest));
  document.head.appendChild(mLink);
})();

// === NAVEGAÇÃO E EVENTOS GLOBAIS ===
const TABS = ["a", "b", "d", "e", "c", "f"];
document.querySelectorAll("#navTabs button").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll("#navTabs button").forEach(x => x.classList.toggle("on", x === b));
    TABS.forEach(t => $("#" + t).classList.toggle("hide", t !== b.dataset.t));
    if (b.dataset.t === "f") refreshRanking();
  };
});

$("#st").onchange = e => {
  S.start = e.target.value;
  save();
  render();
};

$("#spull").onclick = async () => {
  await pullCloud();
  await refreshRanking();
};

$("#ov").onclick = e => {
  if (e.target.id == "ov") $("#ov").classList.remove("on");
};

$("#btnLogin").onclick = async () => {
  const email = $("#aemail").value.trim(), pass = $("#apass").value;
  if (!email || !pass) {
    showAuthMsg("Preencha e-mail e senha.", true);
    return;
  }
  try {
    showAuthMsg("Entrando...", false);
    await authLogin(email, pass);
    loadLocal();
    showView(true);
    render();
    await pullCloud();
    await refreshRanking();
  } catch (e) {
    showAuthMsg(e.message, true);
  }
};

$("#btnSignup").onclick = async () => {
  const email = $("#aemail").value.trim(), pass = $("#apass").value;
  if (!email || pass.length < 6) {
    showAuthMsg("Informe um e-mail válido e senha com at least 6 caracteres.", true);
    return;
  }
  try {
    showAuthMsg("Criando conta...", false);
    const res = await authSignup(email, pass);
    if (res.logged) {
      loadLocal();
      showView(true);
      render();
      await pullCloud();
      await refreshRanking();
    } else {
      showAuthMsg("Conta criada! Verifique seu e-mail para confirmar o cadastro e depois clique em Entrar.", false);
    }
  } catch (e) {
    showAuthMsg(e.message, true);
  }
};

$("#btnLogout").onclick = () => {
  clearSession();
  showView(false);
};

// === BOOT ===
(async function init() {
  const left = Math.ceil((EXAM - new Date(new Date().toDateString())) / 864e5);
  $("#cd").textContent = left;
  const auth = loadSavedSession();
  if (auth && auth.access_token) {
    loadLocal();
    showView(true);
    render();
    await pullCloud();
    await refreshRanking();
  } else {
    showView(false);
  }
})();
