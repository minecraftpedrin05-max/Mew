'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  donoUI — telas e interações do /dono   (customIds: xdono_*, só o dono do bot)
// ═══════════════════════════════════════════════════════════════════════════
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { E, emojiObj, COR, cortar, ts } = require('../extras-system/base');
const dono = require('./donoManager');

const POR_PAGINA = 20;
const pendentes = new Map();   // token → { userId, nome, descricao, codigo, arquivo, expira }

const btn = (id, label, emoji, st = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(st);
const voltar = () => btn('xdono_home', 'Voltar', E.voltar);
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const comandosOrdenados = (client) => [...client.commands.keys()].filter(n => n !== 'dono').sort();

function fmtTempo(s) {
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return `${d ? d + 'd ' : ''}${h}h ${m}min`;
}

// ── Telas ──────────────────────────────────────────────────────────────────
function telaHome(client) {
  const e = dono.estado();
  const gruposBloq = dono.GRUPOS.filter(dono.grupoBloqueado).length;
  const soltos = e.bloqueios.length - dono.GRUPOS.filter(dono.grupoBloqueado).reduce((a, g) => a + g.prefixos.length, 0);
  const emb = new EmbedBuilder().setColor(e.manutencao.ativa ? COR.aviso : COR.info).setTitle(`${E.coroa} Painel do Dono`)
    .setDescription(
      `${E.users} **Servidores:** ${client.guilds.cache.size}   ${E.raio} **Ping:** ${Math.round(client.ws.ping)}ms\n\n` +
      `${E.config} **Comandos ocultos:** ${e.ocultos.length}\n` +
      `${E.block} **Botões bloqueados:** ${gruposBloq} grupo(s)${soltos > 0 ? ` + ${soltos} prefixo(s)` : ''}\n` +
      `${E.embed} **Comandos criados por você:** ${Object.keys(e.custom).length}\n` +
      `${E.tools} **Manutenção:** ${e.manutencao.ativa ? `${E.online} Ligada` : `${E.off} Desligada`}\n` +
      (e.pendente ? `\n${E.sino} **Há mudanças de comandos que ainda não foram aplicadas no Discord.** Clique em **Aplicar no Discord**.\n` : '') +
      '\n-# Só você (dono do bot) vê e usa este painel. Você ignora os bloqueios e a manutenção.');
  return { embeds: [emb], components: [
    row(btn('xdono_p_cmds_0', 'Comandos', E.config, ButtonStyle.Primary), btn('xdono_p_botoes', 'Botões', E.block, ButtonStyle.Primary),
        btn('xdono_p_custom', 'Criar comando', E.mais, ButtonStyle.Success), btn('xdono_p_servers', 'Servidores', E.users), btn('xdono_p_stats', 'Estatísticas', E.rendimentos)),
    row(btn('xdono_manut', e.manutencao.ativa ? 'Desligar manutenção' : 'Ligar manutenção', E.tools, e.manutencao.ativa ? ButtonStyle.Danger : ButtonStyle.Secondary),
        btn('xdono_m_manut', 'Msg de manutenção', E.editar),
        btn('xdono_sync', 'Aplicar no Discord', E.save, e.pendente ? ButtonStyle.Success : ButtonStyle.Secondary)),
  ] };
}

function telaComandos(client, pagina) {
  const nomes = comandosOrdenados(client);
  const total = Math.max(1, Math.ceil(nomes.length / POR_PAGINA));
  pagina = Math.min(Math.max(0, pagina), total - 1);
  const fatia = nomes.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const e = dono.estado();
  const emb = new EmbedBuilder().setColor(COR.info).setTitle(`${E.config} Comandos (${pagina + 1}/${total})`)
    .setDescription(
      'Escolha um comando no menu para **ocultar / mostrar**. Oculto = some do Discord e fica bloqueado para todo mundo (menos você).\n' +
      'Depois de mexer, clique em **Aplicar no Discord**.\n\n' +
      fatia.map(n => `${e.ocultos.includes(n) ? E.off : E.online} \`/${n}\`${e.custom[n] ? ' *(criado por você)*' : ''}`).join('\n') +
      `\n\n**Ocultos agora:** ${e.ocultos.length ? e.ocultos.map(n => `\`/${n}\``).join(' ') : 'nenhum'}`.slice(0, 900));
  const sel = new StringSelectMenuBuilder().setCustomId(`xdono_s_cmd_${pagina}`).setPlaceholder('Ocultar / mostrar um comando')
    .addOptions(fatia.map(n => ({ label: `/${n}`, value: n, description: e.ocultos.includes(n) ? 'Oculto — clique para mostrar' : 'Visível — clique para ocultar', emoji: emojiObj(e.ocultos.includes(n) ? E.off : E.online) })));
  return { embeds: [emb], components: [
    row(sel),
    row(btn(`xdono_p_cmds_${pagina - 1}`, '', E.voltar).setDisabled(pagina === 0), btn(`xdono_p_cmds_${pagina + 1}`, '', E.arrow || E.raio).setDisabled(pagina >= total - 1),
        btn('xdono_m_busca', 'Buscar', E.link), btn('xdono_sync', 'Aplicar', E.save, e.pendente ? ButtonStyle.Success : ButtonStyle.Secondary), voltar()),
  ] };
}

function telaBotoes() {
  const e = dono.estado();
  const grupos = dono.GRUPOS;
  const emb = new EmbedBuilder().setColor(COR.info).setTitle(`${E.block} Bloquear botões`)
    .setDescription(
      'Escolha um **grupo** no menu para bloquear/liberar todos os botões, menus e formulários dele. Quem clicar vê "função desativada". Vale na hora, sem precisar aplicar.\n' +
      `${E.proibido} Cuidado: bloquear **Loja e compras** impede clientes de comprar.\n\n` +
      grupos.map(g => `${dono.grupoBloqueado(g) ? E.block : E.online} ${g.nome}`).join('\n') +
      (e.bloqueios.length ? `\n\n**Prefixos bloqueados:** ${e.bloqueios.map(p => `\`${p}\``).join(' ')}`.slice(0, 700) : ''));
  const sel = new StringSelectMenuBuilder().setCustomId('xdono_s_grupo').setPlaceholder('Bloquear / liberar um grupo')
    .addOptions(grupos.slice(0, 25).map(g => ({ label: g.nome, value: g.id, description: dono.grupoBloqueado(g) ? 'Bloqueado — clique para liberar' : 'Liberado — clique para bloquear', emoji: emojiObj(dono.grupoBloqueado(g) ? E.block : E.online) })));
  return { embeds: [emb], components: [row(sel), row(btn('xdono_m_prefixo', 'Outro prefixo', E.editar, ButtonStyle.Primary), btn('xdono_desbloq', 'Liberar tudo', E.positivo, ButtonStyle.Success), voltar())] };
}

function telaCustom() {
  const e = dono.estado();
  const lista = Object.values(e.custom);
  const emb = new EmbedBuilder().setColor(COR.info).setTitle(`${E.embed} Comandos criados por você`)
    .setDescription(
      'Clique em **Novo comando**, escolha o nome e a descrição. O bot pede o arquivo `.js` no chat; você envia, confirma e o comando já funciona em todos os servidores.\n\n' +
      (lista.length ? lista.map(c => `${E.link} \`/${c.nome}\` — ${cortar(c.descricao || 'sem descrição', 60)} • ${ts(c.criadoEm)}`).join('\n') : '*Nenhum comando criado ainda.*') +
      `\n\n-# ${lista.length}/20 comandos`);
  const rows = [];
  if (lista.length) rows.push(row(new StringSelectMenuBuilder().setCustomId('xdono_s_custom').setPlaceholder('Gerenciar / remover um comando')
    .addOptions(lista.slice(0, 25).map(c => ({ label: `/${c.nome}`, value: c.nome, description: cortar(c.descricao || 'sem descrição', 90), emoji: emojiObj(E.embed) })))));
  rows.push(row(btn('xdono_m_novo', 'Novo comando', E.mais, ButtonStyle.Success), voltar()));
  return { embeds: [emb], components: rows };
}

