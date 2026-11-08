'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  Suporte por VOZ
//
//  Fluxo:
//   1) Admin: /painel → Gerenciar Ticket → "Suporte por voz" → escolhe o canal de voz, os cargos
//      de atendentes e o cargo "em atendimento" → "Postar painel".
//   2) O canal de voz fica com a fala BLOQUEADA pra todo mundo (só atendentes e quem tem o cargo
//      de atendimento falam). No chat do canal de voz o bot posta o painel "Pedir atendimento".
//   3) Cliente entra na call e toca "Pedir atendimento" → entra na fila e o bot manda DM pra TODOS
//      os atendentes (quem tem os cargos de suporte).
//   4) Atendente abre o "Painel Atendente" → vê a fila → toca "Atender" → o cliente recebe o cargo
//      de atendimento (fala liberada).
//   5) No mesmo painel, "Finalizar atendimento" tira o cargo (fala bloqueada de novo).
//   Se o cliente sair da call, a fila/atendimento dele é limpo sozinho.
// ═══════════════════════════════════════════════════════════════════════════
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ChannelType, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  EmbedBuilder, MessageFlags,
} = require('discord.js');
const db = require('../database/db');
const { BOT_OWNER_ID } = require('../config/constants');

const COR = 0x000000;
const EPH_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const POR_PAGINA = 4;                       // entradas por página no painel do atendente (cabe nas 5 linhas de botões)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Emojis personalizados do Kael (mesmos IDs usados no resto do bot)
const E = {
  ok:      '<:positivo:1528401238197276702>',
  erro:    '<:negativo:1528400986744295475>',
  voz:     '<:users:1528840901739151430>',
  user:    '<:user:1532137085081878558>',
  sino:    '<:sino:1528840971096297482>',
  relogio: '<:clock:1524207889441357917>',
  painel:  '<:embed:1528400492982571111>',
  config:  '<:config3:1524208114327617588>',
  canal:   '<:canal:1524207214791884890>',
  cargo:   '<:safety:1528841000548569239>',
  postar:  '<:arrow:1524206792626933831>',
  apagar:  '<:apagar:1524206738885050388>',
  voltar:  '<:voltar:1528548726518448198>',
  pedido:  '<:pedidoSolicitado:1528401082777342044>',
  entregue:'<:pedidoEntregue:1528401023054385202>',
  raio:    '<:raio:1533080818258411662>',
  tools:   '<:tools1:1533222180408791080>',
  texto:   '<:text:1533089802856038461>',
  parar:   '<:npertubar:1533081528966316083>',
};

const txt = (t) => new TextDisplayBuilder().setContent(t);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

// ───────────────────────────── config / banco ─────────────────────────────
function getCfg(gid) {
  const c = db.getGuild(gid).suporteVoz || {};
  return {
    ativo: !!c.ativo, canalId: c.canalId || null, cargosSuporte: c.cargosSuporte || [],
    cargoAtendId: c.cargoAtendId || null, painelMsgId: c.painelMsgId || null,
    fila: c.fila || [], atendimentos: c.atendimentos || {},
  };
}
function saveCfg(gid, cfg) { db.updateGuild(gid, 'suporteVoz', cfg); return cfg; }

const ehAdmin = (member, userId) => userId === BOT_OWNER_ID || !!member?.permissions?.has('Administrator');
function ehAtendente(member, cfg, userId) {
  if (ehAdmin(member, userId)) return true;
  return !!member && cfg.cargosSuporte.some(id => member.roles.cache.has(id));
}

