/**
 * Cross-component chat action dispatch.
 *
 * Allows ClientPanel ("Morning briefing") and FeedItem ("Why relevant?")
 * to trigger "open intelligence chat and send a message" without coupling
 * to IntelligencePanel internals.
 *
 * IntelligencePanel subscribes in a useEffect and processes actions.
 */

export interface ChatAction {
  message: string;
  isBriefing?: boolean;
}

type Listener = (action: ChatAction) => void;

const listeners = new Set<Listener>();

export function dispatchChatAction(action: ChatAction) {
  listeners.forEach((fn) => fn(action));
}

export function onChatAction(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
