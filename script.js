/* ═══════════════════════════════════════════════════
   LEXCALL — Lógica da Aplicação
   script.js
   ═══════════════════════════════════════════════════ */

/* ─────────────────────────────────────────
   CONFIGURAÇÃO DO FIREBASE
───────────────────────────────────────── */

const firebaseConfig = {
  apiKey: "AIzaSyAD60g-LUTuhdIKTI6Khg9FciFT08UGZEA",
  authDomain: "sistema-de-atendimento-d2430.firebaseapp.com",
  projectId: "sistema-de-atendimento-d2430",
  storageBucket: "sistema-de-atendimento-d2430.firebasestorage.app",
  messagingSenderId: "426359681494",
  appId: "1:426359681494:web:90ab35cea70e8cc345f477",
  measurementId: "G-4H0XYXTZCM"
};

/* ─────────────────────────────────────────
   ESTADO GLOBAL
───────────────────────────────────────── */
let db = null;
let currentLawyer = null;
let popupTimer = null;
let popupQueue = [];

let unsubReception = null;
let unsubLawyer = null;
let unsubMonitor = null;

/* ═══════════════════════════════════════════════════
   FIREBASE — INICIALIZAÇÃO AUTOMÁTICA
   ═══════════════════════════════════════════════════ */

window.telaAtivaAtual = 'reception';

function initFirebase() {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
    startListeners();
    console.log("✓ LexCall conectado ao Firebase.");
  } catch (err) {
    console.error('Erro ao conectar ao Firebase:', err);
    showToast('Erro de conexão. Verifique o script.js', true);
  }
}

/* ═══════════════════════════════════════════════════
   NAVEGAÇÃO — TROCA DE TELAS
   ═══════════════════════════════════════════════════ */

function showView(id) {
  window.telaAtivaAtual = id;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));

  const targetView = document.getElementById('view-' + id);
  if (targetView) targetView.classList.add('active');

  const btns = document.querySelectorAll('nav button');
  if (id === 'reception' && btns[0]) btns[0].classList.add('active');
  if (id === 'lawyer' && btns[1]) btns[1].classList.add('active');
  if (id === 'monitor' && btns[2]) btns[2].classList.add('active');
}

/* ═══════════════════════════════════════════════════
   TELA 1 — RECEPÇÃO
   ═══════════════════════════════════════════════════ */

async function addClient() {
  if (!db) { showToast('Firebase não conectado.', true); return; }

  const name = document.getElementById('inp-name').value.trim();
  const lawyer = document.getElementById('inp-lawyer').value;

  if (!name || !lawyer) {
    showToast('Preencha nome e advogado.', true);
    return;
  }

  try {
    await db.collection('clientes').add({
      nome: name,
      advogado: lawyer,
      status: 'aguardando',
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      notificado: false
    });
    document.getElementById('inp-name').value = '';
    showToast(`${name} adicionado!`);
  } catch (err) {
    showToast('Erro ao salvar no banco.', true);
  }
}

/* ─────────────────────────────────────────
   APAGAR CLIENTE INDIVIDUAL
───────────────────────────────────────── */

async function deleteClient(docId, nome) {
  if (!confirm(`Remover "${nome}" da lista?`)) return;
  try {
    await db.collection('clientes').doc(docId).delete();
    showToast(`${nome} removido.`);
  } catch (err) {
    showToast('Erro ao remover cliente.', true);
  }
}

/* ─────────────────────────────────────────
   APAGAR HISTÓRICO COMPLETO (RECEPÇÃO)
───────────────────────────────────────── */

async function clearAllClients() {
  if (!confirm('Apagar TODOS os clientes do histórico? Esta ação não pode ser desfeita.')) return;
  try {
    const snap = await db.collection('clientes').get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    showToast('Histórico apagado com sucesso.');
  } catch (err) {
    showToast('Erro ao apagar histórico.', true);
  }
}

/* ─────────────────────────────────────────
   APAGAR HISTÓRICO DO ADVOGADO SELECIONADO
───────────────────────────────────────── */

async function clearLawyerClients() {
  if (!currentLawyer) return;
  if (!confirm(`Apagar todos os clientes de ${currentLawyer}? Esta ação não pode ser desfeita.`)) return;
  try {
    const snap = await db.collection('clientes')
      .where('advogado', '==', currentLawyer)
      .get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    showToast(`Fila de ${currentLawyer} apagada.`);
  } catch (err) {
    showToast('Erro ao apagar fila.', true);
  }
}

