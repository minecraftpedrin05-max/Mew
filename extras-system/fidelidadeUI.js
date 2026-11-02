'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  fidelidadeUI — painéis e interações de /fidelidade (dono), /saldo e /afiliado (cliente)
//  customIds: xfid_*  e  xafil_*   (tratados em extras-system/index.js)
// ═══════════════════════════════════════════════════════════════════════════
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { E, emojiObj, COR, dinheiro, ehStaff, exigirPlano, embedErro, cortar, ts } = require('./base');
const fid = require('./fidelidadeManager');

const PAGINAS = [
  { id: 'geral',     label: 'Visão geral', emoji: E.target },
  { id: 'cashback',  label: 'Cashback',    emoji: E.money },
  { id: 'niveis',    label: 'Níveis',      emoji: E.coroa },
  { id: 'afiliados', label: 'Afiliados',   emoji: E.users },
  { id: 'cupons',    label: 'Cupons automáticos', emoji: E.cupom },
];
const st = (b) => (b ? `${E.online} Ligado` : `${E.off} Desligado`);
const num = (s) => parseFloat(String(s).replace(',', '.').replace(/[^\d.]/g, ''));

// ── Painel do dono ─────────────────────────────────────────────────────────
function painelAdmin(guildId, pagina = 'geral') {
  const cfg = fid.getCfg(guildId);
  const emb = new EmbedBuilder().setColor(COR.ouro);
  const linhas = [];
  const nav = new StringSelectMenuBuilder().setCustomId('xfid_nav').setPlaceholder('Escolha uma seção')
    .addOptions(PAGINAS.map(p => ({ label: p.label, value: p.id, emoji: emojiObj(p.emoji), default: p.id === pagina })));
  const rows = [new ActionRowBuilder().addComponents(nav)];
  const btn = (id, label, emoji, ligado) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji)
    .setStyle(ligado === undefined ? ButtonStyle.Secondary : (ligado ? ButtonStyle.Success : ButtonStyle.Secondary));

  if (pagina === 'cashback') {
    emb.setTitle(`${E.money} Cashback`).setDescription(
      `**Status:** ${st(cfg.cashback.ativo)}\n**Cashback por compra:** ${cfg.cashback.pct}% do valor pago\n**Resgate mínimo:** ${dinheiro(cfg.resgateMin)}\n\n` +
      '> O cliente acumula saldo a cada compra e troca por um **cupom de valor fixo** (uso único, 7 dias) com `/saldo`. ' +
      'Se não usar, o saldo volta sozinho.');
    rows.push(new ActionRowBuilder().addComponents(
      btn('xfid_t_cashback', cfg.cashback.ativo ? 'Desligar' : 'Ligar', E.raio, cfg.cashback.ativo),
      btn('xfid_m_cashback', 'Definir %', E.editar), btn('xfid_m_resgate', 'Resgate mínimo', E.money)));
  } else if (pagina === 'niveis') {
    const l = fid.listaNiveis(cfg);
    emb.setTitle(`${E.coroa} Níveis de cliente`).setDescription(
      `**Status:** ${st(cfg.niveis.ativo)}\n\n` +
      l.map(n => `${E.medal} **${n.nome}** — a partir de ${dinheiro(n.gasto)} gastos ${n.cargoId ? `• <@&${n.cargoId}>` : '• *sem cargo*'}`).join('\n') +
      '\n\n> O nível sobe sozinho conforme o total gasto. Se o nível tiver cargo, o bot dá o cargo e tira o anterior.');
    rows.push(new ActionRowBuilder().addComponents(
      btn('xfid_t_niveis', cfg.niveis.ativo ? 'Desligar' : 'Ligar', E.raio, cfg.niveis.ativo),
      btn('xfid_m_niveis', 'Editar níveis', E.editar), btn('xfid_cargos', 'Cargos dos níveis', E.coroa)));
  } else if (pagina === 'afiliados') {
    const d = fid.getDados(guildId);
    const total = Object.values(d.afiliados);
    emb.setTitle(`${E.users} Programa de afiliados`).setDescription(
      `**Status:** ${st(cfg.afiliados.ativo)}\n**Comissão pro afiliado:** ${cfg.afiliados.comissaoPct}% de cada venda\n` +
      `**Desconto pra quem usa o código:** ${cfg.afiliados.descontoPct}%\n**Afiliados:** ${total.length} • **Vendas indicadas:** ${total.reduce((a, x) => a + x.vendas, 0)}\n\n` +
      '> Cada cliente cria o próprio código com `/afiliado`. O código vira um cupom em todos os produtos; quando alguém compra com ele, o afiliado ganha comissão em saldo.');
    rows.push(new ActionRowBuilder().addComponents(
      btn('xfid_t_afiliados', cfg.afiliados.ativo ? 'Desligar' : 'Ligar', E.raio, cfg.afiliados.ativo),
      btn('xfid_m_afiliados', 'Comissão e desconto', E.editar)));
  } else if (pagina === 'cupons') {
    emb.setTitle(`${E.cupom} Cupons automáticos`).setDescription(
      `${E.present} **Boas-vindas:** ${st(cfg.bemVindo.ativo)} — ${cfg.bemVindo.pct}% OFF, vale ${cfg.bemVindo.dias} dia(s), enviado por DM a quem entra no servidor\n\n` +
      `${E.clock} **Volta pra loja:** ${st(cfg.volta.ativo)} — ${cfg.volta.pct}% OFF, vale ${cfg.volta.dias} dia(s), enviado a quem ficou ${cfg.volta.diasInativo}+ dias sem comprar\n\n` +
      '> Os cupons são únicos por cliente, somem depois de usados ou vencidos e não aparecem como "cupom sem uso" no /insights.');
    rows.push(new ActionRowBuilder().addComponents(
      btn('xfid_t_bemvindo', cfg.bemVindo.ativo ? 'Boas-vindas: desligar' : 'Boas-vindas: ligar', E.present, cfg.bemVindo.ativo),
      btn('xfid_m_bemvindo', 'Editar boas-vindas', E.editar),
      btn('xfid_t_volta', cfg.volta.ativo ? 'Volta: desligar' : 'Volta: ligar', E.clock, cfg.volta.ativo),
      btn('xfid_m_volta', 'Editar volta', E.editar)));
  } else {
    emb.setTitle(`${E.coroa} Fidelidade & Crescimento`).setDescription(
      `${E.money} **Cashback:** ${st(cfg.cashback.ativo)} (${cfg.cashback.pct}%)\n` +
      `${E.coroa} **Níveis de cliente:** ${st(cfg.niveis.ativo)}\n` +
      `${E.users} **Afiliados:** ${st(cfg.afiliados.ativo)} (${cfg.afiliados.comissaoPct}% comissão)\n` +
      `${E.present} **Cupom de boas-vindas:** ${st(cfg.bemVindo.ativo)}\n` +
      `${E.clock} **Cupom "volta":** ${st(cfg.volta.ativo)}\n\n` +
      '-# Cada recurso liga e desliga separado. Use o menu abaixo para configurar. Clientes usam `/saldo` e `/afiliado`.');
  }
  return { embeds: [emb], components: rows };
}

