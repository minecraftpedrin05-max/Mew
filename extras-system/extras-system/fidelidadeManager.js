'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  fidelidadeManager — Cashback, Níveis de cliente, Afiliados e Cupons automáticos
//
//  Tudo funciona em cima do sistema de cupons que o bot JÁ tem (produto.cupons),
//  então o checkout não precisa de nenhuma mudança além do gancho `onCompra`
//  chamado pelo salesManager logo depois que a venda é registrada.
//
//  Dados (guild.extras):
//    fidCfg   → configuração do dono (cada recurso liga/desliga sozinho)
//    fidDados → { clientes, afiliados, codigos, auto, ledger }
//
//  • Cashback:  % do que o cliente PAGOU vira saldo. Saldo vira cupom de valor fixo.
//  • Níveis:    por total gasto (Bronze/Prata/Ouro/Diamante...), com cargo opcional.
//  • Afiliados: o cliente tem um código (que é um cupom de desconto %). Quando alguém
//               compra com o código, o afiliado ganha comissão % em saldo.
//  • Cupons automáticos: boas-vindas (quem entra) e "volta" (cliente sumido).
//  • Resgate:   saldo → cupom fixo de uso único (7 dias) em UM produto; se não usar,
//               o saldo volta sozinho quando o cupom expira.
// ═══════════════════════════════════════════════════════════════════════════
const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const { E, COR, getExtras, setExtras, temPlano, dinheiro, codigoAleatorio, enviarDM, cortar } = require('./base');

const DIA = 86400000;
const MARCA = 'kael-auto'; // criadoPor dos cupons gerados aqui (o /insights ignora esses)

const CFG_PADRAO = {
  cashback:  { ativo: false, pct: 5 },
  niveis:    { ativo: false, lista: [
    { nome: 'Bronze',   gasto: 0,    cargoId: null },
    { nome: 'Prata',    gasto: 100,  cargoId: null },
    { nome: 'Ouro',     gasto: 500,  cargoId: null },
    { nome: 'Diamante', gasto: 1000, cargoId: null },
  ] },
  afiliados: { ativo: false, comissaoPct: 10, descontoPct: 5 },
  bemVindo:  { ativo: false, pct: 10, dias: 7 },
  volta:     { ativo: false, pct: 10, diasInativo: 30, dias: 7 },
  resgateMin: 5,
};

function getCfg(guildId) {
  const salvo = getExtras(guildId, 'fidCfg');
  const cfg = {};
  for (const k of Object.keys(CFG_PADRAO)) {
    const pad = CFG_PADRAO[k];
    cfg[k] = (pad && typeof pad === 'object' && !Array.isArray(pad))
      ? { ...JSON.parse(JSON.stringify(pad)), ...(salvo[k] || {}) }
      : (salvo[k] ?? pad);
  }
  return cfg;
}
const salvarCfg = (guildId, cfg) => setExtras(guildId, 'fidCfg', cfg);

function getDados(guildId) {
  const d = getExtras(guildId, 'fidDados');
  d.clientes ||= {}; d.afiliados ||= {}; d.codigos ||= {}; d.auto ||= {}; d.ledger ||= {};
  return d;
}
const salvarDados = (guildId, d) => setExtras(guildId, 'fidDados', d);

function getCliente(d, id) {
  d.clientes[id] ||= { saldo: 0, gasto: 0, compras: 0, nivel: null, ultima: null, voltaEm: null, bemVindoEm: null };
  return d.clientes[id];
}

const arred = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ativoFid = (guildId) => temPlano(guildId, 'fidelidade');
const ativoAfil = (guildId) => temPlano(guildId, 'afiliados');