function telaCustomDetalhe(nome) {
  const c = dono.estado().custom[nome];
  if (!c) return telaCustom();
  const emb = new EmbedBuilder().setColor(COR.info).setTitle(`${E.embed} /${c.nome}`)
    .setDescription(`**Descrição:** ${c.descricao || '—'}\n**Arquivo:** \`${c.arquivo}\` (${Math.ceil(Buffer.byteLength(c.codigo) / 1024)} KB)\n**Criado:** ${ts(c.criadoEm)}\n**Estado:** ${dono.estaOculto(c.nome) ? `${E.off} Oculto` : `${E.online} Visível`}`);
  return { embeds: [emb], components: [row(
    btn(`xdono_c_oculto_${c.nome}`, dono.estaOculto(c.nome) ? 'Mostrar' : 'Ocultar', E.visivel),
    btn(`xdono_c_rm_${c.nome}`, 'Remover', E.apagar, ButtonStyle.Danger),
    btn('xdono_p_custom', 'Voltar', E.voltar))] };
}

function telaServidores(client) {
  const gs = [...client.guilds.cache.values()].sort((a, b) => b.memberCount - a.memberCount).slice(0, 25);
  const emb = new EmbedBuilder().setColor(COR.info).setTitle(`${E.users} Servidores (${client.guilds.cache.size})`)
    .setDescription((gs.map(g => `${E.link} **${cortar(g.name, 40)}** — ${g.memberCount} membros`).join('\n') || '*Nenhum.*') +
      (client.guilds.cache.size > 25 ? '\n\n-# Mostrando os 25 maiores.' : ''));
  const rows = [];
  if (gs.length) rows.push(row(new StringSelectMenuBuilder().setCustomId('xdono_s_server').setPlaceholder('Ver um servidor')
    .addOptions(gs.map(g => ({ label: cortar(g.name, 100), value: g.id, description: `${g.memberCount} membros • ${g.id}` })))));
  rows.push(row(voltar()));
  return { embeds: [emb], components: rows };
}

