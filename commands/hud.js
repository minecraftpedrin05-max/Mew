const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const backupManager = require('../backup-system/backupManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hud')
    .setDescription('Kael HUD — salva e restaura cargos, categorias, canais e permissões do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if(!require("../utils/helpers").checkLicense(interaction.guild?.id)){ await interaction.reply({embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Sem Licença").setDescription("> Este servidor não possui uma licença ativa.")],ephemeral:true}); return; }
    const _lic = require("../database/db").getLicense(interaction.guild?.id);
    if(!require("../utils/helpers").temPlanoMinimo(interaction.guild?.id, "PREMIUM")) { await interaction.reply({ embeds:[new (require("discord.js").EmbedBuilder)().setColor(0xE50000).setTitle("<:negativo:1528400986744295475> Plano insuficiente").setDescription("> Adquira o plano Premium para usar este comando.")], ephemeral:true }); return; }
    await backupManager.showAdminPanel(interaction);
  }
};
