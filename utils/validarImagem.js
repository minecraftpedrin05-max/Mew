'use strict';
// Confere se um link realmente é uma imagem antes de salvar no painel (evita o bloco cinza "imagem quebrada").
// Só recusa quando TEM CERTEZA que não é imagem; se o site não deixar conferir (timeout/bloqueio), aceita.
async function validarUrlImagem(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\/\S+$/i.test(u)) return { ok: false, motivo: 'O link precisa começar com `https://`.' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(u, { method: 'GET', headers: { Range: 'bytes=0-1023', 'User-Agent': 'Mozilla/5.0 (KAEL link check)' }, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    if (res.status === 404 || res.status === 410) return { ok: false, motivo: 'Esse link não existe mais (erro 404).' };
    const tipo = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok || res.status === 206) {
      if (tipo && !/^(image|video)\//.test(tipo) && !tipo.startsWith('application/octet-stream')) {
        return { ok: false, motivo: 'Esse link não é uma imagem direta (é uma página). Use o link da própria imagem, que termina em .png, .jpg, .gif ou .webp.' };
      }
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
module.exports = { validarUrlImagem };
