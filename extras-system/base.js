'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  extras-system/base.js — utilidades compartilhadas dos sistemas novos
//  (moderação, logs, fidelidade, afiliados, cupons automáticos, reembolso)
//
//  Tudo que é salvo fica em  guild.extras.<chave>  (blob JSON da guild),
//  então não precisa de migração nem mexe nas tabelas existentes.
// ═══════════════════════════════════════════════════════════════════════════
const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const { BOT_OWNER_ID } = require('../config/constants');

// Emojis personalizados do aplicativo (mesmos IDs usados no resto do bot).
// O emojiResolver conserta automaticamente se algum ID ficar inválido.
const E = {
  coroa:     '<:coroa:1520751629350080582>',
  medal:     '<:medal:1534356044367790161>',
  trofeu:    '<a:trofeu:1532499321008951538>',
  money:     '<:money:1532503308961448096>',
  cupom:     '<:cupom:1524209015008002148>',
  present:   '<:present:1538356348989743166>',
  sino:      '<:sino:1528840971096297482>',
  safety:    '<:safety:1528841000548569239>',
  users:     '<:users:1528840901739151430>',
  user:      '<:user:1532137085081878558>',
  target:    '<:target:1532137085081878558>',
  raio:      '<:raio:1533080818258411662>',
  save:      '<:save:1533080403810713773>',
  positivo:  '<:positivo:1528401238197276702>',
  negativo:  '<:negativo:1528400986744295475>',
  clock:     '<:clock:1524207889441357917>',
  caixa:     '<:caixa:1524207165496099007>',
  carrinho:  '<:carrinho:1524207445600370719>',
  config:    '<:config3:1524208114327617588>',
  tools:     '<:tools1:1533222180408791080>',
  editar:    '<:editar:1528400388137549864>',
  apagar:    '<:apagar:1524206738885050388>',
  mais:      '<:mais2:1528400709018583100>',
  link:      '<:link:1533251823778005082>',
  text:      '<:text:1533089802856038461>',
  termos:    '<:termos:1533454585169973288>',
  pix:       '<:pix:1528401197642551436>',
  rendimentos:'<:rendimentos:1528401542070145135>',
  entregue:  '<:pedidoEntregue:1528401023054385202>',
  solicitado:'<:pedidoSolicitado:1528401082777342044>',
  canal:     '<:canal:1524207214791884890>',
  folder:    '<:folder:1533259504936816641>',
  block:     '<:block:1533259816871657522>',
  lock:      '<:CadLock:1533221942256078968>',
  proibido:  '<:npertubar:1533081528966316083>',
  online:    '<:online:1533081467918221565>',
  off:       '<:naoconfigurado:1513207873243578438>',
  voltar:    '<:voltar:1528548726518448198>',
  visivel:   '<:visible:1528840851654971443>',
  bot:       '<:bot:1524207085850591273>',
  dev:       '<:dev:1525538335139958915>',
  embed:     '<:embed:1528400492982571111>',
  sorteio:   '<:sorteio:1533089699844067418>',
  card:      '<:card:1533880211882381422>',
  copy:      '<:copypast:1533880329536802896>',
  ia:        '<:ia:1533235376464986313>',
};

/** '<:nome:id>' → { name, id, animated } (formato exigido pelas opções de menu de seleção). */
function emojiObj(str) {
  const m = /^<(a?):([A-Za-z0-9_]+):(\d+)>$/.exec(str || '');
  return m ? { name: m[2], id: m[3], animated: !!m[1] } : { name: str };
}

// Cores (mesmo padrão do resto do bot)
const COR = { ok: 0x57f287, erro: 0xed4245, aviso: 0xfee75c, info: 0x5865f2, ouro: 0xffd700, neutro: 0x2b2d31 };

// ── Plano mínimo exigido por recurso (mude aqui se quiser outro plano) ─────
// Ordem: FREE < BASICO < PRO < PREMIUM < PERMANENTE
const PLANO_MINIMO = {
  ajuda: 'FREE',
  moderacao: 'BASICO',
  logs: 'BASICO',
  reembolso: 'BASICO',
  fidelidade: 'PRO',   // cashback, níveis, cupons automáticos
  afiliados: 'PRO',
};

function temPlano(guildId, recurso) {
  const min = PLANO_MINIMO[recurso] || 'FREE';
  if (min === 'FREE') return true;
  try { return require('../utils/helpers').temPlanoMinimo(guildId, min); } catch { return false; }
}

/** Responde "plano insuficiente" e devolve false quando o servidor não tem o plano do recurso. */
async function exigirPlano(interaction, recurso) {
  if (temPlano(interaction.guildId, recurso)) return true;
  const min = PLANO_MINIMO[recurso];
  const payload = {
    embeds: [new EmbedBuilder().setColor(COR.erro).setTitle(`${E.negativo} Plano insuficiente`)
      .setDescription(`> Este recurso exige o plano **${min}** ou superior neste servidor.`)],
    flags: 64,
  };
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
  else await interaction.reply(payload).catch(() => {});
  return false;
}

// ── Armazenamento ──────────────────────────────────────────────────────────
function getExtras(guildId, chave, padrao) {
  const atual = db.getGuild(guildId).extras?.[chave];
  if (padrao === undefined) return atual || {};
  return { ...JSON.parse(JSON.stringify(padrao)), ...(atual || {}) };
}
function setExtras(guildId, chave, valor) {
  db.updateGuild(guildId, `extras.${chave}`, valor);
}

// ── Formatação ─────────────────────────────────────────────────────────────
const dinheiro = (n) => `R$ ${(Number(n) || 0).toFixed(2).replace('.', ',')}`;
const precoParaFloat = (s) => parseFloat(String(s).replace(/[^\d,\.]/g, '').replace(',', '.')) || 0;
const ts = (iso) => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>`;
const cortar = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const codigoAleatorio = (n = 6) => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = ''; for (let i = 0; i < n; i++) r += a[Math.floor(Math.random() * a.length)];
  return r;
};

function ehStaff(interaction) {
  return interaction.user.id === BOT_OWNER_ID ||
    interaction.memberPermissions?.has('ManageGuild') ||
    interaction.memberPermissions?.has('Administrator');
}

function embedErro(texto) {
  return new EmbedBuilder().setColor(COR.erro).setTitle(`${E.negativo} Não foi possível`).setDescription(`> ${texto}`);
}
function embedOk(titulo, texto) {
  const e = new EmbedBuilder().setColor(COR.ok).setTitle(`${E.positivo} ${titulo}`);
  if (texto) e.setDescription(texto);
  return e;
}

async function enviarDM(client, userId, payload) {
  try { const u = await client.users.fetch(userId); await u.send(payload); return true; } catch { return false; }
}

module.exports = {
  E, emojiObj, COR, PLANO_MINIMO, temPlano, exigirPlano,
  getExtras, setExtras, dinheiro, precoParaFloat, ts, cortar, codigoAleatorio,
  ehStaff, embedErro, embedOk, enviarDM,
};
