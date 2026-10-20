'use strict';
// Anuncia a atualização mais recente (config/atualizacoes.js) em TODOS os servidores.
// - Só envia quando o `id` da atualização é diferente do último que o servidor já recebeu.
// - Canal: o escolhido em /atualizacoes canal → canal de avisos do sistema → 1º canal de texto onde o bot escreve.
// - Servidores que desligaram (/atualizacoes desligar) não recebem.
const {
  ChannelType, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
} = require('discord.js');
const db = require('../database/db');
const { bannerFile, BANNER_ATTACH_URL } = require('./branding');
const { ULTIMA } = require('../config/atualizacoes');

const PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];
const esperar = (ms) => new Promise(r => setTimeout(r, ms));

function getCfg(guildId) { return db.getGuild(guildId).atualizacoes || {}; }
function setCfg(guildId, cfg) { db.updateGuild(guildId, 'atualizacoes', cfg); }

function podeEscrever(guild, ch) {
  return ch && ch.isTextBased?.() && ch.type !== ChannelType.GuildVoice &&
    ch.permissionsFor(guild.members.me)?.has(PERMS);
}

async function escolherCanal(guild) {
  const cfg = getCfg(guild.id);
  if (cfg.canalId) {
    const ch = guild.channels.cache.get(cfg.canalId) || await guild.channels.fetch(cfg.canalId).catch(() => null);
    if (podeEscrever(guild, ch)) return ch;
  }
  if (podeEscrever(guild, guild.systemChannel)) return guild.systemChannel;
  return guild.channels.cache
    .filter(c => c.type === ChannelType.GuildText && podeEscrever(guild, c))
    .sort((a, b) => a.rawPosition - b.rawPosition).first() || null;
}

function montarMensagem(at = ULTIMA) {
  const [ano, mes, dia] = at.data.split('-');
  const c = new ContainerBuilder().setAccentColor(0x000000)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# 🆕 Atualização do Kael — v${at.id}\n-# ${dia}/${mes}/${ano} • ${at.titulo}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(BANNER_ATTACH_URL)))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '**O que mudou:**\n' + at.itens.map(i => `• ${i}`).join('\n')))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      '-# Admins podem escolher o canal ou desligar estes avisos com /atualizacoes'));
  return { components: [c], files: [bannerFile()], flags: MessageFlags.IsComponentsV2 };
}

/** Roda no boot. Retorna quantos servidores receberam o aviso. */
async function anunciarAtualizacoes(client) {
  let enviados = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = getCfg(guild.id);
      if (cfg.ultimaVersao === ULTIMA.id) continue;       // já recebeu essa
      if (cfg.ativo === false) { setCfg(guild.id, { ...cfg, ultimaVersao: ULTIMA.id }); continue; }
      const canal = await escolherCanal(guild);
      // marca ANTES de enviar: se falhar, não fica tentando (e repetindo) a cada reinício
      setCfg(guild.id, { ...cfg, ultimaVersao: ULTIMA.id });
      if (!canal) { console.warn(`[Atualização] ${guild.name}: nenhum canal onde eu possa escrever.`); continue; }
      await canal.send(montarMensagem());
      enviados++;
      console.log(`[Atualização] v${ULTIMA.id} enviada em "${guild.name}" (#${canal.name}).`);
    } catch (e) {
      console.error(`[Atualização] Falha em ${guild.id}:`, e.message);
    }
    await esperar(1500); // respeita o limite de requisições do Discord
  }
  console.log(`[Atualização] v${ULTIMA.id}: aviso enviado em ${enviados} servidor(es).`);
  return enviados;
}

/** Servidor novo: marca como "em dia" pra não receber o aviso de algo que já nasceu com ele. */
function marcarServidorNovo(guild) {
  try { const cfg = getCfg(guild.id); if (!cfg.ultimaVersao) setCfg(guild.id, { ...cfg, ultimaVersao: ULTIMA.id }); }
  catch (e) { console.error('[Atualização] marcarServidorNovo:', e.message); }
}

module.exports = { anunciarAtualizacoes, marcarServidorNovo, montarMensagem, getCfg, setCfg, escolherCanal };
