const { Client, GatewayIntentBits, REST, Routes, Collection } = require("discord.js");
const fs   = require("fs");
const path = require("path");

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

// ── Rede de proteção contra crash total ──
// Sem isso, uma Promise rejeitada sem .catch() (unhandledRejection) ou uma
// exceção síncrona fora de qualquer try/catch (uncaughtException) derruba
// o processo Node inteiro e o bot fica offline até reiniciar manualmente.
// Aqui apenas logamos o erro com stack completo e mantemos o processo
// vivo — nenhum erro é escondido, só deixa de matar o bot.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRASH-GUARD] unhandledRejection não tratada:', reason);
});

process.on('uncaughtException', (error, origin) => {
  console.error(`[CRASH-GUARD] uncaughtException (origin: ${origin}):`, error);
});

const { iniciarMemoryWatchdog } = require("./utils/memoryWatchdog");
iniciarMemoryWatchdog();

// ─────────────────────────────────────────────────────────────────────
// BACKUP AUTOMÁTICO (Discord): em hospedagens sem disco persistente, o
// banco de dados pode voltar a um estado antigo a cada restart. Antes de
// carregar qualquer coisa que abra o banco (alguns linhas abaixo, no
// loop que lê commands/), tentamos restaurar o backup mais recente
// salvo num canal do Discord — só restaura se for mais novo que o banco
// local, então nunca sobrescreve dado atual com dado velho.
//
// Precisa estar dentro de uma função async porque `require()` é síncrono
// em CommonJS: a única forma de "esperar" essa restauração terminar
// antes do resto do arquivo rodar é envolver o resto do arquivo numa
// função async e usar `await` logo no início dela.
// ─────────────────────────────────────────────────────────────────────
const { restaurarBackupAntesDeIniciar, iniciarBackupPeriodico } = require('./database/backupSqlite');
const emojiResolver = require('./utils/emojiResolver');
const { BOT_OWNER_ID } = require('./config/constants');

// Registra os comandos de barra no Discord e DIZ no log exatamente o que aconteceu.
// Se UM comando estiver inválido o Discord recusa o lote inteiro (e ficam só os
// comandos antigos). Nesse caso registramos um por um pra isolar o culpado.
async function sincronizarComandos(rest, commandsJSON) {
  client.errosRegistro = [];
  const nomes = commandsJSON.map(c => c.name);
  console.log(`[Comandos] Carregados ${nomes.length}: ${nomes.join(', ')}`);
  try {
    const data = await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandsJSON });
    console.log(`[Comandos] ${data.length}/${nomes.length} registrados com sucesso no Discord.`);
    return;
  } catch (error) {
    console.error('[Comandos] O Discord recusou o lote inteiro:', error?.rawError ? JSON.stringify(error.rawError.errors || error.rawError) : error);
    client.errosRegistro.push({ nome: '(lote inteiro)', msg: error?.rawError ? JSON.stringify(error.rawError.errors || error.rawError).slice(0, 600) : String(error.message || error) });
  }
  let ok = 0;
  for (const cmd of commandsJSON) {
    try {
      await rest.post(Routes.applicationCommands(CLIENT_ID), { body: cmd });
      ok++;
    } catch (e) {
      console.error(`[Comandos] ❌ "/${cmd.name}" inválido e NÃO registrado:`, e?.rawError ? JSON.stringify(e.rawError.errors || e.rawError) : e.message);
      client.errosRegistro.push({ nome: cmd.name, msg: e?.rawError ? JSON.stringify(e.rawError.errors || e.rawError).slice(0, 600) : String(e.message) });
    }
  }
  console.log(`[Comandos] Registro individual: ${ok}/${commandsJSON.length} comandos registrados.`);
}

async function bootstrap() {
  await restaurarBackupAntesDeIniciar();

  const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildInvites,
  ]
});

emojiResolver.instalar(client); // conserta emojis personalizados quebrados (:coroa:)

client.commands = new Collection();
const commandsJSON = [];