// ── Níveis ─────────────────────────────────────────────────────────────────
function listaNiveis(cfg) {
  return [...(cfg.niveis.lista || [])].sort((a, b) => a.gasto - b.gasto);
}
function nivelPara(cfg, gasto) {
  let atual = null;
  for (const n of listaNiveis(cfg)) if (gasto >= n.gasto) atual = n;
  return atual;
}
function proximoNivel(cfg, gasto) {
  return listaNiveis(cfg).find(n => n.gasto > gasto) || null;
}

async function aplicarCargoNivel(client, guildId, userId, nivel, cfg) {
  try {
    const guild = client.guilds.cache.get(guildId);
    const membro = guild && await guild.members.fetch(userId).catch(() => null);
    if (!membro) return;
    for (const n of cfg.niveis.lista) {
      if (n.cargoId && n.nome !== nivel?.nome && membro.roles.cache.has(n.cargoId)) await membro.roles.remove(n.cargoId).catch(() => {});
    }
    if (nivel?.cargoId && !membro.roles.cache.has(nivel.cargoId)) await membro.roles.add(nivel.cargoId).catch(() => {});
  } catch (e) { console.error('[Fidelidade] cargo de nível:', e.message); }
}

// ── Cupons gerados pelo sistema ────────────────────────────────────────────

// ── Cupons de produto (mesmo formato do cupom-system/cupomManager.js, que não exporta esses helpers) ──
function getCuponsProduto(guildId, produtoId) { return db.getProdutoPorId(guildId, produtoId)?.cupons || {}; }
function salvarCuponsProduto(guildId, produtoId, cupons) { db.atualizarProduto(guildId, produtoId, 'cupons', cupons); }
function criarCupomProduto(guildId, produtoId, codigo, dados) {
  const cupons = getCuponsProduto(guildId, produtoId);
  cupons[codigo] = {
    desconto: dados.tipo === 'percentual' ? dados.valor : 0,
    tipo: dados.tipo,
    valorFixo: dados.tipo === 'fixo' ? dados.valor : 0,
    usos: 0,
    usosMaximos: dados.usosMaximos ?? null,
    cargoObrigatorioId: null,
    valorMinimo: dados.valorMinimo ?? null,
    valorMaximo: null,
    validoAte: dados.validoAte ?? null,
    criadoEm: new Date().toISOString(),
    criadoPor: dados.criadoPor,
  };
  salvarCuponsProduto(guildId, produtoId, cupons);
}
function removerCupomProduto(guildId, produtoId, codigo) {
  const cupons = getCuponsProduto(guildId, produtoId);
  if (!cupons[codigo]) return false;
  delete cupons[codigo];
  salvarCuponsProduto(guildId, produtoId, cupons);
  return true;
}
function produtosAtivos(guildId) {
  return (db.getProdutos(guildId) || []).filter(p => p.ativo !== false);
}

/** Cria o mesmo cupom em todos os produtos ativos (ou só nos `somenteProdutos`). */
function emitirCupom(guildId, { prefixo, tipo, valor, dias, clienteId, origem, somenteProdutos, usosMaximos = 3, extra = {} }) {
  const d = getDados(guildId);
  if (Object.keys(d.auto).length >= 300) return null; // trava anti-abuso
  let codigo;
  for (let i = 0; i < 10; i++) {
    const c = `${prefixo}-${codigoAleatorio(6)}`;
    if (!d.auto[c] && !d.codigos[c]) { codigo = c; break; }
  }
  if (!codigo) return null;
  const alvo = (somenteProdutos || produtosAtivos(guildId).map(p => p.id)).slice(0, 50);
  if (!alvo.length) return null;
  const expiraEm = new Date(Date.now() + dias * DIA).toISOString();
  for (const pid of alvo) {
    criarCupomProduto(guildId, pid, codigo, {
      tipo, valor, usosMaximos, validoAte: expiraEm,
      valorMinimo: tipo === 'fixo' ? valor : null, criadoPor: MARCA,
    });
  }
  d.auto[codigo] = { clienteId, origem, tipo, valor, produtoIds: alvo, expiraEm, criadoEm: new Date().toISOString(), ...extra };
  salvarDados(guildId, d);
  return { codigo, expiraEm, produtoIds: alvo };
}