// Interações vindas de DM não têm `guild`: o id do servidor vai dentro do customId.
async function contexto(interaction, gid) {
  const guild = interaction.guild || interaction.client.guilds.cache.get(gid);
  if (!guild) return {};
  const member = interaction.member || await guild.members.fetch(interaction.user.id).catch(() => null);
  return { guild, member };
}
const emDM = (interaction) => !interaction.guild;
/** Mensagem curta em container (emoji personalizado + separador), no lugar de texto solto. */
function aviso(emoji, titulo, corpo, { efemero = true } = {}) {
  const c = new ContainerBuilder().setAccentColor(COR).addTextDisplayComponents(txt(`${emoji}  **${titulo}**`));
  if (corpo) { c.addSeparatorComponents(sep()); c.addTextDisplayComponents(txt(corpo)); }
  return { components: [c], flags: efemero ? EPH_V2 : MessageFlags.IsComponentsV2 };
}
const avisoCanal = (emoji, titulo, corpo) => aviso(emoji, titulo, corpo, { efemero: false });
const avisoI = (interaction, emoji, titulo, corpo) => aviso(emoji, titulo, corpo, { efemero: !emDM(interaction) });
const soComp = (payload) => ({ components: payload.components, flags: MessageFlags.IsComponentsV2 });
const flagsPainel = (interaction) => (emDM(interaction) ? MessageFlags.IsComponentsV2 : EPH_V2);

// ───────────────────────────── 1) escolha: chat x voz ─────────────────────────────
async function showEscolha(interaction) {
  const c = new ContainerBuilder().setAccentColor(COR)
    .addTextDisplayComponents(txt(
      `## ${E.painel}  Suporte\nEscolha o que você quer configurar:`))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(txt(
      `${E.canal}  **Ticket (chat):** painel de tickets com categorias, canal, logs e cargos.\n` +
      `${E.voz}  **Suporte por voz:** sala de espera em call, com fila e painel de atendentes.`))
    .addSeparatorComponents(sep())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vsup_go_chat').setLabel('Ticket (chat)').setEmoji(E.canal).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('vsup_go_voz').setLabel('Suporte por voz').setEmoji(E.voz).setStyle(ButtonStyle.Primary),
    ));
  return interaction.reply({ components: [c], flags: EPH_V2 });
}

// ───────────────────────────── 2) painel de configuração ─────────────────────────────
function linhaOk(ok) { return ok ? E.ok : E.erro; }

function buildConfigPayload(guild, aviso = null) {
  const cfg = getCfg(guild.id);
  const c = new ContainerBuilder().setAccentColor(COR);
  if (aviso) { c.addTextDisplayComponents(txt(aviso)); c.addSeparatorComponents(sep()); }
  c.addTextDisplayComponents(txt(
    `## ${E.voz}  Suporte por voz`));
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(txt(
    `${linhaOk(cfg.canalId)} ${E.canal} **Canal de voz:** ${cfg.canalId ? `<#${cfg.canalId}>` : 'não definido'}\n` +
    `${linhaOk(cfg.cargosSuporte.length)} ${E.cargo} **Cargos de atendentes:** ${cfg.cargosSuporte.length ? cfg.cargosSuporte.map(r => `<@&${r}>`).join(' ') : 'não definidos'}\n` +
    `${linhaOk(cfg.cargoAtendId)} ${E.config} **Cargo "em atendimento":** ${cfg.cargoAtendId ? `<@&${cfg.cargoAtendId}>` : 'será criado automaticamente'}\n` +
    `${linhaOk(cfg.ativo)} ${E.painel} **Painel:** ${cfg.ativo ? 'ativo no chat da call' : 'ainda não postado'}`));
  c.addSeparatorComponents(sep());
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId('vsup_cfg_canal').setChannelTypes(ChannelType.GuildVoice)
      .setPlaceholder('Escolher o canal de voz do suporte').setMinValues(1).setMaxValues(1)));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('vsup_cfg_suporte')
      .setPlaceholder('Cargos dos atendentes (recebem os pedidos)').setMinValues(1).setMaxValues(10)));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('vsup_cfg_atend')
      .setPlaceholder('Cargo "em atendimento" (opcional)').setMinValues(1).setMaxValues(1)));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('vsup_cfg_postar').setLabel(cfg.ativo ? 'Repostar painel' : 'Postar painel').setEmoji(E.postar).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('vsup_cfg_desativar').setLabel('Desativar').setEmoji(E.apagar).setStyle(ButtonStyle.Danger).setDisabled(!cfg.ativo),
  ));
  return { components: [c], flags: EPH_V2 };
}

