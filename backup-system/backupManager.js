// ═══════════════════════════════════════════════════════════════════════════
//  backupManager.js — Kael HUD (Backup & Restauração de Servidor)
//  (Components V2, Discord.js v14) — módulo NOVO e independente.
// ═══════════════════════════════════════════════════════════════════════════
//
//  Captura um snapshot de: cargos, categorias, canais (com overwrites de
//  CARGO — overwrites de membro específico não são portáveis e por isso
//  não são capturados), e emojis customizados. NÃO captura histórico de
//  mensagens (custo/risco alto, pouco valor para reconstrução estrutural).
//
//  Restauração é sempre em modo ADITIVO: cria o que estiver faltando
//  (comparando por nome), nunca apaga ou substitui o que já existe no
//  servidor no momento da restauração. Isso evita perda de dados em uma
//  restauração acidental.
//
//  Seções deste arquivo:
//    1. Imports & DB
//    2. Constantes / utilitários
//    3. Captura de snapshot (leitura do servidor ao vivo)
//    4. Restauração (recriação no servidor)
//    5. Builders de container (Components V2)
//    6. handleButton / handleSelectMenu / handleModal
//    7. Exports
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  1. IMPORTS & DB
// ─────────────────────────────────────────────────────────────
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder,
  MessageFlags,
} = require('discord.js');
const { bannerFile, BANNER_ATTACH_URL } = require('../utils/branding');

const db = require('../database/db');

// ─────────────────────────────────────────────────────────────
//  2. CONSTANTES / UTILITÁRIOS
// ─────────────────────────────────────────────────────────────
const COR = {
  SUCCESS: 0x57F287,
  DANGER : 0xED4245,
  GOLD   : 0x000000, // visual KAEL: container preto
};

const E = {
  escudo : '<:safety:1528841000548569239>',
  salvar : '<:save:1533080403810713773>',
  pasta  : '<:folder:1533259504936816641>',
  relogio: '<:clock:1524207889441357917>',
  ok     : '<:positivo:1528401238197276702>',
  erro   : '<:negativo:1528400986744295475>',
  apagar : '<:apagar:1524206738885050388>',
  lista  : '<:embed:1528400492982571111>',
};

const MAX_BACKUPS = 5;
const INTERVALO_AUTO_HORAS = 6;
const FLAGS_V2 = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;

function errContainer(texto) {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(COR.DANGER)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(texto)),
    ],
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };
}

function botaoVoltar() {
  return new ButtonBuilder().setCustomId('bkp_painel_voltar').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary);
}

