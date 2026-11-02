/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Reembolso (opcional)
 *  /reembolso        (cliente) pede reembolso de uma compra recente
 *  /reembolsoconfig  (dono)    liga/desliga, define prazo e canal da equipe
 * ─────────────────────────────────────────────────────────────────
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { exigirPlano } = require('../extras-system/base');
const r = require('../extras-system/reembolsoManager');

module.exports = [
  {
    data: new SlashCommandBuilder().setName('reembolso').setDescription('Pede o reembolso de uma compra recente (se a loja aceitar)'),
    async execute(interaction) {
      if (!interaction.guild) return interaction.reply({ content: 'Use este comando dentro de um servidor.', flags: 64 });
      return r.abrirPedido(interaction);
    },
  },
  {
    data: new SlashCommandBuilder().setName('reembolsoconfig').setDescription('Liga/desliga os reembolsos, define prazo e canal da equipe')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
      if (!interaction.guild) return interaction.reply({ content: 'Use este comando dentro de um servidor.', flags: 64 });
      if (!(await exigirPlano(interaction, 'reembolso'))) return;
      return interaction.reply({ ...r.painelConfig(interaction.guildId), flags: 64 });
    },
  },
];
