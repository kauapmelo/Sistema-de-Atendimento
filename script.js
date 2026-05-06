/* ═══════════════════════════════════════════════════
    LEXCALL — Lógica da Aplicação (script.js)
   ═══════════════════════════════════════════════════ */

/* ─────────────────────────────────────────
   CONFIGURAÇÃO FIXA DO FIREBASE
   Substitua os valores abaixo pelos seus dados 
   que você copiou do Firebase Console
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

function initFirebase() {
  try {
    // Evita inicializar o Firebase múltiplas vezes
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    
    db = firebase.firestore();
    startListeners();
    
    console.log("✓ LexCall conectado ao Firebase.");
    // Opcional: esconde o botão de config se quiser que o usuário não mexa
    // document.querySelector('button[onclick="showView(\'config\')"]').style.display = 'none';
  } catch (err) {
    console.error('Erro ao conectar ao Firebase:', err);
    showToast('Erro de conexão. Verifique o script.js', true);
  }
}

/* ═══════════════════════════════════════════════════
   NAVEGAÇÃO — TROCA DE TELAS
   ═══════════════════════════════════════════════════ */

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));

  const targetView = document.getElementById('view-' + id);
  if (targetView) targetView.classList.add('active');

  // Mapeamento dos botões (Recepção=0, Advogado=1, Monitor=2, Config=3)
  const btns = document.querySelectorAll('nav button');
  if (id === 'reception') btns[0].classList.add('active');
  if (id === 'lawyer')    btns[1].classList.add('active');
  if (id === 'monitor')   btns[2].classList.add('active');
  if (id === 'config')    btns[3].classList.add('active');
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

function renderReceptionList(snap) {
  const list = document.getElementById('reception-list');
  const docs = snap.docs;
  document.getElementById('rec-count').textContent = docs.length;

  if (docs.length === 0) {
    list.innerHTML = `<div class="empty">Nenhum cliente hoje.</div>`;
    return;
  }

  list.innerHTML = '';
  docs.forEach(doc => {
    const d = doc.data();
    const called = d.status === 'chamado';
    const wait = formatWaitTime(d.timestamp);

    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="client-info">
        <div class="client-name">${escHtml(d.nome)}</div>
        <div class="client-meta">👤 ${escHtml(d.advogado)} · ⏱ ${wait.text}</div>
      </div>
      <span class="badge ${called ? 'badge-called' : 'badge-waiting'}">
        ${called ? 'Chamado' : 'Aguardando'}
      </span>`;
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
    .where('advogado', '==', name)
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => renderLawyerList(snap));
}

function renderLawyerList(snap) {
  const list = document.getElementById('lawyer-list');
  const docs = snap.docs;
  document.getElementById('lawyer-count').textContent = docs.length;

  if (docs.length === 0) {
    list.innerHTML = `<div class="empty">Fila vazia.</div>`;
    return;
  }

  list.innerHTML = '';
  docs.forEach((doc, i) => {
    const d = doc.data();
    const called = d.status === 'chamado';
    
    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="pos-num">${i + 1}</div>
      <div class="client-info">
        <div class="client-name">${escHtml(d.nome)}</div>
        <div class="client-meta">${called ? '📢 Já chamado' : '⏱ Aguardando'}</div>
      </div>
      <button class="btn btn-call" onclick="callClient('${doc.id}', '${escAttr(d.nome)}')" ${called ? 'disabled' : ''}>
        ${called ? 'Chamado' : '📢 Chamar'}
      </button>`;
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
    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="client-info">
        <div class="client-name">📢 ${escHtml(d.nome)}</div>
        <div class="client-meta">Ir para: <strong>${escHtml(d.advogado)}</strong></div>
      </div>`;
    list.appendChild(row);
  });
}

function checkForNewCalls(snap) {
  snap.docChanges().forEach(change => {
    if (change.type === 'added' || change.type === 'modified') {
      const data = change.doc.data();
      if (data.status === 'chamado' && data.notificado === false) {
        popupQueue.push({ id: change.doc.id, nome: data.nome, advogado: data.advogado });
        processPopupQueue();
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
  document.getElementById('popup-name').textContent = nome;
  document.getElementById('popup-lawyer').textContent = advogado;
  document.getElementById('popup-overlay').classList.add('show');

  const fill = document.getElementById('popup-timer-fill');
  fill.style.width = '100%';

  let start = Date.now();
  clearInterval(popupTimer);
  popupTimer = setInterval(() => {
    let elapsed = Date.now() - start;
    let pct = Math.max(0, 100 - (elapsed / 5000) * 100);
    fill.style.width = pct + '%';
    if (elapsed >= 5000) closePopup();
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
    });

  unsubMonitor = db.collection('clientes')
    .where('status', '==', 'chamado')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      renderMonitorList(snap);
      checkForNewCalls(snap);
    });
}

function formatWaitTime(ts) {
  if (!ts) return { text: '--', long: false };
  const diff = Math.floor((Date.now() - ts.toMillis()) / 1000);
  if (diff < 60) return { text: 'agora', long: false };
  const min = Math.floor(diff / 60);
  return { text: min + 'min', long: min > 30 };
}

function escHtml(s) {
  const t = document.createElement('textarea');
  t.textContent = s;
  return t.innerHTML;
}

function escAttr(s) {
  return s.replace(/'/g, "\\'");
}

function showToast(msg, error = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = error ? '#e05252' : '#181c27';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// INICIALIZAÇÃO
document.getElementById('inp-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') addClient();
});

window.onload = initFirebase;