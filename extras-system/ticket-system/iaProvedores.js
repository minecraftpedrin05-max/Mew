'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  iaProvedores — conversa com as APIs de IA (Gemini, OpenAI, Groq, OpenRouter, Claude)
//
//  gerar() NUNCA lança erro: devolve { ok:true, texto } ou { ok:false, tipo, status, msg }
//  tipo: 'limite' | 'invalida' | 'config' | 'temporario' | 'vazio'
//  (o ticketIA usa o tipo pra decidir se troca de API em silêncio)
// ═══════════════════════════════════════════════════════════════════════════

const PROVEDORES = {
  gemini:     { nome: 'Google Gemini',      modelo: 'gemini-2.5-flash' },
  openai:     { nome: 'OpenAI',             modelo: 'gpt-4o-mini' },
  groq:       { nome: 'Groq',               modelo: 'llama-3.3-70b-versatile' },
  openrouter: { nome: 'OpenRouter',         modelo: 'openai/gpt-4o-mini' },
  anthropic:  { nome: 'Anthropic (Claude)', modelo: 'claude-haiku-5-5' },
};

const BASES_OPENAI = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

// permite trocar o fetch nos testes
let _fetch = (...a) => globalThis.fetch(...a);
function __setFetch(fn) { _fetch = fn; }

/** Lista de provedores prováveis pela cara da chave (o primeiro é o mais provável). */
function detectar(key) {
  const k = String(key || '').trim();
  if (k.startsWith('sk-ant-')) return ['anthropic'];
  if (k.startsWith('sk-or-'))  return ['openrouter'];
  if (k.startsWith('gsk_'))    return ['groq'];
  if (k.startsWith('AIza'))    return ['gemini'];
  if (k.startsWith('sk-'))     return ['openai'];
  return ['gemini', 'openai', 'groq', 'openrouter', 'anthropic']; // formato desconhecido: tenta todos
}

/** Junta mensagens seguidas do mesmo autor, começa sempre por "user" e termina em "user". */
function normalizarMensagens(msgs) {
  const out = [];
  for (const m of msgs || []) {
    const texto = String(m.content || '').trim();
    if (!texto) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + texto;
    else out.push({ role, content: texto });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  return out;
}

function mensagemDeErro(corpo, key) {
  let msg = '';
  try {
    const j = typeof corpo === 'string' ? JSON.parse(corpo) : corpo;
    msg = j?.error?.message || (typeof j?.error === 'string' ? j.error : '') || j?.message || '';
  } catch { msg = typeof corpo === 'string' ? corpo : ''; }
  msg = String(msg || '').replace(/\s+/g, ' ').trim();
  if (key) msg = msg.split(key).join('****');
  return msg.slice(0, 220);
}

function classificar(status, msg) {
  const m = String(msg || '').toLowerCase();
  if (status === 429 || status === 402) return 'limite';
  if (/quota|rate.?limit|exceeded|exhausted|billing|insufficient|credit|resource_exhausted|too many requests|overloaded/.test(m)
      && status !== 401) return status >= 500 ? 'temporario' : 'limite';
  if (status === 401 || status === 403 || /api key not valid|invalid api key|incorrect api key|invalid x-api-key|unauthorized|permission denied|authentication/.test(m)) return 'invalida';
  if (status === 404 || status === 400) return 'config';   // modelo inexistente / requisição recusada
  if (status >= 500) return 'temporario';
  return 'config';
}

async function postar(url, headers, body, timeoutMs, key) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await _fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const texto = await res.text();
    if (!res.ok) {
      const msg = mensagemDeErro(texto, key) || `HTTP ${res.status}`;
      return { erro: { ok: false, tipo: classificar(res.status, msg), status: res.status, msg } };
    }
    let json; try { json = JSON.parse(texto); } catch { return { erro: { ok: false, tipo: 'temporario', status: res.status, msg: 'Resposta inválida da API.' } }; }
    return { json };
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'A API demorou demais para responder.' : `Falha de conexão: ${String(e?.message || e).split(key).join('****').slice(0, 120)}`;
    return { erro: { ok: false, tipo: 'temporario', status: 0, msg } };
  } finally { clearTimeout(t); }
}

/**
 * @param {{provedor:string,key:string,modelo?:string,sistema:string,mensagens:{role:string,content:string}[],maxTokens?:number,timeoutMs?:number}} p
 */
async function gerar({ provedor, key, modelo, sistema, mensagens, maxTokens = 600, timeoutMs = 25000 }) {
  const info = PROVEDORES[provedor];
  if (!info) return { ok: false, tipo: 'config', status: 0, msg: 'Provedor desconhecido.' };
  const model = (modelo || info.modelo).trim();
  const msgs = normalizarMensagens(mensagens);
  if (!msgs.length) return { ok: false, tipo: 'vazio', status: 0, msg: 'Sem mensagem para responder.' };
  let r, texto = '';

  if (provedor === 'gemini') {
    r = await postar(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': key },
      { systemInstruction: { parts: [{ text: sistema }] },
        contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.6 } }, timeoutMs, key);
    if (r.erro) return r.erro;
    texto = (r.json?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  } else if (provedor === 'anthropic') {
    r = await postar('https://api.anthropic.com/v1/messages',
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: maxTokens, system: sistema, messages: msgs }, timeoutMs, key);
    if (r.erro) return r.erro;
    texto = (r.json?.content || []).map(c => c.text || '').join('').trim();
  } else {
    const corpo = { model, messages: [{ role: 'system', content: sistema }, ...msgs] };
    if (provedor === 'openai') corpo.max_completion_tokens = maxTokens; else corpo.max_tokens = maxTokens;
    r = await postar(`${BASES_OPENAI[provedor]}/chat/completions`, { authorization: `Bearer ${key}` }, corpo, timeoutMs, key);
    if (r.erro) return r.erro;
    texto = String(r.json?.choices?.[0]?.message?.content || '').trim();
  }
  if (!texto) return { ok: false, tipo: 'vazio', status: 200, msg: 'A IA não devolveu texto (possível bloqueio de segurança).' };
  return { ok: true, texto, modelo: model };
}

/** Teste rápido: pergunta algo trivial. Em chave de formato desconhecido tenta todos os provedores. */
async function testarChave(key, modelo) {
  const candidatos = detectar(key);
  let primeiroErro = null;
  for (const provedor of candidatos) {
    const r = await gerar({ provedor, key, modelo, sistema: 'Responda apenas com a palavra OK.',
      mensagens: [{ role: 'user', content: 'Teste de conexão.' }], maxTokens: 24, timeoutMs: 15000 });
    if (r.ok) return { ok: true, provedor, modelo: r.modelo };
    primeiroErro ||= { ...r, provedor };
    // se a chave foi reconhecida (limite/config), não adianta tentar outros provedores
    if (candidatos.length === 1 || r.tipo === 'limite' || r.tipo === 'config' && r.status === 404) break;
  }
  return { ok: false, ...primeiroErro };
}

module.exports = { PROVEDORES, detectar, normalizarMensagens, classificar, gerar, testarChave, __setFetch };
