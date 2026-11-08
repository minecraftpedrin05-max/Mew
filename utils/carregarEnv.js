'use strict';
// Lê o arquivo ".env" da pasta do bot (se existir) e coloca os valores em process.env.
// - Variáveis que JÁ existem no ambiente (ex.: as "Variables" do Railway) têm prioridade e NÃO são trocadas.
// - Nunca imprime os valores (token/segredos) no log.
// - Tolerante: aceita KEY="valor", KEY='valor', KEY=valor, "export KEY=valor" e aspas faltando no fim.
const fs = require('fs');
const path = require('path');

function carregar(arquivo = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(arquivo)) return 0;
  let n = 0;
  for (const bruta of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    let linha = bruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    if (linha.startsWith('export ')) linha = linha.slice(7).trim();
    const i = linha.indexOf('=');
    if (i < 1) continue;
    const chave = linha.slice(0, i).trim();
    let valor = linha.slice(i + 1).trim();
    const aspa = valor[0];
    if (aspa === '"' || aspa === "'") {
      valor = valor.slice(1);
      if (valor.endsWith(aspa)) valor = valor.slice(0, -1);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(chave)) continue;
    if (process.env[chave] === undefined) { process.env[chave] = valor; n++; }
  }
  if (n) console.log(`[Env] .env carregado (${n} variável(is)).`);
  return n;
}

carregar();
module.exports = { carregar };
