/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — /logs
 *  Painel dos logs do servidor: escolha o canal e ligue/desligue
 *  cada categoria (mensagens, membros, cargos, canais, moderação).
 * ─────────────────────────────────────────────────────────────────
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { exigirPlano } = require('../extras-system/base');
const logs = require('../extras-system/logsManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Configura os logs do servidor (mensagens, membros, cargos, canais e moderação)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: 'Use este comando dentro de um servidor.', flags: 64 });
    if (!(await exigirPlano(interaction, 'logs'))) return;
    return interaction.reply({ ...logs.montarPainel(interaction.guildId), flags: 64 });
  },
};
