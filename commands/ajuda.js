/**
 * ─────────────────────────────────────────────────────────────────
 *  KAEL — /ajuda
 *  Lista os comandos do bot por categoria. Mostra só o que a pessoa
 *  pode usar (admin vê tudo). Comandos novos que não estiverem na
 *  lista abaixo aparecem sozinhos em "Outros", com a própria descrição.
 * ─────────────────────────────────────────────────────────────────
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { E, COR } = require('../extras-system/base');
const { BOT_OWNER_ID } = require('../config/constants');

const CATEGORIAS = [
  { nome: 'Loja', emoji: E.carrinho, cmds: {
    painel: 'Painel de controle do bot', produto: 'Cria e publica produtos', definicoes: 'Formas de pagamento',
    minhascompras: 'Suas compras', ranking: 'Ranking de compradores', carteira: 'Carteira e saques', rendimentos: 'Rendimentos da loja',
    insights: 'Análises e metas da loja', reembolso: 'Pede reembolso de uma compra',
  } },
  { nome: 'Fidelidade', emoji: E.coroa, cmds: {
    saldo: 'Seu saldo de cashback, nível e resgate', afiliado: 'Seu código de afiliado e ganhos',
    fidelidade: 'Config. de cashback, níveis, afiliados e cupons automáticos', reembolsoconfig: 'Config. de reembolsos',
  } },
  { nome: 'Pagamentos', emoji: E.pix, cmds: { efibank: 'Configura o Efi Bank', c6bank: 'Configura o C6 Bank', openpix: 'Configura a OpenPix/Woovi' } },
  { nome: 'Moderação', emoji: E.safety, cmds: {
    ban: 'Bane um membro', unban: 'Remove um banimento', kick: 'Expulsa um membro', timeout: 'Silencia um membro',
    warn: 'Dá um aviso', avisos: 'Vê os avisos de um membro', limparavisos: 'Apaga os avisos de um membro',
    limpar: 'Apaga mensagens do canal', lock: 'Bloqueia o canal', unlock: 'Desbloqueia o canal', logs: 'Configura os logs do servidor',
  } },
  { nome: 'Comunidade', emoji: E.users, cmds: {
    sugestao: 'Envia uma sugestão', invite: 'Sistema de convites', template: 'Biblioteca de estruturas de servidor',
    hud: 'Backup e restauração do servidor', atualizacoes: 'Avisos de novidades do bot',
  } },
  { nome: 'Utilidades', emoji: E.tools, cmds: { ping: 'Latência do bot', cargoid: 'Mostra o ID de um cargo', ajuda: 'Esta lista' } },
];

module.exports = {
  data: new SlashCommandBuilder().setName('ajuda').setDescription('Lista os comandos do bot que você pode usar'),

  async execute(interaction, client) {
    const c = client || interaction.client;
    const ehDono = interaction.user.id === BOT_OWNER_ID;
    const pode = (nome) => {
      const exigida = c.commandPerms?.get(nome);
      return ehDono || !exigida || interaction.memberPermissions?.has(exigida);
    };
    const existentes = new Set([...c.commands.keys()]);
    const usados = new Set();
    const emb = new EmbedBuilder().setColor(COR.info).setTitle(`${E.text} Central de Ajuda`)
      .setDescription('Estes são os comandos que **você** pode usar. Digite `/` e o nome para executar.');

    for (const cat of CATEGORIAS) {
      const linhas = [];
      for (const [nome, desc] of Object.entries(cat.cmds)) {
        if (!existentes.has(nome)) continue;
        usados.add(nome);
        if (pode(nome)) linhas.push(`${E.link} \`/${nome}\` — ${desc}`);
      }
      if (linhas.length) emb.addFields({ name: `${cat.emoji} ${cat.nome}`, value: linhas.join('\n').slice(0, 1024) });
    }
    const outros = [...existentes].filter(n => !usados.has(n) && pode(n)).map(n => {
      const d = c.commands.get(n)?.data?.description || '';
      return `${E.link} \`/${n}\`${d && !d.startsWith('>') && !d.startsWith('━') ? ` — ${d.slice(0, 80)}` : ''}`;
    });
    if (outros.length) emb.addFields({ name: `${E.bot} Outros`, value: outros.join('\n').slice(0, 1024) });
    emb.setFooter({ text: 'Também funciona com !ajuda • Precisa de suporte? Abra um ticket.' });
    return interaction.reply({ embeds: [emb], flags: 64 });
  },
};
