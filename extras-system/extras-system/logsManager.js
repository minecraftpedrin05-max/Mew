'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  logsManager — Logs do servidor (mensagens, membros, cargos, canais, moderação)
//  Config em guild.extras.logs = { canalId, categorias: { mensagens, membros, ... } }
// ═══════════════════════════════════════════════════════════════════════════
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
} = require('discord.js');
const { E, COR, getExtras, setExtras, temPlano, cortar, ehStaff, exigirPlano } = require('./base');

const CATEGORIAS = {
  mensagens: { label: 'Mensagens',  emoji: E.text,   desc: 'Mensagens apagadas e editadas' },
  membros:   { label: 'Membros',    emoji: E.users,  desc: 'Entradas e saídas do servidor' },
  cargos:    { label: 'Cargos',     emoji: E.coroa,  desc: 'Cargos adicionados/removidos de membros' },
  canais:    { label: 'Canais',     emoji: E.canal,  desc: 'Canais criados e apagados' },
  moderacao: { label: 'Moderação',  emoji: E.safety, desc: 'Ban, kick, timeout e avisos' },
};
const PADRAO = { canalId: null, categorias: { mensagens: true, membros: true, cargos: true, canais: true, moderacao: true } };

const getCfg = (guildId) => {
  const c = getExtras(guildId, 'logs', PADRAO);
  c.categorias = { ...PADRAO.categorias, ...(c.categorias || {}) };
  return c;
};

/** Envia um embed pro canal de logs (se a categoria estiver ligada). Nunca lança erro. */
async function logar(guild, categoria, embed) {
  try {
    if (!guild || !temPlano(guild.id, 'logs')) return;
    const cfg = getCfg(guild.id);
    if (!cfg.canalId || !cfg.categorias[categoria]) return;
    const canal = guild.channels.cache.get(cfg.canalId) || await guild.channels.fetch(cfg.canalId).catch(() => null);
    if (!canal?.isTextBased?.()) return;
    await canal.send({ embeds: [embed.setTimestamp()], allowedMentions: { parse: [] } });
  } catch (e) { console.error('[Logs] Falha ao enviar log:', e.message); }
}

// ── Painel (/logs) ─────────────────────────────────────────────────────────
function montarPainel(guildId) {
  const cfg = getCfg(guildId);
  const linhas = Object.entries(CATEGORIAS).map(([k, c]) =>
    `${cfg.categorias[k] ? E.online : E.off} ${c.emoji} **${c.label}** — ${c.desc}`).join('\n');
  const embed = new EmbedBuilder().setColor(COR.info).setTitle(`${E.text} Logs do servidor`)
    .setDescription(
      `**Canal de logs:** ${cfg.canalId ? `<#${cfg.canalId}>` : '`Não configurado`'}\n\n${linhas}\n\n` +
      '-# Clique nos botões para ligar/desligar cada categoria. Mensagens só são registradas se o bot as tiver visto (cache).');
  const botoes = Object.entries(CATEGORIAS).map(([k, c]) =>
    new ButtonBuilder().setCustomId(`xlogs_toggle_${k}`).setLabel(c.label).setEmoji(c.emoji)
      .setStyle(cfg.categorias[k] ? ButtonStyle.Success : ButtonStyle.Secondary));
  const select = new ChannelSelectMenuBuilder().setCustomId('xlogs_canal')
    .setPlaceholder('Escolha o canal onde os logs serão enviados')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(botoes)],
  };
}

async function handleInteraction(interaction) {
  if (!(await exigirPlano(interaction, 'logs'))) return;
  if (!ehStaff(interaction)) {
    return interaction.reply({ content: `${E.negativo} Só quem gerencia o servidor pode alterar os logs.`, flags: 64 });
  }
  const id = interaction.customId;
  const cfg = getCfg(interaction.guildId);
  if (id === 'xlogs_canal') {
    cfg.canalId = interaction.values[0];
    setExtras(interaction.guildId, 'logs', cfg);
  } else if (id.startsWith('xlogs_toggle_')) {
    const k = id.replace('xlogs_toggle_', '');
    if (!CATEGORIAS[k]) return;
    cfg.categorias[k] = !cfg.categorias[k];
    setExtras(interaction.guildId, 'logs', cfg);
  }
  return interaction.update(montarPainel(interaction.guildId));
}