function modal(id, titulo, campos) {
  const m = new ModalBuilder().setCustomId(id).setTitle(titulo);
  for (const c of campos) {
    m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId(c.id).setLabel(c.label).setStyle(c.longo ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(true).setValue(String(c.valor ?? '')).setMaxLength(c.longo ? 600 : 20)));
  }
  return m;
}

const erroNum = (i, txt) => i.reply({ embeds: [embedErro(txt)], flags: 64 });

async function handleAdmin(interaction) {
  const id = interaction.customId;
  const gid = interaction.guildId;
  if (!(await exigirPlano(interaction, 'fidelidade'))) return;
  if (!ehStaff(interaction)) return interaction.reply({ content: `${E.negativo} Só quem gerencia o servidor pode usar isso.`, flags: 64 });
  const cfg = fid.getCfg(gid);

  // navegação
  if (id === 'xfid_nav') return interaction.update(painelAdmin(gid, interaction.values[0]));

  // liga/desliga
  const tog = { xfid_t_cashback: ['cashback', 'cashback'], xfid_t_niveis: ['niveis', 'niveis'], xfid_t_afiliados: ['afiliados', 'afiliados'],
    xfid_t_bemvindo: ['bemVindo', 'cupons'], xfid_t_volta: ['volta', 'cupons'] };
  if (tog[id]) {
    const [k, pag] = tog[id];
    cfg[k].ativo = !cfg[k].ativo;
    fid.salvarCfg(gid, cfg);
    if (k === 'afiliados') fid.sincronizarAfiliados(gid);
    return interaction.update(painelAdmin(gid, pag));
  }

  // abrir modais
  if (id === 'xfid_m_cashback') return interaction.showModal(modal('xfid_s_cashback', 'Cashback', [{ id: 'pct', label: 'Cashback em % (0 a 50)', valor: cfg.cashback.pct }]));
  if (id === 'xfid_m_resgate') return interaction.showModal(modal('xfid_s_resgate', 'Resgate mínimo', [{ id: 'v', label: 'Valor mínimo em R$', valor: cfg.resgateMin }]));
  if (id === 'xfid_m_afiliados') return interaction.showModal(modal('xfid_s_afiliados', 'Afiliados', [
    { id: 'com', label: 'Comissão do afiliado em % (0 a 50)', valor: cfg.afiliados.comissaoPct },
    { id: 'desc', label: 'Desconto pro comprador em % (0 a 50)', valor: cfg.afiliados.descontoPct }]));
  if (id === 'xfid_m_bemvindo') return interaction.showModal(modal('xfid_s_bemvindo', 'Cupom de boas-vindas', [
    { id: 'pct', label: 'Desconto em % (1 a 90)', valor: cfg.bemVindo.pct }, { id: 'dias', label: 'Validade em dias (1 a 60)', valor: cfg.bemVindo.dias }]));
  if (id === 'xfid_m_volta') return interaction.showModal(modal('xfid_s_volta', 'Cupom "volta"', [
    { id: 'pct', label: 'Desconto em % (1 a 90)', valor: cfg.volta.pct }, { id: 'dias', label: 'Validade em dias (1 a 60)', valor: cfg.volta.dias },
    { id: 'inativo', label: 'Dias sem comprar para enviar (7 a 365)', valor: cfg.volta.diasInativo }]));
  if (id === 'xfid_m_niveis') return interaction.showModal(modal('xfid_s_niveis', 'Editar níveis', [
    { id: 'lista', longo: true, label: 'Um por linha: Nome=gasto mínimo (R$)',
      valor: fid.listaNiveis(cfg).map(n => `${n.nome}=${n.gasto}`).join('\n') }]));

  // salvar modais
  if (id === 'xfid_s_cashback') {
    const v = num(interaction.fields.getTextInputValue('pct'));
    if (isNaN(v) || v < 0 || v > 50) return erroNum(interaction, 'Use um valor entre 0 e 50.');
    cfg.cashback.pct = v; fid.salvarCfg(gid, cfg); return interaction.update(painelAdmin(gid, 'cashback'));
  }
  if (id === 'xfid_s_resgate') {
    const v = num(interaction.fields.getTextInputValue('v'));
    if (isNaN(v) || v < 1 || v > 10000) return erroNum(interaction, 'Use um valor entre 1 e 10000.');
    cfg.resgateMin = v; fid.salvarCfg(gid, cfg); return interaction.update(painelAdmin(gid, 'cashback'));
  }
  if (id === 'xfid_s_afiliados') {
    const c = num(interaction.fields.getTextInputValue('com')), d = num(interaction.fields.getTextInputValue('desc'));
    if ([c, d].some(x => isNaN(x) || x < 0 || x > 50)) return erroNum(interaction, 'Use valores entre 0 e 50.');
    cfg.afiliados.comissaoPct = c; cfg.afiliados.descontoPct = d; fid.salvarCfg(gid, cfg);
    fid.sincronizarAfiliados(gid);
    return interaction.update(painelAdmin(gid, 'afiliados'));
  }
  if (id === 'xfid_s_bemvindo' || id === 'xfid_s_volta') {
    const p = num(interaction.fields.getTextInputValue('pct')), dias = parseInt(interaction.fields.getTextInputValue('dias'), 10);
    if (isNaN(p) || p < 1 || p > 90 || isNaN(dias) || dias < 1 || dias > 60) return erroNum(interaction, 'Desconto de 1 a 90% e validade de 1 a 60 dias.');
    if (id === 'xfid_s_bemvindo') { cfg.bemVindo.pct = p; cfg.bemVindo.dias = dias; }
    else {
      const ina = parseInt(interaction.fields.getTextInputValue('inativo'), 10);
      if (isNaN(ina) || ina < 7 || ina > 365) return erroNum(interaction, 'Dias sem comprar: de 7 a 365.');
      cfg.volta.pct = p; cfg.volta.dias = dias; cfg.volta.diasInativo = ina;
    }
    fid.salvarCfg(gid, cfg); return interaction.update(painelAdmin(gid, 'cupons'));
  }
  if (id === 'xfid_s_niveis') {
    const antigos = cfg.niveis.lista;
    const nova = [];
    for (const linha of interaction.fields.getTextInputValue('lista').split('\n')) {
      const t = linha.trim(); if (!t) continue;
      const [nome, valor] = t.split('=');
      const g = num(valor);
      if (!nome?.trim() || isNaN(g) || g < 0) return erroNum(interaction, `Linha inválida: \`${cortar(t, 40)}\`. Use \`Nome=100\`.`);
      const velho = antigos.find(n => n.nome.toLowerCase() === nome.trim().toLowerCase());
      nova.push({ nome: cortar(nome.trim(), 30), gasto: g, cargoId: velho?.cargoId || null });
    }
    if (!nova.length || nova.length > 10) return erroNum(interaction, 'Informe de 1 a 10 níveis.');
    cfg.niveis.lista = nova; fid.salvarCfg(gid, cfg); return interaction.update(painelAdmin(gid, 'niveis'));
  }

  // cargos dos níveis: escolhe o nível → escolhe o cargo
  if (id === 'xfid_cargos') {
    const sel = new StringSelectMenuBuilder().setCustomId('xfid_cargo_nivel').setPlaceholder('Escolha o nível')
      .addOptions(fid.listaNiveis(cfg).map((n, i) => ({ label: n.nome, value: String(i), description: n.cargoId ? 'Já tem cargo' : 'Sem cargo' })));
    return interaction.reply({ content: `${E.coroa} Para qual nível você quer definir o cargo?`, components: [new ActionRowBuilder().addComponents(sel)], flags: 64 });
  }
  if (id === 'xfid_cargo_nivel') {
    const idx = interaction.values[0];
    const rs = new RoleSelectMenuBuilder().setCustomId(`xfid_cargo_set_${idx}`).setPlaceholder('Escolha o cargo deste nível').setMinValues(0).setMaxValues(1);
    return interaction.update({ content: `${E.coroa} Escolha o cargo (deixe vazio para remover):`, components: [new ActionRowBuilder().addComponents(rs)] });
  }
  if (id.startsWith('xfid_cargo_set_')) {
    const lista = fid.listaNiveis(cfg);
    const alvo = lista[parseInt(id.replace('xfid_cargo_set_', ''), 10)];
    if (!alvo) return;
    const real = cfg.niveis.lista.find(n => n.nome === alvo.nome);
    real.cargoId = interaction.values[0] || null;
    fid.salvarCfg(gid, cfg);
    return interaction.update({ content: `${E.positivo} Cargo do nível **${alvo.nome}** ${real.cargoId ? `definido: <@&${real.cargoId}>` : 'removido'}.`, components: [] });
  }
}

