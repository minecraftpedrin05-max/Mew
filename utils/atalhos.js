'use strict';
// Botão "Atalhos" dos editores de painel: mostra os atalhos que funcionam em qualquer texto do KAEL.
const { MessageFlags } = require('discord.js');
const emojiResolver = require('./emojiResolver');

async function mostrarAtalhos(interaction) {
  const todos = emojiResolver.listar().sort((a, b) => a.nome.localeCompare(b.nome));
  const topo =
    '## ⚡ Atalhos para seus painéis\n' +
    '**Emojis:** escreva o nome entre dois pontos em qualquer texto. Ex.: `:ligacao:` vira o emoji.\n' +
    '**Separador:** escreva `{separador}` sozinho numa linha e ela vira uma linha divisória.\n' +
    '**Emoji novo:** use `/novo-emoji criar` e envie uma foto (funciona em todos os servidores).\n\n' +
    `**Emojis disponíveis (${todos.length}):**\n`;
  const itens = todos.map(e => `<${e.animated ? 'a' : ''}:${e.nome}:${e.id}> \`:${e.nome}:\``);
  const partes = [];
  let atual = topo;
  for (const it of itens) {
    const add = (atual.endsWith('\n') ? '' : '  ') + it;
    if ((atual + add).length > 1850) { partes.push(atual); atual = ''; }
    atual += (atual === '' || atual.endsWith('\n') ? '' : '  ') + it;
  }
  if (atual) partes.push(atual);
  if (!todos.length) partes[0] = topo + '_Nenhum emoji carregado ainda._';
  await interaction.reply({ content: partes[0], flags: MessageFlags.Ephemeral });
  for (const p of partes.slice(1)) await interaction.followUp({ content: p, flags: MessageFlags.Ephemeral });
}

module.exports = { mostrarAtalhos };
