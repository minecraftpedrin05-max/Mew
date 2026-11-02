/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Moderação manual
 *  /ban  /unban  /kick  /timeout  /warn  /avisos  /limparavisos
 *
 *  • Confere hierarquia de cargos (quem executa e o bot).
 *  • Avisa o usuário por DM (quando possível) antes de ban/kick.
 *  • Toda ação vai pro canal de /logs (categoria "Moderação").
 *  • Avisos ficam salvos em guild.extras.moderacao.avisos[userId].
 *  • As permissões são checadas pelo index.js (commandPerms).
 * ─────────────────────────────────────────────────────────────────
 */
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { E, COR, exigirPlano, getExtras, setExtras, embedErro, cortar, ts, enviarDM } = require('../extras-system/base');
const logs = require('../extras-system/logsManager');

const DURACOES = [
  { name: '60 segundos', value: '60s' }, { name: '5 minutos', value: '5m' },
  { name: '10 minutos', value: '10m' }, { name: '1 hora', value: '1h' },
  { name: '1 dia', value: '1d' }, { name: '7 dias', value: '7d' },
  { name: '28 dias (máximo)', value: '28d' }, { name: 'Remover castigo', value: '0' },
];
const MS = { '60s': 60e3, '5m': 300e3, '10m': 600e3, '1h': 3600e3, '1d': 86400e3, '7d': 7 * 86400e3, '28d': 28 * 86400e3 };

async function base(interaction) {
  if (!interaction.guild) { await interaction.reply({ content: 'Use este comando dentro de um servidor.', flags: 64 }); return false; }
  return exigirPlano(interaction, 'moderacao');
}

/** Verifica se dá pra agir no alvo. Retorna string de erro ou null. */
function checarHierarquia(interaction, alvoMember) {
  if (!alvoMember) return null; // alvo fora do servidor (ban por ID) — sem hierarquia
  const guild = interaction.guild;
  if (alvoMember.id === interaction.user.id) return 'Você não pode aplicar isso em si mesmo.';
  if (alvoMember.id === guild.ownerId) return 'Não dá pra punir o dono do servidor.';
  if (alvoMember.id === interaction.client.user.id) return 'Não vou fazer isso comigo mesmo.';
  const eu = guild.members.me;
  if (alvoMember.roles.highest.position >= eu.roles.highest.position) return 'Esse membro tem um cargo igual ou acima do meu. Suba o cargo do bot.';
  if (interaction.user.id !== guild.ownerId && interaction.member?.roles?.highest &&
      alvoMember.roles.highest.position >= interaction.member.roles.highest.position) {
    return 'Esse membro tem um cargo igual ou acima do seu.';
  }
  return null;
}

function embedAcao(titulo, cor, alvo, mod, motivo, extra) {
  const e = new EmbedBuilder().setColor(cor).setTitle(titulo)
    .addFields(
      { name: 'Usuário', value: `<@${alvo.id}> (\`${alvo.tag || alvo.id}\`)`, inline: true },
      { name: 'Moderador', value: `<@${mod.id}>`, inline: true },
      { name: 'Motivo', value: cortar(motivo, 1000) },
    );
  if (extra) e.addFields(extra);
  return e;
}

const motivoOpt = (o) => o.setName('motivo').setDescription('Motivo (aparece nos logs)').setMaxLength(400);