function painelPublico() {
  const c = new ContainerBuilder().setAccentColor(COR)
    .addTextDisplayComponents(txt(
      `# ${E.voz}  Suporte por voz\n` +
      `${E.parar}  Sua fala está **bloqueada** nesta call até um atendente te atender.`))
    .addSeparatorComponents(sep())
    .addTextDisplayComponents(txt(
      `${E.pedido}  Toque em **Pedir atendimento**.\n` +
      `${E.relogio}  Aguarde aqui na call.\n` +
      `${E.ok}  Quando um atendente aceitar, sua fala é liberada.`))
    .addSeparatorComponents(sep())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vsup_pedir').setLabel('Pedir atendimento').setEmoji(E.pedido).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vsup_sair').setLabel('Sair da fila').setEmoji(E.voltar).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vsup_painel').setLabel('Painel Atendente').setEmoji(E.painel).setStyle(ButtonStyle.Primary),
    ));
  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

async function aplicarPermissoes(guild, cfg) {
  const canal = guild.channels.cache.get(cfg.canalId) || await guild.channels.fetch(cfg.canalId);
  await canal.permissionOverwrites.edit(guild.roles.everyone, { Speak: false });
  if (cfg.cargoAtendId) await canal.permissionOverwrites.edit(cfg.cargoAtendId, { Speak: true });
  for (const r of cfg.cargosSuporte) {
    await canal.permissionOverwrites.edit(r, { ViewChannel: true, Connect: true, Speak: true });
  }
  return canal;
}

async function removerPermissoes(guild, cfg) {
  const canal = guild.channels.cache.get(cfg.canalId) || await guild.channels.fetch(cfg.canalId).catch(() => null);
  if (!canal) return;
  await canal.permissionOverwrites.edit(guild.roles.everyone, { Speak: null }).catch(() => {});
  if (cfg.cargoAtendId) await canal.permissionOverwrites.delete(cfg.cargoAtendId).catch(() => {});
  for (const r of cfg.cargosSuporte) await canal.permissionOverwrites.delete(r).catch(() => {});
}

async function postarPainel(interaction) {
  const { guild } = await contexto(interaction);
  let cfg = getCfg(guild.id);
  if (!cfg.canalId) return interaction.update(buildConfigPayload(guild, `${E.erro}  Escolha primeiro o **canal de voz**.`));
  if (!cfg.cargosSuporte.length) return interaction.update(buildConfigPayload(guild, `${E.erro}  Escolha pelo menos um **cargo de atendente**.`));
  await interaction.deferUpdate();
  try {
    if (!cfg.cargoAtendId || !guild.roles.cache.has(cfg.cargoAtendId)) {
      const role = await guild.roles.create({ name: 'Em Atendimento (Suporte)', reason: 'KAEL — suporte por voz' });
      cfg = saveCfg(guild.id, { ...cfg, cargoAtendId: role.id });
    }
    const canal = await aplicarPermissoes(guild, cfg);
    if (cfg.painelMsgId) await canal.messages.delete(cfg.painelMsgId).catch(() => {});
    const msg = await canal.send(painelPublico());
    saveCfg(guild.id, { ...cfg, ativo: true, painelMsgId: msg.id });
    return interaction.editReply(soComp(buildConfigPayload(guild, `${E.ok}  Painel postado no chat de <#${canal.id}>. A fala nessa call agora está bloqueada para quem não for atendido.`)));
  } catch (e) {
    console.error('[SuporteVoz] Erro ao postar painel:', e);
    return interaction.editReply(soComp(buildConfigPayload(guild,
      `${E.erro}  Não consegui configurar: ${e.message}\nConfira se o Kael tem **Gerenciar cargos**, **Gerenciar canais** e acesso ao canal de voz, e se o cargo do Kael está **acima** dos cargos escolhidos.`)));
  }
}

