/* ═══════════════════════════════════════════════════
   LEXCALL — Lógica da Aplicação
   app.js
   ═══════════════════════════════════════════════════ */


/* ─────────────────────────────────────────
   ESTADO GLOBAL
───────────────────────────────────────── */

let db          = null;   // Instância do Firestore
let currentLawyer = null; // Advogado selecionado na tela 2
let popupTimer  = null;   // Intervalo do timer do popup
let popupQueue  = [];     // Fila de popups pendentes

// Funções de cancelamento dos listeners do Firestore
let unsubReception = null;
let unsubLawyer    = null;
let unsubMonitor   = null;


/* ═══════════════════════════════════════════════════
   FIREBASE — INICIALIZAÇÃO E CONFIGURAÇÃO
   ═══════════════════════════════════════════════════ */

/**
 * Inicializa o Firebase usando a configuração salva no localStorage.
 * Chamado ao carregar a página e ao salvar nova configuração.
 */
function initFirebase() {
  const cfg = loadConfig();
  if (!cfg) return;

  // Remove instância anterior se existir
  if (window._fbApp) {
    try { window._fbApp.delete(); } catch (e) { /* ignorado */ }
  }

  try {
    // Usa sufixo de timestamp para evitar conflito de nomes
    window._fbApp = firebase.initializeApp(cfg, 'lexcall-' + Date.now());
    db = firebase.firestore(window._fbApp);

    startListeners();
    document.getElementById('cfg-status').textContent = '✓ Conectado ao Firebase.';
    showToast('Firebase conectado!');
  } catch (err) {
    console.error('Erro ao inicializar Firebase:', err);
    showToast('Erro ao conectar Firebase. Verifique as configurações.', true);
  }
}

/**
 * Salva a configuração do Firebase no localStorage e reconecta.
 */
function saveConfig() {
  const cfg = {
    apiKey:            document.getElementById('cfg-apiKey').value.trim(),
    authDomain:        document.getElementById('cfg-authDomain').value.trim(),
    projectId:         document.getElementById('cfg-projectId').value.trim(),
    storageBucket:     document.getElementById('cfg-storageBucket').value.trim(),
    messagingSenderId: document.getElementById('cfg-messagingSenderId').value.trim(),
    appId:             document.getElementById('cfg-appId').value.trim(),
  };

  if (!cfg.apiKey || !cfg.projectId) {
    showToast('Preencha ao menos API Key e Project ID.', true);
    return;
  }

  localStorage.setItem('lexcall_firebase_cfg', JSON.stringify(cfg));
  initFirebase();
}

/**
 * Carrega a configuração do localStorage e preenche o formulário.
 * @returns {Object|null} Configuração ou null se não encontrada.
 */
function loadConfig() {
  try {
    const raw = localStorage.getItem('lexcall_firebase_cfg');
    if (!raw) return null;

    const cfg = JSON.parse(raw);

    // Preenche os campos do formulário de configuração
    document.getElementById('cfg-apiKey').value            = cfg.apiKey            || '';
    document.getElementById('cfg-authDomain').value        = cfg.authDomain        || '';
    document.getElementById('cfg-projectId').value         = cfg.projectId         || '';
    document.getElementById('cfg-storageBucket').value     = cfg.storageBucket     || '';
    document.getElementById('cfg-messagingSenderId').value = cfg.messagingSenderId || '';
    document.getElementById('cfg-appId').value             = cfg.appId             || '';

    return cfg;
  } catch {
    return null;
  }
}


/* ═══════════════════════════════════════════════════
   NAVEGAÇÃO — TROCA DE TELAS
   ═══════════════════════════════════════════════════ */

/**
 * Exibe a tela solicitada e atualiza o estado da navegação.
 * @param {string} id - ID da tela ('reception' | 'lawyer' | 'monitor' | 'config')
 */
function showView(id) {
  // Remove 'active' de todas as telas e botões
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));

  // Ativa a tela solicitada
  document.getElementById('view-' + id).classList.add('active');

  // Marca o botão correspondente na navbar
  const indexMap = { reception: 0, lawyer: 1, monitor: 2, config: 3 };
  const btnIndex = indexMap[id];
  if (btnIndex !== undefined) {
    document.querySelectorAll('nav button')[btnIndex].classList.add('active');
  }
}


/* ═══════════════════════════════════════════════════
   TELA 1 — RECEPÇÃO: CADASTRO DE CLIENTES
   ═══════════════════════════════════════════════════ */