function telaServidorDetalhe(client, id) {
  const g = client.guilds.cache.get(id);
  if (!g) return telaServidores(client);
  const emb = new EmbedBuilder().setColor(COR.info).setTitle(cortar(g.name, 200))
    .setDescription(`**ID:** \`${g.id}\`\n**Dono:** <@${g.ownerId}> (\`${g.ownerId}\`)\n**Membros:** ${g.memberCount}\n**Criado:** ${ts(g.createdAt)}\n**Bot entrou:** ${g.joinedAt ? ts(g.joinedAt) : '—'}`);
  if (g.iconURL()) emb.setThumbnail(g.iconURL({ size: 128 }));
  return { embeds: [emb], components: [row(btn(`xdono_g_sair_${g.id}`, 'Sair deste servidor', E.proibido, ButtonStyle.Danger), btn('xdono_p_servers', 'Voltar', E.voltar))] };
}

function telaStats(client) {
  const e = dono.estado();
  const mem = process.memoryUsage();
  const membros = client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0);
  const emb = new EmbedBuilder().setColor(COR.info).setTitle(`${E.rendimentos} Estatísticas do bot`)
    .addFields(
      { name: 'Servidores', value: String(client.guilds.cache.size), inline: true },
      { name: 'Membros (soma)', value: String(membros), inline: true },
      { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true },
      { name: 'Online há', value: fmtTempo(process.uptime()), inline: true },
      { name: 'Memória', value: `${Math.round(mem.rss / 1048576)} MB`, inline: true },
      { name: 'Node', value: process.version, inline: true },
      { name: 'Comandos', value: `${client.commands.size} (${e.ocultos.length} ocultos, ${Object.keys(e.custom).length} criados)`, inline: false });
  return { embeds: [emb], components: [row(btn('xdono_p_stats', 'Atualizar', E.raio), voltar())] };
}

// ── Modais ─────────────────────────────────────────────────────────────────
const campo = (id, label, { longo = false, req = true, max = 100, ph = '', val = '' } = {}) =>
  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(longo ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(req).setMaxLength(max).setPlaceholder(ph).setValue(val));
const modal = (id, titulo, ...campos) => new ModalBuilder().setCustomId(id).setTitle(titulo).addComponents(...campos);

const EXEMPLO =
"```js\nconst { SlashCommandBuilder } = require('discord.js');\n\nmodule.exports = {\n  data: new SlashCommandBuilder().setName('exemplo').setDescription('Diz oi'),\n  async execute(interaction, client) {\n    await interaction.reply('Oi!');\n  },\n};\n```";

async function sincronizar(client) {
  if (typeof client.ressincronizarComandos !== 'function') throw new Error('sincronização indisponível');
  await client.ressincronizarComandos();
}

