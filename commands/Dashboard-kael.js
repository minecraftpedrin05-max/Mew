/**
 * KAEL — /dashboard-kael
 * Envia um card com o botão que abre o dashboard web.
 */
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://mew-production-07c9.up.railway.app/dashboard';
const BANNER = path.join(__dirname, '..', 'assets', 'kael-banner.png');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard-kael')
    .setDescription('Abre o dashboard web do Kael'),

  async execute(interaction) {
    const files = [];
    const container = {
      type: 17,
      accent_color: 10070709,
      components: [],
    };

    if (fs.existsSync(BANNER)) {
      files.push(new AttachmentBuilder(BANNER, { name: 'kael-banner.png' }));
      container.components.push(
        { type: 12, items: [{ media: { url: 'https://i.imgur.com/Xetp4KE.png' } }] },
        { type: 14, divider: true, spacing: 1 },
      );
    }

    container.components.push(
      { type: 10, content: '## DASHBOARD KAEL' },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: 'Entre em nosso dashboard para conseguir mais acesso sobre o bot' },
    );

    return interaction.reply({
      flags: (1 << 15) | 64, // IS_COMPONENTS_V2
      files,
      components: [
        container,
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: 'Dashboard', url: DASHBOARD_URL },
          ],
        },
      ],
    });
  },
};