async function desativar(interaction) {
  const { guild } = await contexto(interaction);
  const cfg = getCfg(guild.id);
  await interaction.deferUpdate();
  // tira o cargo de quem estava em atendimento
  for (const uid of Object.keys(cfg.atendimentos)) {
    const m = await guild.members.fetch(uid).catch(() => null);
    if (m && cfg.cargoAtendId) await m.roles.remove(cfg.cargoAtendId).catch(() => {});
  }
  await removerPermissoes(guild, cfg);
  if (cfg.painelMsgId && cfg.canalId) {
    const canal = guild.channels.cache.get(cfg.canalId);
    if (canal) await canal.messages.delete(cfg.painelMsgId).catch(() => {});
  }
  saveCfg(guild.id, { ...cfg, ativo: false, painelMsgId: null, fila: [], atendimentos: {} });
  return interaction.editReply(soComp(buildConfigPayload(guild, `${E.apagar}  Suporte por voz desativado. A call voltou ao normal.`)));
}

// ───────────────────────────── 3) cliente: pedir atendimento ─────────────────────────────
async function pedirAtendimento(interaction) {
  const guild = interaction.guild;
  const cfg = getCfg(guild.id);
  if (!cfg.ativo) return interaction.reply(aviso(E.erro, 'Suporte por voz desativado', 'O suporte por voz está desativado neste servidor.'));
  if (interaction.member.voice?.channelId !== cfg.canalId) {
    return interaction.reply(aviso(E.erro, 'Entre na call primeiro', `Entre na call <#${cfg.canalId}> e depois peça o atendimento.`));
  }
  const uid = interaction.user.id;
  if (cfg.atendimentos[uid]) return interaction.reply(aviso(E.voz, 'Você já está sendo atendido'));
  const pos = cfg.fila.findIndex(f => f.userId === uid);
  if (pos >= 0) return interaction.reply(aviso(E.relogio, `Você já está na fila (posição ${pos + 1})`, 'Aguarde aqui na call.'));

  await interaction.deferReply({ flags: EPH_V2 });
  cfg.fila.push({ userId: uid, em: Date.now() });
  saveCfg(guild.id, cfg);

  // 1) AVISO NO CHAT DA CALL marcando os cargos de atendentes (garante que alguém veja, mesmo com DM fechada)
  let marcou = false;
  try {
    const canal = guild.channels.cache.get(cfg.canalId) || await guild.channels.fetch(cfg.canalId);
    const c = new ContainerBuilder().setAccentColor(COR)
      .addTextDisplayComponents(txt(`${E.sino}  **Novo pedido de atendimento por voz**`))
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(txt(`${E.user}  ${interaction.user} está esperando nesta call.\n${E.cargo}  ${cfg.cargosSuporte.map(r => `<@&${r}>`).join(' ')}`))
      .addSeparatorComponents(sep())
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('vsup_painel').setLabel('Painel Atendente').setEmoji(E.painel).setStyle(ButtonStyle.Primary)));
    await canal.send({ components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { roles: cfg.cargosSuporte, users: [uid] } });
    marcou = true;
  } catch (e) { console.error('[SuporteVoz] Erro ao avisar no chat da call:', e.message); }

  // 2) DM pra todos os atendentes
  let avisados = 0;
  try {
    await Promise.race([guild.members.fetch(), sleep(8000)]).catch(() => {});   // se demorar, usa o cache
    const atendentes = guild.members.cache.filter(m => !m.user.bot && cfg.cargosSuporte.some(r => m.roles.cache.has(r)));
    const dm = new ContainerBuilder().setAccentColor(COR)
      .addTextDisplayComponents(txt(`${E.sino}  **Novo pedido de atendimento por voz**`))
      .addSeparatorComponents(sep())
      .addTextDisplayComponents(txt(`${E.user}  ${interaction.user} está esperando na call <#${cfg.canalId}> em **${guild.name}**.\n${E.painel}  Toque em **Painel Atendente** para atender.`))
      .addSeparatorComponents(sep())
      .addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vsup_painel:${guild.id}`).setLabel('Painel Atendente').setEmoji(E.painel).setStyle(ButtonStyle.Primary)));
    for (const m of atendentes.values()) {
      try { await m.send({ components: [dm], flags: MessageFlags.IsComponentsV2 }); avisados++; }
      catch (e) { console.warn(`[SuporteVoz] DM não enviada para ${m.user.tag}: ${e.message}`); }
      await sleep(250);
    }
  } catch (e) { console.error('[SuporteVoz] Erro ao avisar atendentes por DM:', e.message); }

  const detalhe = [
    marcou ? `${E.ok}  Atendentes marcados no chat da call.` : `${E.erro}  Não consegui marcar os atendentes no chat da call.`,
    avisados ? `${E.ok}  **${avisados}** atendente(s) avisados por DM.` : `${E.erro}  Nenhuma DM enviada (DMs fechadas?). Eles também veem a fila no **Painel Atendente**.`,
  ].join('\n');
  return interaction.editReply(aviso(E.ok, 'Pedido enviado!', `${detalhe}\n\n${E.relogio}  Aguarde aqui na call: sua fala será liberada quando alguém te atender.`));
}

async function sairDaFila(interaction) {
  const guild = interaction.guild;
  const cfg = getCfg(guild.id);
  const antes = cfg.fila.length;
  cfg.fila = cfg.fila.filter(f => f.userId !== interaction.user.id);
  const saiu = cfg.fila.length !== antes;
  if (saiu) saveCfg(guild.id, cfg);
  return interaction.reply(saiu ? aviso(E.voltar, 'Você saiu da fila') : aviso(E.erro, 'Você não está na fila'));
}

// ───────────────────────────── 4) painel do atendente ─────────────────────────────
function buildPainelAtendente(guild, aba = 'fila', interaction) {
  const cfg = getCfg(guild.id);
  const fila = cfg.fila;
  const atend = Object.entries(cfg.atendimentos);
  const c = new ContainerBuilder().setAccentColor(COR)
    .addTextDisplayComponents(txt(`## ${E.painel}  Painel Atendente\n${E.relogio}  **Na fila:** ${fila.length}  •  ${E.voz}  **Em atendimento:** ${atend.length}`));
  c.addSeparatorComponents(sep());

  if (aba === 'fila') {
    if (!fila.length) c.addTextDisplayComponents(txt(`${E.ok}  _Ninguém esperando atendimento no momento._`));
    fila.slice(0, POR_PAGINA).forEach((f, i) => {
      c.addTextDisplayComponents(txt(`**${i + 1}.** ${E.user} <@${f.userId}> • esperando desde <t:${Math.floor(f.em / 1000)}:R>`));
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vsup_atender:${guild.id}:${f.userId}`).setLabel('Atender').setEmoji(E.voz).setStyle(ButtonStyle.Success)));
    });
    if (fila.length > POR_PAGINA) c.addTextDisplayComponents(txt(`-# +${fila.length - POR_PAGINA} na fila (atenda os primeiros para ver os próximos)`));
  } else {
    if (!atend.length) c.addTextDisplayComponents(txt(`${E.ok}  _Nenhum atendimento em andamento._`));
    atend.slice(0, POR_PAGINA).forEach(([uid, a]) => {
      c.addTextDisplayComponents(txt(`${E.user} <@${uid}> • atendido por <@${a.atendenteId}> desde <t:${Math.floor(a.em / 1000)}:R>`));
      c.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vsup_fim:${guild.id}:${uid}`).setLabel('Finalizar atendimento').setEmoji(E.ok).setStyle(ButtonStyle.Danger)));
    });
    if (atend.length > POR_PAGINA) c.addTextDisplayComponents(txt(`-# +${atend.length - POR_PAGINA} em atendimento`));
  }

  c.addSeparatorComponents(sep());
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vsup_pfila:${guild.id}`).setLabel(`Fila (${fila.length})`).setStyle(aba === 'fila' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`vsup_patend:${guild.id}`).setLabel(`Em atendimento (${atend.length})`).setStyle(aba === 'atend' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`vsup_pupd:${guild.id}:${aba}`).setLabel('Atualizar').setEmoji(E.raio).setStyle(ButtonStyle.Secondary),
  ));
  return { components: [c], flags: interaction ? flagsPainel(interaction) : EPH_V2 };
}

async function abrirPainelAtendente(interaction, gid) {
  const { guild, member } = await contexto(interaction, gid);
  if (!guild) return interaction.reply(aviso(E.erro, 'Não encontrei o servidor'));
  const cfg = getCfg(guild.id);
  if (!cfg.ativo) return interaction.reply(avisoI(interaction, E.erro, 'Suporte por voz desativado'));
  if (!ehAtendente(member, cfg, interaction.user.id)) {
    return interaction.reply(avisoI(interaction, E.erro, 'Só atendentes podem abrir este painel'));
  }
  return interaction.reply(buildPainelAtendente(guild, 'fila', interaction));
}

async function trocarAba(interaction, gid, aba) {
  const { guild, member } = await contexto(interaction, gid);
  if (!guild) return;
  if (!ehAtendente(member, getCfg(guild.id), interaction.user.id)) return interaction.reply(aviso(E.erro, 'Só atendentes'));
  return interaction.update(buildPainelAtendente(guild, aba, interaction));
}

async function atender(interaction, gid, uid) {
  const { guild, member } = await contexto(interaction, gid);
  if (!guild) return;
  const cfg = getCfg(guild.id);
  if (!ehAtendente(member, cfg, interaction.user.id)) return interaction.reply(aviso(E.erro, 'Só atendentes'));

  const naFila = cfg.fila.find(f => f.userId === uid);
  if (!naFila) return interaction.update(buildPainelAtendente(guild, 'fila', interaction)); // já atendido por outro ou saiu

  const alvo = await guild.members.fetch(uid).catch(() => null);
  cfg.fila = cfg.fila.filter(f => f.userId !== uid);
  if (!alvo || alvo.voice?.channelId !== cfg.canalId) {
    saveCfg(guild.id, cfg);   // saiu da call: tira da fila
    return interaction.update(buildPainelAtendente(guild, 'fila', interaction));
  }
  try {
    await alvo.roles.add(cfg.cargoAtendId, `Atendimento por ${interaction.user.tag}`);
  } catch (e) {
    cfg.fila.unshift(naFila); saveCfg(guild.id, cfg);
    console.error('[SuporteVoz] Erro ao dar o cargo de atendimento:', e.message);
    return interaction.reply(avisoI(interaction, E.erro, 'Não consegui dar o cargo de atendimento', `${e.message}\nO cargo do Kael precisa estar **acima** do cargo "em atendimento".`));
  }
  cfg.atendimentos[uid] = { atendenteId: interaction.user.id, em: Date.now() };
  saveCfg(guild.id, cfg);
  const canal = guild.channels.cache.get(cfg.canalId);
  if (canal) canal.send({ ...avisoCanal(E.voz, 'Atendimento iniciado', `${E.user}  ${alvo}, você está sendo atendido por ${interaction.user}!\n${E.ok}  Sua fala foi **liberada**.`), allowedMentions: { users: [uid, interaction.user.id] } }).catch(() => {});
  return interaction.update(buildPainelAtendente(guild, 'fila', interaction));
}

async function finalizar(interaction, gid, uid) {
  const { guild, member } = await contexto(interaction, gid);
  if (!guild) return;
  const cfg = getCfg(guild.id);
  if (!ehAtendente(member, cfg, interaction.user.id)) return interaction.reply(aviso(E.erro, 'Só atendentes'));
  await encerrar(guild, cfg, uid, `Atendimento finalizado por ${interaction.user.tag}`);
  const canal = guild.channels.cache.get(cfg.canalId);
  if (canal) canal.send({ ...avisoCanal(E.ok, 'Atendimento finalizado', `${E.user}  <@${uid}> foi atendido por ${interaction.user}.\n${E.parar}  A fala dele(a) foi bloqueada novamente.`), allowedMentions: { parse: [] } }).catch(() => {});
  return interaction.update(buildPainelAtendente(guild, 'atend', interaction));
}

/** Tira o cargo e apaga o registro do atendimento. */
async function encerrar(guild, cfg, uid, motivo) {
  const alvo = await guild.members.fetch(uid).catch(() => null);
  if (alvo && cfg.cargoAtendId) await alvo.roles.remove(cfg.cargoAtendId, motivo).catch(() => {});
  const atual = getCfg(guild.id);
  delete atual.atendimentos[uid];
  saveCfg(guild.id, atual);
}

// ───────────────────────────── 5) limpeza automática ─────────────────────────────
async function onVoiceStateUpdate(oldState, newState) {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;
    const cfg = getCfg(guild.id);
    if (!cfg.ativo || !cfg.canalId) return;
    const uid = (newState.member || oldState.member)?.id;
    if (!uid) return;

    // saiu da call do suporte: sai da fila e/ou encerra o atendimento
    if (oldState.channelId === cfg.canalId && newState.channelId !== cfg.canalId) {
      const estavaNaFila = cfg.fila.some(f => f.userId === uid);
      if (estavaNaFila) { cfg.fila = cfg.fila.filter(f => f.userId !== uid); saveCfg(guild.id, cfg); }
      if (cfg.atendimentos[uid]) {
        await encerrar(guild, cfg, uid, 'Saiu da call de suporte');
        const canal = guild.channels.cache.get(cfg.canalId);
        if (canal) canal.send({ ...avisoCanal(E.voltar, 'Atendimento encerrado', `${E.user}  <@${uid}> saiu da call.`), allowedMentions: { parse: [] } }).catch(() => {});
      }
    }
    // entrou na call com o cargo de atendimento sobrando (ex.: bot caiu no meio do atendimento): limpa
    if (newState.channelId === cfg.canalId && oldState.channelId !== cfg.canalId && cfg.cargoAtendId && !cfg.atendimentos[uid]) {
      const m = newState.member;
      if (m && m.roles.cache.has(cfg.cargoAtendId)) await m.roles.remove(cfg.cargoAtendId, 'Cargo de atendimento sobrando').catch(() => {});
    }
  } catch (e) { console.error('[SuporteVoz] voiceStateUpdate:', e.message); }
}

// ───────────────────────────── roteador (botões e menus vsup_*) ─────────────────────────────
async function handle(interaction) {
  const id = interaction.customId;
  const [acao, a1, a2] = id.split(':');
  const gid = a1;

  // — configuração (só admin) —
  if (id.startsWith('vsup_go_') || id.startsWith('vsup_cfg_')) {
    if (!ehAdmin(interaction.member, interaction.user.id)) {
      return interaction.reply(aviso(E.erro, 'Só administradores podem configurar'));
    }
    if (id === 'vsup_go_chat') return require('../ticket-system/ticketManager').showAdminPanel(interaction);
    if (id === 'vsup_go_voz') return interaction.update(buildConfigPayload(interaction.guild));
    const guild = interaction.guild;
    const cfg = getCfg(guild.id);
    if (id === 'vsup_cfg_canal')   { saveCfg(guild.id, { ...cfg, canalId: interaction.values[0] }); return interaction.update(buildConfigPayload(guild)); }
    if (id === 'vsup_cfg_suporte') { saveCfg(guild.id, { ...cfg, cargosSuporte: interaction.values }); return interaction.update(buildConfigPayload(guild)); }
    if (id === 'vsup_cfg_atend')   { saveCfg(guild.id, { ...cfg, cargoAtendId: interaction.values[0] }); return interaction.update(buildConfigPayload(guild)); }
    if (id === 'vsup_cfg_postar')    return postarPainel(interaction);
    if (id === 'vsup_cfg_desativar') return desativar(interaction);
  }

  // — cliente —
  if (acao === 'vsup_pedir') return pedirAtendimento(interaction);
  if (acao === 'vsup_sair')  return sairDaFila(interaction);

  // — atendente (o painel público não leva guildId; os de DM levam) —
  if (acao === 'vsup_painel') return abrirPainelAtendente(interaction, gid || interaction.guildId);
  if (acao === 'vsup_pfila')  return trocarAba(interaction, gid, 'fila');
  if (acao === 'vsup_patend') return trocarAba(interaction, gid, 'atend');
  if (acao === 'vsup_pupd')   return trocarAba(interaction, gid, a2 === 'atend' ? 'atend' : 'fila');
  if (acao === 'vsup_atender') return atender(interaction, gid, a2);
  if (acao === 'vsup_fim')     return finalizar(interaction, gid, a2);
}

module.exports = { showEscolha, handle, onVoiceStateUpdate };