function tsRelativo(iso) {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>`;
}

// ─────────────────────────────────────────────────────────────
//  3. CAPTURA DE SNAPSHOT
// ─────────────────────────────────────────────────────────────

/** Guarda só os overwrites de CARGO (type 0) de um canal, pelo NOME do cargo. */
function capturarOverwrites(channel) {
  // BUGFIX: threads (e alguns outros tipos) não têm permissionOverwrites
  // — acessar .cache neles quebrava com "Cannot read properties of
  // undefined (reading 'cache')". Agora é defensivo.
  if (!channel.permissionOverwrites?.cache) return [];
  return channel.permissionOverwrites.cache
    .filter(o => o.type === 0)
    .map(o => {
      const cargo = channel.guild?.roles?.cache?.get(o.id);
      if (!cargo) return null;
      return { cargoNome: cargo.name, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() };
    })
    .filter(Boolean);
}

// Tipos de canal que realmente fazem sentido num backup de estrutura de
// servidor (exclui threads e qualquer tipo sem permissionOverwrites).
const TIPOS_CANAL_BACKUP = [
  ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia,
].filter(t => t !== undefined);

async function capturarSnapshot(guild) {
  const roles = guild.roles.cache
    .filter(r => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position) // do topo pra base, pra recriar na mesma ordem
    .map(r => ({
      nome: r.name,
      cor: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
    }));

  const categorias = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position)
    .map(c => ({ nome: c.name, overwrites: capturarOverwrites(c) }));

  const canais = guild.channels.cache
    .filter(c => TIPOS_CANAL_BACKUP.includes(c.type))
    .sort((a, b) => a.position - b.position)
    .map(c => ({
      nome: c.name,
      tipo: c.type,
      categoriaNome: c.parent ? c.parent.name : null,
      topico: ('topic' in c) ? (c.topic || null) : null,
      nsfw: c.nsfw || false,
      overwrites: capturarOverwrites(c),
    }));

  const emojis = guild.emojis.cache.map(e => ({
    nome: e.name,
    url: e.imageURL({ extension: e.animated ? 'gif' : 'png' }),
  }));

  return {
    guildNomeOriginal: guild.name,
    criadoPor: null, // preenchido por quem chamar (id do admin)
    totalCargos: roles.length,
    totalCategorias: categorias.length,
    totalCanais: canais.length,
    totalEmojis: emojis.length,
    roles, categorias, canais, emojis,
  };
}

// ─────────────────────────────────────────────────────────────
//  4. RESTAURAÇÃO
// ─────────────────────────────────────────────────────────────

function construirOverwrites(overwrites, nomeParaRoleId, guild) {
  const lista = [];
  for (const o of (overwrites || [])) {
    const roleId = nomeParaRoleId.get(o.cargoNome) || guild.roles.cache.find(r => r.name === o.cargoNome)?.id;
    if (!roleId) continue;
    lista.push({ id: roleId, allow: BigInt(o.allow || '0'), deny: BigInt(o.deny || '0') });
  }
  return lista;
}

/**
 * Restaura um snapshot no servidor em modo ADITIVO: se já existe um
 * cargo/categoria/canal/emoji com o mesmo nome, PULA (não duplica, não
 * substitui). Retorna um resumo do que foi criado + eventuais erros.
 */
async function restaurarSnapshot(guild, snapshot) {
  const resultado = { cargosCriados: 0, categoriasCriadas: 0, canaisCriados: 0, emojisCriados: 0, erros: [] };
  const nomeParaRoleId = new Map();
  const nomeParaCategoriaId = new Map();

  // 1) Cargos (do topo pra base, preserva hierarquia aproximada)
  for (const r of (snapshot.roles || [])) {
    try {
      const existente = guild.roles.cache.find(x => x.name === r.nome);
      if (existente) { nomeParaRoleId.set(r.nome, existente.id); continue; }
      const novo = await guild.roles.create({
        name: r.nome,
        color: r.cor || undefined,
        hoist: !!r.hoist,
        mentionable: !!r.mentionable,
        permissions: BigInt(r.permissions || '0'),
        reason: 'Restauração de backup — KAEL',
      });
      nomeParaRoleId.set(r.nome, novo.id);
      resultado.cargosCriados++;
    } catch (e) { resultado.erros.push(`Cargo "${r.nome}": ${e.message}`); }
  }

  // 2) Categorias
  for (const c of (snapshot.categorias || [])) {
    try {
      const existente = guild.channels.cache.find(x => x.type === ChannelType.GuildCategory && x.name === c.nome);
      if (existente) { nomeParaCategoriaId.set(c.nome, existente.id); continue; }
      const overwrites = construirOverwrites(c.overwrites, nomeParaRoleId, guild);
      const nova = await guild.channels.create({
        name: c.nome, type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
        reason: 'Restauração de backup — KAEL',
      });
      nomeParaCategoriaId.set(c.nome, nova.id);
      resultado.categoriasCriadas++;
    } catch (e) { resultado.erros.push(`Categoria "${c.nome}": ${e.message}`); }
  }

  // 3) Canais
  for (const c of (snapshot.canais || [])) {
    try {
      const jaExiste = guild.channels.cache.some(x => x.name === c.nome && x.type === c.tipo);
      if (jaExiste) continue;
      const overwrites = construirOverwrites(c.overwrites, nomeParaRoleId, guild);
      const parentId = c.categoriaNome ? nomeParaCategoriaId.get(c.categoriaNome) : null;
      await guild.channels.create({
        name: c.nome,
        type: c.tipo,
        parent: parentId || undefined,
        topic: c.topico || undefined,
        nsfw: c.nsfw || false,
        permissionOverwrites: overwrites,
        reason: 'Restauração de backup — KAEL',
      });
      resultado.canaisCriados++;
    } catch (e) { resultado.erros.push(`Canal "${c.nome}": ${e.message}`); }
  }

  // 4) Emojis (ignora se já existir um com o mesmo nome, ou se o servidor
  // já atingiu o limite de slots de emoji — erro é só registrado, não trava o resto)
  for (const e of (snapshot.emojis || [])) {
    try {
      if (guild.emojis.cache.some(x => x.name === e.nome)) continue;
      await guild.emojis.create({ attachment: e.url, name: e.nome, reason: 'Restauração de backup — KAEL' });
      resultado.emojisCriados++;
    } catch (e2) { resultado.erros.push(`Emoji "${e.nome}": ${e2.message}`); }
  }

  return resultado;
}

// ─────────────────────────────────────────────────────────────
//  5. BUILDERS DE CONTAINER (Components V2) — visual Kael HUD
// ─────────────────────────────────────────────────────────────

const sep = (divider = true) => new SeparatorBuilder().setDivider(divider).setSpacing(SeparatorSpacingSize.Small);
const txt = (t) => new TextDisplayBuilder().setContent(t);

function getAuto(guildId) {
  const st = db.getBackupState(guildId);
  return st.auto || { enabled: false, intervaloHoras: INTERVALO_AUTO_HORAS, ultimoEm: null };
}

function textoStatus(guildId) {
  const state = db.getBackupState(guildId);
  const snaps = state.snapshots || [];
  const auto = getAuto(guildId);
  const ultimo = snaps[snaps.length - 1];
  const linhaAuto = auto.enabled
    ? `**Backup automático:** ligado (a cada ${auto.intervaloHoras || INTERVALO_AUTO_HORAS}h)`
    : `**Backup automático:** desligado`;
  if (!ultimo) return `Nenhum backup salvo ainda. Toque em **Salvar agora**.\n${linhaAuto}`;
  return `**Último backup:** ${tsRelativo(ultimo.criadoEm)} • \`${snaps.length}/${MAX_BACKUPS}\` salvos\n` +
         `\`${ultimo.totalCargos}\` cargos • \`${ultimo.totalCategorias}\` categorias • \`${ultimo.totalCanais}\` canais\n${linhaAuto}`;
}

