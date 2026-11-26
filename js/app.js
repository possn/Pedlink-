import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const ESTADOS = {
  novo: 'Novo',
  em_analise: 'Em análise',
  subespecialidade: 'Discussão com subespecialidade',
  respondido: 'Respondido na app',
  reuniao_agendada: 'Reunião agendada',
  fechado: 'Fechado',
};
const PRIORIDADES = { urgente: 'Urgente', prioritario: 'Prioritário', normal: 'Normal' };
const PRIO_ORDEM = { urgente: 0, prioritario: 1, normal: 2 };
const DESFECHOS = {
  referenciar: 'Referenciar à consulta hospitalar',
  nao_referenciar: 'Não referenciar',
  seguimento_mgf: 'Manter seguimento em MGF com orientação',
  referenciar_urgencia: 'Enviar ao Serviço de Urgência',
};
const AREAS = ['Geral', 'Alergologia', 'Cardiologia', 'Cirurgia pediátrica', 'Desenvolvimento', 'Endocrinologia',
  'Gastroenterologia', 'Hematologia', 'Infecciologia', 'Nefrologia', 'Neonatologia', 'Neurologia', 'Nutrição',
  'Oncologia', 'Ortopedia', 'Pneumologia', 'Reumatologia', 'Saúde mental / Pedopsiquiatria', 'Adolescência', 'Outra'];
const TIPOS_UNIDADE = ['USF', 'UCSP', 'UCC', 'USP', 'URAP', 'Hospital', 'Outra'];

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtData = (d) => d ? new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const fmtDataHora = (d) => d ? new Date(d).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const idadeTxt = (c) => `${c.idade_valor} ${c.idade_valor === 1 ? { dias: 'dia', semanas: 'semana', meses: 'mês', anos: 'ano' }[c.idade_unidade] : c.idade_unidade}`;
const sexoTxt = (s) => ({ F: 'Feminino', M: 'Masculino', Indeterminado: 'Indeterminado' }[s] || s);
const unidadeTxt = (u) => u ? `${u.tipo && !u.nome.startsWith(u.tipo) ? u.tipo + ' ' : ''}${u.nome}` : '—';
const toLocalInput = (d) => { if (!d) return ''; const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

function icon(name) {
  const p = {
    casos: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>',
    novo: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    docs: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
    sino: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    admin: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    perfil: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5c1.5-2 3.4-3 5.5-3s4 1 5.5 3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    sair: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    voltar: '<path d="M15 6l-6 6 6 6"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  }[name] || '';
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, isErr ? 6000 : 3000);
}

function erroMsg(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Email ou palavra-passe incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Ainda não confirmou o email. Verifique a caixa de correio.';
  if (/User already registered/i.test(m)) return 'Já existe uma conta com este email.';
  if (/Password should be at least/i.test(m)) return 'A palavra-passe deve ter pelo menos 8 caracteres.';
  if (/rate limit/i.test(m)) return 'Demasiadas tentativas. Aguarde alguns minutos.';
  if (/row-level security/i.test(m)) return 'Sem permissão para esta ação.';
  if (/Database error saving new user/i.test(m)) return 'Registo permitido apenas com email institucional (@…min-saude.pt).';
  return m;
}

// ---------------------------------------------------------------------------
// Proteção de dados: deteção de identificadores no texto livre
// (o servidor aplica as mesmas regras de bloqueio; aqui damos feedback imediato)
// ---------------------------------------------------------------------------
function verificarTexto(t) {
  const bloqueios = [], avisos = [];
  if (!t) return { bloqueios, avisos };
  if (/(^|[^0-9])[0-9]{3}[ .-]?[0-9]{3}[ .-]?[0-9]{3}([^0-9]|$)/.test(t)) bloqueios.push('número de 9 dígitos (nº de utente, NIF ou telefone)');
  else if (/[0-9]{8,}/.test(t)) bloqueios.push('número identificativo longo');
  if (/[0-9]{8}\s?[0-9]\s?[a-z]{2}[0-9]/i.test(t)) bloqueios.push('número de Cartão de Cidadão');
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) bloqueios.push('endereço de email');
  if (/(n\.?º|nº|numero|número)\s*(de\s*)?(utente|sns|processo|cc|bi)\s*[:=]?\s*[0-9]/i.test(t)) bloqueios.push('número de utente/processo');
  if (/\b\d{1,2}[\/.-]\d{1,2}[\/.-](19|20)\d{2}\b/.test(t)) avisos.push('data completa (se for a data de nascimento, retire-a; datas de exames podem ficar como mês/ano)');
  if (/\b(nasc(eu|ido|ida|imento)|d\.?\s?n\.?)\b/i.test(t) && /\b(19|20)\d{2}\b/.test(t)) avisos.push('referência a data de nascimento');
  if (/\b(rua|avenida|av\.|travessa|largo|lote|c[oó]digo postal)\b/i.test(t)) avisos.push('possível morada');
  if (/\b(chama-se|de nome|nome:|o\s+\w+\s+tem\s+\d)/i.test(t)) avisos.push('possível nome próprio');
  if (/\b(sr\.?|sra\.?|dona|d\.)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+/.test(t)) avisos.push('possível nome de familiar');
  return { bloqueios, avisos };
}

// Ditado por voz (Web Speech API: Safari iOS 14.5+, Chrome, Edge)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let ditado = null; // { rec, alvo, btn, base, ouviu, timer, inicio }
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function botaoDitar(alvoId) {
  return SR ? `<button type="button" class="btn secondary small mic" data-ditar="${alvoId}">${icon('mic')} <span>Ditar</span></button>` : '';
}
function limparDitado(txt) {
  txt = txt.replace(/\s*\b(ponto final|ponto)\b/gi, '.').replace(/\s*\bvírgula\b/gi, ',').replace(/\s*\b(nova linha|parágrafo)\b\s*/gi, '\n');
  return txt.replace(/([.!?]\s+|\n)(\p{Ll})/gu, (m, p1, l) => p1 + l.toUpperCase());
}
function juntarDitado(antes, txt) {
  txt = limparDitado(txt.trim());
  if (!txt) return antes;
  const sep = !antes || /[\s\n]$/.test(antes) ? '' : ' ';
  if (!antes || /[.!?\n]\s*$/.test(antes)) txt = txt.charAt(0).toUpperCase() + txt.slice(1);
  return antes + sep + txt;
}
// Um único motor de reconhecimento, em modo contínuo, para todo o formulário.
// No Safari iOS só a primeira ativação da página é fiável; por isso, ao mudar de campo,
// o motor NÃO é parado: o texto que vai chegando passa simplesmente a ser escrito no campo novo.
let motor = null, motorAtivo = false, ultimoFull = '', ultimoN = 0;
function uiDitado(d, estado) {
  d.btn.classList.toggle('on', estado !== 'off'); d.btn.classList.toggle('ouvir', estado === 'ouvir');
  d.btn.querySelector('span').textContent = estado === 'off' ? 'Ditar' : 'Parar';
}
function traco(d, ev) {
  if (!d) return;
  d.trace.push(ev);
  let el = d.alvo.parentElement.querySelector('.ditlog');
  if (!el) { el = document.createElement('div'); el.className = 'ditlog'; d.alvo.insertAdjacentElement('afterend', el); }
  el.textContent = 'Ditado: ' + d.trace.slice(-8).join(' → ');
}
function pararDitado(aviso) {
  if (!ditado) return;
  const d = ditado; ditado = null;
  clearTimeout(d.timer);
  if (motor && motorAtivo) { try { motor.stop(); } catch { /* ignore */ } }
  uiDitado(d, 'off');
  traco(d, 'parado');
  if (aviso) toast(aviso, true);
}
const AVISO_TECLADO = IOS
  ? 'O ditado não respondeu. No iPhone use o microfone 🎤 do teclado: toque no campo e depois no 🎤 junto à barra de espaço.'
  : 'O ditado não respondeu. Verifique a permissão do microfone ou escreva o texto.';
function obterMotor() {
  if (motor) return motor;
  motor = new SR();
  motor.lang = 'pt-PT';
  motor.continuous = true;
  motor.interimResults = true;  // o Safari iOS por vezes só entrega resultados intermédios
  motor.onstart = () => { ultimoFull = ''; ultimoN = 0; if (ditado) { ditado.prefixo = ''; ditado.desde = 0; ditado.base = ditado.alvo.value; } traco(ditado, 'início'); };
  motor.onaudiostart = () => { if (ditado) uiDitado(ditado, 'ouvir'); traco(ditado, 'microfone'); };
  motor.onspeechstart = () => traco(ditado, 'voz');
  motor.onnomatch = () => traco(ditado, 'não percebido');
  motor.onresult = (ev) => {
    const partes = [];
    for (let i = 0; i < ev.results.length; i++) partes.push(ev.results[i][0].transcript.trim());
    const full = partes.join(' ');
    ultimoFull = full; ultimoN = ev.results.length;
    const d = ditado;
    if (!d) return;
    if (!d.ouviu) traco(d, 'texto');
    d.ouviu = true; clearTimeout(d.timer);
    const seg = d.prefixo && full.startsWith(d.prefixo) ? full.slice(d.prefixo.length) : partes.slice(d.desde).join(' ');
    d.alvo.value = juntarDitado(d.base, seg).slice(0, d.alvo.maxLength > 0 ? d.alvo.maxLength : undefined);
    d.alvo.dispatchEvent(new Event('input', { bubbles: true }));
  };
  motor.onerror = (ev) => {
    const d = ditado;
    traco(d, 'erro ' + ev.error);
    if (!d) return;
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      pararDitado(IOS && (navigator.standalone || matchMedia('(display-mode: standalone)').matches)
        ? 'O ditado da app não funciona na app do ecrã principal do iPhone. Use o microfone 🎤 do teclado, ou abra o PedLink no Safari.'
        : 'Sem permissão para microfone/reconhecimento de voz. Autorize nas Definições (Safari › Microfone) ou use o 🎤 do teclado.');
    } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
      pararDitado('Ditado interrompido (' + ev.error + '). ' + (IOS ? 'Pode usar o 🎤 do teclado.' : ''));
    }
  };
  motor.onend = () => {
    motorAtivo = false;
    const d = ditado;
    traco(d, 'fim');
    if (!d) return;
    if (!d.ouviu && Date.now() - d.inicio > 9000) return pararDitado(AVISO_TECLADO);
    setTimeout(arrancarMotor, 200); // o motor parou sozinho (silêncio): volta a ouvir até carregar em Parar
  };
  return motor;
}
function arrancarMotor() {
  const d = ditado;
  if (!d || motorAtivo) return;
  d.base = d.alvo.value; d.prefixo = ''; d.desde = 0;
  motorAtivo = true;
  try { obterMotor().start(); }
  catch (err) { motorAtivo = false; traco(d, 'falhou ' + (err.name || '')); pararDitado('Não foi possível iniciar o ditado. ' + (IOS ? 'Use o 🎤 do teclado.' : '')); }
}
function ligarDitado(root) {
  if (!SR) return;
  $$('[data-ditar]', root).forEach(btn => btn.onclick = () => {
    const alvo = document.getElementById(btn.dataset.ditar);
    if (ditado && ditado.btn === btn) return pararDitado();
    if (ditado) { clearTimeout(ditado.timer); uiDitado(ditado, 'off'); }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // teclado aberto compete pelo microfone
    const anterior = ditado;
    const d = { alvo, btn, ouviu: false, inicio: Date.now(), trace: [], base: alvo.value, prefixo: ultimoFull, desde: ultimoN };
    ditado = d;
    uiDitado(d, motorAtivo ? 'ouvir' : 'on');
    d.timer = setTimeout(() => { if (ditado === d && !d.ouviu) pararDitado(AVISO_TECLADO); }, 12000);
    if (motorAtivo) { traco(d, anterior ? 'mudou de campo' : 'a continuar'); }
    else arrancarMotor();
  });
}