/* ═══════════════════════════════════════════════════
   TELA 1 — RECEPÇÃO (ORDEM: AGUARDANDO PRIMEIRO)
   ═══════════════════════════════════════════════════ */

function renderReceptionList(snap) {
  const list = document.getElementById('reception-list');
  const docs = snap.docs;
  document.getElementById('rec-count').textContent = docs.length;

  if (docs.length === 0) {
    list.innerHTML = `<div class="empty">Nenhum cliente hoje.</div>`;
    return;
  }

  const sortedDocs = [...docs].sort((a, b) => {
    const statusA = a.data().status;
    const statusB = b.data().status;
    if (statusA === 'aguardando' && statusB === 'chamado') return -1;
    if (statusA === 'chamado' && statusB === 'aguardando') return 1;
    return 0;
  });

  list.innerHTML = '';

  sortedDocs.forEach(doc => {
    const d = doc.data();
    const called = d.status === 'chamado';
    const timeText = formatDateTime(d.timestamp);

    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="client-info">
        <div class="client-name">${escHtml(d.nome)}${called ? ' <span class="called-tag">(Chamado)</span>' : ''}</div>
        <div class="client-meta">👤 ${escHtml(d.advogado)} · 🕐 ${timeText}</div>
      </div>
      <span class="badge ${called ? 'badge-called' : 'badge-waiting'}">
        ${called ? 'Chamado' : 'Aguardando'}
      </span>
      <button class="btn-delete" title="Remover cliente">🗑</button>`;
    row.querySelector('.btn-delete').addEventListener('click', () => deleteClient(doc.id, d.nome));
    list.appendChild(row);
  });
}

function updateStats(snap) {
  const docs = snap.docs;
  const waiting = docs.filter(d => d.data().status === 'aguardando').length;
  const called = docs.filter(d => d.data().status === 'chamado').length;

  document.getElementById('stat-total').textContent = docs.length;
  document.getElementById('stat-waiting').textContent = waiting;
  document.getElementById('stat-called').textContent = called;
}

/* ═══════════════════════════════════════════════════
   TELA 2 — ADVOGADO
   ═══════════════════════════════════════════════════ */

function selectLawyer(name, el) {
  document.querySelectorAll('.lawyer-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  currentLawyer = name;

  document.getElementById('lawyer-queue').style.display = 'block';
  document.getElementById('lawyer-queue-title').textContent = `Fila — ${name}`;

  if (unsubLawyer) unsubLawyer();

  unsubLawyer = db.collection('clientes')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      renderLawyerList(snap);
    });
}

function renderLawyerList(snap) {
  const list = document.getElementById('lawyer-list');
  const docs = snap.docs || [];

  const meusClientes = docs.filter(doc => doc.data().advogado === currentLawyer);
  const aguardando = meusClientes.filter(doc => doc.data().status !== 'chamado');
  const chamados = meusClientes.filter(doc => doc.data().status === 'chamado');
  const listaFinal = [...aguardando, ...chamados];

  document.getElementById('lawyer-count').textContent = listaFinal.length;

  list.innerHTML = '';

  if (listaFinal.length === 0) {
    list.innerHTML = `<div class="empty">Nenhum cliente na sua fila.</div>`;
    return;
  }

  listaFinal.forEach((doc, i) => {
    const d = doc.data();
    const called = d.status === 'chamado';
    const timeText = formatDateTime(d.timestamp);

    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="pos-num">${i + 1}</div>
      <div class="client-info">
        <div class="client-name">${escHtml(d.nome)}</div>
        <div class="client-meta">${called ? '📢 Chamado' : '⏱ Aguardando'} · 🕐 ${timeText}</div>
      </div>
      <button class="btn btn-call" ${called ? 'disabled' : ''}>
        ${called ? 'Chamado' : '📢 Chamar'}
      </button>
      <button class="btn-delete" title="Remover cliente">🗑</button>`;
    if (!called) {
      row.querySelector('.btn-call').addEventListener('click', () => callClient(doc.id, d.nome));
    }
    row.querySelector('.btn-delete').addEventListener('click', () => deleteClient(doc.id, d.nome));
    list.appendChild(row);
  });
}

async function callClient(docId, nome) {
  try {
    await db.collection('clientes').doc(docId).update({
      status: 'chamado',
      notificado: false
    });
    showToast(`Chamando ${nome}...`);
  } catch (err) {
    showToast('Erro ao chamar.', true);
  }
}