/** Painel principal: texto, banner, status e 3 botões. Sempre leva o banner como anexo. */
function buildHudPayload(guild, statusMsg = null, { edicao = false } = {}) {
  const auto = getAuto(guild.id);
  const c = new ContainerBuilder().setAccentColor(COR.GOLD);
  if (statusMsg) { c.addTextDisplayComponents(txt(statusMsg)); c.addSeparatorComponents(sep(true)); }
  c.addTextDisplayComponents(txt(
    `# ${E.escudo} Kael HUD\n` +
    `Salva **cargos, categorias, canais e permissões** do servidor. Se alguém destruir tudo, é só restaurar por aqui.`
  ));
  c.addSeparatorComponents(sep(true));
  c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(BANNER_ATTACH_URL).setSpoiler(false)
  ));
  c.addSeparatorComponents(sep(true));
  c.addTextDisplayComponents(txt(textoStatus(guild.id)));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bkp_criar_snapshot').setLabel('Salvar agora').setEmoji(E.salvar).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bkp_listar_snapshots').setLabel('Backups e restaurar').setEmoji(E.pasta).setStyle(ButtonStyle.Secondary),
  ));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bkp_toggle_auto')
      .setLabel(auto.enabled ? 'Desligar automático' : 'Ligar automático')
      .setEmoji(E.relogio).setStyle(auto.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
  ));
  const payload = { components: [c], files: [bannerFile()], flags: FLAGS_V2 };
  // Ao editar uma mensagem que já tem o banner, troca o anexo antigo pelo novo (não acumula).
  if (edicao) payload.attachments = [];
  return payload;
}

function buildListaContainer(itens) {
  const c = new ContainerBuilder().setAccentColor(COR.GOLD);
  if (itens.length === 0) {
    c.addTextDisplayComponents(txt(`## ${E.pasta} Backups e restaurar\nNenhum backup salvo ainda. Volte e toque em **Salvar agora**.`));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(botaoVoltar()));
    return c;
  }
  c.addTextDisplayComponents(txt(`## ${E.pasta} Backups e restaurar\nEscolha um backup para ver os detalhes, restaurar ou apagar.`));
  c.addSeparatorComponents(sep(true));
  const select = new StringSelectMenuBuilder()
    .setCustomId('bkp_sel_snapshot')
    .setPlaceholder('Selecione um backup...')
    .addOptions(itens.slice(0, 25).map(item => ({
      label: (item.nome || `Backup de ${new Date(item.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`).slice(0, 100),
      description: `${item.totalCargos} cargos • ${item.totalCategorias} categorias • ${item.totalCanais} canais`.slice(0, 100),
      value: item.id,
    })));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(botaoVoltar()));
  return c;
}

