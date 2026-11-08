'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  donoManager — o "painel de dono" do bot (só o BOT_OWNER_ID usa)
//
//  • Ocultar comandos: some do Discord (re-registro) e fica bloqueado na execução.
//  • Bloquear botões/menus/modais por grupo ou prefixo de customId (o dono ignora o bloqueio).
//  • Modo manutenção: ninguém além do dono usa o bot (mensagem personalizável).
//  • Comandos criados por arquivo (.js): ficam salvos no banco e são recarregados ao ligar.
//
//  Estado salvo no banco, na "guild" especial `__bot__` → extras.dono  (entra no backup do banco).
// ═══════════════════════════════════════════════════════════════════════════
const path = require('path');
const Module = require('module');
const db = require('../database/db');
const { BOT_OWNER_ID } = require('../config/constants');

const ROOT = path.join(__dirname, '..');
const ID_ESTADO = '__bot__';
const MAX_CUSTOM = 20;
const MAX_BYTES = 100 * 1024;

const PADRAO = () => ({ ocultos: [], bloqueios: [], manutencao: { ativa: false, msg: '' }, custom: {}, pendente: false });
let cache = null;

function estado() {
  if (!cache) {
    let salvo = {};
    try { salvo = db.getGuild(ID_ESTADO).extras?.dono || {}; } catch (e) { console.error('[Dono] Falha ao ler estado:', e.message); }
    cache = { ...PADRAO(), ...salvo };
    cache.manutencao = { ativa: false, msg: '', ...(salvo.manutencao || {}) };
  }
  return cache;
}
function salvar() {
  try { db.updateGuild(ID_ESTADO, 'extras.dono', estado()); } catch (e) { console.error('[Dono] Falha ao salvar estado:', e.message); }
}
const ehDono = (id) => id === BOT_OWNER_ID;

// ── Grupos de botões (prefixos dos customIds do bot) ───────────────────────
const GRUPOS = [
  { id: 'tickets',    nome: 'Tickets',            prefixos: ['tkt_', 'modal_tkt_'] },
  { id: 'loja',       nome: 'Loja e compras',     prefixos: ['loja_', 'cliente_', 'confirmar_compra', 'cancelar_compra'] },
  { id: 'produtos',   nome: 'Painel de produtos', prefixos: ['prod_', 'var_'] },
  { id: 'cupons',     nome: 'Cupons',             prefixos: ['cup_'] },
  { id: 'carteira',   nome: 'Carteira',           prefixos: ['carteira_', 'modal_pix_'] },
  { id: 'sorteios',   nome: 'Sorteios',           prefixos: ['srt_'] },
  { id: 'convites',   nome: 'Convites',           prefixos: ['invite_'] },
  { id: 'protecao',   nome: 'Proteção',           prefixos: ['prot_'] },
  { id: 'insights',   nome: 'Insights',           prefixos: ['insights_'] },
  { id: 'verifica',   nome: 'Verificação',        prefixos: ['v_', 'vf_'] },
  { id: 'templates',  nome: 'Templates',          prefixos: ['tpl_'] },
  { id: 'backup',     nome: 'Backup (HUD)',       prefixos: ['bkp_'] },
  { id: 'voz',        nome: 'Suporte por voz',    prefixos: ['vsup_'] },
  { id: 'sugestoes',  nome: 'Sugestões',          prefixos: ['sug_'] },
  { id: 'ranking',    nome: 'Ranking',            prefixos: ['rank_'] },
  { id: 'boasvindas', nome: 'Boas-vindas',        prefixos: ['BV_'] },
  { id: 'licencas',   nome: 'Licenças',           prefixos: ['lic_', 'license_'] },
  { id: 'fidelidade', nome: 'Fidelidade/Afiliados', prefixos: ['xfid_', 'xafil_'] },
  { id: 'reembolso',  nome: 'Reembolso',          prefixos: ['xreemb_'] },
  { id: 'logs',       nome: 'Logs do servidor',   prefixos: ['xlogs_'] },
];
const grupoBloqueado = (g) => g.prefixos.every(p => estado().bloqueios.includes(p));

