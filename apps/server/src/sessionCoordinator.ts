import type { ImageMessage, Session, TurnEvent } from '@roleplay/shared';
import { attachPicture } from './engine/world';
import { AppError } from './errors';
import type { SessionStore } from './store/sessionStore';

/**
 * Coordinates per-session exclusive turn locks, ordered background disk writes,
 * and live SSE image settlement so routes share one concurrency discipline.
 */
export class SessionCoordinator {
  private readonly running = new Set<string>();
  private readonly activeTurns = new Map<string, { session: Session; emit: (event: TurnEvent) => void }>();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private readonly sessions: SessionStore;

  constructor(sessions: SessionStore) {
    this.sessions = sessions;
  }

  claim(id: string): void {
    if (this.running.has(id)) {
      throw new AppError('turn_in_progress', 'A turn is being generated for this session.');
    }
    this.running.add(id);
  }

  release(id: string): void {
    this.running.delete(id);
  }

  waitPending(id: string): Promise<void> {
    return this.writeQueues.get(id) ?? Promise.resolve();
  }

  enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeQueues.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.then(
      () => {},
      () => {},
    );
    this.writeQueues.set(id, settled);
    settled.finally(() => {
      if (this.writeQueues.get(id) === settled) this.writeQueues.delete(id);
    });
    return next;
  }

  setActiveTurn(id: string, session: Session, emit: (event: TurnEvent) => void): void {
    this.activeTurns.set(id, { session, emit });
  }

  clearActiveTurn(id: string): void {
    this.activeTurns.delete(id);
  }

  getActiveTurn(id: string): { session: Session; emit: (event: TurnEvent) => void } | undefined {
    return this.activeTurns.get(id);
  }

  applySettledPicture(sessionId: string, settled: ImageMessage): Promise<void> {
    return this.enqueue(sessionId, async () => {
      const attachTo = (target: Session): boolean => {
        const idx = target.messages.findIndex((m) => m.id === settled.id && m.kind === 'image');
        if (idx < 0) return false;
        target.messages[idx] = settled;
        if (settled.status === 'ready' && settled.url) {
          attachPicture(target.world, settled.subject, settled.targetId, settled.url);
          for (const snap of target.snapshots ?? []) {
            if (snap.turn >= settled.turn) {
              attachPicture(snap.world, settled.subject, settled.targetId, settled.url);
            }
          }
        }
        return true;
      };

      const active = this.activeTurns.get(sessionId);
      if (active) {
        if (attachTo(active.session)) {
          active.emit({ type: 'message', message: settled });
          if (settled.status === 'ready') {
            active.emit({ type: 'world', world: active.session.world });
          }
        }
        return;
      }

      const latest = await this.sessions.get(sessionId);
      if (!latest || !attachTo(latest)) return;
      await this.sessions.save(latest);
    });
  }
}