function buildDetalheContainer(item) {
  return new ContainerBuilder().setAccentColor(COR.GOLD)
    .addTextDisplayComponents(txt(
      `## ${E.salvar} Backup de ${tsRelativo(item.criadoEm)}\n` +
      `**Servidor original:** \`${item.guildNomeOriginal}\`\n\n` +
      `**Cargos:** \`${item.totalCargos}\`\n**Categorias:** \`${item.totalCategorias}\`\n` +
      `**Canais:** \`${item.totalCanais}\`\n**Emojis:** \`${item.totalEmojis}\`\n\n` +
      `-# A restauração só cria o que está faltando (comparando pelo nome). Nada é apagado ou substituído.`
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bkp_confirmar_restaurar_snapshot_${item.id}`).setLabel('Restaurar').setEmoji(E.salvar).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`bkp_apagar_snapshot_${item.id}`).setLabel('Apagar').setEmoji(E.apagar).setStyle(ButtonStyle.Danger),
      botaoVoltarLista(),
    ));
}

function buildConfirmarContainer(item) {
  return new ContainerBuilder().setAccentColor(COR.DANGER)
    .addTextDisplayComponents(txt(
      `## ⚠️ Confirmar restauração\n` +
      `Vou criar o que estiver faltando: \`${item.totalCargos}\` cargos, \`${item.totalCategorias}\` categorias, ` +
      `\`${item.totalCanais}\` canais e \`${item.totalEmojis}\` emojis.\n\n` +
      `Nada existente será apagado ou sobrescrito. Pode levar alguns segundos. Confirmar?`
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bkp_executar_restaurar_snapshot_${item.id}`).setLabel('Sim, restaurar').setEmoji(E.salvar).setStyle(ButtonStyle.Danger),
      botaoVoltarLista(),
    ));
}

function botaoVoltarLista() {
  return new ButtonBuilder().setCustomId('bkp_listar_snapshots').setLabel('Voltar').setEmoji('<:voltar:1528548726518448198>').setStyle(ButtonStyle.Secondary);
}

// ─────────────────────────────────────────────────────────────
//  6. HANDLERS
// ─────────────────────────────────────────────────────────────

async function showAdminPanel(interaction) {
  await interaction.reply(buildHudPayload(interaction.guild));
}

/** Salva um backup (usado pelo botão e pelo agendador automático). */
async function salvarBackup(guild, userId = null) {
  const snapshot = await capturarSnapshot(guild);
  return db.salvarSnapshot(guild.id, { ...snapshot, criadoPor: userId });
}

async function criarSnapshotAgora(interaction) {
  await interaction.deferUpdate();
  try {
    const r = await salvarBackup(interaction.guild, interaction.user.id);
    await interaction.editReply(buildHudPayload(interaction.guild,
      `${E.ok} **Backup salvo!** \`${r.totalCargos}\` cargos • \`${r.totalCategorias}\` categorias • \`${r.totalCanais}\` canais`, { edicao: true }));
  } catch (e) {
    console.error('[HUD] Erro ao salvar backup:', e.message);
    await interaction.editReply(errContainer(`${E.erro} Erro ao salvar o backup: ${e.message}`));
  }
}

async function alternarAutomatico(interaction) {
  const atual = getAuto(interaction.guildId);
  const novo = { enabled: !atual.enabled, intervaloHoras: atual.intervaloHoras || INTERVALO_AUTO_HORAS, ultimoEm: atual.ultimoEm || null };
  db.updateGuild(interaction.guildId, 'backups.auto', novo);
  await interaction.deferUpdate();
  await interaction.editReply(buildHudPayload(interaction.guild,
    novo.enabled
      ? `${E.ok} **Backup automático ligado.** Vou salvar sozinho a cada ${novo.intervaloHoras}h (guardo os ${MAX_BACKUPS} mais recentes).`
      : `${E.ok} **Backup automático desligado.**`, { edicao: true }));
}

async function listarSnapshots(interaction) {
  const itens = db.getSnapshots(interaction.guildId).slice().reverse();
  return interaction.update({ components: [buildListaContainer(itens)], flags: FLAGS_V2 });
}

async function handleSelectMenu(interaction) {
  const item = db.getSnapshotPorId(interaction.guildId, interaction.values[0]);
  if (!item) return interaction.update(errContainer(`${E.erro} Este backup não existe mais.`));
  return interaction.update({ components: [buildDetalheContainer(item)], flags: FLAGS_V2 });
}

function extrairId(customId, prefixo) {
  // aceita também ids antigos de botões já publicados (…_snapshot_<id> / …_template_<id>)
  const resto = customId.slice(prefixo.length);
  const tipo = resto.startsWith('snapshot_') ? 'snapshot' : 'template';
  return { tipo, id: resto.slice(tipo.length + 1) };
}

function buscarItem(guildId, tipo, id) {
  return tipo === 'snapshot' ? db.getSnapshotPorId(guildId, id) : db.getTemplatePorId(guildId, id);
}