function alternarGrupo(idGrupo) {
  const g = GRUPOS.find(x => x.id === idGrupo); if (!g) return null;
  const e = estado();
  if (grupoBloqueado(g)) e.bloqueios = e.bloqueios.filter(p => !g.prefixos.includes(p));
  else e.bloqueios = [...new Set([...e.bloqueios, ...g.prefixos])];
  salvar();
  return grupoBloqueado(g);
}
/** Bloqueia/desbloqueia um prefixo digitado pelo dono. Devolve { ok, motivo?, bloqueado? }. */
function alternarPrefixo(prefixo) {
  const p = String(prefixo || '').trim();
  if (p.length < 3) return { ok: false, motivo: 'Use pelo menos 3 caracteres (ex.: `tkt_cfg_`).' };
  if (p.length > 80 || /\s/.test(p)) return { ok: false, motivo: 'Prefixo inválido.' };
  if ('xdono_'.startsWith(p) || p.startsWith('xdono_')) return { ok: false, motivo: 'Não dá pra bloquear o próprio painel do dono.' };
  const e = estado();
  if (e.bloqueios.includes(p)) { e.bloqueios = e.bloqueios.filter(x => x !== p); salvar(); return { ok: true, bloqueado: false }; }
  e.bloqueios.push(p); salvar(); return { ok: true, bloqueado: true };
}
function desbloquearTudo() { estado().bloqueios = []; salvar(); }
const botaoBloqueado = (customId) => typeof customId === 'string' && estado().bloqueios.some(p => customId.startsWith(p));

// ── Comandos ocultos ───────────────────────────────────────────────────────
const estaOculto = (nome) => estado().ocultos.includes(nome);
function alternarOculto(nome) {
  if (nome === 'dono') return null;
  const e = estado();
  if (e.ocultos.includes(nome)) e.ocultos = e.ocultos.filter(n => n !== nome); else e.ocultos.push(nome);
  e.pendente = true; salvar();
  return e.ocultos.includes(nome);
}

// ── Manutenção ─────────────────────────────────────────────────────────────
function alternarManutencao() { const e = estado(); e.manutencao.ativa = !e.manutencao.ativa; salvar(); return e.manutencao.ativa; }
function definirMsgManutencao(msg) { estado().manutencao.msg = String(msg || '').slice(0, 300); salvar(); }

/** Chamado no começo de TODA interação. Devolve true se a interação foi barrada (e já respondida). */
async function barrar(interaction) {
  try {
    if (ehDono(interaction.user?.id)) return false;
    const e = estado();
    let motivo = null;
    if (e.manutencao.ativa) motivo = e.manutencao.msg || '🛠️ O bot está em manutenção rápida. Tente novamente em alguns minutos.';
    else if (interaction.isChatInputCommand?.() || interaction.isContextMenuCommand?.() || interaction.isAutocomplete?.()) {
      if (e.ocultos.includes(interaction.commandName)) motivo = 'Este comando está indisponível no momento.';
    } else if (botaoBloqueado(interaction.customId)) motivo = 'Esta função foi desativada temporariamente pelo dono do bot.';
    if (!motivo) return false;
    if (interaction.isAutocomplete?.()) { await interaction.respond([]).catch(() => {}); return true; }
    await interaction.reply({ content: motivo, flags: 64 }).catch(() => {});
    return true;
  } catch { return false; }
}

// ── Comandos criados por arquivo ───────────────────────────────────────────
const NOME_VALIDO = /^[a-z0-9_-]{1,32}$/;

/** Executa o código do arquivo como se fosse um módulo do projeto (require funciona normalmente). */
function compilar(codigo, arquivo) {
  const caminho = path.join(ROOT, 'comandos-custom', arquivo.replace(/[^a-zA-Z0-9_.-]/g, '_'));
  const m = new Module(caminho, module);
  m.filename = caminho;
  m.paths = Module._nodeModulePaths(path.dirname(caminho)).concat(Module._nodeModulePaths(ROOT));
  m._compile(codigo, caminho);
  return m.exports;
}
function extrair(exportado) {
  const lista = Array.isArray(exportado) ? exportado : [exportado];
  return lista.find(c => c && c.data && typeof c.data.toJSON === 'function' && typeof c.execute === 'function') || null;
}

function removerComandoDoBot(nome, client) {
  client.commands.delete(nome);
  client.commandPerms?.delete(nome);
  const arr = client.commandsJSON;
  if (arr) { const i = arr.findIndex(c => c.name === nome); if (i >= 0) arr.splice(i, 1); }
}