// Permissões exigidas por comando. Elas NÃO vão mais pro Discord (senão ele esconde o comando de
// quem não tem a permissão — inclusive do dono do bot em servidores de terceiros). Em vez disso,
// o bot confere na hora de executar: passa quem tem a permissão OU é o dono do bot.
client.commandPerms = new Map();
function registrarComando(cmd) {
  const json = cmd.data.toJSON();
  if (json.default_member_permissions) {
    client.commandPerms.set(json.name, BigInt(json.default_member_permissions));
    json.default_member_permissions = null;
  }
  commandsJSON.push(json);
}

const commandsPath = path.join(__dirname, "commands");
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));
  for (const file of commandFiles) {
    const filePath     = path.join(commandsPath, file);
    const commandModule = require(filePath);
    if (Array.isArray(commandModule)) {
      for (const cmd of commandModule) {
        if (cmd.data && cmd.execute) {
          client.commands.set(cmd.data.name, cmd);
          registrarComando(cmd);
        }
      }
    } else if (commandModule.data && commandModule.execute) {
      client.commands.set(commandModule.data.name, commandModule);
      registrarComando(commandModule);
    }
  }
}

const buttonHandler  = require("./events/buttonHandler");
const messageHandler = require("./events/messageHandler");
const { iniciarScheduler } = require("./handlers/scheduler");
const { iniciarCarrinhoScheduler } = require("./handlers/carrinhoScheduler");
const { iniciarExpiracaoScheduler } = require("./handlers/expiracaoScheduler");
const { iniciarAlertScheduler } = require("./insights-system/alertScheduler");
const { iniciarAntiFraude } = require("./sales-system/antifraude");
const { iniciarPollerEfiBank } = require("./sales-system/efiBank");
const { iniciarVerificacaoAssinaturas } = require("./assinatura-system/assinaturaManager");
const { iniciarSorteioScheduler } = require("./handlers/sorteioScheduler");
const { Scheduler: ProtectionScheduler, RaidDetector: antiRaidDetector, MessageDetector: antiMessageDetector, ServerDetector: antiServerDetector } = require("./protectionSystem");
const { iniciarProtectionScheduler } = ProtectionScheduler;