// Reprocessa imagens num canvas: remove EXIF/GPS/metadados e reduz tamanho
async function anonimizarImagem(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const max = 2000;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Falha ao processar imagem')), 'image/jpeg', 0.85));
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
const app = $('#app');
const st = { session: null, perfil: null, unidades: [], aces: [], naoLidas: 0 };
const isPed = () => st.perfil && (st.perfil.papel === 'pediatra' || st.perfil.is_admin);
const isAdmin = () => !!st.perfil?.is_admin;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  app.innerHTML = `<div class="auth"><div class="card"><div class="logo"><img src="icons/logo.svg" alt=""><b>PedLink</b></div>
    <div class="alert warn">A app ainda não está ligada à base de dados. Preencha <code>js/config.js</code> com o URL e a chave pública do projeto Supabase.</div></div></div>`;
  throw new Error('config em falta');
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

async function carregarUnidades() {
  const [{ data: aces }, { data: unid }] = await Promise.all([
    sb.from('aces').select('*').order('nome'),
    sb.from('unidades').select('*, aces(nome, uls)').order('nome'),
  ]);
  st.aces = aces || [];
  st.unidades = unid || [];
}

async function carregarPerfil() {
  const { data, error } = await sb.from('perfis').select('*, unidades(id, nome, tipo, aces(nome))').eq('id', st.session.user.id).maybeSingle();
  if (error) throw error;
  st.perfil = data;
}

function opcoesUnidades(selecionada, { apenasAtivas = true, vazio = 'Selecione a unidade…', hospitais = false } = {}) {
  let html = `<option value="">${esc(vazio)}</option>`;
  for (const a of st.aces) {
    const us = st.unidades.filter(u => u.aces_id === a.id && (!apenasAtivas || u.ativo || u.id === selecionada)
      && ((u.tipo === 'Hospital') === hospitais));
    if (!us.length) continue;
    html += `<optgroup label="${esc(a.nome)}">` + us.map(u =>
      `<option value="${u.id}" ${u.id === selecionada ? 'selected' : ''}>${esc(unidadeTxt(u))}${u.centro_saude ? ' — ' + esc(u.centro_saude) : ''}</option>`).join('') + '</optgroup>';
  }
  return html;
}

function opcoesHospitais(selecionado) {
  const hs = st.unidades.filter(u => u.tipo === 'Hospital' && u.ativo);
  return hs.map(u => `<option value="${u.id}" ${u.id === selecionado || (!selecionado && hs[0] === u) ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')
    + `<option value="outro" ${hs.length === 0 ? 'selected' : ''}>Outro hospital…</option>`;
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------
function ecraAuth(modo = 'entrar', aviso = '') {
  app.innerHTML = `
  <div class="auth"><div class="card">
    <div class="logo"><img src="icons/logo.svg" alt=""><div><b>PedLink</b><div class="muted small">Pediatria em rede com os Cuidados de Saúde Primários</div></div></div>
    <div class="tabs" role="tablist">
      <button data-m="entrar" class="${modo === 'entrar' ? 'active' : ''}">Entrar</button>
      <button data-m="registar" class="${modo === 'registar' ? 'active' : ''}">Criar conta</button>
      <button data-m="recuperar" class="${modo === 'recuperar' ? 'active' : ''}">Recuperar acesso</button>
    </div>
    ${aviso ? `<div class="alert info">${aviso}</div>` : ''}
    <div id="authform"></div>
  </div></div>`;
  $$('.tabs button', app).forEach(b => b.onclick = () => ecraAuth(b.dataset.m));
  const f = $('#authform');

  if (modo === 'entrar') {
    f.innerHTML = `<form id="fl">
      <div class="field"><label for="em">Email institucional</label><input id="em" type="email" autocomplete="username" required></div>
      <div class="field"><label for="pw">Palavra-passe</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="btn" style="width:100%">Entrar</button></form>`;
    $('#fl').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter; btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
      btn.disabled = false;
      if (error) toast(erroMsg(error), true);
    };
  }

  if (modo === 'registar') {
    f.innerHTML = `<form id="fr">
      <div class="field"><label for="rn">Nome profissional</label><input id="rn" required maxlength="120" placeholder="Dr.ª Ana Silva"></div>
      <div class="field"><label for="re">Email institucional <span class="hint">(@…min-saude.pt)</span></label><input id="re" type="email" required autocomplete="username"></div>
      <div class="field"><label for="rp">Palavra-passe <span class="hint">(mín. 8 caracteres)</span></label><input id="rp" type="password" minlength="8" required autocomplete="new-password"></div>
      <div class="field"><label>Perfil</label>
        <div class="seg">
          <label><input type="radio" name="papel" value="mgf" checked> Medicina Geral e Familiar</label>
          <label><input type="radio" name="papel" value="pediatra"> Pediatria hospitalar</label>
        </div></div>
      <div class="field" id="campoUnid"><label for="ru">Unidade de saúde</label><select id="ru" required>${opcoesUnidades(null)}</select>
        <div class="muted small">Não encontra a sua unidade? Escolha a mais próxima e peça ao administrador para a corrigir.</div></div>
      <div id="campoServ" hidden>
        <div class="field"><label for="rh">Hospital</label><select id="rh">${opcoesHospitais(null)}</select></div>
        <div class="field" id="campoOutroH" hidden><label for="rho">Nome do hospital</label><input id="rho" maxlength="120"></div>
        <div class="field"><label for="rs">Serviço / área <span class="hint">(opcional)</span></label><input id="rs" maxlength="120" placeholder="Pediatria, Neonatologia, Cardiologia Pediátrica…"></div>
      </div>
      <div class="alert info small">A conta fica pendente até ser aprovada por um administrador do projeto.</div>
      <button class="btn" style="width:100%">Criar conta</button></form>`;
    const sync = () => {
      const ped = $('input[name=papel]:checked').value === 'pediatra';
      $('#campoUnid').hidden = ped; $('#ru').required = !ped;
      $('#campoServ').hidden = !ped;
      $('#campoOutroH').hidden = !(ped && $('#rh').value === 'outro'); $('#rho').required = ped && $('#rh').value === 'outro';
    };
    $('#rh').onchange = sync;
    $$('input[name=papel]').forEach(r => r.onchange = sync);
    $('#fr').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter; btn.disabled = true;
      try {
        const email = $('#re').value.trim().toLowerCase();
        const { data: ok } = await sb.rpc('email_permitido', { e: email });
        if (ok === false) throw new Error('Registo permitido apenas com email institucional (@…min-saude.pt).');
        const papel = $('input[name=papel]:checked').value;
        const hId = papel === 'pediatra' && $('#rh').value && $('#rh').value !== 'outro' ? $('#rh').value : null;
        const hNome = papel !== 'pediatra' ? '' : hId ? unidadeTxt(st.unidades.find(u => u.id === hId)) : $('#rho').value.trim();
        const serv = papel === 'pediatra' ? [$('#rs').value.trim(), hNome].filter(Boolean).join(' · ') : null;
        const { error } = await sb.auth.signUp({
          email, password: $('#rp').value,
          options: {
            emailRedirectTo: location.origin + location.pathname,
            data: { nome: $('#rn').value.trim(), papel, unidade_id: papel === 'mgf' ? $('#ru').value : hId, servico: serv },
          },
        });
        if (error) throw error;
        { const { data: sess } = await sb.auth.getSession(); if (sess?.session) { arrancar(); return; } }
        ecraAuth('entrar', 'Conta criada. Se receber um email de confirmação, abra a ligação; depois entre aqui. O acesso fica ativo quando um administrador aprovar.');
      } catch (err) { toast(erroMsg(err), true); btn.disabled = false; }
    };
  }

  if (modo === 'recuperar') {
    f.innerHTML = `<form id="fp"><div class="field"><label for="pe">Email institucional</label><input id="pe" type="email" required></div>
      <button class="btn" style="width:100%">Enviar ligação de recuperação</button></form>`;
    $('#fp').onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.resetPasswordForEmail($('#pe').value.trim(), { redirectTo: location.origin + location.pathname + '#/nova-password' });
      if (error) return toast(erroMsg(error), true);
      ecraAuth('entrar', 'Se o email estiver registado, receberá uma ligação para definir nova palavra-passe.');
    };
  }
}

function ecraNovaPassword() {
  app.innerHTML = `<div class="auth"><div class="card"><div class="logo"><img src="icons/logo.svg" alt=""><b>PedLink</b></div>
    <h2>Definir nova palavra-passe</h2>
    <form id="fn"><div class="field"><label for="np">Nova palavra-passe</label><input id="np" type="password" minlength="8" required autocomplete="new-password"></div>
    <button class="btn">Guardar</button></form></div></div>`;
  $('#fn').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $('#np').value });
    if (error) return toast(erroMsg(error), true);
    toast('Palavra-passe atualizada.');
    location.hash = '#/casos'; arrancar();
  };
}

function ecraPendente() {
  const p = st.perfil;
  app.innerHTML = `<div class="auth"><div class="card"><div class="logo"><img src="icons/logo.svg" alt=""><b>PedLink</b></div>
    ${!p ? `<div class="alert err">Não foi encontrado o seu perfil. Contacte o administrador do projeto.${st.perfilErro ? `<br><span class="small">Detalhe técnico: ${esc(st.perfilErro)}</span>` : ''}</div>`
      : !p.ativo ? `<div class="alert err">A sua conta foi desativada. Contacte o administrador do projeto.</div>`
      : `<div class="alert info">Olá, ${esc(p.nome)}. O seu pedido de acesso como <b>${p.papel === 'pediatra' ? 'pediatra' : 'MGF'}</b> aguarda aprovação de um administrador. Receberá acesso assim que for aprovado.</div>`}
    <div class="actions"><button class="btn secondary" id="rec">Verificar novamente</button><button class="btn secondary" id="out">Sair</button></div>
  </div></div>`;
  $('#rec').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'A verificar…';
    await arrancar();
    if (!st.perfil?.aprovado || !st.perfil?.ativo) toast('Ainda sem aprovação (' + new Date().toLocaleTimeString('pt-PT') + ').', true);
  };
  $('#out').onclick = () => sair();
}

// ---------------------------------------------------------------------------
// Estrutura principal (menu lateral)
// ---------------------------------------------------------------------------
async function sair() {
  try { await sb.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
  st.session = null; st.perfil = null;
  history.replaceState(null, '', location.pathname);
  ecraAuth('entrar', 'Sessão terminada. Outra pessoa pode agora entrar ou criar conta.');
}

function shell() {
  const p = st.perfil;
  app.innerHTML = `
  <div class="shell" id="shell">
    <div class="scrim" id="scrim"></div>
    <aside class="sidebar" aria-label="Menu">
      <a class="brand" href="#/casos"><img src="icons/logo.svg" alt="">PedLink</a>
      <nav class="nav">
        <a href="#/casos" data-r="casos">${icon('casos')} Casos</a>
        <a href="#/novo" data-r="novo">${icon('novo')} Novo caso</a>
        <a href="#/projeto" data-r="projeto">${icon('docs')} Projeto e critérios</a>
        <a href="#/notificacoes" data-r="notificacoes">${icon('sino')} Notificações <span class="count" id="nCount" hidden></span></a>
        ${isAdmin() ? `<a href="#/admin" data-r="admin">${icon('admin')} Administração</a>` : ''}
        <div class="sep"></div>
        <a href="#/perfil" data-r="perfil">${icon('perfil')} O meu perfil</a>
        <a href="#" id="sairNav">${icon('sair')} Sair</a>
      </nav>
      <div class="who"><b>${esc(p.nome)}</b><br><span class="muted">${isPed() ? 'Pediatria' + (p.servico ? ' · ' + esc(p.servico) : '') : esc(unidadeTxt(p.unidades))}${p.is_admin ? ' · admin' : ''}</span><div class="muted" style="font-size:.72rem;margin-top:4px">versão 15</div></div>
    </aside>
    <div>
      <header class="topbar"><button class="iconbtn" id="menuBtn" aria-label="Abrir menu">${icon('menu')}</button>
        <a class="brand" href="#/casos"><img src="icons/logo.svg" alt="">PedLink</a></header>
      <main class="main" id="view"></main>
    </div>
  </div>`;
  $('#sairNav').onclick = (e) => { e.preventDefault(); sair(); };
  $('#menuBtn').onclick = () => $('#shell').classList.add('open');
  $('#scrim').onclick = () => $('#shell').classList.remove('open');
  atualizarContador();
}

async function atualizarContador() {
  if (!st.perfil) return;
  const { count } = await sb.from('notificacoes').select('id', { count: 'exact', head: true }).eq('lida', false);
  st.naoLidas = count || 0;
  const el = $('#nCount');
  if (el) { el.hidden = !st.naoLidas; el.textContent = st.naoLidas; }
  if ('setAppBadge' in navigator) (st.naoLidas ? navigator.setAppBadge(st.naoLidas) : navigator.clearAppBadge()).catch(() => {});
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function route() {
  if (!st.perfil) return;
  const h = location.hash.replace(/^#\/?/, '') || 'casos';
  const [r, id, sub] = h.split('/');
  $('#shell')?.classList.remove('open');
  pararDitado();
  $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.r === r || (r === 'caso' && a.dataset.r === 'casos')));
  const v = $('#view');
  v.innerHTML = '<p class="muted">A carregar…</p>';
  window.scrollTo(0, 0);
  try {
    if (r === 'casos') await vistaCasos(v);
    else if (r === 'novo') await vistaFormCaso(v, null);
    else if (r === 'caso' && sub === 'editar') await vistaFormCaso(v, id);
    else if (r === 'caso') await vistaCaso(v, id);
    else if (r === 'projeto') await vistaProjeto(v);
    else if (r === 'notificacoes') await vistaNotificacoes(v);
    else if (r === 'admin' && isAdmin()) await vistaAdmin(v, id || 'utilizadores');
    else if (r === 'perfil') await vistaPerfil(v);
    else location.hash = '#/casos';
  } catch (e) {
    console.error(e);
    v.innerHTML = `<div class="alert err">Erro: ${esc(erroMsg(e))}</div>`;
  }
  atualizarContador();
}

// ---------------------------------------------------------------------------
// Lista de casos
// ---------------------------------------------------------------------------
const filtros = { estado: 'abertos', prioridade: '', aces: '', unidade: '', meus: false, q: '', ambito: 'meus' };

async function vistaCasos(v) {
  const { data, error } = await sb.from('casos')
    .select('id, codigo, idade_valor, idade_unidade, sexo, prioridade, area, motivo, estado, desfecho, reuniao_em, created_at, updated_at, criado_por, pediatra_id, unidade_id, unidades(nome, tipo, aces_id, aces(nome)), pediatra:perfis!casos_pediatra_id_fkey(nome)')
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  const casos = data || [];
  const ped = isPed();

  const abertos = casos.filter(c => c.estado !== 'fechado');
  const stats = ped ? `
    <div class="stats">
      <div class="stat"><b>${abertos.filter(c => c.estado === 'novo').length}</b><span>Novos por analisar</span></div>
      <div class="stat"><b style="color:var(--urg)">${abertos.filter(c => c.prioridade === 'urgente').length}</b><span>Urgentes em aberto</span></div>
      <div class="stat"><b>${abertos.filter(c => c.estado === 'subespecialidade').length}</b><span>Com subespecialidade</span></div>
      <div class="stat"><b>${casos.filter(c => c.reuniao_em && new Date(c.reuniao_em) > new Date()).length}</b><span>Reuniões agendadas</span></div>
    </div>` : `
    <div class="stats">
      <div class="stat"><b>${abertos.filter(c => c.criado_por === st.perfil.id).length}</b><span>Os meus casos em aberto</span></div>
      <div class="stat"><b>${casos.filter(c => c.criado_por === st.perfil.id && ['respondido', 'reuniao_agendada'].includes(c.estado)).length}</b><span>Com resposta / reunião</span></div>
      <div class="stat"><b>${casos.filter(c => c.reuniao_em && new Date(c.reuniao_em) > new Date()).length}</b><span>Reuniões agendadas</span></div>
    </div>`;

  const unidFiltro = st.unidades.filter(u => u.tipo !== 'Hospital' && (u.ativo || u.id === filtros.unidade));
  const acesOpts = `<option value="">Todos os ACES</option>` + st.aces.filter(a => a.id === filtros.aces || unidFiltro.some(u => u.aces_id === a.id)).map(a => `<option value="${a.id}" ${filtros.aces === a.id ? 'selected' : ''}>${esc(a.nome)}</option>`).join('');
  const unidOpts = `<option value="">${filtros.aces ? 'Todas as unidades deste ACES' : 'Todas as unidades'}</option>` + st.aces
    .filter(a => !filtros.aces || a.id === filtros.aces)
    .map(a => { const us = unidFiltro.filter(u => u.aces_id === a.id); return us.length ? `<optgroup label="${esc(a.nome)}">${us
      .map(u => `<option value="${u.id}" ${filtros.unidade === u.id ? 'selected' : ''}>${esc(u.tipo + ' ' + u.nome)}</option>`).join('')}</optgroup>` : ''; }).join('');

  v.innerHTML = `
    <div class="row" style="align-items:center;margin-bottom:12px"><h1 style="margin:0">Casos</h1>
      <div style="flex:0 0 auto"><a class="btn" href="#/novo">${icon('novo')} Novo caso</a></div></div>
    ${stats}
    <div class="filters">
      ${!ped ? `<select id="fAmbito"><option value="meus" ${filtros.ambito === 'meus' ? 'selected' : ''}>Os meus casos</option><option value="unidade" ${filtros.ambito === 'unidade' ? 'selected' : ''}>Toda a minha unidade</option></select>` : ''}
      <select id="fEstado"><option value="abertos">Em aberto</option><option value="">Todos os estados</option>
        ${Object.entries(ESTADOS).map(([k, t]) => `<option value="${k}" ${filtros.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="fPrio"><option value="">Todas as prioridades</option>${Object.entries(PRIORIDADES).map(([k, t]) => `<option value="${k}" ${filtros.prioridade === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${ped ? `<select id="fAces">${acesOpts}</select><select id="fUnid">${unidOpts}</select>
        <label class="check" style="align-self:center"><input type="checkbox" id="fMeus" ${filtros.meus ? 'checked' : ''}> Atribuídos a mim</label>` : ''}
      <input id="fQ" type="search" placeholder="Pesquisar código ou motivo" value="${esc(filtros.q)}">
    </div>
    <div class="cases" id="lista"></div>`;
  if (filtros.estado === 'abertos') $('#fEstado').value = 'abertos';
  else if (!filtros.estado) $('#fEstado').value = '';

  const desenhar = () => {
    const q = filtros.q.trim().toLowerCase();
    const lista = casos.filter(c =>
      (ped || filtros.ambito === 'unidade' || c.criado_por === st.perfil.id) &&
      (filtros.estado === 'abertos' ? c.estado !== 'fechado' : !filtros.estado || c.estado === filtros.estado) &&
      (!filtros.prioridade || c.prioridade === filtros.prioridade) &&
      (!filtros.aces || c.unidades?.aces_id === filtros.aces) &&
      (!filtros.unidade || c.unidade_id === filtros.unidade) &&
      (!filtros.meus || c.pediatra_id === st.perfil.id) &&
      (!q || c.codigo.toLowerCase().includes(q) || c.motivo.toLowerCase().includes(q) || (c.area || '').toLowerCase().includes(q))
    ).sort((a, b) => (a.estado === 'fechado') - (b.estado === 'fechado') || PRIO_ORDEM[a.prioridade] - PRIO_ORDEM[b.prioridade] || new Date(a.created_at) - new Date(b.created_at));
    $('#lista').innerHTML = lista.length ? lista.map(c => `
      <a class="case ${c.prioridade}" href="#/caso/${c.id}">
        <div class="top"><span class="code">${esc(c.codigo)}</span>
          <span class="badge p-${c.prioridade}">${PRIORIDADES[c.prioridade]}</span>
          <span class="badge e-${c.estado}">${ESTADOS[c.estado]}</span>
          ${c.desfecho ? `<span class="badge">${esc(DESFECHOS[c.desfecho])}</span>` : ''}
          ${c.area ? `<span class="badge">${esc(c.area)}</span>` : ''}</div>
        <div class="motivo">${esc(c.motivo)}</div>
        <div class="meta">${esc(idadeTxt(c))} · ${esc(sexoTxt(c.sexo))} · ${esc(unidadeTxt(c.unidades))}${c.unidades?.aces ? ' (' + esc(c.unidades.aces.nome) + ')' : ''} · ${fmtData(c.created_at)}
          ${c.pediatra ? ' · Pediatra: ' + esc(c.pediatra.nome) : ''}${c.reuniao_em ? ' · Reunião ' + fmtDataHora(c.reuniao_em) : ''}</div>
      </a>`).join('') : `<div class="empty">Sem casos para estes filtros.${!ped ? '<br><a href="#/novo">Criar um novo caso</a>' : ''}</div>`;
  };
  desenhar();
  const bind = (id, k, prop = 'value') => { const el = $(id); if (el) el.oninput = el.onchange = () => { filtros[k] = el[prop]; if (k === 'aces') { filtros.unidade = ''; vistaCasos(v); return; } desenhar(); }; };
  bind('#fEstado', 'estado'); bind('#fPrio', 'prioridade'); bind('#fAces', 'aces'); bind('#fUnid', 'unidade');
  bind('#fMeus', 'meus', 'checked'); bind('#fQ', 'q'); bind('#fAmbito', 'ambito');
}

// ---------------------------------------------------------------------------
// Criar / editar caso
// ---------------------------------------------------------------------------
async function vistaFormCaso(v, id) {
  let c = { idade_valor: '', idade_unidade: 'anos', sexo: '', prioridade: 'normal', area: '', motivo: '', historia: '', exame_objetivo: '', exames: '', terapeutica: '', pergunta: '', unidade_id: st.perfil.unidade_id };
  if (id) {
    const { data, error } = await sb.from('casos').select('*').eq('id', id).single();
    if (error) throw error;
    if (data.estado !== 'novo' && !isPed()) { v.innerHTML = '<div class="alert warn">Este caso já está em análise e não pode ser editado. Use a conversa do caso para acrescentar informação.</div>'; return; }
    c = data;
  }
  const campoTexto = (k, label, hint, rows = 4, req = false, max = 6000) => `
    <div class="field"><div class="labelrow"><label for="c_${k}">${label}${hint ? ` <span class="hint">${hint}</span>` : ''}</label>${botaoDitar('c_' + k)}</div>
      <textarea id="c_${k}" data-k="${k}" rows="${rows}" maxlength="${max}" ${req ? 'required' : ''}>${esc(c[k])}</textarea><div class="fielderr" id="e_${k}"></div></div>`;

  v.innerHTML = `
    <a href="${id ? '#/caso/' + id : '#/casos'}" class="muted small" style="text-decoration:none">${icon('voltar')} Voltar</a>
    <h1>${id ? 'Editar caso ' + esc(c.codigo) : 'Novo caso para discussão'}</h1>
    <div class="alert warn">${icon('cadeado')} <b>Não identifique o doente.</b> Não escreva nome, número de utente, NIF, número de processo, data de nascimento completa, morada, escola ou contactos. Use a idade e descreva só o clinicamente relevante.</div>
    <form id="fc" class="card" novalidate>
      <h2>Identificação mínima</h2>
      <div class="grid2">
        <div class="field"><label for="c_idade">Idade</label>
          <div class="row" style="gap:8px"><input id="c_idade" type="number" min="0" max="216" required value="${esc(c.idade_valor)}" style="flex:1 1 80px">
          <select id="c_idade_u" style="flex:1 1 110px">${['dias', 'semanas', 'meses', 'anos'].map(u => `<option ${c.idade_unidade === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
        <div class="field"><label>Sexo</label><div class="seg">
          ${['F', 'M', 'Indeterminado'].map(s => `<label><input type="radio" name="sexo" value="${s}" ${c.sexo === s ? 'checked' : ''} required> ${sexoTxt(s)}</label>`).join('')}</div></div>
      </div>
      <div>
        <div class="field"><label>Prioridade</label><div class="seg">
          ${Object.entries(PRIORIDADES).map(([k, t]) => `<label><input type="radio" name="prio" value="${k}" ${c.prioridade === k ? 'checked' : ''}> ${t}</label>`).join('')}</div>
          <div class="muted small" style="margin-top:4px">Situações emergentes devem seguir para o Serviço de Urgência, não para a app.</div></div>
      </div>
      ${(isPed() || !st.perfil.unidade_id) ? `<div class="field"><label for="c_unid">Unidade de origem</label><select id="c_unid" required>${opcoesUnidades(c.unidade_id)}</select></div>` : ''}
      <h2 style="margin-top:8px">Caso clínico</h2>
      ${SR ? `<div class="alert info small">${icon('mic')} Pode <b>ditar</b> em vez de escrever: toque em "Ditar" ao lado de cada campo e fale (no iPhone também pode usar o 🎤 do teclado). O texto é convertido pelo reconhecimento de voz do telemóvel/browser, por isso não dite nomes nem números identificativos.</div>` : ''}
      <div class="field"><div class="labelrow"><label for="c_motivo">Motivo da discussão <span class="hint">(1 linha)</span></label>${botaoDitar('c_motivo')}</div>
        <input id="c_motivo" data-k="motivo" maxlength="300" required value="${esc(c.motivo)}" placeholder="Ex.: Sopro cardíaco em criança assintomática"><div class="fielderr" id="e_motivo"></div></div>
      ${campoTexto('historia', 'História clínica', '(antecedentes, evolução, curva de crescimento)', 6, false, 8000)}
      ${campoTexto('exame_objetivo', 'Exame objetivo', '', 3, false, 4000)}
      ${campoTexto('exames', 'Exames complementares', '(resultados e datas aproximadas: mês/ano)', 4)}
      ${campoTexto('terapeutica', 'Terapêutica atual / já tentada', '', 2, false, 2000)}
      ${campoTexto('pergunta', 'Pergunta concreta ao pediatra', '(o que precisa de saber?)', 3, true, 2000)}
      <div id="avisos"></div>
      ${!id ? `<div class="field"><label for="c_img">Imagens <span class="hint">(opcional: fotografias de lesões, ECG, relatórios — JPG/PNG; os metadados são removidos)</span></label>
        <input id="c_img" type="file" accept="image/jpeg,image/png" multiple>
        <div class="muted small">Garanta que nenhuma imagem mostra o rosto, nome, etiqueta ou número do doente.</div></div>` : ''}
      <label class="check"><input type="checkbox" id="c_conf" required> Confirmo que este caso não contém dados que permitam identificar o doente.</label>
      <div class="actions" style="margin-top:16px"><button class="btn" id="gravar">${id ? 'Guardar alterações' : 'Submeter caso'}</button>
        <a class="btn secondary" href="${id ? '#/caso/' + id : '#/casos'}">Cancelar</a></div>
    </form>`;

  const campos = ['motivo', 'historia', 'exame_objetivo', 'exames', 'terapeutica', 'pergunta'];
  const validar = () => {
    let bloq = false; const todosAvisos = new Set();
    for (const k of campos) {
      const { bloqueios, avisos } = verificarTexto($(`#c_${k}`).value);
      $(`#e_${k}`).textContent = bloqueios.length ? 'Remova: ' + bloqueios.join(', ') + '.' : '';
      if (bloqueios.length) bloq = true;
      avisos.forEach(a => todosAvisos.add(a));
    }
    $('#avisos').innerHTML = todosAvisos.size ? `<div class="alert warn"><b>Verifique:</b> o texto parece conter ${[...todosAvisos].join('; ')}.</div>` : '';
    return !bloq;
  };
  campos.forEach(k => $(`#c_${k}`).addEventListener('input', validar));
  ligarDitado(v);
  validar();

  $('#fc').onsubmit = async (e) => {
    e.preventDefault();
    pararDitado();
    const f = e.target;
    if (!validar()) return toast('Existem dados identificativos a remover.', true);
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const btn = $('#gravar'); btn.disabled = true;
    const row = {
      idade_valor: parseInt($('#c_idade').value, 10), idade_unidade: $('#c_idade_u').value,
      sexo: $('input[name=sexo]:checked')?.value, prioridade: $('input[name=prio]:checked')?.value || 'normal',
      motivo: $('#c_motivo').value.trim(), historia: $('#c_historia').value.trim() || null,
      exame_objetivo: $('#c_exame_objetivo').value.trim() || null, exames: $('#c_exames').value.trim() || null,
      terapeutica: $('#c_terapeutica').value.trim() || null, pergunta: $('#c_pergunta').value.trim(),
    };
    if ($('#c_unid')) row.unidade_id = $('#c_unid').value || null;
    try {
      let casoId = id;
      if (id) {
        const { error } = await sb.from('casos').update(row).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('casos').insert(row).select('id').single();
        if (error) throw error;
        casoId = data.id;
        const files = [...($('#c_img')?.files || [])];
        for (const file of files) await carregarAnexo(casoId, file);
      }
      toast(id ? 'Caso atualizado.' : 'Caso submetido. A equipa de pediatria foi notificada.');
      location.hash = '#/caso/' + casoId;
    } catch (err) { toast(erroMsg(err), true); btn.disabled = false; }
  };
}

async function carregarAnexo(casoId, file) {
  if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('Apenas imagens JPG ou PNG.');
  const blob = await anonimizarImagem(file);
  const path = `${casoId}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from('anexos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  const { error: e2 } = await sb.from('anexos').insert({ caso_id: casoId, path });
  if (e2) throw e2;
}

// ---------------------------------------------------------------------------
// Detalhe do caso
// ---------------------------------------------------------------------------
async function vistaCaso(v, id) {
  const [{ data: c, error }, { data: coms }, { data: anx }, { data: pediatras }] = await Promise.all([
    sb.from('casos').select('*, unidades(nome, tipo, centro_saude, aces(nome, uls)), criador:perfis!casos_criado_por_fkey(nome), pediatra:perfis!casos_pediatra_id_fkey(nome, servico)').eq('id', id).maybeSingle(),
    sb.from('comentarios').select('*, autor:perfis(nome, papel)').eq('caso_id', id).order('created_at'),
    sb.from('anexos').select('*').eq('caso_id', id).order('created_at'),
    isPed() ? sb.from('perfis').select('id, nome').in('papel', ['pediatra']).eq('aprovado', true).eq('ativo', true).order('nome') : Promise.resolve({ data: [] }),
  ]);
  if (error) throw error;
  if (!c) { v.innerHTML = '<div class="alert err">Caso não encontrado ou sem permissão.</div>'; return; }
  const ped = isPed();
  const meu = c.criado_por === st.perfil.id;

  // marcar notificações deste caso como lidas
  sb.from('notificacoes').update({ lida: true }).eq('caso_id', id).eq('lida', false).then(() => atualizarContador());

  const urls = {};
  if (anx?.length) {
    const { data: signed } = await sb.storage.from('anexos').createSignedUrls(anx.map(a => a.path), 3600);
    (signed || []).forEach(s => { urls[s.path] = s.signedUrl; });
  }

  const linha = (t, val) => val ? `<dt>${t}</dt><dd>${esc(val)}</dd>` : '';
  v.innerHTML = `
    <a href="#/casos" class="muted small" style="text-decoration:none">${icon('voltar')} Casos</a>
    <div class="row" style="align-items:center;margin:6px 0 14px">
      <div><h1 style="margin:0">${esc(c.codigo)} · ${esc(c.motivo)}</h1>
        <div class="top" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <span class="badge p-${c.prioridade}">${PRIORIDADES[c.prioridade]}</span>
          <span class="badge e-${c.estado}">${ESTADOS[c.estado]}</span>
          ${c.desfecho ? `<span class="badge">${esc(DESFECHOS[c.desfecho])}</span>` : ''}</div></div>
      ${(meu && c.estado === 'novo') || ped ? `<div style="flex:0 0 auto" class="actions">
        <a class="btn secondary small" href="#/caso/${c.id}/editar">Editar</a>
        ${(meu && c.estado === 'novo') || isAdmin() ? '<button class="btn secondary small" id="apagar">Apagar</button>' : ''}</div>` : ''}
    </div>
    <div class="cols">
      <div>
        <section class="card"><h2>Caso clínico</h2>
          <dl class="dl">
            <dt>Idade / sexo</dt><dd>${esc(idadeTxt(c))} · ${esc(sexoTxt(c.sexo))}</dd>
            <dt>Origem</dt><dd>${esc(unidadeTxt(c.unidades))}${c.unidades?.centro_saude ? ' — ' + esc(c.unidades.centro_saude) : ''}${c.unidades?.aces ? '\n' + esc(c.unidades.aces.nome) : ''}</dd>
            <dt>Médico(a) MGF</dt><dd>${esc(c.criador?.nome || 'Colega da unidade')}</dd>
            <dt>Submetido</dt><dd>${fmtDataHora(c.created_at)}</dd>
            ${linha('Área sugerida', c.area)}
            ${linha('História clínica', c.historia)}
            ${linha('Exame objetivo', c.exame_objetivo)}
            ${linha('Exames', c.exames)}
            ${linha('Terapêutica', c.terapeutica)}
          </dl>
          <h3 style="margin-top:14px">Pergunta</h3><div class="answer" style="background:var(--info-soft)">${esc(c.pergunta)}</div>
        </section>
        ${(anx?.length || ped || meu) ? `<section class="card"><h2>Imagens</h2>
          ${anx?.length ? `<div class="gallery">${anx.map(a => `<a href="${esc(urls[a.path] || '#')}" target="_blank" rel="noopener"><img src="${esc(urls[a.path] || '')}" alt="Imagem do caso" loading="lazy"></a>`).join('')}</div>` : '<p class="muted">Sem imagens.</p>'}
          ${c.estado !== 'fechado' ? `<div class="field" style="margin-top:12px"><label for="addImg">Adicionar imagem <span class="hint">(metadados removidos automaticamente)</span></label><input type="file" id="addImg" accept="image/jpeg,image/png" multiple></div>` : ''}
        </section>` : ''}
        <section class="card"><h2>Conversa</h2>
          <div class="thread">${(coms || []).map(m => `
            <div class="msg ${m.interno ? 'interno' : ''} ${m.autor_id === st.perfil.id ? 'mine' : ''}">
              <div class="h"><b>${esc(m.autor?.nome || 'Colega')}</b><span>${m.autor?.papel === 'pediatra' ? 'Pediatria' : 'MGF'}</span><span>${fmtDataHora(m.created_at)}</span>${m.interno ? '<span class="badge e-subespecialidade">Nota interna da pediatria</span>' : ''}</div>
              <div class="t">${esc(m.texto)}</div></div>`).join('') || '<p class="muted">Ainda sem mensagens.</p>'}</div>
          <form id="fm">
            <div class="field"><div class="labelrow"><span></span>${botaoDitar('mTxt')}</div><textarea id="mTxt" rows="3" maxlength="4000" required placeholder="${ped ? 'Mensagem para o médico de família, ou nota interna' : 'Escreva uma mensagem ou acrescente informação'}"></textarea><div class="fielderr" id="mErr"></div></div>
            <div class="row" style="align-items:center">
              ${ped ? '<label class="check" style="flex:1 1 auto"><input type="checkbox" id="mInt"> Nota interna (só pediatras, ex.: discussão com subespecialidade)</label>' : '<span></span>'}
              <div style="flex:0 0 auto"><button class="btn">Enviar</button></div></div>
          </form>
        </section>
      </div>
      <div>
        <section class="card"><h2>Resposta da pediatria</h2>
          ${c.pediatra ? `<p class="small muted">Responsável: <b>${esc(c.pediatra.nome)}</b>${c.pediatra.servico ? ' · ' + esc(c.pediatra.servico) : ''}</p>` : ''}
          ${c.subespecialidade ? `<p class="small">Discutido com: <b>${esc(c.subespecialidade)}</b></p>` : ''}
          ${c.reuniao_em ? `<div class="alert info"><b>Reunião:</b> ${fmtDataHora(c.reuniao_em)}${c.reuniao_local ? '<br>' + esc(c.reuniao_local) : ''}</div>` : ''}
          ${c.resposta ? `<div class="answer">${esc(c.resposta)}</div>` : '<p class="muted">Ainda sem resposta.</p>'}
          ${c.desfecho ? `<p style="margin-top:12px"><b>Desfecho:</b> ${esc(DESFECHOS[c.desfecho])}${c.desfecho_nota ? '<br>' + esc(c.desfecho_nota) : ''}</p>` : ''}
        </section>
        ${ped ? `<section class="card"><h2>Gestão do caso</h2>
          <form id="fg">
            <div class="field"><label for="gEst">Estado</label><select id="gEst">${Object.entries(ESTADOS).map(([k, t]) => `<option value="${k}" ${c.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="field"><label for="gPed">Pediatra responsável</label><select id="gPed"><option value="">—</option>${(pediatras || []).map(p => `<option value="${p.id}" ${c.pediatra_id === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
              ${c.pediatra_id !== st.perfil.id ? '<button type="button" class="linkbtn small" id="gMim">Atribuir a mim</button>' : ''}</div>
            <div class="field"><label for="gSub">Subespecialidade consultada</label><input id="gSub" maxlength="120" list="areasList" value="${esc(c.subespecialidade)}"><datalist id="areasList">${AREAS.map(a => `<option>${a}</option>`).join('')}</datalist></div>
            <div class="field"><div class="labelrow"><label for="gResp">Resposta ao MGF <span class="hint">(visível ao médico de família)</span></label>${botaoDitar('gResp')}</div><textarea id="gResp" rows="5" maxlength="8000">${esc(c.resposta)}</textarea><div class="fielderr" id="gErr"></div></div>
            <div class="grid2">
              <div class="field"><label for="gReu">Reunião presencial</label><input id="gReu" type="datetime-local" value="${toLocalInput(c.reuniao_em)}"></div>
              <div class="field"><label for="gLoc">Local / ligação</label><input id="gLoc" maxlength="300" value="${esc(c.reuniao_local)}" placeholder="Sala, USF ou link Teams"></div>
            </div>
            <div class="field"><label for="gDes">Desfecho</label><select id="gDes"><option value="">— (em aberto)</option>${Object.entries(DESFECHOS).map(([k, t]) => `<option value="${k}" ${c.desfecho === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
            <div class="field"><label for="gDesN">Nota do desfecho <span class="hint">(ex.: consulta de Cardiologia Pediátrica, prioridade)</span></label><input id="gDesN" maxlength="500" value="${esc(c.desfecho_nota)}"></div>
            <button class="btn">Guardar</button>
          </form></section>` : ''}
      </div>
    </div>`;

  ligarDitado(v);
  $('#apagar')?.addEventListener('click', async () => {
    if (!confirm('Apagar definitivamente este caso?')) return;
    const { error } = await sb.from('casos').delete().eq('id', id);
    if (error) return toast(erroMsg(error), true);
    toast('Caso apagado.'); location.hash = '#/casos';
  });

  $('#addImg')?.addEventListener('change', async (e) => {
    try { for (const f of e.target.files) await carregarAnexo(id, f); toast('Imagem adicionada.'); route(); }
    catch (err) { toast(erroMsg(err), true); }
  });

  $('#fm').onsubmit = async (e) => {
    e.preventDefault();
    pararDitado();
    const texto = $('#mTxt').value.trim();
    const { bloqueios } = verificarTexto(texto);
    if (bloqueios.length) { $('#mErr').textContent = 'Remova: ' + bloqueios.join(', ') + '.'; return; }
    if (!texto) return;
    const interno = !!$('#mInt')?.checked;
    const { error } = await sb.from('comentarios').insert({ caso_id: id, texto, interno, autor_id: st.perfil.id });
    if (error) return toast(erroMsg(error), true);
    route();
  };

  if (ped) {
    $('#gMim')?.addEventListener('click', () => { $('#gPed').value = st.perfil.id; if ($('#gEst').value === 'novo') $('#gEst').value = 'em_analise'; });
    $('#gReu').addEventListener('change', () => { if ($('#gReu').value && !['fechado'].includes($('#gEst').value)) $('#gEst').value = 'reuniao_agendada'; });
    $('#gDes').addEventListener('change', () => { if ($('#gDes').value) $('#gEst').value = 'fechado'; });
    $('#fg').onsubmit = async (e) => {
      e.preventDefault();
      pararDitado();
      const resp = $('#gResp').value.trim();
      const b = [...verificarTexto(resp).bloqueios, ...verificarTexto($('#gDesN').value).bloqueios];
      if (b.length) { $('#gErr').textContent = 'Remova: ' + b.join(', ') + '.'; return; }
      let estado = $('#gEst').value;
      if (resp && resp !== (c.resposta || '') && ['novo', 'em_analise', 'subespecialidade'].includes(estado)) estado = 'respondido';
      const upd = {
        estado, pediatra_id: $('#gPed').value || null, subespecialidade: $('#gSub').value.trim() || null,
        resposta: resp || null, reuniao_em: $('#gReu').value ? new Date($('#gReu').value).toISOString() : null,
        reuniao_local: $('#gLoc').value.trim() || null, desfecho: $('#gDes').value || null, desfecho_nota: $('#gDesN').value.trim() || null,
      };
      if (!upd.pediatra_id && estado !== 'novo') upd.pediatra_id = st.perfil.id;
      const { error } = await sb.from('casos').update(upd).eq('id', id);
      if (error) return toast(erroMsg(error), true);
      toast('Caso atualizado. O médico de família foi notificado.');
      route();
    };
  }
}

// ---------------------------------------------------------------------------
// Projeto e critérios de referenciação
// ---------------------------------------------------------------------------
async function vistaProjeto(v) {
  const [{ data: cont }, { data: docs, error }] = await Promise.all([
    sb.from('conteudos').select('*').eq('chave', 'projeto').maybeSingle(),
    sb.from('documentos').select('*').order('categoria').order('ordem').order('titulo'),
  ]);
  if (error) throw error;
  const cats = {};
  (docs || []).forEach(d => (cats[d.categoria] ||= []).push(d));

  v.innerHTML = `
    <h1>Projeto e critérios de referenciação</h1>
    <section class="card"><h2>${esc(cont?.titulo || 'O projeto')}</h2>
      <div class="prose" id="projTxt">${esc(cont?.corpo || '')}</div>
      ${isAdmin() ? `<div class="actions"><button class="btn secondary small" id="editProj">Editar texto</button></div>` : ''}
    </section>
    <section class="card"><h2>Documentos</h2>
      ${Object.keys(cats).length ? Object.entries(cats).map(([cat, ds]) => `<h3 style="margin-top:10px">${esc(cat)}</h3>` + ds.map(d => `
        <div class="doc"><div class="pdf">PDF</div>
          <div class="info"><b>${esc(d.titulo)}</b>${d.descricao ? `<span class="muted small">${esc(d.descricao)}</span>` : ''}</div>
          <button class="btn secondary small" data-abrir="${esc(d.path)}">Abrir</button>
          ${isAdmin() ? `<button class="btn secondary small" data-apagar="${d.id}" data-path="${esc(d.path)}">Remover</button>` : ''}
        </div>`).join('')).join('') : '<p class="muted">Ainda não foram carregados documentos.</p>'}
    </section>
    ${isAdmin() ? `<section class="card"><h2>Carregar PDF</h2>
      <form id="fd"><div class="grid2">
        <div class="field"><label for="dT">Título</label><input id="dT" required maxlength="200" placeholder="Critérios de referenciação — Cardiologia Pediátrica"></div>
        <div class="field"><label for="dC">Categoria</label><input id="dC" required maxlength="100" value="Critérios de referenciação" list="catList">
          <datalist id="catList">${[...new Set(['Critérios de referenciação', 'Protocolos', 'Documentos do projeto', ...Object.keys(cats)])].map(x => `<option>${esc(x)}</option>`).join('')}</datalist></div></div>
        <div class="field"><label for="dD">Descrição <span class="hint">(opcional)</span></label><input id="dD" maxlength="300"></div>
        <div class="field"><label for="dF">Ficheiro PDF <span class="hint">(máx. 20 MB)</span></label><input id="dF" type="file" accept="application/pdf" required></div>
        <button class="btn">Carregar</button></form></section>` : ''}`;

  $$('[data-abrir]', v).forEach(b => b.onclick = async () => {
    const w = window.open('', '_blank');
    const { data, error } = await sb.storage.from('documentos').createSignedUrl(b.dataset.abrir, 3600);
    if (error) { w?.close(); return toast(erroMsg(error), true); }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  });

  if (!isAdmin()) return;
  $('#editProj').onclick = () => {
    $('#projTxt').outerHTML = `<form id="fpj"><div class="field"><input id="pjT" value="${esc(cont?.titulo || 'O projeto PedLink')}" maxlength="200"></div>
      <div class="field"><textarea id="pjB" rows="16">${esc(cont?.corpo || '')}</textarea></div>
      <div class="actions"><button class="btn">Guardar</button></div></form>`;
    $('#editProj').remove();
    $('#fpj').onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.from('conteudos').upsert({ chave: 'projeto', titulo: $('#pjT').value.trim(), corpo: $('#pjB').value, updated_at: new Date().toISOString() });
      if (error) return toast(erroMsg(error), true);
      toast('Texto atualizado.'); route();
    };
  };
  $$('[data-apagar]', v).forEach(b => b.onclick = async () => {
    if (!confirm('Remover este documento?')) return;
    await sb.storage.from('documentos').remove([b.dataset.path]);
    const { error } = await sb.from('documentos').delete().eq('id', b.dataset.apagar);
    if (error) return toast(erroMsg(error), true);
    toast('Documento removido.'); route();
  });
  $('#fd').onsubmit = async (e) => {
    e.preventDefault();
    const file = $('#dF').files[0];
    if (!file || file.type !== 'application/pdf') return toast('Escolha um ficheiro PDF.', true);
    const btn = e.submitter; btn.disabled = true;
    const path = `${crypto.randomUUID()}.pdf`;
    const { error } = await sb.storage.from('documentos').upload(path, file, { contentType: 'application/pdf' });
    if (error) { btn.disabled = false; return toast(erroMsg(error), true); }
    const { error: e2 } = await sb.from('documentos').insert({ titulo: $('#dT').value.trim(), categoria: $('#dC').value.trim(), descricao: $('#dD').value.trim() || null, path });
    if (e2) { btn.disabled = false; return toast(erroMsg(e2), true); }
    toast('Documento carregado.'); route();
  };
}

// ---------------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------------
async function vistaNotificacoes(v) {
  const { data, error } = await sb.from('notificacoes').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  v.innerHTML = `<div class="row" style="align-items:center"><h1 style="margin:0">Notificações</h1>
    <div style="flex:0 0 auto"><button class="btn secondary small" id="todasLidas">Marcar todas como lidas</button></div></div>
    <section class="card" style="margin-top:14px">${(data || []).map(n => `
      <a class="notif ${n.lida ? 'read' : 'unread'}" href="${esc(n.link || '#/casos')}" data-id="${n.id}"><span class="dot"></span>
        <div><b>${esc(n.texto)}</b><div class="muted small">${fmtDataHora(n.created_at)}</div></div></a>`).join('') || '<p class="muted">Sem notificações.</p>'}</section>`;
  $('#todasLidas').onclick = async () => { await sb.from('notificacoes').update({ lida: true }).eq('lida', false); route(); };
  $$('.notif', v).forEach(a => a.addEventListener('click', () => { sb.from('notificacoes').update({ lida: true }).eq('id', a.dataset.id).then(() => atualizarContador()); }));
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------
async function vistaPerfil(v) {
  const p = st.perfil;
  v.innerHTML = `<h1>O meu perfil</h1>
    <form class="card" id="fpf">
      <div class="field"><label>Email</label><input value="${esc(p.email)}" disabled></div>
      <div class="field"><label for="pfN">Nome profissional</label><input id="pfN" value="${esc(p.nome)}" required maxlength="120"></div>
      ${p.papel === 'mgf' ? `<div class="field"><label for="pfU">Unidade de saúde</label><select id="pfU" required>${opcoesUnidades(p.unidade_id)}</select></div>`
      : `<div class="field"><label for="pfH">Hospital</label><select id="pfH"><option value="">—</option>${opcoesHospitais(p.unidade_id).replace(/<option value="outro"[^>]*>[^<]*<\/option>/, '')}</select></div>
         <div class="field"><label for="pfS">Hospital / serviço <span class="hint">(texto mostrado aos colegas)</span></label><input id="pfS" value="${esc(p.servico)}" maxlength="120"></div>`}
      <div class="field"><label for="pfT">Contacto profissional <span class="hint">(opcional, visível aos colegas pediatras)</span></label><input id="pfT" value="${esc(p.telefone_prof)}" maxlength="60"></div>
      <button class="btn">Guardar</button>
    </form>
    <form class="card" id="fpw"><h2>Alterar palavra-passe</h2>
      <div class="field"><label for="pwN">Nova palavra-passe</label><input id="pwN" type="password" minlength="8" required autocomplete="new-password"></div>
      <button class="btn secondary">Alterar</button></form>
    <section class="card"><h2>Sessão</h2><p class="muted small">Termine a sessão para outra pessoa poder usar este dispositivo.</p>
      <button class="btn danger" id="pfSair">${icon('sair')} Sair da conta</button></section>
    <section class="card"><h2>Aspeto</h2><div class="seg" id="tema">
      ${[['', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, t]) => `<label><input type="radio" name="tema" value="${k}" ${(localStorageGet('tema') || '') === k ? 'checked' : ''}> ${t}</label>`).join('')}</div></section>`;
  $('#fpf').onsubmit = async (e) => {
    e.preventDefault();
    const upd = { nome: $('#pfN').value.trim(), telefone_prof: $('#pfT').value.trim() || null };
    if ($('#pfU')) upd.unidade_id = $('#pfU').value; if ($('#pfS')) upd.servico = $('#pfS').value.trim() || null; if ($('#pfH')) upd.unidade_id = $('#pfH').value || null;
    const { error } = await sb.from('perfis').update(upd).eq('id', p.id);
    if (error) return toast(erroMsg(error), true);
    await carregarPerfil(); shell(); route(); toast('Perfil atualizado.');
  };
  $('#fpw').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $('#pwN').value });
    if (error) return toast(erroMsg(error), true);
    e.target.reset(); toast('Palavra-passe alterada.');
  };
  $('#pfSair').onclick = () => sair();
  $$('input[name=tema]').forEach(r => r.onchange = () => { localStorageSet('tema', r.value); aplicarTema(); });
}

function localStorageGet(k) { try { return localStorage.getItem('pedlink.' + k); } catch { return null; } }
function localStorageSet(k, val) { try { localStorage.setItem('pedlink.' + k, val); } catch { /* ignore */ } }
function aplicarTema() { const t = localStorageGet('tema'); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

// ---------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------
async function vistaAdmin(v, tab) {
  v.innerHTML = `<h1>Administração</h1>
    <div class="tabs">${[['utilizadores', 'Utilizadores'], ['unidades', 'ACES e unidades'], ['emails', 'Emails autorizados'], ['estatisticas', 'Estatísticas'], ['testes', 'Dados de teste']]
      .map(([k, t]) => `<button data-t="${k}" class="${tab === k ? 'active' : ''}">${t}</button>`).join('')}</div><div id="adm"></div>`;
  $$('.tabs button', v).forEach(b => b.onclick = () => { location.hash = '#/admin/' + b.dataset.t; });
  const a = $('#adm');
  if (tab === 'utilizadores') return adminUtilizadores(a);
  if (tab === 'unidades') return adminUnidades(a);
  if (tab === 'emails') return adminEmails(a);
  if (tab === 'estatisticas') return adminEstatisticas(a);
  if (tab === 'testes') return adminTestes(a);
}

async function adminTestes(a) {
  const { count } = await sb.from('casos').select('id', { count: 'exact', head: true });
  a.innerHTML = `<section class="card"><h2>Apagar casos de teste</h2>
    <p>Existem <b>${count ?? 0}</b> caso(s) na plataforma. Esta ação apaga <b>todos</b> os casos, mensagens, imagens e notificações associadas, e recomeça a numeração em PL-${new Date().getFullYear()}-0001.</p>
    <div class="alert warn">Use apenas na fase de testes, antes de abrir a plataforma aos colegas. Não pode ser desfeito. Utilizadores, unidades e documentos não são apagados.</div>
    <div class="field"><label for="tConf">Para confirmar escreva APAGAR</label><input id="tConf" autocomplete="off" autocapitalize="characters"></div>
    <button class="btn danger" id="tApagar" disabled>Apagar todos os casos</button></section>`;
  const inp = $('#tConf'), btn = $('#tApagar');
  inp.oninput = () => { btn.disabled = inp.value.trim().toUpperCase() !== 'APAGAR'; };
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'A apagar…';
    try {
      const { data: anx, error: e1 } = await sb.from('anexos').select('path');
      if (e1) throw e1;
      const paths = (anx || []).map(x => x.path);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await sb.storage.from('anexos').remove(paths.slice(i, i + 100));
        if (error) throw error;
      }
      const { data: n, error: e2 } = await sb.rpc('apagar_todos_casos');
      if (e2) throw e2;
      toast(`${n} caso(s) apagado(s). A numeração recomeça em 0001.`);
      adminTestes(a);
    } catch (err) {
      toast('Não foi possível apagar: ' + (err.message || err), true);
      btn.textContent = 'Apagar todos os casos'; btn.disabled = false;
    }
  };
}

async function adminUtilizadores(a) {
  const { data, error } = await sb.from('perfis').select('*, unidades(nome, tipo)').order('aprovado').order('created_at', { ascending: false });
  if (error) throw error;
  const pend = data.filter(p => !p.aprovado);
  a.innerHTML = `
    ${pend.length ? `<div class="alert warn"><b>${pend.length}</b> pedido(s) de acesso pendente(s).</div>` : ''}
    <div class="card tablewrap"><table class="table"><thead><tr><th>Nome</th><th>Email</th><th>Perfil</th><th>Unidade / serviço</th><th>Estado</th><th>Ações</th></tr></thead><tbody>
    ${data.map(p => `<tr>
      <td><b>${esc(p.nome)}</b><div class="muted small">${fmtData(p.created_at)}</div></td>
      <td class="small">${esc(p.email)}</td>
      <td><select data-papel="${p.id}" ${p.id === st.perfil.id ? 'disabled' : ''}><option value="mgf" ${p.papel === 'mgf' ? 'selected' : ''}>MGF</option><option value="pediatra" ${p.papel === 'pediatra' ? 'selected' : ''}>Pediatra</option></select>
        <label class="check small" style="margin-top:4px"><input type="checkbox" data-admin="${p.id}" ${p.is_admin ? 'checked' : ''} ${p.id === st.perfil.id ? 'disabled' : ''}> admin</label></td>
      <td class="small">${p.papel === 'mgf' ? esc(unidadeTxt(p.unidades)) : esc(p.servico || '—')}</td>
      <td>${!p.aprovado ? '<span class="badge p-prioritario">Pendente</span>' : p.ativo ? '<span class="badge p-normal">Ativo</span>' : '<span class="badge">Inativo</span>'}</td>
      <td><div class="actions" style="margin:0">
        ${!p.aprovado ? `<button class="btn small" data-aprovar="${p.id}">Aprovar</button>` : ''}
        ${p.id !== st.perfil.id ? `<button class="btn secondary small" data-ativo="${p.id}" data-v="${!p.ativo}">${p.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}
      </div></td></tr>`).join('')}</tbody></table></div>`;
  const upd = async (id, obj) => { const { error } = await sb.from('perfis').update(obj).eq('id', id); if (error) toast(erroMsg(error), true); else { toast('Atualizado.'); route(); } };
  $$('[data-aprovar]', a).forEach(b => b.onclick = () => upd(b.dataset.aprovar, { aprovado: true, ativo: true }));
  $$('[data-ativo]', a).forEach(b => b.onclick = () => upd(b.dataset.ativo, { ativo: b.dataset.v === 'true' }));
  $$('[data-papel]', a).forEach(s => s.onchange = () => upd(s.dataset.papel, { papel: s.value }));
  $$('[data-admin]', a).forEach(c => c.onchange = () => upd(c.dataset.admin, { is_admin: c.checked }));
}

async function adminUnidades(a) {
  await carregarUnidades();
  a.innerHTML = `
    <section class="card"><h2>Novo ACES / ULS</h2>
      <form id="fa" class="row"><div><label for="aN">Nome do ACES</label><input id="aN" required maxlength="150" placeholder="ACES Lisboa Norte"></div>
        <div><label for="aU">ULS <span class="hint">(opcional)</span></label><input id="aU" maxlength="150" placeholder="ULS Santa Maria"></div>
        <div style="flex:0 0 auto"><button class="btn">Adicionar</button></div></form></section>
    <section class="card"><h2>Nova unidade funcional</h2>
      <form id="fu"><div class="grid2">
        <div class="field"><label for="uA">ACES</label><select id="uA" required><option value="">—</option>${st.aces.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></div>
        <div class="field"><label for="uT">Tipo</label><select id="uT">${TIPOS_UNIDADE.map(t => `<option>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="uN">Nome da unidade</label><input id="uN" required maxlength="150" placeholder="USF Exemplo"></div>
        <div class="field"><label for="uC">Centro de saúde / polo <span class="hint">(opcional)</span></label><input id="uC" maxlength="150"></div>
      </div><button class="btn">Adicionar unidade</button></form></section>
    ${st.aces.map(x => `<section class="card"><h2>${esc(x.nome)} ${x.uls ? `<span class="muted small">· ${esc(x.uls)}</span>` : ''}</h2>
      <div class="actions" style="margin:-4px 0 10px"><button class="btn secondary small" data-renaces="${x.id}" data-nome="${esc(x.nome)}" data-uls="${esc(x.uls || '')}">Editar ACES</button>
        <button class="btn secondary small" data-delaces="${x.id}">Apagar ACES</button></div>
      <div class="tablewrap"><table class="table"><thead><tr><th>Tipo</th><th>Unidade</th><th>Centro de saúde</th><th>Estado</th><th></th></tr></thead><tbody>
      ${st.unidades.filter(u => u.aces_id === x.id).map(u => `<tr><td>${esc(u.tipo)}</td><td>${esc(u.nome)}</td><td>${esc(u.centro_saude || '')}</td>
        <td>${u.ativo ? '<span class="badge p-normal">Ativa</span>' : '<span class="badge">Inativa</span>'}</td>
        <td><div class="actions" style="margin:0"><button class="btn secondary small" data-editu="${u.id}">Editar</button><button class="btn secondary small" data-togu="${u.id}" data-v="${!u.ativo}">${u.ativo ? 'Desativar' : 'Ativar'}</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sem unidades.</td></tr>'}
      </tbody></table></div></section>`).join('')}`;

  const done = (error, msg) => { if (error) toast(erroMsg(error), true); else { toast(msg); route(); } };
  $('#fa').onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.from('aces').insert({ nome: $('#aN').value.trim(), uls: $('#aU').value.trim() || null }); done(error, 'ACES adicionado.'); };
  $('#fu').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('unidades').insert({ aces_id: $('#uA').value, tipo: $('#uT').value, nome: $('#uN').value.trim(), centro_saude: $('#uC').value.trim() || null });
    done(error, 'Unidade adicionada.');
  };
  $$('[data-togu]', a).forEach(b => b.onclick = async () => { const { error } = await sb.from('unidades').update({ ativo: b.dataset.v === 'true' }).eq('id', b.dataset.togu); done(error, 'Atualizado.'); });
  $$('[data-editu]', a).forEach(b => b.onclick = async () => {
    const u = st.unidades.find(x => x.id === b.dataset.editu);
    const nome = prompt('Nome da unidade', u.nome); if (nome === null) return;
    const cs = prompt('Centro de saúde / polo', u.centro_saude || ''); if (cs === null) return;
    const tipo = prompt('Tipo (' + TIPOS_UNIDADE.join(', ') + ')', u.tipo); if (tipo === null) return;
    const { error } = await sb.from('unidades').update({ nome: nome.trim(), centro_saude: cs.trim() || null, tipo: TIPOS_UNIDADE.includes(tipo.trim()) ? tipo.trim() : u.tipo }).eq('id', u.id);
    done(error, 'Unidade atualizada.');
  });
  $$('[data-renaces]', a).forEach(b => b.onclick = async () => {
    const nome = prompt('Nome do ACES', b.dataset.nome); if (nome === null) return;
    const uls = prompt('ULS', b.dataset.uls); if (uls === null) return;
    const { error } = await sb.from('aces').update({ nome: nome.trim(), uls: uls.trim() || null }).eq('id', b.dataset.renaces);
    done(error, 'ACES atualizado.');
  });
  $$('[data-delaces]', a).forEach(b => b.onclick = async () => {
    if (!confirm('Apagar este ACES? Só é possível se não tiver unidades.')) return;
    const { error } = await sb.from('aces').delete().eq('id', b.dataset.delaces);
    done(error ? { message: 'Não é possível apagar: o ACES ainda tem unidades associadas.' } : null, 'ACES apagado.');
  });
}

async function adminEmails(a) {
  const { data } = await sb.from('emails_autorizados').select('*').order('created_at', { ascending: false });
  a.innerHTML = `<section class="card"><h2>Emails autorizados fora do domínio min-saude.pt</h2>
    <p class="muted small">Por defeito só emails @…min-saude.pt podem criar conta. Adicione aqui exceções (ex.: pediatras com email de hospital fora do domínio).</p>
    <form id="fe" class="row"><div><label for="eE">Email</label><input id="eE" type="email" required></div><div><label for="eN">Nota</label><input id="eN" maxlength="200"></div>
      <div style="flex:0 0 auto"><button class="btn">Autorizar</button></div></form>
    <div class="tablewrap" style="margin-top:14px"><table class="table"><tbody>${(data || []).map(x => `<tr><td>${esc(x.email)}</td><td class="muted">${esc(x.nota || '')}</td><td><button class="btn secondary small" data-del="${esc(x.email)}">Remover</button></td></tr>`).join('') || '<tr><td class="muted">Nenhum.</td></tr>'}</tbody></table></div></section>`;
  $('#fe').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('emails_autorizados').insert({ email: $('#eE').value.trim().toLowerCase(), nota: $('#eN').value.trim() || null });
    if (error) return toast(erroMsg(error), true); toast('Email autorizado.'); route();
  };
  $$('[data-del]', a).forEach(b => b.onclick = async () => { await sb.from('emails_autorizados').delete().eq('email', b.dataset.del); route(); });
}

async function adminEstatisticas(a) {
  const { data, error } = await sb.from('casos').select('estado, prioridade, desfecho, area, created_at, updated_at, unidade_id, unidades(nome, tipo, aces(nome))');
  if (error) throw error;
  const conta = (arr, f) => arr.reduce((m, x) => { const k = f(x) || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const tabela = (titulo, obj, map = {}) => `<section class="card"><h2>${titulo}</h2><table class="table"><tbody>${Object.entries(obj).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<tr><td>${esc(map[k] || k)}</td><td style="text-align:right"><b>${n}</b></td></tr>`).join('') || '<tr><td class="muted">Sem dados.</td></tr>'}</tbody></table></section>`;
  const fechados = data.filter(c => c.estado === 'fechado');
  const tempos = fechados.map(c => (new Date(c.updated_at) - new Date(c.created_at)) / 86400000).sort((x, y) => x - y);
  const mediana = tempos.length ? tempos[Math.floor(tempos.length / 2)].toFixed(1) : '—';
  a.innerHTML = `<div class="stats">
      <div class="stat"><b>${data.length}</b><span>Casos totais</span></div>
      <div class="stat"><b>${fechados.length}</b><span>Fechados</span></div>
      <div class="stat"><b>${fechados.length ? Math.round(100 * fechados.filter(c => c.desfecho === 'nao_referenciar' || c.desfecho === 'seguimento_mgf').length / fechados.length) + '%' : '—'}</b><span>Resolvidos sem referenciação</span></div>
      <div class="stat"><b>${mediana}</b><span>Mediana de dias até fecho</span></div></div>
    <div class="grid2">
      ${tabela('Por desfecho', conta(fechados, c => c.desfecho), DESFECHOS)}
      ${tabela('Por estado', conta(data, c => c.estado), ESTADOS)}
      ${tabela('Por área', conta(data, c => c.area))}
      ${tabela('Por ACES', conta(data, c => c.unidades?.aces?.nome))}
      ${tabela('Por unidade', conta(data, c => unidadeTxt(c.unidades)))}
      ${tabela('Por prioridade', conta(data, c => c.prioridade), PRIORIDADES)}
    </div>`;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
let recuperacao = false;
async function arrancar() {
  aplicarTema();
  const { data: { session } } = await sb.auth.getSession();
  st.session = session;
  await carregarUnidades();
  if (recuperacao || location.hash.startsWith('#/nova-password')) { if (session) return ecraNovaPassword(); }
  const qs = new URLSearchParams(location.search + '&' + location.hash.replace(/^#\/?[^?&]*[?&]?/, ''));
  const errDesc = qs.get('error_description');
  if (errDesc) history.replaceState(null, '', location.pathname + (location.hash.startsWith('#/') ? location.hash.split('?')[0] : ''));
  if (!session) {
    st.perfil = null;
    if (errDesc) return ecraAuth('entrar', /expired|invalid/i.test(errDesc)
      ? 'A ligação de confirmação já não é válida (expirou ou já foi usada). Tente entrar com o email e palavra-passe; se a conta ainda não estiver confirmada, use "Recuperar acesso" para receber nova ligação.'
      : 'Erro na ligação recebida por email: ' + esc(errDesc));
    return ecraAuth();
  }
  st.perfilErro = null;
  try { await carregarPerfil(); } catch (e) { st.perfil = null; st.perfilErro = e?.message || String(e); console.error(e); }
  if (!st.perfil || !st.perfil.aprovado || !st.perfil.ativo) return ecraPendente();
  shell();
  route();
}

sb.auth.onAuthStateChange((evt, session) => {
  if (evt === 'PASSWORD_RECOVERY') { recuperacao = true; st.session = session; ecraNovaPassword(); return; }
  if (evt === 'SIGNED_IN' && (!st.session || st.session.user.id !== session?.user.id)) { st.session = session; setTimeout(arrancar, 0); }
  if (evt === 'SIGNED_OUT' && st.perfil) { st.session = null; st.perfil = null; ecraAuth(); }
});
window.addEventListener('hashchange', () => { if (st.perfil && !location.hash.startsWith('#/nova-password')) route(); });
setInterval(() => { if (document.visibilityState === 'visible') atualizarContador(); }, 60000);

arrancar();