function apagarCupomAuto(guildId, codigo) {
  const d = getDados(guildId);
  const a = d.auto[codigo];
  if (!a) return null;
  for (const pid of a.produtoIds || []) { try { removerCupomProduto(guildId, pid, codigo); } catch {} }
  delete d.auto[codigo];
  salvarDados(guildId, d);
  return a;
}

// ── Gancho de compra (chamado pelo salesManager) ───────────────────────────
async function onCompra({ client, guildId, clienteId, total, cupomCodigo, registroId, produtoNome }) {
  try {
    if (!ativoFid(guildId) && !ativoAfil(guildId)) return;
    total = arred(total);
    const cfg = getCfg(guildId);
    const d = getDados(guildId);
    const cli = getCliente(d, clienteId);
    const ledger = { clienteId, total, cashback: 0, afiliadoId: null, comissao: 0, produtoNome: produtoNome || null, em: new Date().toISOString() };

    // 1) consome cupom automático (boas-vindas / volta / resgate) → apaga as cópias dos outros produtos
    if (cupomCodigo && d.auto[cupomCodigo]) {
      d.auto[cupomCodigo].consumido = true;
      salvarDados(guildId, d);
      apagarCupomAuto(guildId, cupomCodigo);
    }
    const d2 = getDados(guildId); // recarrega (apagarCupomAuto salvou)
    const cli2 = getCliente(d2, clienteId);

    // 2) cashback
    if (ativoFid(guildId) && cfg.cashback.ativo && cfg.cashback.pct > 0) {
      ledger.cashback = arred(total * cfg.cashback.pct / 100);
      cli2.saldo = arred(cli2.saldo + ledger.cashback);
    }

    // 3) comissão de afiliado
    const afId = cupomCodigo ? d2.codigos[cupomCodigo] : null;
    if (afId && afId !== clienteId && ativoAfil(guildId) && cfg.afiliados.ativo) {
      const com = arred(total * cfg.afiliados.comissaoPct / 100);
      if (com > 0) {
        const af = (d2.afiliados[afId] ||= { codigo: cupomCodigo, vendas: 0, ganhos: 0 });
        const cliAf = getCliente(d2, afId);
        cliAf.saldo = arred(cliAf.saldo + com);
        af.vendas += 1; af.ganhos = arred(af.ganhos + com);
        ledger.afiliadoId = afId; ledger.comissao = com;
        enviarDM(client, afId, { embeds: [new EmbedBuilder().setColor(COR.ok)
          .setTitle(`${E.money} Você ganhou uma comissão!`)
          .setDescription(`Alguém comprou com o seu código **${cupomCodigo}**.\n> **Comissão:** ${dinheiro(com)}\n> Use \`/saldo\` para resgatar.`)] });
      }
    }

    // 4) estatísticas do cliente + nível
    const nivelAntes = cli2.nivel;
    cli2.gasto = arred(cli2.gasto + total);
    cli2.compras += 1;
    cli2.ultima = ledger.em;
    let novoNivel = null;
    if (ativoFid(guildId) && cfg.niveis.ativo) {
      novoNivel = nivelPara(cfg, cli2.gasto);
      cli2.nivel = novoNivel?.nome || null;
    }
    d2.ledger[registroId] = ledger;
    // mantém o ledger enxuto (últimos 2000 registros)
    const ks = Object.keys(d2.ledger);
    if (ks.length > 2000) for (const k of ks.slice(0, ks.length - 2000)) delete d2.ledger[k];
    salvarDados(guildId, d2);

    if (novoNivel && novoNivel.nome !== nivelAntes) {
      await aplicarCargoNivel(client, guildId, clienteId, novoNivel, cfg);
      enviarDM(client, clienteId, { embeds: [new EmbedBuilder().setColor(COR.ouro)
        .setTitle(`${E.coroa} Você subiu de nível!`).setDescription(`Agora você é **${novoNivel.nome}**. Obrigado por comprar com a gente!`)] });
    }
    if (ledger.cashback > 0) {
      enviarDM(client, clienteId, { embeds: [new EmbedBuilder().setColor(COR.ok)
        .setTitle(`${E.money} Cashback recebido`)
        .setDescription(`Você ganhou **${dinheiro(ledger.cashback)}** nessa compra.\n> Saldo atual: **${dinheiro(cli2.saldo)}** — veja com \`/saldo\`.`)] });
    }
  } catch (e) { console.error('[Fidelidade] onCompra:', e.stack || e.message); }
}

