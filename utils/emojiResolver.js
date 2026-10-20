'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  emojiResolver — conserta os emojis personalizados que aparecem como ":coroa:"
//
//  Quando o ID de um emoji no código não existe mais (emoji apagado/reenviado,
//  ou pertence a um servidor onde o bot não está), o Discord mostra só o texto
//  ":nome:". Aqui a gente intercepta TUDO que o bot envia ao Discord e:
//    1) se o ID ainda é válido (emoji do app ou de um servidor do bot) → mantém;
//    2) senão procura um emoji do APLICATIVO do bot com o MESMO NOME e troca o ID;
//    3) se não existir, usa um emoji Unicode parecido (nunca mais ":nome:").
//
//  Pra ter os ícones certos: Discord Developer Portal → seu app → "Emojis" →
//  envie cada ícone com o mesmo nome usado no código (ex.: coroa, safety, save).
// ═══════════════════════════════════════════════════════════════════════════

const RE_EMOJI = /<(a?):([A-Za-z0-9_]{2,32}):(\d{15,22})>/g;

// nome → alternativa Unicode (usada só quando o emoji não existe em lugar nenhum)
const FALLBACK = {
  coroa: '👑', CadLock: '🔒', apagar: '🗑️', arrow: '➡️', block: '🧱', bot: '🤖',
  caixa: '📦', canal: '📢', card: '💳', carregarAnimado: '⏳', carrinho: '🛒',
  casa: '🏠', clock: '🕒', relogio: '🕒', config2: '⚙️', config3: '⚙️',
  configuracoes: '⚙️', confimado: '✅', copypast: '📋', cupom: '🎟️', dev: '🧑‍💻',
  editar: '✏️', embed: '🧾', folder: '📁', foto: '🖼️', ia: '🧠', import1: '📥',
  link: '🔗', mais2: '➕', medal: '🏅', money: '💰', naoconfigurado: '⚪',
  negativo: '❌', npertubar: '⛔', online: '🟢', pedidoEntregue: '📬',
  pedidoSolicitado: '📨', personalizar: '🎨', personalizarE: '🎨', pix: '💠',
  positivo: '✅', present: '🎁', produtoEntregue: '📦', raio: '⚡',
  rendimentos: '📈', grafico: '📈', safety: '🛡️', save: '💾', sino: '🔔',
  sorteio: '🎉', target: '🎯', termos: '📜', text: '📝', tools1: '🛠️',
  trofeu: '🏆', user: '👤', users: '👥', visible: '👁️', voltar: '↩️',
  xpooo: '⚡', tickets: '🎫',
};

const porNome = new Map();   // nome(lowercase) → { id, animated }   (SÓ emojis do app)
const idsValidos = new Set(); // ids que o bot realmente consegue usar
let pronto = false;
const naoEncontrados = new Set();

async function carregar(client) {
  try {
    const appEmojis = await client.application.emojis.fetch();
    porNome.clear();
    for (const e of appEmojis.values()) {
      porNome.set(String(e.name).toLowerCase(), { id: e.id, animated: !!e.animated });
      idsValidos.add(e.id);
    }
    for (const g of client.guilds.cache.values()) {
      for (const e of g.emojis.cache.values()) idsValidos.add(e.id);
    }
    pronto = true;
    console.log(`[Emojis] ${porNome.size} emoji(s) do aplicativo carregados.`);
  } catch (e) {
    // Sem a lista não dá pra saber o que é válido: não mexe em nada.
    console.error('[Emojis] Não consegui carregar os emojis do aplicativo — mantendo os do código:', e.message);
  }
}

function resolverUm(animated, nome, id) {
  if (!pronto || idsValidos.has(id)) return null;           // válido → não mexe
  const achado = porNome.get(String(nome).toLowerCase());
  if (achado) return { id: achado.id, name: nome, animated: achado.animated };
  naoEncontrados.add(nome);
  return false;                                              // sem emoji → fallback unicode
}

function reescreverTexto(s) {
  if (!pronto || s.indexOf('<') === -1 || s.indexOf(':') === -1) return s;
  return s.replace(RE_EMOJI, (m, a, nome, id) => {
    const r = resolverUm(!!a, nome, id);
    if (r === null) return m;
    if (r === false) return FALLBACK[nome] || '▫️';
    return `<${r.animated ? 'a' : ''}:${nome}:${r.id}>`;
  });
}

function ehObjetoEmoji(o) {
  const ks = Object.keys(o);
  return typeof o.id === 'string' && /^\d{15,22}$/.test(o.id) && typeof o.name === 'string'
    && ks.every(k => k === 'id' || k === 'name' || k === 'animated');
}

function reescrever(v) {
  if (typeof v === 'string') return reescreverTexto(v);
  if (Array.isArray(v)) return v.map(reescrever);
  if (v && typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v; // Buffer, FormData, etc.
    if (ehObjetoEmoji(v)) {
      const r = resolverUm(!!v.animated, v.name, v.id);
      if (r === null) return v;
      if (r === false) return { name: FALLBACK[v.name] || '▫️' };   // emoji unicode de botão/select
      return { id: r.id, name: v.name, animated: r.animated };
    }
    const out = {};
    for (const k of Object.keys(v)) out[k] = reescrever(v[k]);
    return out;
  }
  return v;
}

/** Instala o filtro em TODAS as requisições que o discord.js faz ao Discord. */
function instalar(client) {
  const rest = client.rest;
  if (!rest || rest.__kaelEmoji) return;
  const original = rest.request.bind(rest);
  rest.request = (options) => {
    try {
      if (pronto && options && options.body && typeof options.body === 'object') {
        options = { ...options, body: reescrever(options.body) };
      }
    } catch (e) { console.error('[Emojis] Falha ao reescrever emojis:', e.message); }
    return original(options);
  };
  rest.__kaelEmoji = true;
}

function relatorio() {
  if (naoEncontrados.size) {
    console.warn('[Emojis] Sem emoji no aplicativo (usando Unicode no lugar): ' + [...naoEncontrados].join(', ') +
      '\n         → Envie com esses nomes em Developer Portal → seu app → Emojis.');
  }
}

module.exports = { instalar, carregar, relatorio, reescrever, FALLBACK };