/** Valida + instala (ou substitui) um comando criado pelo dono. */
function instalarComando({ nome, descricao, codigo, arquivo }, client, registrar) {
  nome = String(nome || '').trim().toLowerCase();
  if (!NOME_VALIDO.test(nome)) return { ok: false, motivo: 'Nome inválido. Use só letras minúsculas, números, `-` e `_` (até 32).' };
  const e = estado();
  const jaCustom = !!e.custom[nome];
  if (client.commands.has(nome) && !jaCustom) return { ok: false, motivo: `Já existe um comando do bot chamado **/${nome}**. Escolha outro nome.` };
  if (!jaCustom && Object.keys(e.custom).length >= MAX_CUSTOM) return { ok: false, motivo: `Limite de ${MAX_CUSTOM} comandos criados.` };
  if (Buffer.byteLength(codigo, 'utf8') > MAX_BYTES) return { ok: false, motivo: 'Arquivo grande demais (máx. 100 KB).' };

  let cmd;
  try {
    cmd = extrair(compilar(codigo, arquivo || `${nome}.js`));
  } catch (err) {
    return { ok: false, motivo: `O arquivo deu erro ao carregar:\n\`\`\`\n${String(err.stack || err.message).split('\n').slice(0, 4).join('\n').slice(0, 500)}\n\`\`\`` };
  }
  if (!cmd) return { ok: false, motivo: 'Não achei um comando no arquivo. Ele precisa exportar `{ data: new SlashCommandBuilder()..., async execute(interaction) {...} }`.' };
  try {
    cmd.data.setName(nome);
    if (descricao && typeof cmd.data.setDescription === 'function') cmd.data.setDescription(String(descricao).slice(0, 100));
    cmd.data.toJSON(); // valida o builder
  } catch (err) {
    return { ok: false, motivo: `O comando do arquivo é inválido: ${String(err.message).slice(0, 300)}` };
  }
  if (jaCustom) removerComandoDoBot(nome, client);
  client.commands.set(nome, cmd);
  registrar(cmd);
  const json = cmd.data.toJSON();
  e.custom[nome] = { nome, descricao: json.description || '', codigo, arquivo: arquivo || `${nome}.js`, criadoEm: new Date().toISOString() };
  e.pendente = true;
  salvar();
  return { ok: true, nome, descricao: json.description || '', substituiu: jaCustom };
}

function removerComandoCustom(nome, client) {
  const e = estado();
  if (!e.custom[nome]) return false;
  delete e.custom[nome];
  e.ocultos = e.ocultos.filter(n => n !== nome);
  removerComandoDoBot(nome, client);
  e.pendente = true;
  salvar();
  return true;
}

/** Recarrega os comandos criados ao ligar o bot. Um arquivo quebrado nunca derruba o bot. */
function carregarCustom(client, registrar) {
  const e = estado();
  for (const c of Object.values(e.custom)) {
    try {
      const cmd = extrair(compilar(c.codigo, c.arquivo));
      if (!cmd) throw new Error('sem comando exportado');
      cmd.data.setName(c.nome);
      if (c.descricao && typeof cmd.data.setDescription === 'function') cmd.data.setDescription(c.descricao.slice(0, 100));
      if (client.commands.has(c.nome)) { console.warn(`[Dono] Comando criado "/${c.nome}" ignorado: já existe um comando do bot com esse nome.`); continue; }
      client.commands.set(c.nome, cmd);
      registrar(cmd);
    } catch (err) {
      console.error(`[Dono] ❌ Comando criado "/${c.nome}" não carregou:`, err.message);
    }
  }
  if (Object.keys(e.custom).length) console.log(`[Dono] ${Object.keys(e.custom).length} comando(s) criado(s) pelo dono carregado(s).`);
}

const marcarSincronizado = () => { estado().pendente = false; salvar(); };

module.exports = {
  ehDono, estado, salvar, GRUPOS, grupoBloqueado, alternarGrupo, alternarPrefixo, desbloquearTudo, botaoBloqueado,
  estaOculto, alternarOculto, alternarManutencao, definirMsgManutencao, barrar,
  instalarComando, removerComandoCustom, carregarCustom, marcarSincronizado, NOME_VALIDO, MAX_BYTES,
};