async function handleButton(interaction) {
  const customId = interaction.customId;

  if (customId === 'bkp_painel_voltar') return interaction.update(buildHudPayload(interaction.guild, null, { edicao: true }));
  if (customId === 'bkp_criar_snapshot')    return criarSnapshotAgora(interaction);
  if (customId === 'bkp_toggle_auto')       return alternarAutomatico(interaction);
  if (customId === 'bkp_listar_snapshots')  return listarSnapshots(interaction);

  if (customId.startsWith('bkp_confirmar_restaurar_')) {
    const { tipo, id } = extrairId(customId, 'bkp_confirmar_restaurar_');
    const item = buscarItem(interaction.guildId, tipo, id);
    if (!item) return interaction.update(errContainer(`${E.erro} Este backup não existe mais.`));
    return interaction.update({ components: [buildConfirmarContainer(item)], flags: FLAGS_V2 });
  }

  if (customId.startsWith('bkp_executar_restaurar_')) {
    const { tipo, id } = extrairId(customId, 'bkp_executar_restaurar_');
    const item = buscarItem(interaction.guildId, tipo, id);
    if (!item) return interaction.update(errContainer(`${E.erro} Este backup não existe mais.`));
    await interaction.deferUpdate();
    try {
      const r = await restaurarSnapshot(interaction.guild, item);
      const resumo =
        `## ${E.ok} Restauração concluída\n` +
        `**Cargos criados:** \`${r.cargosCriados}\`\n**Categorias criadas:** \`${r.categoriasCriadas}\`\n` +
        `**Canais criados:** \`${r.canaisCriados}\`\n**Emojis criados:** \`${r.emojisCriados}\`` +
        (r.erros.length ? `\n\n⚠️ **${r.erros.length} erro(s):**\n\`\`\`\n${r.erros.slice(0, 8).join('\n')}\n\`\`\`` : '');
      const c = new ContainerBuilder().setAccentColor(r.erros.length ? COR.DANGER : COR.SUCCESS)
        .addTextDisplayComponents(txt(resumo))
        .addActionRowComponents(new ActionRowBuilder().addComponents(botaoVoltar()));
      await interaction.editReply({ components: [c], flags: FLAGS_V2 });
    } catch (e) {
      console.error('[HUD] Erro ao restaurar:', e.message);
      await interaction.editReply(errContainer(`${E.erro} Erro ao restaurar: ${e.message}`));
    }
    return;
  }

  if (customId.startsWith('bkp_apagar_')) {
    const { tipo, id } = extrairId(customId, 'bkp_apagar_');
    if (tipo === 'snapshot') db.removerSnapshot(interaction.guildId, id);
    else { const t = db.getTemplatePorId(interaction.guildId, id); if (t) db.removerTemplate(interaction.guildId, t.nome); }
    return interaction.update(buildHudPayload(interaction.guild, `${E.apagar} Backup removido.`, { edicao: true }));
  }

  // Botões de painéis ANTIGOS ainda publicados: abre o HUD novo em vez de dar erro.
  if (customId === 'bkp_modal_template' || customId === 'bkp_listar_templates') {
    return interaction.update(buildHudPayload(interaction.guild, null, { edicao: true }));
  }
}

async function handleModal(interaction) {
  // Modal de "salvar como template" foi removido do HUD novo.
  return interaction.reply(errContainer(`${E.erro} Use o botão **Salvar agora** no /hud.`));
}

// ─────────────────────────────────────────────────────────────
//  7. BACKUP AUTOMÁTICO
// ─────────────────────────────────────────────────────────────
let _timerAuto = null;

async function rodarBackupsAutomaticos(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const auto = getAuto(guild.id);
      if (!auto.enabled) continue;
      const intervaloMs = (auto.intervaloHoras || INTERVALO_AUTO_HORAS) * 3600 * 1000;
      if (auto.ultimoEm && Date.now() - new Date(auto.ultimoEm).getTime() < intervaloMs) continue;
      await salvarBackup(guild, null);
      db.updateGuild(guild.id, 'backups.auto', { ...auto, ultimoEm: new Date().toISOString() });
      console.log(`[HUD] Backup automático salvo — guild ${guild.id}.`);
    } catch (e) {
      console.error(`[HUD] Falha no backup automático da guild ${guild.id}:`, e.message);
    }
  }
}

function iniciarBackupAutomatico(client) {
  if (_timerAuto) return;
  setTimeout(() => rodarBackupsAutomaticos(client), 60 * 1000);
  _timerAuto = setInterval(() => rodarBackupsAutomaticos(client), 10 * 60 * 1000);
  console.log('[HUD] Agendador de backup automático ativo (checa a cada 10 min).');
}

module.exports = {
  showAdminPanel,
  handleButton,
  handleSelectMenu,
  handleModal,
  iniciarBackupAutomatico,
  capturarSnapshot,
  restaurarSnapshot,
};
