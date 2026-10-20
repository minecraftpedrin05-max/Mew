'use strict';
// /atualizacoes — admin escolhe onde o Kael avisa sobre novidades (ou desliga).
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getCfg, setCfg, escolherCanal, montarMensagem } = require('../utils/anunciarAtualizacao');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('atualizacoes')
    .setDescription('Avisos de novidades do Kael neste servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(s => s.setName('canal').setDescription('Escolhe o canal dos avisos de atualização')
      .addChannelOption(o => o.setName('canal').setDescription('Canal de texto').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand(s => s.setName('desligar').setDescription('Não receber mais avisos de atualização'))
    .addSubcommand(s => s.setName('ligar').setDescription('Voltar a receber avisos de atualização'))
    .addSubcommand(s => s.setName('ultima').setDescription('Mostra a última atualização do Kael')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = getCfg(interaction.guildId);
    const eph = { flags: MessageFlags.Ephemeral };

    if (sub === 'canal') {
      const canal = interaction.options.getChannel('canal');
      setCfg(interaction.guildId, { ...cfg, canalId: canal.id, ativo: true });
      return interaction.reply({ content: `✅ Os avisos de atualização agora vão para ${canal}.`, ...eph });
    }
    if (sub === 'desligar') {
      setCfg(interaction.guildId, { ...cfg, ativo: false });
      return interaction.reply({ content: '🔕 Avisos de atualização desligados. Use `/atualizacoes ligar` para voltar.', ...eph });
    }
    if (sub === 'ligar') {
      setCfg(interaction.guildId, { ...cfg, ativo: true });
      const canal = await escolherCanal(interaction.guild);
      return interaction.reply({ content: `🔔 Avisos ligados.${canal ? ` Vão para ${canal}.` : ' Escolha um canal com `/atualizacoes canal`.'}`, ...eph });
    }
    // ultima
    const msg = montarMensagem();
    msg.flags |= MessageFlags.Ephemeral;
    return interaction.reply(msg);
  },
};
