'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  Histórico de atualizações do KAEL.
//
//  COMO USAR: a cada atualização, ADICIONE uma entrada NO TOPO da lista com um
//  `id` NOVO (ex.: '1.2.0'). Quando o bot reiniciar depois do deploy, ele posta
//  essa entrada em todos os servidores onde está. Se o `id` não mudar, nada é
//  enviado (reiniciar o bot não gera aviso repetido).
// ═══════════════════════════════════════════════════════════════════════════

const ATUALIZACOES = [
  {
    id: '1.3.0',
    data: '2026-11-07',
    titulo: 'IA no ticket',
    itens: [
      '<:ia:1533235376464986313> **IA no ticket**: cole a API na configuração do ticket, o bot faz um teste rápido e, se funcionar, libera o botão **Config. da IA**.',
      '<:editar:1528400388137549864> Personalize o **prompt**, o modelo e o comportamento da IA (pausa sozinha quando a equipe fala).',
      '<:mais2:1528400709018583100> Adicione **APIs extras**: se uma atingir o limite, o bot troca para a próxima **sem mostrar erro** no ticket.',
      '<:raio:1533080818258411662> Funciona com Gemini, OpenAI, Groq, OpenRouter e Claude — o bot reconhece o provedor pela chave.',
    ],
  },
  {
    id: '1.2.0',
    data: '2026-11-02',
    titulo: 'Fidelidade, afiliados, moderação, logs e reembolso',
    itens: [
      '<:money:1532503308961448096> **Cashback**: o cliente ganha saldo a cada compra e troca por cupom com **/saldo**.',
      '<:coroa:1520751629350080582> **Níveis de cliente** (Bronze, Prata, Ouro...) por total gasto, com cargo automático. Configure em **/fidelidade**.',
      '<:users:1528840901739151430> **Programa de afiliados**: cada cliente cria o código com **/afiliado** e ganha comissão nas vendas indicadas.',
      '<:present:1538356348989743166> **Cupons automáticos**: boas-vindas para quem entra e "volta" para cliente que sumiu.',
      '<:card:1533880211882381422> **Reembolso opcional**: o dono liga ou desliga em **/reembolsoconfig**; o cliente pede com **/reembolso**.',
      '<:safety:1528841000548569239> **Moderação**: novos **/ban**, **/unban**, **/kick**, **/timeout**, **/warn**, **/avisos** e **/limparavisos**.',
      '<:text:1533089802856038461> **Logs do servidor** (mensagens, membros, cargos, canais e moderação) em **/logs**.',
      '<:link:1533251823778005082> Novo **/ajuda** que mostra só os comandos que você pode usar.',
    ],
  },
  {
    id: '1.1.0',
    data: '2026-10-20',
    titulo: 'Kael HUD, novo visual e correções',
    itens: [
      'Novo **/hud**: salva e restaura cargos, categorias, canais e permissões do servidor, com **backup automático**.',
      'Banner KAEL no **/painel** e no **/hud**.',
      'Emojis personalizados corrigidos (acabou o `:coroa:` aparecendo no lugar do ícone).',
      'O `!ajuda` agora lista **todos** os comandos do bot.',
      'Chaves de licença agora começam com **KAEL-**.',
      'Servidor de pagamentos (webhooks) corrigido.',
    ],
  },
];

module.exports = { ATUALIZACOES, ULTIMA: ATUALIZACOES[0] };
