/**
 * Input validation for chat messages and conversations.
 */

const MAX_MESSAGE_LENGTH = 5000;
const MAX_MESSAGES_PER_CONVERSATION = 100;

export function validateChatMessage(message: string): {
  valid: boolean;
  error?: string;
} {
  if (!message || message.trim().length === 0) {
    return { valid: false, error: 'Message cannot be empty' };
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` };
  }

  return { valid: true };
}

export function validateConversationLength(messageCount: number): {
  valid: boolean;
  error?: string;
} {
  if (messageCount >= MAX_MESSAGES_PER_CONVERSATION) {
    return {
      valid: false,
      error: 'Conversation too long. Start a new conversation.',
    };
  }

  return { valid: true };
}
