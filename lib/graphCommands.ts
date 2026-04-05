/**
 * Lightweight pub/sub for graph commands dispatched from chat.
 * PulseContent subscribes; IntelligencePanel (chat) dispatches.
 */

export type GraphCommand =
  | { type: 'select_entity'; entityId: string }
  | { type: 'search'; query: string }
  | { type: 'reset' }
  | { type: 'focus_mode'; enabled: boolean };

type Listener = (cmd: GraphCommand) => void;
const listeners = new Set<Listener>();

export function dispatchGraphCommand(cmd: GraphCommand) {
  listeners.forEach((fn) => fn(cmd));
}

export function subscribeToGraphCommands(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