/** Desfaz cashback/comissão/gasto de uma compra (usado pelo reembolso aprovado). */
async function estornar(client, guildId, registroId) {
  try {
    const d = getDados(guildId);
    const l = d.ledger[registroId];
    if (!l) return false;
    const cli = getCliente(d, l.clienteId);
    cli.saldo = Math.max(0, arred(cli.saldo - (l.cashback || 0)));
    cli.gasto = Math.max(0, arred(cli.gasto - (l.total || 0)));
    cli.compras = Math.max(0, cli.compras - 1);
    if (l.afiliadoId) {
      getCliente(d, l.afiliadoId).saldo = Math.max(0, arred(getCliente(d, l.afiliadoId).saldo - (l.comissao || 0)));
      const af = d.afiliados[l.afiliadoId];
      if (af) { af.vendas = Math.max(0, af.vendas - 1); af.ganhos = Math.max(0, arred(af.ganhos - (l.comissao || 0))); }
    }
    delete d.ledger[registroId];
    const cfg = getCfg(guildId);
    if (cfg.niveis.ativo) {
      const n = nivelPara(cfg, cli.gasto);
      if ((n?.nome || null) !== cli.nivel) { cli.nivel = n?.nome || null; await aplicarCargoNivel(client, guildId, l.clienteId, n, cfg); }
    }
    salvarDados(guildId, d);
    return true;
  } catch (e) { console.error('[Fidelidade] estornar:', e.message); return false; }
}

// ── Resgate de saldo → cupom fixo ──────────────────────────────────────────
function resgatar(guildId, userId, produtoId, valor) {
  const cfg = getCfg(guildId);
  valor = arred(valor);
  const d = getDados(guildId);
  const cli = getCliente(d, userId);
  if (!(valor > 0)) return { ok: false, motivo: 'Valor inválido.' };
  if (valor < cfg.resgateMin) return { ok: false, motivo: `O resgate mínimo é ${dinheiro(cfg.resgateMin)}.` };
  if (valor > cli.saldo + 0.001) return { ok: false, motivo: `Seu saldo é só ${dinheiro(cli.saldo)}.` };
  const prod = produtosAtivos(guildId).find(p => p.id === produtoId);
  if (!prod) return { ok: false, motivo: 'Produto indisponível.' };
  // debita primeiro (se falhar ao criar o cupom, devolve)
  cli.saldo = arred(cli.saldo - valor);
  salvarDados(guildId, d);
  const r = emitirCupom(guildId, { prefixo: 'CASH', tipo: 'fixo', valor, dias: 7, clienteId: userId, origem: 'resgate', somenteProdutos: [produtoId] });
  if (!r) {
    const d2 = getDados(guildId); getCliente(d2, userId).saldo = arred(getCliente(d2, userId).saldo + valor); salvarDados(guildId, d2);
    return { ok: false, motivo: 'Não consegui gerar o cupom agora. Seu saldo foi mantido.' };
  }
  return { ok: true, codigo: r.codigo, expiraEm: r.expiraEm, produto: prod.titulo, valor };
}

// ── Afiliados ──────────────────────────────────────────────────────────────
function limparCodigo(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); }