// ── Roteador ───────────────────────────────────────────────────────────────
async function handle(interaction) {
  const id = interaction.customId;
  const client = interaction.client;
  if (!dono.ehDono(interaction.user.id)) {
    return interaction.reply({ content: `${E.negativo} Só o dono do bot pode usar isso.`, flags: 64 }).catch(() => {});
  }
  const ir = (tela) => interaction.update(tela);

  // navegação
  if (id === 'xdono_home') return ir(telaHome(client));
  if (id.startsWith('xdono_p_cmds_')) return ir(telaComandos(client, parseInt(id.replace('xdono_p_cmds_', ''), 10) || 0));
  if (id === 'xdono_p_botoes') return ir(telaBotoes());
  if (id === 'xdono_p_custom') return ir(telaCustom());
  if (id === 'xdono_p_servers') return ir(telaServidores(client));
  if (id === 'xdono_p_stats') return ir(telaStats(client));

  // comandos: ocultar/mostrar
  if (id.startsWith('xdono_s_cmd_')) {
    dono.alternarOculto(interaction.values[0]);
    return ir(telaComandos(client, parseInt(id.replace('xdono_s_cmd_', ''), 10) || 0));
  }
  if (id === 'xdono_m_busca') return interaction.showModal(modal('xdono_mod_busca', 'Ocultar / mostrar comando', campo('nome', 'Nome do comando (sem a barra)', { max: 32 })));
  if (id === 'xdono_mod_busca') {
    const nome = interaction.fields.getTextInputValue('nome').trim().toLowerCase().replace(/^\//, '');
    if (!client.commands.has(nome) || nome === 'dono') return interaction.reply({ content: `${E.negativo} Não achei o comando **/${nome}**.`, flags: 64 });
    const oculto = dono.alternarOculto(nome);
    return interaction.reply({ content: `${E.positivo} **/${nome}** agora está ${oculto ? 'oculto' : 'visível'}. Clique em **Aplicar no Discord** no painel.`, flags: 64 });
  }
  if (id === 'xdono_sync') {
    await interaction.deferUpdate();
    try { await sincronizar(client); }
    catch (e) { return interaction.followUp({ content: `${E.negativo} Não consegui aplicar no Discord: ${cortar(e.message, 200)}`, flags: 64 }); }
    return interaction.editReply(telaHome(client));
  }

  // botões
  if (id === 'xdono_s_grupo') { dono.alternarGrupo(interaction.values[0]); return ir(telaBotoes()); }
  if (id === 'xdono_desbloq') { dono.desbloquearTudo(); return ir(telaBotoes()); }
  if (id === 'xdono_m_prefixo') return interaction.showModal(modal('xdono_mod_prefixo', 'Bloquear / liberar prefixo', campo('prefixo', 'Começo do ID do botão (ex.: tkt_cfg_)', { max: 80 })));
  if (id === 'xdono_mod_prefixo') {
    const r = dono.alternarPrefixo(interaction.fields.getTextInputValue('prefixo'));
    if (!r.ok) return interaction.reply({ content: `${E.negativo} ${r.motivo}`, flags: 64 });
    return interaction.reply({ content: `${E.positivo} Prefixo \`${interaction.fields.getTextInputValue('prefixo').trim()}\` ${r.bloqueado ? 'bloqueado' : 'liberado'}.`, flags: 64 });
  }

  // manutenção
  if (id === 'xdono_manut') {
    const ativa = dono.alternarManutencao();
    try { client.user.setPresence(ativa ? { status: 'dnd', activities: [{ name: 'Em manutenção', type: 0 }] } : { status: 'online', activities: [{ name: 'KAEL', type: 0 }] }); } catch {}
    return ir(telaHome(client));
  }
  if (id === 'xdono_m_manut') return interaction.showModal(modal('xdono_mod_manut', 'Mensagem de manutenção',
    campo('msg', 'Mensagem (vazio = padrão)', { longo: true, req: false, max: 300, val: dono.estado().manutencao.msg })));
  if (id === 'xdono_mod_manut') {
    dono.definirMsgManutencao(interaction.fields.getTextInputValue('msg'));
    return interaction.reply({ content: `${E.positivo} Mensagem de manutenção salva.`, flags: 64 });
  }

  // criar comando
  if (id === 'xdono_m_novo') return interaction.showModal(modal('xdono_mod_novo', 'Novo comando',
    campo('nome', 'Nome do comando (sem a barra)', { max: 32, ph: 'ex: sorteio-rapido' }),
    campo('descricao', 'Descrição (aparece no Discord)', { req: false, max: 100 })));
  if (id === 'xdono_mod_novo') return pedirArquivo(interaction);
  if (id.startsWith('xdono_n_ok_') || id.startsWith('xdono_n_no_')) return confirmarNovo(interaction);
  if (id === 'xdono_s_custom') return ir(telaCustomDetalhe(interaction.values[0]));
  if (id.startsWith('xdono_c_oculto_')) { dono.alternarOculto(id.replace('xdono_c_oculto_', '')); return ir(telaCustomDetalhe(id.replace('xdono_c_oculto_', ''))); }
  if (id.startsWith('xdono_c_rm_')) {
    const nome = id.replace('xdono_c_rm_', '');
    dono.removerComandoCustom(nome, client);
    await interaction.deferUpdate();
    let aviso = '';
    try { await sincronizar(client); } catch (e) { aviso = ` (mas não consegui aplicar no Discord agora: ${cortar(e.message, 120)})`; }
    await interaction.editReply(telaCustom());
    return interaction.followUp({ content: `${E.positivo} Comando **/${nome}** removido${aviso}.`, flags: 64 });
  }

  // servidores
  if (id === 'xdono_s_server') return ir(telaServidorDetalhe(client, interaction.values[0]));
  if (id.startsWith('xdono_g_sair_ok_')) {
    const g = client.guilds.cache.get(id.replace('xdono_g_sair_ok_', ''));
    if (!g) return ir(telaServidores(client));
    const nome = g.name;
    await g.leave().catch(() => {});
    await interaction.update(telaServidores(client));
    return interaction.followUp({ content: `${E.positivo} Saí do servidor **${cortar(nome, 60)}**.`, flags: 64 });
  }
  if (id.startsWith('xdono_g_sair_')) {
    const g = client.guilds.cache.get(id.replace('xdono_g_sair_', ''));
    if (!g) return ir(telaServidores(client));
    return ir({ embeds: [new EmbedBuilder().setColor(COR.erro).setTitle(`${E.proibido} Sair de ${cortar(g.name, 60)}?`)
      .setDescription('O bot sai do servidor na hora. Para voltar, alguém precisa convidá-lo de novo.')],
      components: [row(btn(`xdono_g_sair_ok_${g.id}`, 'Confirmar saída', E.proibido, ButtonStyle.Danger), btn(`xdono_s_server_voltar_${g.id}`, 'Cancelar', E.voltar))] });
  }
  if (id.startsWith('xdono_s_server_voltar_')) return ir(telaServidorDetalhe(client, id.replace('xdono_s_server_voltar_', '')));
}

// ── Criar comando: pede o arquivo no chat ──────────────────────────────────
async function pedirArquivo(interaction) {
  const client = interaction.client;
  const nome = interaction.fields.getTextInputValue('nome').trim().toLowerCase().replace(/^\//, '');
  const descricao = interaction.fields.getTextInputValue('descricao').trim();
  if (!dono.NOME_VALIDO.test(nome)) return interaction.reply({ content: `${E.negativo} Nome inválido. Use só letras minúsculas, números, \`-\` e \`_\`.`, flags: 64 });
  if (client.commands.has(nome) && !dono.estado().custom[nome]) return interaction.reply({ content: `${E.negativo} Já existe um comando do bot chamado **/${nome}**.`, flags: 64 });

  await interaction.reply({
    content: `<@${interaction.user.id}>`, allowedMentions: { users: [interaction.user.id] },
    embeds: [new EmbedBuilder().setColor(COR.info).setTitle(`${E.embed} Envie o arquivo do comando /${nome}`)
      .setDescription(`Mande **neste chat** o arquivo \`.js\` do comando (você tem **3 minutos**).\n\n**Modelo de arquivo:**\n${EXEMPLO}\n-# O nome e a descrição que você escolheu valem por cima do que estiver no arquivo.`)],
  });
  const canal = interaction.channel;
  if (!canal?.awaitMessages) return;
  const coletadas = await canal.awaitMessages({ filter: m => m.author.id === interaction.user.id && m.attachments.size > 0, max: 1, time: 180000 }).catch(() => null);
  const msg = coletadas?.first();
  if (!msg) return interaction.editReply({ content: `${E.clock} Tempo esgotado. Clique em **Novo comando** de novo quando estiver com o arquivo.`, embeds: [] }).catch(() => {});

  const anexo = msg.attachments.first();
  const apagar = () => msg.delete().catch(() => {});
  if (!/\.(js|cjs|txt)$/i.test(anexo.name || '')) { apagar(); return interaction.followUp({ content: `${E.negativo} O arquivo precisa ser \`.js\`.`, flags: 64 }); }
  if (anexo.size > dono.MAX_BYTES) { apagar(); return interaction.followUp({ content: `${E.negativo} Arquivo grande demais (máx. 100 KB).`, flags: 64 }); }
  let codigo;
  try {
    const res = await fetch(anexo.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    codigo = await res.text();
  } catch (e) { return interaction.followUp({ content: `${E.negativo} Não consegui baixar o arquivo: ${cortar(e.message, 100)}`, flags: 64 }); }
  apagar();

  const token = Math.random().toString(36).slice(2, 10);
  pendentes.set(token, { userId: interaction.user.id, nome, descricao, codigo, arquivo: (anexo.name || `${nome}.js`).replace(/\.txt$/i, '.js'), expira: Date.now() + 10 * 60e3 });
  for (const [t, p] of pendentes) if (p.expira < Date.now()) pendentes.delete(t);
  await interaction.editReply({ content: `${E.positivo} Arquivo recebido (\`${cortar(anexo.name, 40)}\`, ${Math.ceil(anexo.size / 1024)} KB).`, embeds: [] }).catch(() => {});
  return interaction.followUp({ flags: 64, embeds: [new EmbedBuilder().setColor(COR.aviso).setTitle(`${E.proibido} Instalar o comando /${nome}?`)
    .setDescription(`${descricao ? `**Descrição:** ${descricao}\n` : ''}**Arquivo:** \`${cortar(anexo.name, 40)}\`\n\n` +
      '**Atenção:** o arquivo roda dentro do bot com acesso total (banco de dados, token, todos os servidores). Instale só código que **você escreveu** ou em que confia 100%.')],
    components: [row(btn(`xdono_n_ok_${token}`, 'Instalar', E.positivo, ButtonStyle.Success), btn(`xdono_n_no_${token}`, 'Cancelar', E.negativo, ButtonStyle.Danger))] });
}

async function confirmarNovo(interaction) {
  const id = interaction.customId;
  const client = interaction.client;
  const token = id.replace(/^xdono_n_(ok|no)_/, '');
  const p = pendentes.get(token);
  if (!p || p.userId !== interaction.user.id) return interaction.update({ content: 'Esse pedido expirou. Clique em **Novo comando** de novo.', embeds: [], components: [] });
  pendentes.delete(token);
  if (id.startsWith('xdono_n_no_')) return interaction.update({ content: `${E.negativo} Instalação cancelada.`, embeds: [], components: [] });

  await interaction.deferUpdate();
  const registrar = client.registrarComando;
  if (typeof registrar !== 'function') return interaction.editReply({ content: `${E.negativo} O bot ainda não está pronto para instalar comandos.`, embeds: [], components: [] });
  const r = dono.instalarComando(p, client, registrar);
  if (!r.ok) return interaction.editReply({ content: `${E.negativo} ${r.motivo}`, embeds: [], components: [] });
  let aviso = '';
  try { await sincronizar(client); } catch (e) { aviso = `\n${E.proibido} O comando foi instalado, mas não consegui registrar no Discord agora (${cortar(e.message, 100)}). Use **Aplicar no Discord** no painel.`; }
  return interaction.editReply({ embeds: [new EmbedBuilder().setColor(COR.ok).setTitle(`${E.positivo} Comando ${r.substituiu ? 'atualizado' : 'instalado'}!`)
    .setDescription(`**/${r.nome}** já está no ar${r.descricao ? ` — ${r.descricao}` : ''}.\nEle pode demorar alguns segundos pra aparecer no Discord (reabra o chat se não aparecer).${aviso}`)], components: [] });
}

module.exports = { handle, telaHome };
