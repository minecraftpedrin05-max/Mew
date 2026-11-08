'use strict';
// {separador} — uma linha contendo SÓ isso vira uma linha divisória de verdade (componente Separator)
// nos painéis feitos com Container. Usado direto nos builders (não depende de nenhum filtro).
const { TextDisplayBuilder, SeparatorBuilder } = require('discord.js');

const RE_LINHA = /^[ \t\r]*\{separador\}[ \t\r]*$/i;

/** Quebra um texto em partes: { tipo: 'texto', conteudo } e { tipo: 'sep' }. */
function dividirTexto(texto) {
  const partes = [];
  let buf = [];
  const fechar = () => {
    const t = buf.join('\n');
    buf = [];
    if (t.trim()) partes.push({ tipo: 'texto', conteudo: t });
  };
  for (const linha of String(texto ?? '').split('\n')) {
    if (RE_LINHA.test(linha)) { fechar(); partes.push({ tipo: 'sep' }); }
    else buf.push(linha);
  }
  fechar();
  return partes;
}

/** Adiciona o texto ao container, trocando cada linha {separador} por um divisor. */
function adicionarTexto(container, texto) {
  for (const p of dividirTexto(texto)) {
    if (p.tipo === 'sep') container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    else container.addTextDisplayComponents(new TextDisplayBuilder().setContent(p.conteudo));
  }
}

module.exports = { dividirTexto, adicionarTexto, RE_LINHA };