function definirCodigoAfiliado(guildId, userId, desejado) {
  const d = getDados(guildId);
  let codigo = limparCodigo(desejado);
  if (codigo && codigo.length < 4) return { ok: false, motivo: 'O código precisa ter de 4 a 16 letras/números.' };
  if (!codigo) codigo = `AF${codigoAleatorio(6)}`;
  if (d.codigos[codigo] && d.codigos[codigo] !== userId) return { ok: false, motivo: 'Esse código já está em uso. Escolha outro.' };
  // não pode colidir com cupom existente de produto
  for (const p of produtosAtivos(guildId)) {
    const c = p.cupons?.[codigo];
    if (c && c.criadoPor !== 'afiliado') return { ok: false, motivo: 'Esse código já existe como cupom da loja. Escolha outro.' };
  }
  const atual = d.afiliados[userId];
  if (atual && atual.codigo !== codigo) {
    // remove o código antigo (cupons + mapa)
    for (const p of produtosAtivos(guildId)) { try { removerCupomProduto(guildId, p.id, atual.codigo); } catch {} }
    delete d.codigos[atual.codigo];
  }
  d.afiliados[userId] = { vendas: 0, ganhos: 0, ...(atual || {}), codigo };
  d.codigos[codigo] = userId;
  salvarDados(guildId, d);
  sincronizarAfiliados(guildId);
  return { ok: true, codigo };
}

/** Garante que cada código de afiliado exista como cupom % em todos os produtos ativos (e some se o recurso for desligado). */
function sincronizarAfiliados(guildId) {
  const cfg = getCfg(guildId);
  const d = getDados(guildId);
  const ligado = ativoAfil(guildId) && cfg.afiliados.ativo;
  const produtos = produtosAtivos(guildId);
  for (const [codigo] of Object.entries(d.codigos)) {
    for (const p of produtos) {
      const atual = p.cupons?.[codigo];
      if (!ligado) { if (atual?.criadoPor === 'afiliado') removerCupomProduto(guildId, p.id, codigo); continue; }
      if (!atual) {
        criarCupomProduto(guildId, p.id, codigo, { tipo: 'percentual', valor: cfg.afiliados.descontoPct, usosMaximos: null, criadoPor: 'afiliado' });
      } else if (atual.criadoPor === 'afiliado' && atual.desconto !== cfg.afiliados.descontoPct) {
        const cs = getCuponsProduto(guildId, p.id);
        cs[codigo].desconto = cfg.afiliados.descontoPct;
        salvarCuponsProduto(guildId, p.id, cs);
      }
    }
  }
}

// ── Cupons automáticos ─────────────────────────────────────────────────────
async function onMembroEntrou(member) {
  try {
    if (member.user.bot) return;
    const guildId = member.guild.id;
    if (!ativoFid(guildId)) return;
    const cfg = getCfg(guildId);
    if (!cfg.bemVindo.ativo) return;
    const d = getDados(guildId);
    const cli = getCliente(d, member.id);
    if (cli.bemVindoEm || cli.compras > 0) return;
    cli.bemVindoEm = new Date().toISOString();
    salvarDados(guildId, d);
    const r = emitirCupom(guildId, { prefixo: 'BEMVINDO', tipo: 'percentual', valor: cfg.bemVindo.pct, dias: cfg.bemVindo.dias, clienteId: member.id, origem: 'bemvindo' });
    if (!r) return;
    await enviarDM(member.client, member.id, { embeds: [new EmbedBuilder().setColor(COR.ouro)
      .setTitle(`${E.present} Presente de boas-vindas`)
      .setDescription(`Bem-vindo(a) à **${member.guild.name}**! Aqui está um cupom de **${cfg.bemVindo.pct}% OFF** na sua primeira compra:\n\n` +
        `${E.cupom} **\`${r.codigo}\`**\n> Vale em qualquer produto. Expira <t:${Math.floor(new Date(r.expiraEm).getTime() / 1000)}:R>.`)] });
  } catch (e) { console.error('[Fidelidade] boas-vindas:', e.message); }
}

