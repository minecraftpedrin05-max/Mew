'use strict';
// /novo-emoji — cria emojis personalizados do KAEL a partir de uma foto, sem precisar de servidor.
// Os emojis ficam no APLICATIVO do bot e funcionam em TODOS os servidores e painéis:
// é só escrever :nome: no texto (ex.: :ligacao: Entre em contato conosco).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { BOT_OWNER_ID } = require('../config/constants');
const emojiResolver = require('../utils/emojiResolver');

let canvasLib = null;
try { canvasLib = require('@napi-rs/canvas'); } catch { /* sem canvas: só aceita imagens pequenas */ }

const NOME_OK = /^[A-Za-z0-9_]{2,32}$/;
const LIMITE_EMOJI = 256 * 1024;      // limite do Discord para emoji
const LIMITE_DOWNLOAD = 8 * 1024 * 1024;
const EPH = MessageFlags.Ephemeral;

async function baixar(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Não consegui baixar a imagem.');
  const tipo = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > LIMITE_DOWNLOAD) throw new Error('Imagem muito grande (máx. 8 MB).');
  return { buf, tipo };
}

/** Deixa a imagem no formato aceito: PNG quadrado 128x128 (GIF animado é enviado como está). */
async function prepararImagem(anexo) {
  const { buf, tipo } = await baixar(anexo.url);
  if (!/^image\/(png|jpe?g|gif|webp)/i.test(tipo || anexo.contentType || '')) {
    throw new Error('Envie uma imagem PNG, JPG, WEBP ou GIF.');
  }
  if (/gif/i.test(tipo)) {
    if (buf.length > LIMITE_EMOJI) throw new Error('GIF muito pesado: emojis animados têm limite de 256 KB. Use um GIF menor.');
    return buf;
  }
  if (!canvasLib) {
    if (buf.length > LIMITE_EMOJI) throw new Error('Imagem acima de 256 KB.');
    return buf;
  }
  const img = await canvasLib.loadImage(buf);
  const T = 128;
  const canvas = canvasLib.createCanvas(T, T);
  const ctx = canvas.getContext('2d');
  const escala = Math.min(T / img.width, T / img.height);   // cabe inteira, sem cortar
  const w = img.width * escala, h = img.height * escala;
  ctx.drawImage(img, (T - w) / 2, (T - h) / 2, w, h);
  const png = canvas.toBuffer('image/png');
  if (png.length > LIMITE_EMOJI) throw new Error('Não consegui deixar a imagem abaixo de 256 KB.');
  return png;
}

function fmt(e) { return `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`; }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('novo-emoji')
    .setDescription('Cria e gerencia emojis personalizados do KAEL (usáveis em qualquer painel)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(s => s.setName('criar').setDescription('Transforma uma foto em emoji do KAEL')
      .addAttachmentOption(o => o.setName('imagem').setDescription('A foto que vira emoji').setRequired(true))
      .addStringOption(o => o.setName('nome').setDescription('Nome do emoji (letras, números e _) — você usa como :nome:').setRequired(true).setMinLength(2).setMaxLength(32)))
    .addSubcommand(s => s.setName('renomear').setDescription('Troca o nome de um emoji (só o dono do bot)')
      .addStringOption(o => o.setName('nome').setDescription('Nome atual').setRequired(true))
      .addStringOption(o => o.setName('novo_nome').setDescription('Novo nome').setRequired(true).setMinLength(2).setMaxLength(32)))
    .addSubcommand(s => s.setName('apagar').setDescription('Apaga um emoji do KAEL (só o dono do bot)')
      .addStringOption(o => o.setName('nome').setDescription('Nome do emoji').setRequired(true)))
    .addSubcommand(s => s.setName('listar').setDescription('Lista todos os emojis que o KAEL tem e o :nome: de cada um')),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const ehDono = interaction.user.id === BOT_OWNER_ID;

    try {
      if (sub === 'listar') {
        await interaction.deferReply({ flags: EPH });
        const todos = (await client.application.emojis.fetch()).map(e => e).sort((a, b) => a.name.localeCompare(b.name));
        if (!todos.length) return interaction.editReply('O KAEL ainda não tem emojis. Use `/novo-emoji criar`.');
        const linhas = todos.map(e => `${fmt(e)} \`:${e.name}:\``);
        const partes = []; let bloco = `**${todos.length} emojis do KAEL** — escreva \`:nome:\` em qualquer painel:\n`;
        for (const l of linhas) { if ((bloco + l + '\n').length > 1800) { partes.push(bloco); bloco = ''; } bloco += l + '\n'; }
        if (bloco) partes.push(bloco);
        await interaction.editReply(partes[0]);
        for (const p of partes.slice(1)) await interaction.followUp({ content: p, flags: EPH });
        return;
      }

      await interaction.deferReply({ flags: EPH });

      if (sub === 'criar') {
        const nome = interaction.options.getString('nome').trim();
        const anexo = interaction.options.getAttachment('imagem');
        if (!NOME_OK.test(nome)) return interaction.editReply('❌ Nome inválido. Use só letras, números e `_` (2 a 32 caracteres).');
        if (emojiResolver.existe(nome)) return interaction.editReply(`❌ Já existe um emoji chamado \`:${nome}:\`. Escolha outro nome.`);
        const imagem = await prepararImagem(anexo);
        const emoji = await client.application.emojis.create({ attachment: imagem, name: nome });
        await emojiResolver.carregar(client);
        return interaction.editReply(`✅ Emoji criado: ${fmt(emoji)}\nUse escrevendo \`:${emoji.name}:\` em qualquer painel, produto, ticket ou mensagem do KAEL.`);
      }

      // renomear / apagar mexem em emojis que TODOS os servidores usam → só o dono do bot
      if (!ehDono) return interaction.editReply('❌ Só o dono do bot pode renomear ou apagar emojis (eles são usados em todos os servidores).');
      const nome = interaction.options.getString('nome').trim().replace(/^:|:$/g, '');
      const lista = await client.application.emojis.fetch();
      const alvo = lista.find(e => e.name.toLowerCase() === nome.toLowerCase());
      if (!alvo) return interaction.editReply(`❌ Não achei o emoji \`:${nome}:\`. Veja os nomes em \`/novo-emoji listar\`.`);

      if (sub === 'renomear') {
        const novo = interaction.options.getString('novo_nome').trim().replace(/^:|:$/g, '');
        if (!NOME_OK.test(novo)) return interaction.editReply('❌ Nome inválido. Use só letras, números e `_` (2 a 32 caracteres).');
        if (emojiResolver.existe(novo)) return interaction.editReply(`❌ Já existe um emoji chamado \`:${novo}:\`.`);
        const editado = await alvo.edit({ name: novo });
        await emojiResolver.carregar(client);
        return interaction.editReply(`✅ Renomeado: ${fmt(editado)} agora é \`:${editado.name}:\`\n⚠️ Painéis que usavam \`:${alvo.name}:\` precisam ser trocados para o nome novo.`);
      }

      if (sub === 'apagar') {
        await client.application.emojis.delete(alvo);
        await emojiResolver.carregar(client);
        return interaction.editReply(`🗑️ Emoji \`:${alvo.name}:\` apagado.`);
      }
    } catch (e) {
      console.error('[novo-emoji] Erro:', e);
      const msg = `❌ Não deu certo: ${e.message || 'erro desconhecido'}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(msg).catch(() => {});
      return interaction.reply({ content: msg, flags: EPH }).catch(() => {});
    }
  },
};
