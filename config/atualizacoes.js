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
