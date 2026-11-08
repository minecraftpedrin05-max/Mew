/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — Fidelidade & Crescimento
 *  /fidelidade  (dono)    painel: cashback, níveis, afiliados, cupons automáticos
 *  /saldo       (cliente) saldo, nível e resgate em cupom
 *  /afiliado    (cliente) código de indicação e ganhos
 * ─────────────────────────────────────────────────────────────────
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { exigirPlano } = require('../extras-system/base');
const ui = require('../extras-system/fidelidadeUI');

const soServidor = async (i) => {
  if (!i.guild) { await i.reply({ content: 'Use este comando dentro de um servidor.', flags: 64 }); return false; }
  return true;
};

module.exports = [
  {
    data: new SlashCommandBuilder().setName('fidelidade')
      .setDescription('Painel de cashback, níveis de cliente, afiliados e cupons automáticos')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    async execute(interaction) {
      if (!(await soServidor(interaction)) || !(await exigirPlano(interaction, 'fidelidade'))) return;
      return interaction.reply({ ...ui.painelAdmin(interaction.guildId, 'geral'), flags: 64 });
    },
  },
  {
    data: new SlashCommandBuilder().setName('saldo').setDescription('Veja seu saldo de cashback, seu nível e resgate em cupom'),
    async execute(interaction) {
      if (!(await soServidor(interaction)) || !(await exigirPlano(interaction, 'fidelidade'))) return;
      return interaction.reply({ ...ui.painelSaldo(interaction.guildId, interaction.user.id), flags: 64 });
    },
  },
  {
    data: new SlashCommandBuilder().setName('afiliado').setDescription('Seu código de afiliado: indique a loja e ganhe comissão'),
    async execute(interaction) {
      if (!(await soServidor(interaction)) || !(await exigirPlano(interaction, 'afiliados'))) return;
      return interaction.reply({ ...ui.painelAfiliado(interaction.guildId, interaction.user.id), flags: 64 });
    },
  },
];