async function varrer(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const guildId = guild.id;
      const d = getDados(guildId);
      const cfg = getCfg(guildId);
      const temAlgo = Object.keys(d.auto).length || Object.keys(d.codigos).length || cfg.volta.ativo;
      if (!temAlgo) continue;

      // 1) expira cupons automáticos (resgate não usado devolve o saldo)
      const agora = Date.now();
      for (const [codigo, a] of Object.entries(d.auto)) {
        if (new Date(a.expiraEm).getTime() > agora) continue;
        apagarCupomAuto(guildId, codigo);
        if (a.origem === 'resgate' && !a.consumido) {
          const dd = getDados(guildId);
          const cli = getCliente(dd, a.clienteId);
          cli.saldo = arred(cli.saldo + a.valor);
          salvarDados(guildId, dd);
          enviarDM(client, a.clienteId, { embeds: [new EmbedBuilder().setColor(COR.info)
            .setTitle(`${E.money} Saldo devolvido`).setDescription(`O cupom \`${codigo}\` expirou sem uso, então **${dinheiro(a.valor)}** voltaram pro seu saldo.`)] });
        }
      }

      // 2) afiliados
      if (Object.keys(d.codigos).length) sincronizarAfiliados(guildId);

      // 3) cupom "volta" para cliente sumido
      if (ativoFid(guildId) && cfg.volta.ativo) {
        const dd = getDados(guildId);
        let enviados = 0;
        for (const [uid, cli] of Object.entries(dd.clientes)) {
          if (enviados >= 20) break;
          if (!cli.ultima || cli.compras < 1) continue;
          const parado = (agora - new Date(cli.ultima).getTime()) / DIA;
          if (parado < cfg.volta.diasInativo) continue;
          if (cli.voltaEm && (agora - new Date(cli.voltaEm).getTime()) / DIA < cfg.volta.diasInativo) continue;
          const r = emitirCupom(guildId, { prefixo: 'VOLTA', tipo: 'percentual', valor: cfg.volta.pct, dias: cfg.volta.dias, clienteId: uid, origem: 'volta' });
          if (!r) break;
          const d3 = getDados(guildId); getCliente(d3, uid).voltaEm = new Date().toISOString(); salvarDados(guildId, d3);
          enviarDM(client, uid, { embeds: [new EmbedBuilder().setColor(COR.ouro)
            .setTitle(`${E.present} Sentimos sua falta!`)
            .setDescription(`Faz um tempo que você não compra na **${guild.name}**. Toma um cupom de **${cfg.volta.pct}% OFF**:\n\n` +
              `${E.cupom} **\`${r.codigo}\`**\n> Expira <t:${Math.floor(new Date(r.expiraEm).getTime() / 1000)}:R>.`)] });
          enviados++;
        }
      }
    } catch (e) { console.error('[Fidelidade] varredura:', e.message); }
  }
}

let timer = null;
function iniciar(client) {
  client.on('guildMemberAdd', (m) => { onMembroEntrou(m); });
  if (timer) clearInterval(timer);
  setTimeout(() => varrer(client), 60 * 1000);
  timer = setInterval(() => varrer(client), 10 * 60 * 1000);
}

module.exports = {
  CFG_PADRAO, MARCA, getCfg, salvarCfg, getDados, salvarDados, getCliente,
  listaNiveis, nivelPara, proximoNivel, aplicarCargoNivel,
  emitirCupom, apagarCupomAuto, onCompra, estornar, resgatar,
  limparCodigo, definirCodigoAfiliado, sincronizarAfiliados, onMembroEntrou, varrer, iniciar,
  produtosAtivos, ativoFid, ativoAfil, arred, cortar,
};
