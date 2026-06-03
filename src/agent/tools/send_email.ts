import type { Tool } from '../../types/index.js';
import { sendEmail, isValidEmail } from '../../channels/gmail-send.js';

export const sendEmailTool: Tool = {
  name: 'send_email',
  description: 'Send an email via Gmail on the user\'s behalf.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient email address' },
      subject: { type: 'string', description: 'Email subject line' },
      body: { type: 'string', description: 'Plain-text email body' },
      reply_to_message_id: {
        type: 'string',
        description: 'Gmail message ID to reply to (optional)',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  async execute(input) {
    const { to, subject, body, reply_to_message_id } = input as {
      to?: unknown;
      subject?: unknown;
      body?: unknown;
      reply_to_message_id?: unknown;
    };

    if (!to || typeof to !== 'string') return 'Error: to is required';
    if (!subject || typeof subject !== 'string') return 'Error: subject is required';
    if (!body || typeof body !== 'string') return 'Error: body is required';
    if (!isValidEmail(to)) return `Error: invalid email address "${to}"`;

    await sendEmail({
      to,
      subject,
      body,
      ...(typeof reply_to_message_id === 'string' ? { replyToMessageId: reply_to_message_id } : {}),
    });
    return `Email sent to ${to}`;
  },
};
