/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — /dono   (SÓ o dono do bot)
 *  Painel com: ocultar comandos, bloquear botões, criar comando por
 *  arquivo, modo manutenção, servidores e estatísticas.
 * ─────────────────────────────────────────────────────────────────
 */
const { SlashCommandBuilder } = require('discord.js');
const { BOT_OWNER_ID } = require('../config/constants');
const { E } = require('../extras-system/base');
const ui = require('../dono-system/donoUI');

module.exports = {
  somenteDono: true,   // o index.js registra com permissão de Administrador (some pra maioria) e confere o dono aqui
  data: new SlashCommandBuilder().setName('dono').setDescription('Painel do dono do bot'),

  async execute(interaction, client) {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({ content: `${E.negativo} Este comando é só para o dono do bot.`, flags: 64 });
    }
    return interaction.reply({ ...ui.telaHome(client || interaction.client), flags: 64 });
  },
};