client.once("ready", async () => {
  console.log("<:bot:1524207085850591273> Bot online: " + client.user.tag);
  client.user.setPresence({ status: "online", activities: [{ name: "KAEL", type: 0 }] });

  // Emojis do aplicativo: carrega antes de qualquer mensagem sair
  await emojiResolver.carregar(client);
  setTimeout(() => emojiResolver.relatorio(), 60 * 1000);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await sincronizarComandos(rest, commandsJSON);
    if (client.errosRegistro?.length) {   // avisa o dono por DM quando algum comando for recusado
      const txt = client.errosRegistro.map(e => `• /${e.nome}: ${e.msg}`).join('\n').slice(0, 1800);
      client.users.fetch(BOT_OWNER_ID).then(u => u.send(`⚠️ O Discord recusou comando(s) ao iniciar:\n${txt}`)).catch(() => {});
    }
  } catch (error) {
    console.error("Erro ao registrar os comandos na API:", error);
  }

  // Aviso: na Railway sem Volume o disco é apagado a cada atualização (licenças e vendas somem).
  if ((process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID) && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    const aviso = '⚠️ **Sem Volume na Railway**: o banco (licenças, vendas, configs) é apagado a cada atualização. ' +
      'No Railway: serviço → **Settings → Volumes → New Volume** com Mount Path `/data`. Depois disso os dados passam a ficar salvos.';
    console.warn('[Dados] ' + aviso.replace(/\*\*/g, ''));
    client.users.fetch(BOT_OWNER_ID).then(u => u.send(aviso)).catch(() => {});
  }

  // Servidor HTTP (webhooks de pagamento Mercado Pago/OpenPix + verificação web).
  // Antes essa função existia mas nunca era chamada.
  try { require('./sales-system/webhook').iniciarWebhook(client); }
  catch (e) { console.error('[Webhook] Falha ao iniciar o servidor HTTP:', e.message); }

  // Avisa em todos os servidores o que mudou (só quando há uma atualização NOVA em config/atualizacoes.js)
  setTimeout(() => {
    require('./utils/anunciarAtualizacao').anunciarAtualizacoes(client)
      .catch(e => console.error('[Atualização] Erro geral:', e.message));
  }, 20 * 1000);

  // Kael HUD — backup automático dos servidores que ligaram essa opção
  try { require('./backup-system/backupManager').iniciarBackupAutomatico(client); }
  catch (e) { console.error('[HUD] Falha ao iniciar o backup automático:', e.message); }

  // Inicia os sistemas automáticos (repostagem, limpeza, mensagens)
  iniciarScheduler(client);

  // KAEL INTELLIGENCE — recuperação automática de carrinhos abandonados
  iniciarCarrinhoScheduler(client);
  iniciarAlertScheduler(client);

  // KAEL — expiração automática de carrinhos (10 minutos, fixo).
  // Relê as transações pendentes do banco e recalcula o tempo restante de
  // cada uma — resistente a restart/deploy (não reinicia o cronômetro).
  iniciarExpiracaoScheduler(client);

  // Anti-Fraude: varredura periódica de reembolsos/chargebacks (Mercado Pago)
  iniciarAntiFraude(client);

  // Efi Bank: poller de confirmação de pagamentos PIX pendentes
  iniciarPollerEfiBank(client);

  // Assinaturas: verificação periódica de expiração (remove cargo vencido)
  iniciarVerificacaoAssinaturas(client);

  // Reagenda o encerramento de todos os sorteios ativos (resistente a restart)
  iniciarSorteioScheduler(client);

  // Reagenda a liberação automática de quarentenas pendentes (resistente a restart)
  iniciarProtectionScheduler(client);

  // KAEL Templates — se o bot caiu no meio de uma aplicação de template,
  // recupera o estado (sem duplicar recursos) e libera o servidor (resistente a restart)
  try {
    const { recuperar } = require('./template-system/core/recovery');
    await recuperar(client);
  } catch (e) {
    console.error('[KAEL Templates] Falha ao rodar a recuperação de operações pendentes:', e);
  }

  // Backup automático pro Discord — só começa depois que o bot está
  // totalmente pronto, garantindo que já dá pra buscar o canal configurado.
  iniciarBackupPeriodico(client);

  // KAEL — Sistema de Verificação: relocaliza os painéis publicados após restart
  // (não recria mensagens; painéis apagados ficam marcados como ausentes, sem perder dados).
  require('./verificacao-system/verificacaoManager').recuperarPaineis(client)
    .catch(e => console.error('[Verificacao] Erro na recuperação de painéis:', e));

  // KAEL INVITE SYSTEM - popula o cache de convites de cada guild uma
  // unica vez no boot, para nunca precisar re-buscar todos os convites
  // a cada entrada de membro.
  require('./invite-system/inviteTracker').primeAllGuilds(client)
    .catch(e => console.error('[InviteSystem] Erro ao inicializar cache de convites:', e));
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    const exigida = client.commandPerms.get(interaction.commandName);
    if (exigida && interaction.user.id !== BOT_OWNER_ID && !interaction.memberPermissions?.has(exigida)) {
      return interaction.reply({ content: "<:negativo:1528400986744295475> Você não tem permissão para usar este comando.", flags: 64 }).catch(() => {});
    }
    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error(`Erro ao executar /${interaction.commandName}:`, error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "<:negativo:1528400986744295475> Houve um erro interno ao executar este comando.", ephemeral: true });
      }
    }
    return;
  }

  if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
    try {
      await buttonHandler.execute(interaction, client);
    } catch (e) {
      console.error("Erro no buttonHandler:", e);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '<:negativo:1528400986744295475> Ocorreu um erro interno ao processar essa interação.', ephemeral: true });
        }
      } catch (_) {}
    }
  }
});

client.on("messageCreate", async (message) => {
  try {
    await messageHandler.execute(message, client);
  } catch (e) {
    console.error("Erro em messageCreate:", e);
  }
  try {
    await antiMessageDetector.handleMessageCreate(message);
  } catch (e) {
    console.error("Erro no Sistema de Proteção (messageCreate):", e);
  }
});

