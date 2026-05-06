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

window.telaAtivaAtual = 'reception';

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
  window.telaAtivaAtual = id;

  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + id).classList.add('active');
  // Remove 'active' de todas as telas
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  
  // Remove 'active' de todos os botões da navegação
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));

  // Ativa a tela solicitada
  const targetView = document.getElementById('view-' + id);
  if (targetView) {
    targetView.classList.add('active');
  }

  // Identifica qual botão ativar baseado na função chamada
  // Isso garante que o destaque visual funcione mesmo sem o botão de config
  const btns = document.querySelectorAll('nav button');
  if (id === 'reception' && btns[0]) btns[0].classList.add('active');
  if (id === 'lawyer'    && btns[1]) btns[1].classList.add('active');
  if (id === 'monitor'   && btns[2]) btns[2].classList.add('active');
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
  // 1. Interface visual: destaca o card selecionado
  document.querySelectorAll('.lawyer-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  currentLawyer = name;

  // 2. Prepara a tela
  document.getElementById('lawyer-queue').style.display = 'block';
  document.getElementById('lawyer-queue-title').textContent = `Fila — ${name}`;

  // 3. LIMPEZA CRÍTICA: Cancela a escuta anterior antes de começar uma nova
  // Isso evita que nomes de um advogado "vazem" para a tela de outro
  if (unsubLawyer) {
    unsubLawyer(); 
  }

  // 4. CONSULTA FILTRADA: Busca no Firebase APENAS onde o advogado é igual ao selecionado
  unsubLawyer = db.collection('clientes')
    .where('advogado', '==', name) // Filtro rigoroso pelo nome do advogado
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      renderLawyerList(snap);
    }, err => {
      console.error("Erro ao carregar fila específica:", err);
    });
}

function renderLawyerList(snap) {
  const list = document.getElementById('lawyer-list');
  const docs = snap.docs;
  
  // Atualiza o contador apenas com os clientes desse advogado
  document.getElementById('lawyer-count').textContent = docs.length;

  if (docs.length === 0) {
    list.innerHTML = `<div class="empty">Nenhum cliente na sua fila.</div>`;
    return;
  }

  list.innerHTML = '';
  docs.forEach((doc, i) => {
    const d = doc.data();
    
    // Verificação extra de segurança no código (Double Check)
    if (d.advogado !== currentLawyer) return;

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
  // BLOQUEIO DEFINITIVO: Se a variável diz que estamos no advogado, cancela tudo.
  if (window.telaAtivaAtual === 'lawyer') {
    return; // O código morre aqui. Nenhum popup vai para a fila.
  }

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
  // VERIFICAÇÃO DE SEGURANÇA: 
  // Se a tela do Advogado estiver ativa, cancelamos a exibição do popup aqui.
  const lawyerView = document.getElementById('view-lawyer');
  if (lawyerView && lawyerView.classList.contains('active')) {
    console.log("Popup bloqueado: Usuário está na tela do advogado.");
    return; 
  }

  // Se passou pela trava, exibe o popup normalmente:
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

  // Marca como notificado no banco para não repetir
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
  // Listener da Recepção (Lista Geral)
  unsubReception = db.collection('clientes')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      renderReceptionList(snap);
      updateStats(snap);
    }, err => console.error("Erro na Recepção:", err));

  // Listener do Monitor (Apenas chamados) - Removido o orderBy para evitar erro de índice
  unsubMonitor = db.collection('clientes')
    .where('status', '==', 'chamado')
    .onSnapshot(snap => {
      renderMonitorList(snap);
      checkForNewCalls(snap);
    }, err => console.error("Erro no Monitor:", err));
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