'use strict';
/**
 * KAEL — Dashboard web
 *
 * Roda no MESMO servidor HTTP do bot (sales-system/webhook.js), sem abrir
 * porta nova. Rotas:
 *   GET  /dashboard                  → página (SPA preto e branco)
 *   GET  /dashboard/login            → manda pro OAuth2 do Discord (identify + guilds)
 *   GET  /dashboard/callback         → recebe o code, cria sessão
 *   GET  /dashboard/logout           → encerra sessão
 *   GET  /dashboard/api/me           → usuário + servidores onde ele é Dono/ADM
 *   GET  /dashboard/api/guild/:id    → dados da loja daquele servidor
 *
 * Regras de acesso:
 *   - Só aparece servidor onde o usuário é DONO ou tem permissão ADMINISTRATOR.
 *   - Servidor onde o Kael já está → abre o painel.
 *   - Servidor onde o Kael NÃO está → botão "Adicionar bot".
 *   - Se o Kael não está em NENHUM servidor do usuário → tela "Comprar",
 *     que leva pro servidor oficial (KAEL_BUY_URL).
 *
 * O access_token do Discord é usado só no callback (pra buscar usuário e
 * servidores) e descartado — nunca fica guardado na sessão.
 *
 * Variáveis (as 3 primeiras já existem por causa da verificação web):
 *   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, PUBLIC_BASE_URL
 *   SESSION_SECRET (opcional, assina o cookie), KAEL_BUY_URL (opcional)
 *
 * IMPORTANTE: o painel só LÊ dados. Nada aqui altera loja, estoque ou
 * pagamentos. O conteúdo do estoque (chaves/contas entregues) nunca é
 * enviado pro navegador — só a contagem.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const engine = require('../insights-system/insightsEngine');

const DISCORD_API = 'https://discord.com/api/v10';
const BUY_URL = process.env.KAEL_BUY_URL || 'https://discord.gg/wkDS2DYBBr';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_CAP = 5000;
const PERM_ADMIN = 0x8n;
const DIA_MS = engine.DIA_MS;
const TZ = 'America/Sao_Paulo';

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sessoes = new Map();      // sid → { user, guilds, expiresAt }
const estadosOAuth = new Map(); // state → expiresAt

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessoes) if (s.expiresAt <= now) sessoes.delete(k);
  for (const [k, t] of estadosOAuth) if (t <= now) estadosOAuth.delete(k);
}, 60 * 1000).unref?.();

// ── util ────────────────────────────────────────────────────────────────
const assinar = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const seguro = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function configOk() {
  return !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && process.env.PUBLIC_BASE_URL);
}
const base = () => String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const redirectUri = () => `${base()}/dashboard/callback`;

function lerCookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, nome, valor, maxAgeSeg) {
  const seguroFlag = base().startsWith('https') ? '; Secure' : '';
  const c = `${nome}=${encodeURIComponent(valor)}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeg}${seguroFlag}`;
  const atual = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', atual ? [].concat(atual, c) : c);
}
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function redirecionar(res, url) { res.writeHead(302, { Location: url }); res.end(); }

function sessaoDe(req) {
  const c = lerCookies(req).kael_sess;
  if (!c) return null;
  const [sid, sig] = c.split('.');
  if (!sid || !sig || !seguro(sig, assinar(sid))) return null;
  const s = sessoes.get(sid);
  if (!s || s.expiresAt <= Date.now()) { sessoes.delete(sid); return null; }
  return { sid, ...s };
}

function podeGerenciar(guild) {
  if (guild.owner) return true;
  try { return (BigInt(guild.permissions || '0') & PERM_ADMIN) === PERM_ADMIN; } catch { return false; }
}

function urlAdicionarBot(guildId) {
  const p = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    scope: 'bot applications.commands',
    permissions: '8',
    guild_id: guildId,
    disable_guild_select: 'true',
  });
  return `https://discord.com/oauth2/authorize?${p}`;
}

// ── OAuth ───────────────────────────────────────────────────────────────
async function trocarCode(code) {
  const r = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return r.json();
}
async function discordGet(rota, token) {
  const r = await fetch(`${DISCORD_API}${rota}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${rota} ${r.status}`);
  return r.json();
}

async function rotaLogin(req, res) {
  if (!configOk()) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Dashboard não configurado: defina DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET e PUBLIC_BASE_URL.');
  }
  const state = crypto.randomBytes(20).toString('hex');
  estadosOAuth.set(state, Date.now() + 10 * 60 * 1000);
  setCookie(res, 'kael_state', `${state}.${assinar(state)}`, 600);
  const p = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'none',
  });
  redirecionar(res, `https://discord.com/oauth2/authorize?${p}`);
}

async function rotaCallback(req, res, url) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const ck = (lerCookies(req).kael_state || '').split('.');
  const ok = state && code && ck[0] === state && ck[1] && seguro(ck[1], assinar(state)) && estadosOAuth.has(state);
  estadosOAuth.delete(state);
  if (!ok) return redirecionar(res, '/dashboard?erro=login');
  try {
    const tok = await trocarCode(code);
    const [user, guilds] = await Promise.all([
      discordGet('/users/@me', tok.access_token),
      discordGet('/users/@me/guilds', tok.access_token),
    ]);
    if (sessoes.size > SESSION_CAP) sessoes.delete(sessoes.keys().next().value);
    const sid = crypto.randomBytes(24).toString('hex');
    sessoes.set(sid, {
      user: { id: user.id, nome: user.global_name || user.username, avatar: user.avatar },
      guilds: guilds.filter(podeGerenciar).map(g => ({ id: g.id, nome: g.name, icone: g.icon })),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    setCookie(res, 'kael_sess', `${sid}.${assinar(sid)}`, SESSION_TTL_MS / 1000);
    setCookie(res, 'kael_state', '', 0);
    redirecionar(res, '/dashboard');
  } catch (e) {
    console.error('[Dashboard] Falha no login:', e.message);
    redirecionar(res, '/dashboard?erro=login');
  }
}

// ── dados ───────────────────────────────────────────────────────────────
function diaBR(d) { return d.toLocaleDateString('sv-SE', { timeZone: TZ }); }
const arred = n => Math.round(n * 100) / 100;

function rotaMe(req, res, client) {
  const s = sessaoDe(req);
  if (!s) return json(res, 401, { logado: false, loginUrl: '/dashboard/login', configurado: configOk() });
  const guilds = s.guilds.map(g => ({ ...g, botPresente: client.guilds.cache.has(g.id), adicionarUrl: urlAdicionarBot(g.id) }));
  json(res, 200, {
    logado: true,
    user: s.user,
    guilds,
    temBotEmAlgum: guilds.some(g => g.botPresente),
    comprarUrl: BUY_URL,
  });
}

async function nomesClientes(client, ids) {
  const mapa = {};
  await Promise.allSettled(ids.map(async id => {
    const u = client.users.cache.get(id) || await client.users.fetch(id).catch(() => null);
    mapa[id] = u ? (u.globalName || u.username) : `Usuário ${String(id).slice(-4)}`;
  }));
  return mapa;
}

async function rotaGuild(req, res, client, guildId, url) {
  const s = sessaoDe(req);
  if (!s) return json(res, 401, { erro: 'não logado' });
  if (!s.guilds.some(g => g.id === guildId)) return json(res, 403, { erro: 'sem permissão neste servidor' });
  if (!client.guilds.cache.has(guildId)) return json(res, 404, { erro: 'bot não está neste servidor' });

  const dias = Math.min(365, Math.max(1, parseInt(url.searchParams.get('dias'), 10) || 30));
  const agora = Date.now();
  const todas = engine.carregarVendas(guildId);
  const ativas = v => !v.reembolsado;

  const atual = engine.filtrarPorPeriodo(todas, dias);
  const anterior = engine.filtrarPorIntervalo(todas, agora - 2 * dias * DIA_MS, agora - dias * DIA_MS);
  const liquidas = atual.filter(ativas);
  const faturamento = liquidas.reduce((a, v) => a + v.valorNum, 0);
  const fatAnterior = anterior.filter(ativas).reduce((a, v) => a + v.valorNum, 0);
  const reembolsos = atual.filter(v => v.reembolsado);

  // série diária (preenche dias sem venda com 0)
  const serie = new Map();
  for (let i = dias - 1; i >= 0; i--) serie.set(diaBR(new Date(agora - i * DIA_MS)), { dia: null, valor: 0, pedidos: 0 });
  for (const [k, o] of serie) o.dia = k;
  for (const v of liquidas) {
    const o = serie.get(diaBR(v.data));
    if (o) { o.valor += v.valorNum; o.pedidos += 1; }
  }

  // ranking de produtos e clientes
  const porProduto = new Map(), porCliente = new Map();
  for (const v of liquidas) {
    const nome = v.produtoNome || 'Desconhecido';
    const p = porProduto.get(nome) || { nome, quantidade: 0, faturamento: 0 };
    p.quantidade += v.quantidade || 1; p.faturamento += v.valorNum; porProduto.set(nome, p);
    const c = porCliente.get(v.clienteId) || { id: v.clienteId, pedidos: 0, total: 0, ultima: 0 };
    c.pedidos += 1; c.total += v.valorNum; c.ultima = Math.max(c.ultima, v.data.getTime()); porCliente.set(v.clienteId, c);
  }
  const produtosRank = [...porProduto.values()].sort((a, b) => b.faturamento - a.faturamento)
    .map(p => ({ ...p, faturamento: arred(p.faturamento) }));
  const topClientes = [...porCliente.values()].sort((a, b) => b.total - a.total).slice(0, 10);

  // pedidos recentes
  const recentes = [...todas].sort((a, b) => b.data - a.data).slice(0, 40);
  const nomes = await nomesClientes(client, [...new Set([...recentes.map(v => v.clienteId), ...topClientes.map(c => c.id)])]);

  // produtos / estoque (SÓ contagens — nunca o conteúdo entregue)
  let produtos = [];
  try {
    produtos = db.getProdutos(guildId).map(p => {
      const temVar = (p.variantes || []).length > 0;
      return {
        id: p.id, titulo: p.titulo, preco: p.preco, ativo: !!p.ativo,
        estoque: temVar ? null : (Array.isArray(p.estoque) ? p.estoque.length : 0),
        variantes: (p.variantes || []).map(v => ({ nome: v.nome, preco: v.preco, estoque: typeof v.estoque === 'number' ? v.estoque : null })),
        cupons: Object.keys(p.cupons || {}).length,
      };
    });
  } catch (e) { console.error('[Dashboard] produtos:', e.message); }

  // funil / insights (cada bloco isolado: se um falhar, o resto continua)
  const seguroCall = (fn, padrao) => { try { return fn(); } catch (e) { console.error('[Dashboard]', e.message); return padrao; } };
  const config = seguroCall(() => engine.getConfigIntelligence(guildId), { minutosAbandono: 60 });
  const conversao = seguroCall(() => engine.calcularConversao(guildId, dias), null);
  const demanda = seguroCall(() => engine.calcularDemandaPorProduto(guildId, dias), []);
  const abandonados = seguroCall(() => db.listarCarrinhosAbandonados(guildId, config.minutosAbandono).length, 0);
  const meta = seguroCall(() => engine.calcularProgressoMeta(guildId), null);
  const cupons = seguroCall(() => engine.cuponsResumo(guildId), []);
  const crescimento = seguroCall(() => engine.crescimentoProdutos(guildId, 15), []);
  const recomendacoes = seguroCall(() => engine.gerarRecomendacoes({
    guildId, minutosAbandono: config.minutosAbandono, vendas: todas, produtos: db.getProdutos(guildId),
  }), []);

  const g = client.guilds.cache.get(guildId);
  json(res, 200, {
    servidor: { id: g.id, nome: g.name, icone: g.icon, membros: g.memberCount },
    dias,
    resumo: {
      faturamento: arred(faturamento),
      faturamentoAnterior: arred(fatAnterior),
      variacaoPct: fatAnterior > 0 ? arred(((faturamento - fatAnterior) / fatAnterior) * 100) : null,
      pedidos: liquidas.length,
      pedidosAnterior: anterior.filter(ativas).length,
      ticketMedio: liquidas.length ? arred(faturamento / liquidas.length) : 0,
      clientesUnicos: porCliente.size,
      reembolsos: reembolsos.length,
      reembolsado: arred(reembolsos.reduce((a, v) => a + v.valorNum, 0)),
      carrinhosAbandonados: abandonados,
    },
    serie: [...serie.values()].map(o => ({ ...o, valor: arred(o.valor) })),
    meta,
    funil: conversao,
    demanda,
    produtosRank,
    crescimento,
    produtos,
    cupons,
    topClientes: topClientes.map(c => ({ ...c, nome: nomes[c.id], total: arred(c.total) })),
    pedidosRecentes: recentes.map(v => ({
      numero: v.numeroPedido, cliente: nomes[v.clienteId], produto: v.produtoNome, variante: v.varianteNome,
      quantidade: v.quantidade || 1, valor: arred(v.valorNum), data: v.dataISO,
      metodo: v.mpPaymentId ? 'Mercado Pago' : v.efiTxid ? 'EFI' : 'PIX',
      reembolsado: !!v.reembolsado,
    })),
    alertas: recomendacoes.slice(0, 12),
  });
}

// ── página ──────────────────────────────────────────────────────────────
let htmlCache = null;
function servirPagina(res) {
  if (!htmlCache || process.env.NODE_ENV !== 'production') {
    htmlCache = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  });
  res.end(htmlCache);
}

async function handleRequest(req, res, client) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Método não permitido'); }

  if (p === '/dashboard') return servirPagina(res);
  if (p === '/dashboard/login') return rotaLogin(req, res);
  if (p === '/dashboard/callback') return rotaCallback(req, res, url);
  if (p === '/dashboard/logout') {
    const s = sessaoDe(req);
    if (s) sessoes.delete(s.sid);
    setCookie(res, 'kael_sess', '', 0);
    return redirecionar(res, '/dashboard');
  }
  if (p === '/dashboard/api/me') return rotaMe(req, res, client);
  const m = p.match(/^\/dashboard\/api\/guild\/(\d{5,25})$/);
  if (m) return rotaGuild(req, res, client, m[1], url);

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Não encontrado');
}

module.exports = { handleRequest };