// ── Eventos ────────────────────────────────────────────────────────────────
function registrar(client) {
  client.on('messageDelete', async (m) => {
    try {
      if (!m.guild || m.author?.bot) return;
      const e = new EmbedBuilder().setColor(COR.erro).setTitle(`${E.apagar} Mensagem apagada`)
        .addFields(
          { name: 'Autor', value: m.author ? `<@${m.author.id}> (\`${m.author.tag}\`)` : 'Desconhecido', inline: true },
          { name: 'Canal', value: `<#${m.channelId}>`, inline: true },
          { name: 'Conteúdo', value: cortar(m.content || (m.attachments?.size ? '*(somente anexo)*' : '*(vazio)*'), 1000) },
        );
      if (m.attachments?.size) e.addFields({ name: 'Anexos', value: String(m.attachments.size), inline: true });
      await logar(m.guild, 'mensagens', e);
    } catch {}
  });

  client.on('messageUpdate', async (antes, depois) => {
    try {
      if (!depois.guild || depois.author?.bot) return;
      if (antes.content == null || antes.content === depois.content) return;
      const e = new EmbedBuilder().setColor(COR.aviso).setTitle(`${E.editar} Mensagem editada`)
        .setDescription(`[Ir para a mensagem](${depois.url})`)
        .addFields(
          { name: 'Autor', value: `<@${depois.author.id}> (\`${depois.author.tag}\`)`, inline: true },
          { name: 'Canal', value: `<#${depois.channelId}>`, inline: true },
          { name: 'Antes', value: cortar(antes.content || '*(vazio)*', 1000) },
          { name: 'Depois', value: cortar(depois.content || '*(vazio)*', 1000) },
        );
      await logar(depois.guild, 'mensagens', e);
    } catch {}
  });

  client.on('guildMemberAdd', async (m) => {
    try {
      const e = new EmbedBuilder().setColor(COR.ok).setTitle(`${E.mais} Membro entrou`)
        .setThumbnail(m.user.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: 'Usuário', value: `<@${m.id}> (\`${m.user.tag}\`)`, inline: true },
          { name: 'Conta criada', value: `<t:${Math.floor(m.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Membros agora', value: String(m.guild.memberCount), inline: true },
        );
      await logar(m.guild, 'membros', e);
    } catch {}
  });

  client.on('guildMemberRemove', async (m) => {
    try {
      const e = new EmbedBuilder().setColor(COR.erro).setTitle(`${E.negativo} Membro saiu`)
        .addFields(
          { name: 'Usuário', value: `<@${m.id}> (\`${m.user?.tag || m.id}\`)`, inline: true },
          { name: 'Membros agora', value: String(m.guild.memberCount), inline: true },
        );
      await logar(m.guild, 'membros', e);
    } catch {}
  });

  client.on('guildMemberUpdate', async (antes, depois) => {
    try {
      if (antes.partial || !antes.roles) return;
      const add = depois.roles.cache.filter(r => !antes.roles.cache.has(r.id));
      const rem = antes.roles.cache.filter(r => !depois.roles.cache.has(r.id));
      if (!add.size && !rem.size) return;
      const e = new EmbedBuilder().setColor(COR.info).setTitle(`${E.coroa} Cargos alterados`)
        .addFields({ name: 'Membro', value: `<@${depois.id}> (\`${depois.user.tag}\`)` });
      if (add.size) e.addFields({ name: `${E.mais} Adicionados`, value: add.map(r => `<@&${r.id}>`).join(' ') });
      if (rem.size) e.addFields({ name: `${E.apagar} Removidos`, value: rem.map(r => `<@&${r.id}>`).join(' ') });
      await logar(depois.guild, 'cargos', e);
    } catch {}
  });

  client.on('channelCreate', async (c) => {
    try {
      if (!c.guild) return;
      await logar(c.guild, 'canais', new EmbedBuilder().setColor(COR.ok).setTitle(`${E.mais} Canal criado`)
        .setDescription(`<#${c.id}> (\`${c.name}\`)`));
    } catch {}
  });
  client.on('channelDelete', async (c) => {
    try {
      if (!c.guild) return;
      await logar(c.guild, 'canais', new EmbedBuilder().setColor(COR.erro).setTitle(`${E.apagar} Canal apagado`)
        .setDescription(`\`#${c.name}\``));
    } catch {}
  });
}

module.exports = { logar, montarPainel, handleInteraction, registrar, getCfg, CATEGORIAS };