/**
 * Adiciona um novo cliente à coleção 'clientes' no Firestore.
 * Valida os campos antes de salvar.
 */
async function addClient() {
  if (!db) {
    showToast('Firebase não configurado. Vá em ⚙ Config.', true);
    return;
  }

  const name   = document.getElementById('inp-name').value.trim();
  const lawyer = document.getElementById('inp-lawyer').value;

  if (!name)   { showToast('Informe o nome do cliente.', true); return; }
  if (!lawyer) { showToast('Selecione um advogado.', true); return; }

  try {
    await db.collection('clientes').add({
      nome:       name,
      advogado:   lawyer,
      status:     'aguardando',           // status inicial
      timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
      notificado: false,                  // controla se o popup já foi exibido
    });

    // Limpa os campos após sucesso
    document.getElementById('inp-name').value   = '';
    document.getElementById('inp-lawyer').value = '';

    showToast(`${name} adicionado à fila de ${lawyer}.`);
  } catch (err) {
    console.error('Erro ao adicionar cliente:', err);
    showToast('Erro ao salvar. Verifique as permissões do Firestore.', true);
  }
}

/**
 * Renderiza a lista completa de clientes na tela da recepção.
 * @param {firebase.firestore.QuerySnapshot} snap
 */
function renderReceptionList(snap) {
  const list = document.getElementById('reception-list');
  const docs = snap.docs;

  document.getElementById('rec-count').textContent = docs.length;

  if (docs.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📋</div>
        Nenhum cliente cadastrado ainda.
      </div>`;
    return;
  }

  list.innerHTML = '';
  docs.forEach(doc => {
    const d      = doc.data();
    const called = d.status === 'chamado';
    const wait   = formatWaitTime(d.timestamp);

    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="client-info">
        <div class="client-name">${escHtml(d.nome)}</div>
        <div class="client-meta">
          👤 ${escHtml(d.advogado)} &nbsp;·&nbsp;
          <span class="wait-time ${wait.long ? 'long' : ''}">⏱ ${wait.text}</span>
        </div>
      </div>
      <span class="badge ${called ? 'badge-called' : 'badge-waiting'}">
        ${called ? 'Chamado' : 'Aguardando'}
      </span>`;
    list.appendChild(row);
  });
}

/**
 * Atualiza os cards de estatísticas (total, aguardando, chamados).
 * @param {firebase.firestore.QuerySnapshot} snap
 */
function updateStats(snap) {
  const docs    = snap.docs;
  const waiting = docs.filter(d => d.data().status === 'aguardando').length;
  const called  = docs.filter(d => d.data().status === 'chamado').length;

  document.getElementById('stat-total').textContent   = docs.length;
  document.getElementById('stat-waiting').textContent = waiting;
  document.getElementById('stat-called').textContent  = called;
}


/* ═══════════════════════════════════════════════════
   TELA 2 — ADVOGADO: FILA E CHAMADA
   ═══════════════════════════════════════════════════ */

/**
 * Seleciona o advogado e inicia o listener da sua fila.
 * @param {string} name - Nome do advogado
 * @param {HTMLElement} el - Elemento clicado (para aplicar estilo)
 */
