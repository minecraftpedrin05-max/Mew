'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  reembolsoManager — pedido de reembolso OPCIONAL (o dono liga/desliga)
//
//  Fluxo: cliente usa /reembolso → escolhe a compra (dentro do prazo) → informa o
//  motivo → o pedido cai no canal da equipe com botões Aprovar / Recusar.
//  Ao aprovar o bot: marca a venda como reembolsada, remove os cargos da compra
//  (opcional), estorna cashback/comissão/nível e avisa o cliente por DM.
//
//  ⚠ O bot NÃO devolve o dinheiro: o dono faz o estorno no provedor PIX
//    (Mercado Pago, EFI, OpenPix, C6) — o aviso na mensagem lembra disso.
//
//  Dados: guild.extras.reembolsoCfg  e  guild.extras.reembolsos[id]
//  customIds: xreemb_*
// ═══════════════════════════════════════════════════════════════════════════
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const db = require('../database/db');
const { E, COR, getExtras, setExtras, dinheiro, precoParaFloat, ts, cortar, ehStaff, exigirPlano, embedErro, enviarDM } = require('./base');

const CFG_PADRAO = { ativo: false, prazoDias: 7, canalId: null, removerCargos: true };
const DIA = 86400000;
const getCfg = (g) => getExtras(g, 'reembolsoCfg', CFG_PADRAO);
const salvarCfg = (g, c) => setExtras(g, 'reembolsoCfg', c);
const getPedidos = (g) => getExtras(g, 'reembolsos');
const salvarPedidos = (g, p) => setExtras(g, 'reembolsos', p);

// ── Painel do dono (/reembolsoconfig) ──────────────────────────────────────
function painelConfig(guildId) {
  const c = getCfg(guildId);
  const pend = Object.values(getPedidos(guildId)).filter(p => p.status === 'pendente').length;
  const emb = new EmbedBuilder().setColor(c.ativo ? COR.ok : COR.neutro).setTitle(`${E.card} Reembolsos`)
    .setDescription(
      `**Status:** ${c.ativo ? `${E.online} Ligado — clientes podem pedir com \`/reembolso\`` : `${E.off} Desligado — o comando avisa que a loja não aceita pedidos por aqui`}\n` +
      `**Prazo:** ${c.prazoDias} dia(s) após a compra\n` +
      `**Canal da equipe:** ${c.canalId ? `<#${c.canalId}>` : '`Não configurado` (obrigatório para ligar)'}\n` +
      `**Remover cargos da compra ao aprovar:** ${c.removerCargos ? 'Sim' : 'Não'}\n` +
      `**Pedidos pendentes:** ${pend}\n\n` +
      '-# O bot não devolve o dinheiro: ao aprovar, faça o estorno no seu provedor PIX. O bot remove cargos, desfaz cashback/comissão e avisa o cliente.');
  const sel = new ChannelSelectMenuBuilder().setCustomId('xreemb_canal').setPlaceholder('Canal onde a equipe recebe os pedidos')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const btns = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('xreemb_toggle').setLabel(c.ativo ? 'Desligar reembolsos' : 'Ligar reembolsos').setEmoji(E.raio).setStyle(c.ativo ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('xreemb_prazo').setLabel('Prazo').setEmoji(E.clock).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('xreemb_cargos').setLabel(c.removerCargos ? 'Cargos: remover' : 'Cargos: manter').setEmoji(E.coroa).setStyle(ButtonStyle.Secondary));
  return { embeds: [emb], components: [new ActionRowBuilder().addComponents(sel), btns] };
}

// ── Cliente: escolher compra ───────────────────────────────────────────────
function comprasElegiveis(guildId, userId) {
  const c = getCfg(guildId);
  const limite = Date.now() - c.prazoDias * DIA;
  const pedidos = getPedidos(guildId);
  const jaPedidas = new Set(Object.values(pedidos).filter(p => p.status !== 'recusado').map(p => p.registroId));
  const hist = db.getGuild(guildId).loja?.historicoCompras || [];
  return hist.filter(h => h.clienteId === userId && !h.reembolsado && new Date(h.dataISO).getTime() >= limite && !jaPedidas.has(h.id))
    .sort((a, b) => new Date(b.dataISO) - new Date(a.dataISO)).slice(0, 25);
}

async function abrirPedido(interaction) {
  if (!(await exigirPlano(interaction, 'reembolso'))) return;
  const gid = interaction.guildId; const c = getCfg(gid);
  if (!c.ativo || !c.canalId) {
    return interaction.reply({ embeds: [embedErro('Esta loja não aceita pedidos de reembolso por aqui. Abra um ticket de suporte para falar com a equipe.')], flags: 64 });
  }
  const lista = comprasElegiveis(gid, interaction.user.id);
  if (!lista.length) {
    return interaction.reply({ embeds: [embedErro(`Você não tem compras elegíveis. O prazo é de **${c.prazoDias} dia(s)** após a compra, e cada compra só pode ter um pedido.`)], flags: 64 });
  }
  const sel = new StringSelectMenuBuilder().setCustomId('xreemb_sel').setPlaceholder('Qual compra você quer reembolsar?')
    .addOptions(lista.map(h => ({
      label: cortar(`#${h.numeroPedido ?? '?'} • ${h.produtoNome}`, 100),
      description: cortar(`${h.valor} • ${new Date(h.dataISO).toLocaleDateString('pt-BR')}`, 100), value: h.id,
    })));
  return interaction.reply({ content: `${E.card} Escolha a compra:`, components: [new ActionRowBuilder().addComponents(sel)], flags: 64 });
}