// ── Cliente: /saldo ────────────────────────────────────────────────────────
function barra(p, t = 12) { const c = Math.round(Math.max(0, Math.min(1, p)) * t); return '█'.repeat(c) + '░'.repeat(t - c); }

function painelSaldo(guildId, userId) {
  const cfg = fid.getCfg(guildId);
  const d = fid.getDados(guildId);
  const cli = d.clientes[userId] || { saldo: 0, gasto: 0, compras: 0, nivel: null };
  const emb = new EmbedBuilder().setColor(COR.ouro).setTitle(`${E.money} Seu saldo e fidelidade`)
    .addFields(
      { name: `${E.money} Saldo`, value: `**${dinheiro(cli.saldo)}**`, inline: true },
      { name: `${E.carrinho} Compras`, value: `${cli.compras}`, inline: true },
      { name: `${E.rendimentos} Total gasto`, value: dinheiro(cli.gasto), inline: true });
  if (cfg.niveis.ativo) {
    const atual = fid.nivelPara(cfg, cli.gasto), prox = fid.proximoNivel(cfg, cli.gasto);
    let txt = atual && cli.compras > 0 ? `${E.coroa} **${atual.nivel || atual.nome}**` : '*Faça sua primeira compra para entrar no ranking de níveis.*';
    if (prox && cli.compras > 0) {
      const base = atual ? atual.gasto : 0;
      txt += `\n\`${barra((cli.gasto - base) / (prox.gasto - base))}\` faltam **${dinheiro(prox.gasto - cli.gasto)}** para **${prox.nome}**`;
    } else if (cli.compras > 0) txt += '\n-# Você está no nível máximo!';
    emb.addFields({ name: 'Nível', value: txt });
  }
  if (cfg.cashback.ativo) emb.setFooter({ text: `Cashback atual: ${cfg.cashback.pct}% • Resgate mínimo ${dinheiro(cfg.resgateMin)}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('xfid_resgatar').setLabel('Resgatar saldo').setEmoji(E.cupom).setStyle(ButtonStyle.Success).setDisabled(cli.saldo < cfg.resgateMin));
  return { embeds: [emb], components: [row] };
}

async function handleCliente(interaction) {
  const id = interaction.customId; const gid = interaction.guildId;
  if (!(await exigirPlano(interaction, 'fidelidade'))) return;
  const cfg = fid.getCfg(gid);

  if (id === 'xfid_resgatar') {
    const cli = fid.getDados(gid).clientes[interaction.user.id];
    if (!cli || cli.saldo < cfg.resgateMin) return interaction.reply({ embeds: [embedErro(`Você precisa de pelo menos ${dinheiro(cfg.resgateMin)} de saldo.`)], flags: 64 });
    const prods = fid.produtosAtivos(gid).slice(0, 25);
    if (!prods.length) return interaction.reply({ embeds: [embedErro('Nenhum produto disponível agora.')], flags: 64 });
    const sel = new StringSelectMenuBuilder().setCustomId('xfid_res_prod').setPlaceholder('Em qual produto você quer usar o saldo?')
      .addOptions(prods.map(p => ({ label: cortar(p.titulo || 'Produto', 100), value: p.id })));
    return interaction.reply({ content: `${E.cupom} Seu saldo: **${dinheiro(cli.saldo)}**. Escolha o produto:`, components: [new ActionRowBuilder().addComponents(sel)], flags: 64 });
  }
  if (id === 'xfid_res_prod') {
    const cli = fid.getDados(gid).clientes[interaction.user.id];
    const m = new ModalBuilder().setCustomId(`xfid_res_modal_${interaction.values[0]}`).setTitle('Resgatar saldo')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('valor').setLabel('Quanto resgatar (R$)')
        .setStyle(TextInputStyle.Short).setRequired(true).setValue(String(Math.floor((cli?.saldo || 0) * 100) / 100))));
    return interaction.showModal(m);
  }
  if (id.startsWith('xfid_res_modal_')) {
    const v = num(interaction.fields.getTextInputValue('valor'));
    const r = fid.resgatar(gid, interaction.user.id, id.replace('xfid_res_modal_', ''), v);
    if (!r.ok) return interaction.reply({ embeds: [embedErro(r.motivo)], flags: 64 });
    return interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setColor(COR.ok).setTitle(`${E.cupom} Cupom gerado!`)
      .setDescription(`${E.copy} **\`${r.codigo}\`**\n> Desconto de **${dinheiro(r.valor)}** em **${cortar(r.produto, 80)}**.\n> Compra mínima: ${dinheiro(r.valor)} • Expira ${ts(r.expiraEm)}.\n` +
        '> Na hora de pagar, clique em **Aplicar Cupom** e cole o código. Se não usar, o saldo volta sozinho.')] });
  }
}