function selectLawyer(name, el) {
  // Atualiza visual dos cards de seleção
  document.querySelectorAll('.lawyer-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  currentLawyer = name;

  // Exibe a seção de fila e atualiza título
  document.getElementById('lawyer-queue').style.display = 'block';
  document.getElementById('lawyer-queue-title').textContent = `Fila — ${name}`;

  // Cancela listener anterior antes de criar um novo
  if (unsubLawyer) unsubLawyer();

  if (!db) {
    document.getElementById('lawyer-list').innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚙</div>
        Firebase não configurado.
      </div>`;
    return;
  }

  // Assina a coleção filtrada por advogado, ordenada por chegada
  unsubLawyer = db.collection('clientes')
    .where('advogado', '==', name)
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => renderLawyerList(snap));
}

/**
 * Renderiza a fila de clientes do advogado selecionado.
 * @param {firebase.firestore.QuerySnapshot} snap
 */
function renderLawyerList(snap) {
  const list = document.getElementById('lawyer-list');
  const docs = snap.docs;

  document.getElementById('lawyer-count').textContent = docs.length;

  if (docs.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">✅</div>
        Nenhum cliente na fila.
      </div>`;
    return;
  }

  list.innerHTML = '';
  docs.forEach((doc, i) => {
    const d      = doc.data();
    const called = d.status === 'chamado';
    const wait   = formatWaitTime(d.timestamp);

    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="pos-num">${i + 1}</div>
      <div class="client-info">
        <div class="client-name">${escHtml(d.nome)}</div>
        <div class="client-meta">
          ${called
            ? '📢 Já chamado'
            : `<span class="wait-time ${wait.long ? 'long' : ''}">⏱ Aguardando ${wait.text}</span>`
          }
        </div>
      </div>
      <span class="badge ${called ? 'badge-called' : 'badge-waiting'}">
        ${called ? 'Chamado' : 'Aguardando'}
      </span>
      <button
        class="btn btn-call"
        onclick="callClient('${doc.id}', '${escAttr(d.nome)}')"
        ${called ? 'disabled' : ''}
      >${called ? '✓ Chamado' : '📢 Chamar'}</button>`;
    list.appendChild(row);
  });
}

/**
 * Atualiza o status do cliente para 'chamado' no Firestore.
 * O campo 'notificado: false' garante que o popup será exibido na recepção.
 * @param {string} docId - ID do documento no Firestore
 * @param {string} nome  - Nome do cliente (para o toast)
 */
async function callClient(docId, nome) {
  if (!db) return;

  try {
    await db.collection('clientes').doc(docId).update({
      status:     'chamado',
      notificado: false,  // reseta para garantir disparo do popup
    });
    showToast(`${nome} foi chamado!`);
  } catch (err) {
    console.error('Erro ao chamar cliente:', err);
    showToast('Erro ao chamar cliente.', true);
  }
}


/* ═══════════════════════════════════════════════════
   TELA 3 — MONITOR DA RECEPÇÃO
   ═══════════════════════════════════════════════════ */

/**
 * Renderiza o histórico de chamadas no monitor da recepção
 * (mais recentes no topo).
 * @param {firebase.firestore.QuerySnapshot} snap
 */
function renderMonitorList(snap) {
  const list = document.getElementById('monitor-list');
  const docs = snap.docs;

  if (docs.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🔔</div>
        Nenhuma chamada registrada.
      </div>`;
    return;
  }

  // Inverte para exibir os mais recentes no topo
  const sorted = [...docs].reverse();
  list.innerHTML = '';
  sorted.forEach(doc => {
    const d   = doc.data();
    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div class="client-info">
        <div class="client-name">📢 ${escHtml(d.nome)}</div>
        <div class="client-meta">Ir para: <strong>${escHtml(d.advogado)}</strong></div>
      </div>
      <span class="badge badge-called">Chamado</span>`;
    list.appendChild(row);
  });
}

/**
 * Verifica se há novas chamadas (notificado === false) e as enfileira para popup.
 * Chamado a cada atualização do snapshot do monitor.
 * @param {firebase.firestore.QuerySnapshot} snap
 */
function checkForNewCalls(snap) {
  snap.docChanges().forEach(change => {
    if (change.type === 'added' || change.type === 'modified') {
      const data = change.doc.data();

      // Só processa chamadas ainda não notificadas
      if (data.status === 'chamado' && data.notificado === false) {
        popupQueue.push({
          id:       change.doc.id,
          nome:     data.nome,
          advogado: data.advogado,
        });
        processPopupQueue();
      }
    }
  });
}


/* ═══════════════════════════════════════════════════
   POPUP — NOTIFICAÇÃO VISUAL
   ═══════════════════════════════════════════════════ */

/**
 * Processa a fila de popups. Exibe o próximo se não houver um aberto.
 */
function processPopupQueue() {
  if (popupQueue.length === 0) return;

  // Aguarda o popup atual fechar antes de abrir o próximo
  const overlay = document.getElementById('popup-overlay');
  if (overlay.classList.contains('show')) return;

  const next = popupQueue.shift();
  showPopup(next.nome, next.advogado, next.id);
}

/**
 * Exibe o popup de chamada com timer de auto-fechamento (5s).
 * @param {string} nome     - Nome do cliente
 * @param {string} advogado - Nome do advogado
 * @param {string} docId    - ID do documento para marcar como notificado
 */
function showPopup(nome, advogado, docId) {
  // Preenche os dados do popup
  document.getElementById('popup-name').textContent   = nome;
  document.getElementById('popup-lawyer').textContent = advogado;

  // Exibe o overlay
  document.getElementById('popup-overlay').classList.add('show');

  // Inicializa a barra de progresso
  const fill     = document.getElementById('popup-timer-fill');
  fill.style.transition = 'none';
  fill.style.width = '100%';

  const DURATION = 5000; // 5 segundos
  const start    = Date.now();

  clearInterval(popupTimer);
  popupTimer = setInterval(() => {
    const elapsed = Date.now() - start;
    const pct     = Math.max(0, 100 - (elapsed / DURATION) * 100);

    fill.style.transition = 'width 0.1s linear';
    fill.style.width      = pct + '%';

    if (elapsed >= DURATION) {
      closePopup();
    }
  }, 100);

  // Marca o cliente como notificado no banco (impede popup duplicado)
  if (db && docId) {
    db.collection('clientes')
      .doc(docId)
      .update({ notificado: true })
      .catch(console.error);
  }

  // Vincula o botão "OK" ao fechamento
  document.getElementById('popup-ok').onclick = closePopup;
}

/**
 * Fecha o popup e verifica se há próximo na fila.
 */
function closePopup() {
  clearInterval(popupTimer);
  document.getElementById('popup-overlay').classList.remove('show');

  // Pequeno delay para a animação de saída antes de abrir o próximo
  setTimeout(processPopupQueue, 400);
}


/* ═══════════════════════════════════════════════════
   LISTENERS — FIRESTORE EM TEMPO REAL
   ═══════════════════════════════════════════════════ */

/**
 * Inicia todos os listeners do Firestore.
 * Cancela listeners anteriores antes de criar novos.
 */
function startListeners() {
  if (!db) return;

  // Cancela listeners anteriores
  if (unsubReception) unsubReception();
  if (unsubMonitor)   unsubMonitor();

  // ── Listener 1: Lista geral da recepção (todas as entradas) ──
  unsubReception = db.collection('clientes')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      renderReceptionList(snap);
      updateStats(snap);
    });

  // ── Listener 2: Monitor — apenas clientes com status 'chamado' ──
  unsubMonitor = db.collection('clientes')
    .where('status', '==', 'chamado')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snap => {
      renderMonitorList(snap);
      checkForNewCalls(snap);
    });
}


/* ═══════════════════════════════════════════════════
   UTILITÁRIOS
   ═══════════════════════════════════════════════════ */

/**
 * Calcula e formata o tempo de espera a partir de um Timestamp do Firestore.
 * Retorna texto legível e flag 'long' para alerta visual (>30min).
 * @param {firebase.firestore.Timestamp|null} ts
 * @returns {{ text: string, long: boolean }}
 */
function formatWaitTime(ts) {
  if (!ts) return { text: '--', long: false };

  const now  = Date.now();
  const then = ts.toMillis ? ts.toMillis() : ts;
  const diff = Math.floor((now - then) / 1000); // diferença em segundos

  if (diff < 60)   return { text: `${diff}s`,                                          long: false };
  if (diff < 3600) return { text: `${Math.floor(diff / 60)}min`,                       long: diff > 1800 };

  const h   = Math.floor(diff / 3600);
  const min = Math.floor((diff % 3600) / 60);
  return { text: `${h}h ${min}min`, long: true };
}

/**
 * Escapa caracteres HTML para prevenir XSS em innerHTML.
 * @param {string} s
 * @returns {string}
 */
function escHtml(s = '') {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escapa aspas simples para uso seguro em atributos HTML inline (onclick).
 * @param {string} s
 * @returns {string}
 */
function escAttr(s = '') {
  return s.replace(/'/g, "\\'");
}

/**
 * Exibe uma notificação toast temporária (3 segundos).
 * @param {string}  msg   - Mensagem a exibir
 * @param {boolean} error - Se true, usa cor de erro
 */
let toastTimer;
function showToast(msg, error = false) {
  const el = document.getElementById('toast');
  el.textContent       = (error ? '⚠ ' : '✓ ') + msg;
  el.style.borderColor = error ? 'var(--danger)' : 'var(--gold-dim)';
  el.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}


/* ═══════════════════════════════════════════════════
   INICIALIZAÇÃO
   ═══════════════════════════════════════════════════ */

// Permite adicionar cliente pressionando Enter no campo de nome
document.getElementById('inp-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') addClient();
});

// Tenta conectar ao Firebase com configuração salva (se existir)
initFirebase();