function botoesDecisao(id, desabilitar) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`xreemb_ok_${id}`).setLabel('Aprovar').setEmoji(E.positivo).setStyle(ButtonStyle.Success).setDisabled(!!desabilitar),
    new ButtonBuilder().setCustomId(`xreemb_no_${id}`).setLabel('Recusar').setEmoji(E.negativo).setStyle(ButtonStyle.Danger).setDisabled(!!desabilitar));
}

function embedPedido(p, status) {
  const cor = status === 'aprovado' ? COR.ok : status === 'recusado' ? COR.erro : COR.aviso;
  const e = new EmbedBuilder().setColor(cor).setTitle(`${E.card} Pedido de reembolso #${p.id}`)
    .addFields(
      { name: 'Cliente', value: `<@${p.clienteId}>`, inline: true },
      { name: 'Compra', value: `#${p.numeroPedido ?? '?'} • ${cortar(p.produtoNome, 60)}`, inline: true },
      { name: 'Valor', value: p.valor, inline: true },
      { name: 'Comprado', value: ts(p.dataCompra), inline: true },
      { name: 'Motivo', value: cortar(p.motivo, 1000) });
  if (status !== 'pendente') e.addFields({ name: status === 'aprovado' ? 'Aprovado por' : 'Recusado por', value: `<@${p.decididoPor}>`, inline: true });
  else e.setFooter({ text: 'Ao aprovar, faça o estorno do PIX no seu provedor de pagamento.' });
  return e;
}

