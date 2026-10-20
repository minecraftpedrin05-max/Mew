'use strict';
// Identidade visual do KAEL — banner único usado nos painéis.
// O arquivo é enviado como anexo (attachment://) junto com a mensagem, então
// não depende de nenhum link externo (imgur/CDN) que possa expirar.
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const BANNER_NAME = 'kael-banner.png';
const BANNER_PATH = path.join(__dirname, '..', 'assets', BANNER_NAME);
const BANNER_ATTACH_URL = `attachment://${BANNER_NAME}`;

let _buf = null;
function bannerBuffer() {
  if (!_buf) _buf = fs.readFileSync(BANNER_PATH);
  return _buf;
}

/** Sempre devolve um AttachmentBuilder novo (cada envio precisa do seu). */
function bannerFile() {
  return new AttachmentBuilder(bannerBuffer(), { name: BANNER_NAME });
}

module.exports = { BANNER_NAME, BANNER_PATH, BANNER_ATTACH_URL, bannerFile };
