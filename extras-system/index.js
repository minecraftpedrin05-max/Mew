'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  extras-system/index.js — liga os sistemas novos ao bot
//    iniciar(client)                → registra eventos (logs, boas-vindas) e agendadores
//    handleInteraction(inter, cli)  → roteia botões/menus/modais xlogs_ / xfid_ / xafil_ / xreemb_
//                                     devolve true quando a interação era nossa
// ═══════════════════════════════════════════════════════════════════════════
const logs = require('./logsManager');
const fid = require('./fidelidadeManager');
const ui = require('./fidelidadeUI');
const reembolso = require('./reembolsoManager');

function iniciar(client) {
  logs.registrar(client);
  fid.iniciar(client);
  require('../ticket-system/ticketIA').registrar(client);   // IA que atende nos tickets
  console.log('[Extras] Logs, fidelidade, afiliados, cupons automáticos e reembolso carregados.');
}

async function handleInteraction(interaction, client) {
  const id = interaction.customId;
  if (typeof id !== 'string') return false;
  if (!id.startsWith('x')) return false;
  const guildOnly = async () => {
    if (interaction.guild) return true;
    await interaction.reply({ content: 'Use isso dentro de um servidor.', flags: 64 }).catch(() => {});
    return false;
  };
  try {
    if (id.startsWith('xlogs_'))  { if (await guildOnly()) await logs.handleInteraction(interaction); return true; }
    if (id.startsWith('xreemb_')) { if (await guildOnly()) await reembolso.handleInteraction(interaction, client); return true; }
    if (id.startsWith('xafil_'))  { if (await guildOnly()) await ui.handleAfiliado(interaction); return true; }
    if (id.startsWith('xfid_')) {
      if (!(await guildOnly())) return true;
      const cliente = id === 'xfid_resgatar' || id === 'xfid_res_prod' || id.startsWith('xfid_res_modal_');
      if (cliente) await ui.handleCliente(interaction); else await ui.handleAdmin(interaction);
      return true;
    }
  } catch (e) {
    console.error('[Extras] Erro numa interação:', id, e.stack || e.message);
    try {
      const p = { content: '❌ Ocorreu um erro ao processar essa ação. Tente novamente.', flags: 64 };
      if (interaction.deferred || interaction.replied) await interaction.followUp(p); else await interaction.reply(p);
    } catch {}
    return true;
  }
  return false;
}

module.exports = { iniciar, handleInteraction };