// ── Cliente: /afiliado ─────────────────────────────────────────────────────
function painelAfiliado(guildId, userId) {
  const cfg = fid.getCfg(guildId);
  const d = fid.getDados(guildId);
  const af = d.afiliados[userId];
  const emb = new EmbedBuilder().setColor(COR.info).setTitle(`${E.users} Programa de afiliados`);
  if (!cfg.afiliados.ativo || !fid.ativoAfil(guildId)) {
    return { embeds: [emb.setDescription('> O programa de afiliados não está ativo neste servidor.')], components: [] };
  }
  emb.setDescription(
    `Indique a loja e ganhe **${cfg.afiliados.comissaoPct}%** de cada venda feita com o seu código. ` +
    `Quem usar o código ganha **${cfg.afiliados.descontoPct}%** de desconto.\n\n` +
    (af ? `${E.cupom} **Seu código:** \`${af.codigo}\`\n${E.carrinho} **Vendas indicadas:** ${af.vendas}\n${E.money} **Total ganho:** ${dinheiro(af.ganhos)}\n${E.money} **Saldo atual:** ${dinheiro(d.clientes[userId]?.saldo || 0)}`
         : '> Você ainda não tem um código. Crie o seu abaixo!'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('xafil_codigo').setLabel(af ? 'Trocar código' : 'Criar meu código').setEmoji(E.editar).setStyle(ButtonStyle.Primary));
  return { embeds: [emb], components: [row] };
}

async function handleAfiliado(interaction) {
  const id = interaction.customId; const gid = interaction.guildId;
  if (!(await exigirPlano(interaction, 'afiliados'))) return;
  if (!fid.getCfg(gid).afiliados.ativo) return interaction.reply({ embeds: [embedErro('O programa de afiliados está desligado.')], flags: 64 });
  if (id === 'xafil_codigo') {
    const m = new ModalBuilder().setCustomId('xafil_modal').setTitle('Seu código de afiliado')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('codigo')
        .setLabel('Código (4 a 16 letras/números) — vazio = automático').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(16)));
    return interaction.showModal(m);
  }
  if (id === 'xafil_modal') {
    const r = fid.definirCodigoAfiliado(gid, interaction.user.id, interaction.fields.getTextInputValue('codigo'));
    if (!r.ok) return interaction.reply({ embeds: [embedErro(r.motivo)], flags: 64 });
    return interaction.reply({ ...painelAfiliado(gid, interaction.user.id), flags: 64 });
  }
}

module.exports = { painelAdmin, painelSaldo, painelAfiliado, handleAdmin, handleCliente, handleAfiliado };