const cmds = [
  // ── /ban ──
  {
    data: new SlashCommandBuilder().setName('ban').setDescription('Bane um membro do servidor')
      .addUserOption(o => o.setName('usuario').setDescription('Quem será banido').setRequired(true))
      .addStringOption(motivoOpt)
      .addIntegerOption(o => o.setName('apagar_mensagens').setDescription('Apagar mensagens dos últimos X dias (0 a 7)').setMinValue(0).setMaxValue(7))
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    async execute(interaction) {
      if (!(await base(interaction))) return;
      const user = interaction.options.getUser('usuario');
      const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
      const dias = interaction.options.getInteger('apagar_mensagens') ?? 0;
      await interaction.deferReply({ flags: 64 });
      const membro = await interaction.guild.members.fetch(user.id).catch(() => null);
      const erro = checarHierarquia(interaction, membro);
      if (erro) return interaction.editReply({ embeds: [embedErro(erro)] });
      if (membro && !membro.bannable) return interaction.editReply({ embeds: [embedErro('Não consigo banir esse membro (permissão/hierarquia).')] });
      await enviarDM(interaction.client, user.id, { embeds: [new EmbedBuilder().setColor(COR.erro)
        .setTitle(`${E.block} Você foi banido de ${interaction.guild.name}`).setDescription(`**Motivo:** ${cortar(motivo, 500)}`)] });
      try {
        await interaction.guild.members.ban(user.id, { reason: `${interaction.user.tag}: ${motivo}`, deleteMessageSeconds: dias * 86400 });
      } catch (e) { return interaction.editReply({ embeds: [embedErro(`Falhou ao banir: ${e.message}`)] }); }
      const emb = embedAcao(`${E.block} Membro banido`, COR.erro, user, interaction.user, motivo);
      await logs.logar(interaction.guild, 'moderacao', emb);
      return interaction.editReply({ embeds: [emb] });
    },
  },
  // ── /unban ──
  {
    data: new SlashCommandBuilder().setName('unban').setDescription('Remove o banimento de um usuário')
      .addStringOption(o => o.setName('id').setDescription('ID do usuário banido').setRequired(true))
      .addStringOption(motivoOpt)
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    async execute(interaction) {
      if (!(await base(interaction))) return;
      const id = interaction.options.getString('id').trim();
      const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
      await interaction.deferReply({ flags: 64 });
      try {
        const u = await interaction.guild.members.unban(id, `${interaction.user.tag}: ${motivo}`);
        const emb = embedAcao(`${E.positivo} Banimento removido`, COR.ok, u, interaction.user, motivo);
        await logs.logar(interaction.guild, 'moderacao', emb);
        return interaction.editReply({ embeds: [emb] });
      } catch {
        return interaction.editReply({ embeds: [embedErro('Esse ID não está banido (ou é inválido).')] });
      }
    },
  },
  // ── /kick ──
  {
    data: new SlashCommandBuilder().setName('kick').setDescription('Expulsa um membro do servidor')
      .addUserOption(o => o.setName('usuario').setDescription('Quem será expulso').setRequired(true))
      .addStringOption(motivoOpt)
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    async execute(interaction) {
      if (!(await base(interaction))) return;
      const user = interaction.options.getUser('usuario');
      const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
      await interaction.deferReply({ flags: 64 });
      const membro = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!membro) return interaction.editReply({ embeds: [embedErro('Esse usuário não está no servidor.')] });
      const erro = checarHierarquia(interaction, membro);
      if (erro) return interaction.editReply({ embeds: [embedErro(erro)] });
      if (!membro.kickable) return interaction.editReply({ embeds: [embedErro('Não consigo expulsar esse membro (permissão/hierarquia).')] });
      await enviarDM(interaction.client, user.id, { embeds: [new EmbedBuilder().setColor(COR.aviso)
        .setTitle(`${E.proibido} Você foi expulso de ${interaction.guild.name}`).setDescription(`**Motivo:** ${cortar(motivo, 500)}`)] });
      try { await membro.kick(`${interaction.user.tag}: ${motivo}`); }
      catch (e) { return interaction.editReply({ embeds: [embedErro(`Falhou ao expulsar: ${e.message}`)] }); }
      const emb = embedAcao(`${E.proibido} Membro expulso`, COR.aviso, user, interaction.user, motivo);
      await logs.logar(interaction.guild, 'moderacao', emb);
      return interaction.editReply({ embeds: [emb] });
    },
  },
  // ── /timeout ──
  {
    data: new SlashCommandBuilder().setName('timeout').setDescription('Silencia um membro por um tempo (castigo)')
      .addUserOption(o => o.setName('usuario').setDescription('Quem será silenciado').setRequired(true))
      .addStringOption(o => o.setName('duracao').setDescription('Por quanto tempo').setRequired(true).addChoices(...DURACOES))
      .addStringOption(motivoOpt)
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      if (!(await base(interaction))) return;
      const user = interaction.options.getUser('usuario');
      const dur = interaction.options.getString('duracao');
      const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';
      await interaction.deferReply({ flags: 64 });
      const membro = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!membro) return interaction.editReply({ embeds: [embedErro('Esse usuário não está no servidor.')] });
      const erro = checarHierarquia(interaction, membro);
      if (erro) return interaction.editReply({ embeds: [embedErro(erro)] });
      if (!membro.moderatable) return interaction.editReply({ embeds: [embedErro('Não consigo aplicar castigo nesse membro (permissão/hierarquia).')] });
      try {
        if (dur === '0') await membro.timeout(null, `${interaction.user.tag}: ${motivo}`);
        else await membro.timeout(MS[dur], `${interaction.user.tag}: ${motivo}`);
      } catch (e) { return interaction.editReply({ embeds: [embedErro(`Falhou: ${e.message}`)] }); }
      const nomeDur = DURACOES.find(d => d.value === dur)?.name;
      const emb = dur === '0'
        ? embedAcao(`${E.positivo} Castigo removido`, COR.ok, user, interaction.user, motivo)
        : embedAcao(`${E.clock} Membro silenciado`, COR.aviso, user, interaction.user, motivo, { name: 'Duração', value: nomeDur, inline: true });
      await logs.logar(interaction.guild, 'moderacao', emb);
      return interaction.editReply({ embeds: [emb] });
    },
  },
  // ── /warn ──
  {
    data: new SlashCommandBuilder().setName('warn').setDescription('Dá um aviso a um membro (fica salvo no histórico)')
      .addUserOption(o => o.setName('usuario').setDescription('Quem receberá o aviso').setRequired(true))
      .addStringOption(o => o.setName('motivo').setDescription('Motivo do aviso').setRequired(true).setMaxLength(400))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      if (!(await base(interaction))) return;
      const user = interaction.options.getUser('usuario');
      const motivo = interaction.options.getString('motivo');
      if (user.bot) return interaction.reply({ embeds: [embedErro('Não dá pra avisar um bot.')], flags: 64 });
      const membro = await interaction.guild.members.fetch(user.id).catch(() => null);
      const erro = checarHierarquia(interaction, membro);
      if (erro) return interaction.reply({ embeds: [embedErro(erro)], flags: 64 });
      const mod = getExtras(interaction.guildId, 'moderacao', { avisos: {} });
      const lista = mod.avisos[user.id] || [];
      lista.push({ id: Date.now().toString(36), motivo, por: interaction.user.id, em: new Date().toISOString() });
      mod.avisos[user.id] = lista;
      setExtras(interaction.guildId, 'moderacao', mod);
      await enviarDM(interaction.client, user.id, { embeds: [new EmbedBuilder().setColor(COR.aviso)
        .setTitle(`${E.sino} Você recebeu um aviso em ${interaction.guild.name}`)
        .setDescription(`**Motivo:** ${cortar(motivo, 500)}\n-# Total de avisos: ${lista.length}`)] });
      const emb = embedAcao(`${E.sino} Aviso aplicado`, COR.aviso, user, interaction.user, motivo, { name: 'Total de avisos', value: String(lista.length), inline: true });
      await logs.logar(interaction.guild, 'moderacao', emb);
      return interaction.reply({ embeds: [emb], flags: 64 });
    },
  },
  // ── /avisos ──
  {
    data: new SlashCommandBuilder().setName('avisos').setDescription('Mostra os avisos de um membro')
      .addUserOption(o => o.setName('usuario').setDescription('Quem consultar').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      if (!(await base(interaction))) return;
      const user = interaction.options.getUser('usuario');
      const lista = getExtras(interaction.guildId, 'moderacao', { avisos: {} }).avisos[user.id] || [];
      const emb = new EmbedBuilder().setColor(COR.aviso).setTitle(`${E.sino} Avisos de ${user.username}`);
      if (!lista.length) emb.setDescription('> Nenhum aviso registrado.').setColor(COR.ok);
      else emb.setDescription(lista.slice(-10).map((a, i) =>
        `**${lista.length > 10 ? lista.length - 10 + i + 1 : i + 1}.** ${cortar(a.motivo, 200)}\n-# por <@${a.por}> ${ts(a.em)}`).join('\n\n')
        + (lista.length > 10 ? `\n\n-# Mostrando os 10 mais recentes de ${lista.length}.` : ''));
      return interaction.reply({ embeds: [emb], flags: 64 });
    },
  },
  // ── /limparavisos ──
  {
    data: new SlashCommandBuilder().setName('limparavisos').setDescription('Apaga todos os avisos de um membro')
      .addUserOption(o => o.setName('usuario').setDescription('Quem terá os avisos apagados').setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    async execute(interaction) {
      if (!(await base(interaction))) return;
      const user = interaction.options.getUser('usuario');
      const mod = getExtras(interaction.guildId, 'moderacao', { avisos: {} });
      const qtd = (mod.avisos[user.id] || []).length;
      delete mod.avisos[user.id];
      setExtras(interaction.guildId, 'moderacao', mod);
      const emb = embedAcao(`${E.apagar} Avisos apagados`, COR.info, user, interaction.user, `${qtd} aviso(s) removido(s)`);
      await logs.logar(interaction.guild, 'moderacao', emb);
      return interaction.reply({ embeds: [emb], flags: 64 });
    },
  },
];

module.exports = cmds;