/* ═══════════════════════════════════════════════════
   TELA 3 — MONITOR & POPUPS
   ═══════════════════════════════════════════════════ */

function renderMonitorList(snap) {
  const list = document.getElementById('monitor-list');
  const docs = snap.docs;

  if (docs.length === 0) {
    list.innerHTML = `<div class="empty">Nenhuma chamada.</div>`;
    return;
  }

  const sorted = [...docs].reverse();
  list.innerHTML = '';
  sorted.forEach(doc => {
    const d = doc.data();
    const timeText = formatDateTime(d.timestamp);
    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="client-info">
        <div class="client-name">📢 ${escHtml(d.nome)}</div>
        <div class="client-meta">Ir para: <strong>${escHtml(d.advogado)}</strong> · 🕐 ${timeText}</div>
      </div>`;
    list.appendChild(row);
  });
}

function checkForNewCalls(snap) {
  if (window.telaAtivaAtual === 'lawyer') return;

  snap.docChanges().forEach(change => {
    if (change.type === 'added' || change.type === 'modified') {
      const data = change.doc.data();

      if (data.status === 'chamado' && data.notificado === false) {
        const jaNaLista = popupQueue.some(p => p.id === change.doc.id);
        if (!jaNaLista) {
          popupQueue.push({
            id: change.doc.id,
            nome: data.nome,
            advogado: data.advogado
          });
          processPopupQueue();
        }
      }
    }
  });
}

function processPopupQueue() {
  if (popupQueue.length === 0) return;
  const overlay = document.getElementById('popup-overlay');
  if (overlay.classList.contains('show')) return;
  const next = popupQueue.shift();
  showPopup(next.nome, next.advogado, next.id);
}

function showPopup(nome, advogado, docId) {
  const lawyerView = document.getElementById('view-lawyer');
  if (lawyerView && lawyerView.classList.contains('active')) {
    console.log("Popup bloqueado: Usuário está na tela do advogado.");
    return;
  }

  document.getElementById('popup-name').textContent = nome;
  document.getElementById('popup-lawyer').textContent = advogado;
  document.getElementById('popup-overlay').classList.add('show');

  const fill = document.getElementById('popup-timer-fill');
  fill.style.width = '100%';

  let start = Date.now();
  clearInterval(popupTimer);
  popupTimer = setInterval(() => {
    let elapsed = Date.now() - start;
    let pct = Math.max(0, 100 - (elapsed / 15000) * 100);
    fill.style.width = pct + '%';
    if (elapsed >= 15000) closePopup();
  }, 100);

  db.collection('clientes').doc(docId).update({ notificado: true });
  document.getElementById('popup-ok').onclick = closePopup;
}

function closePopup() {
  clearInterval(popupTimer);
  document.getElementById('popup-overlay').classList.remove('show');
  setTimeout(processPopupQueue, 400);
}

/* ═══════════════════════════════════════════════════
   LISTENERS & UTILITÁRIOS
   ═══════════════════════════════════════════════════ */

function startListeners() {
  unsubReception = db.collection('clientes')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      renderReceptionList(snap);
      updateStats(snap);
    }, err => console.error("Erro na Recepção:", err));

  unsubMonitor = db.collection('clientes')
    .where('status', '==', 'chamado')
    .onSnapshot(snap => {
      renderMonitorList(snap);
      checkForNewCalls(snap);
    }, err => console.error("Erro no Monitor:", err));
}

/* ─────────────────────────────────────────
   FORMATA DATA E HORA DO TIMESTAMP
───────────────────────────────────────── */
function formatDateTime(ts) {
  if (!ts) return '--';
  try {
    const date = ts.toDate();
    const hoje = new Date();
    const isHoje =
      date.getDate() === hoje.getDate() &&
      date.getMonth() === hoje.getMonth() &&
      date.getFullYear() === hoje.getFullYear();

    const hora = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    if (isHoje) {
      return hora;
    } else {
      const dia = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return `${dia} ${hora}`;
    }
  } catch {
    return '--';
  }
}

function escHtml(s) {
  const t = document.createElement('textarea');
  t.textContent = s;
  return t.innerHTML;
}

function showToast(msg, error = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = error ? '#c0392b' : '#6b1a1a';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

/* ─────────────────────────────────────────
   INICIALIZAÇÃO
───────────────────────────────────────── */
document.getElementById('inp-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') addClient();
});

initFirebase();