client.on("messageDelete", async (message) => {
  try {
    await antiMessageDetector.handleMessageDelete(message);
  } catch (e) {
    console.error("Erro no Sistema de Proteção (messageDelete):", e);
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    await antiRaidDetector.handleGuildMemberAdd(member);
  } catch (e) {
    console.error("Erro no Sistema de Proteção (guildMemberAdd):", e);
  }
  // BUGFIX (sistema de boas-vindas): o placeholder {convidadoPor} lê o
  // registro que o Invite System grava — por isso ele TEM que rodar antes
  // do Boas-Vindas, senão a mensagem de entrada nunca acha quem convidou.
  try {
    await require('./invite-system/inviteTracker').handleGuildMemberAdd(member);
  } catch (e) {
    console.error("Erro no KAEL Invite System (guildMemberAdd):", e);
  }
  try {
    await require('./commands/boasVindas').handleGuildMemberAdd(member);
  } catch (e) {
    console.error("Erro no Sistema de Boas-Vindas (guildMemberAdd):", e);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    await require('./commands/boasVindas').handleGuildMemberRemove(member);
  } catch (e) {
    console.error("Erro no Sistema de Boas-Vindas (guildMemberRemove):", e);
  }
  try {
    await require('./invite-system/inviteTracker').handleGuildMemberRemove(member);
  } catch (e) {
    console.error("Erro no KAEL Invite System (guildMemberRemove):", e);
  }
});

client.on("inviteCreate", (invite) => {
  try {
    require('./invite-system/inviteTracker').handleInviteCreate(invite);
  } catch (e) {
    console.error("Erro no KAEL Invite System (inviteCreate):", e);
  }
});

client.on("inviteDelete", (invite) => {
  try {
    require('./invite-system/inviteTracker').handleInviteDelete(invite);
  } catch (e) {
    console.error("Erro no KAEL Invite System (inviteDelete):", e);
  }
});

client.on("guildCreate", async (guild) => {
  try { require('./utils/anunciarAtualizacao').marcarServidorNovo(guild); } catch {}
  try {
    await require('./invite-system/inviteTracker').primeGuildCache(guild);
  } catch (e) {
    console.error("Erro no KAEL Invite System (guildCreate):", e);
  }
});

client.on("channelDelete", async (channel) => {
  try { await antiServerDetector.handleChannelDelete(channel); }
  catch (e) { console.error("Erro no Sistema de Proteção (channelDelete):", e); }
});
client.on("channelCreate", async (channel) => {
  try { await antiServerDetector.handleChannelCreate(channel); }
  catch (e) { console.error("Erro no Sistema de Proteção (channelCreate):", e); }
});
client.on("channelUpdate", async (oldChannel, newChannel) => {
  try { await antiServerDetector.handleChannelUpdate(oldChannel, newChannel); }
  catch (e) { console.error("Erro no Sistema de Proteção (channelUpdate):", e); }
});

client.on("roleDelete", async (role) => {
  try { await antiServerDetector.handleRoleDelete(role); }
  catch (e) { console.error("Erro no Sistema de Proteção (roleDelete):", e); }
});
client.on("roleCreate", async (role) => {
  try { await antiServerDetector.handleRoleCreate(role); }
  catch (e) { console.error("Erro no Sistema de Proteção (roleCreate):", e); }
});
client.on("roleUpdate", async (oldRole, newRole) => {
  try { await antiServerDetector.handleRoleUpdate(oldRole, newRole); }
  catch (e) { console.error("Erro no Sistema de Proteção (roleUpdate):", e); }
});

client.on("emojiDelete", async (emoji) => {
  try { await antiServerDetector.handleEmojiDelete(emoji); }
  catch (e) { console.error("Erro no Sistema de Proteção (emojiDelete):", e); }
});
client.on("emojiCreate", async (emoji) => {
  try { await antiServerDetector.handleEmojiCreate(emoji); }
  catch (e) { console.error("Erro no Sistema de Proteção (emojiCreate):", e); }
});
client.on("emojiUpdate", async (oldEmoji, newEmoji) => {
  try { await antiServerDetector.handleEmojiUpdate(oldEmoji, newEmoji); }
  catch (e) { console.error("Erro no Sistema de Proteção (emojiUpdate):", e); }
});

client.on("webhooksUpdate", async (channel) => {
  try { await antiServerDetector.handleWebhooksUpdate(channel); }
  catch (e) { console.error("Erro no Sistema de Proteção (webhooksUpdate):", e); }
});

client.login(TOKEN).catch(err => console.error("ERRO LOGIN:", err));
}

bootstrap().catch(err => {
  console.error('[Boot] Falha fatal ao iniciar o bot:', err);
  process.exit(1);
});
