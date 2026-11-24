export class TelegramNotifier {
  private botToken = '';
  private chatId = '';

  constructor(botToken = '', chatId = '') {
    this.botToken = botToken.trim();
    this.chatId = chatId.trim();
  }

  updateCredentials(botToken: string, chatId: string): void {
    this.botToken = botToken.trim();
    this.chatId = chatId.trim();
  }

  isEnabled(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  async sendAlert(title: string, lines: string[]): Promise<void> {
    if (!this.isEnabled()) return;
    const text = `<b>${escapeHtml(title)}</b>\n${lines.map(escapeHtml).join('\n')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
          signal: controller.signal,
        },
      );
    } catch {
      // Non-blocking alert failure must never crash trading loop
    } finally {
      clearTimeout(timer);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
