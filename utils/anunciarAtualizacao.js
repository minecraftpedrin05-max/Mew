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

// Se o deploy veio de um commit cuja mensagem começa com "update:" (ou "atualização:"),
// o texto do próprio commit vira o aviso. Ex.:
//   git commit -m "update: Corrigi o ticket
//   - Botão de fechar ticket funcionando
//   - Novo layout do /ranking"
// O Railway entrega a mensagem do commit em RAILWAY_GIT_COMMIT_MESSAGE.
function atualizacaoDoCommit() {
  const msg = process.env.RAILWAY_GIT_COMMIT_MESSAGE || '';
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || '';
  const m = msg.match(/^\s*(?:update|atualiza[cç][aã]o|atualizacao)\s*:\s*([\s\S]+)/i);
  if (!m || !sha) return null;
  const linhas = m[1].split('\n').map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return null;
  const resto = linhas.slice(1).map(l => l.replace(/^[-•*]\s*/, ''));
  return {
    id: sha.slice(0, 7),
    commit: true,
    data: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
    titulo: resto.length ? linhas[0] : 'Novidades',
    itens: resto.length ? resto : [linhas[0]],
  };
}
const ATUAL = atualizacaoDoCommit() || ULTIMA;

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

function montarMensagem(at = ATUAL) {
  const [ano, mes, dia] = at.data.split('-');
  const c = new ContainerBuilder().setAccentColor(0x000000)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# 🆕 Atualização do Kael — ${at.commit ? '#' : 'v'}${at.id}\n-# ${dia}/${mes}/${ano} • ${at.titulo}`))
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
      if (cfg.ultimaVersao === ATUAL.id) continue;       // já recebeu essa
      if (cfg.ativo === false) { setCfg(guild.id, { ...cfg, ultimaVersao: ATUAL.id }); continue; }
      const canal = await escolherCanal(guild);
      // marca ANTES de enviar: se falhar, não fica tentando (e repetindo) a cada reinício
      setCfg(guild.id, { ...cfg, ultimaVersao: ATUAL.id });
      if (!canal) { console.warn(`[Atualização] ${guild.name}: nenhum canal onde eu possa escrever.`); continue; }
      await canal.send(montarMensagem());
      enviados++;
      console.log(`[Atualização] v${ATUAL.id} enviada em "${guild.name}" (#${canal.name}).`);
    } catch (e) {
      console.error(`[Atualização] Falha em ${guild.id}:`, e.message);
    }
    await esperar(1500); // respeita o limite de requisições do Discord
  }
  console.log(`[Atualização] v${ATUAL.id}: aviso enviado em ${enviados} servidor(es).`);
  return enviados;
}

/** Servidor novo: marca como "em dia" pra não receber o aviso de algo que já nasceu com ele. */
function marcarServidorNovo(guild) {
  try { const cfg = getCfg(guild.id); if (!cfg.ultimaVersao) setCfg(guild.id, { ...cfg, ultimaVersao: ATUAL.id }); }
  catch (e) { console.error('[Atualização] marcarServidorNovo:', e.message); }
}

module.exports = { anunciarAtualizacoes, marcarServidorNovo, montarMensagem, getCfg, setCfg, escolherCanal };