async function handleInteraction(interaction, client) {
  const id = interaction.customId; const gid = interaction.guildId;
  if (!interaction.guild) return;

  // ----- cliente -----
  if (id === 'xreemb_sel') {
    const reg = interaction.values[0];
    const m = new ModalBuilder().setCustomId(`xreemb_modal_${reg}`).setTitle('Pedido de reembolso')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Por que você quer o reembolso?')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(10).setMaxLength(800)));
    return interaction.showModal(m);
  }
  if (id.startsWith('xreemb_modal_')) {
    if (!(await exigirPlano(interaction, 'reembolso'))) return;
    const c = getCfg(gid);
    if (!c.ativo || !c.canalId) return interaction.reply({ embeds: [embedErro('Os reembolsos foram desativados.')], flags: 64 });
    const regId = id.replace('xreemb_modal_', '');
    const compra = comprasElegiveis(gid, interaction.user.id).find(h => h.id === regId);
    if (!compra) return interaction.reply({ embeds: [embedErro('Essa compra não é mais elegível (prazo, outro pedido ou já reembolsada).')], flags: 64 });
    const canal = interaction.guild.channels.cache.get(c.canalId) || await interaction.guild.channels.fetch(c.canalId).catch(() => null);
    if (!canal?.isTextBased()) return interaction.reply({ embeds: [embedErro('O canal da equipe não está acessível. Avise um administrador.')], flags: 64 });
    const pedidos = getPedidos(gid);
    const pid = Date.now().toString(36).toUpperCase();
    const p = { id: pid, registroId: regId, clienteId: interaction.user.id, numeroPedido: compra.numeroPedido ?? null, produtoNome: compra.produtoNome,
      valor: compra.valor, dataCompra: compra.dataISO, motivo: interaction.fields.getTextInputValue('motivo'), status: 'pendente', criadoEm: new Date().toISOString() };
    const msg = await canal.send({ embeds: [embedPedido(p, 'pendente')], components: [botoesDecisao(pid)], allowedMentions: { parse: [] } }).catch(() => null);
    if (!msg) return interaction.reply({ embeds: [embedErro('Não consegui avisar a equipe (sem permissão no canal). Avise um administrador.')], flags: 64 });
    p.canalId = canal.id; p.mensagemId = msg.id;
    pedidos[pid] = p; salvarPedidos(gid, pedidos);
    return interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setColor(COR.ok).setTitle(`${E.positivo} Pedido enviado`)
      .setDescription(`Sua solicitação **#${pid}** foi enviada para a equipe. Você receberá a resposta por DM.`)] });
  }

  // ----- decisão da equipe -----
  if (id.startsWith('xreemb_ok_') || id.startsWith('xreemb_no_')) {
    if (!(await exigirPlano(interaction, 'reembolso'))) return;
    if (!ehStaff(interaction)) return interaction.reply({ content: `${E.negativo} Só a equipe pode decidir.`, flags: 64 });
    const aprovar = id.startsWith('xreemb_ok_');
    const pid = id.replace(/^xreemb_(ok|no)_/, '');
    const pedidos = getPedidos(gid); const p = pedidos[pid];
    if (!p || p.status !== 'pendente') return interaction.reply({ content: 'Esse pedido já foi decidido.', flags: 64 });
    p.status = aprovar ? 'aprovado' : 'recusado'; p.decididoPor = interaction.user.id; p.decididoEm = new Date().toISOString();
    salvarPedidos(gid, pedidos);   // trava contra clique duplo antes de qualquer efeito colateral
    await interaction.update({ embeds: [embedPedido(p, p.status)], components: [botoesDecisao(pid, true)] });

    if (aprovar) await efeitosAprovacao(client, interaction.guild, p);
    await enviarDM(client, p.clienteId, { embeds: [new EmbedBuilder().setColor(aprovar ? COR.ok : COR.erro)
      .setTitle(aprovar ? `${E.positivo} Reembolso aprovado` : `${E.negativo} Reembolso recusado`)
      .setDescription(aprovar
        ? `Seu pedido **#${pid}** (${cortar(p.produtoNome, 60)}) em **${interaction.guild.name}** foi aprovado. A equipe fará o estorno do valor **${p.valor}** pelo mesmo meio de pagamento.`
        : `Seu pedido **#${pid}** (${cortar(p.produtoNome, 60)}) em **${interaction.guild.name}** foi recusado. Se tiver dúvidas, abra um ticket de suporte.`)] });
    return;
  }

  // ----- painel do dono -----
  if (id === 'xreemb_canal' || id === 'xreemb_toggle' || id === 'xreemb_prazo' || id === 'xreemb_cargos' || id === 'xreemb_prazo_modal') {
    if (!(await exigirPlano(interaction, 'reembolso'))) return;
    if (!ehStaff(interaction)) return interaction.reply({ content: `${E.negativo} Só quem gerencia o servidor pode mexer nisso.`, flags: 64 });
    const c = getCfg(gid);
    if (id === 'xreemb_canal') { c.canalId = interaction.values[0]; salvarCfg(gid, c); return interaction.update(painelConfig(gid)); }
    if (id === 'xreemb_toggle') {
      if (!c.ativo && !c.canalId) return interaction.reply({ embeds: [embedErro('Escolha primeiro o canal da equipe no menu do painel.')], flags: 64 });
      c.ativo = !c.ativo; salvarCfg(gid, c); return interaction.update(painelConfig(gid));
    }
    if (id === 'xreemb_cargos') { c.removerCargos = !c.removerCargos; salvarCfg(gid, c); return interaction.update(painelConfig(gid)); }
    if (id === 'xreemb_prazo') {
      const m = new ModalBuilder().setCustomId('xreemb_prazo_modal').setTitle('Prazo do reembolso')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dias').setLabel('Prazo em dias (1 a 90)')
          .setStyle(TextInputStyle.Short).setRequired(true).setValue(String(c.prazoDias)).setMaxLength(3)));
      return interaction.showModal(m);
    }
    if (id === 'xreemb_prazo_modal') {
      const d = parseInt(interaction.fields.getTextInputValue('dias'), 10);
      if (isNaN(d) || d < 1 || d > 90) return interaction.reply({ embeds: [embedErro('Use um prazo de 1 a 90 dias.')], flags: 64 });
      c.prazoDias = d; salvarCfg(gid, c); return interaction.update(painelConfig(gid));
    }
  }
}

async function efeitosAprovacao(client, guild, p) {
  const gid = guild.id;
  try {
    const dados = db.getGuild(gid);
    const hist = dados.loja?.historicoCompras || [];
    const h = hist.find(x => x.id === p.registroId);
    if (h) { h.reembolsado = true; h.reembolsadoEm = new Date().toISOString(); db.updateGuild(gid, 'loja.historicoCompras', hist); }

    if (getCfg(gid).removerCargos && h) {
      const produto = (db.getProdutos(gid) || []).find(x => x.titulo === h.produtoNome);
      const ids = new Set();
      if (produto?.cargoId) ids.add(produto.cargoId);
      for (const cid of produto?.cargosPosCompra?.adicionar || []) ids.add(cid);
      const variante = (produto?.variantes || []).find(v => v.nome === h.varianteNome);
      if (variante?.cargoId) ids.add(variante.cargoId);
      const membro = await guild.members.fetch(p.clienteId).catch(() => null);
      if (membro) for (const cid of ids) await membro.roles.remove(cid).catch(() => {});
    }
    await require('./fidelidadeManager').estornar(client, gid, p.registroId);
  } catch (e) { console.error('[Reembolso] efeitos da aprovação:', e.message); }
}

module.exports = { painelConfig, abrirPedido, handleInteraction, getCfg, comprasElegiveis, CFG_PADRAO };
