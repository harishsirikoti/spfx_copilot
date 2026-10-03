import { appConfig } from '../config/AppConfig';
import { CopilotService } from './CopilotService';

export const CONVERSATION_SESSION_KEY = 'spfx-chatbot:conversation-session';

interface IStoredSession {
  version: 1;
  accountBinding: string;
  agentBinding: string;
  conversationId: string;
  token: string;
  expiresAt: number;
  userID: string;
}

export interface IConversationConnection {
  conversationId: string;
  token: string;
  streamUrl: string;
  domain: string;
  userID: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Owns browser-session continuity, not OAuth or SharePoint SSO. */
export class ConversationSessionService {
  private domain = '';
  private agentBinding = '';
  private session: IStoredSession | undefined;
  private storage: Storage | undefined;
  private disposed = false;
  private busy = false;
  private replacementAttempted = false;
  private refreshAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly requests = new Set<AbortController>();
  private onConnection: ((connection: IConversationConnection, replacement: boolean) => void) | undefined;
  private onFailure: (() => void) | undefined;

  public constructor(private readonly accountBinding: string) {
    try {
      if (accountBinding) this.storage = window.sessionStorage;
    } catch {
      console.warn('Conversation continuity: session storage unavailable; using memory only.');
    }
  }

  public async initialize(): Promise<IConversationConnection> {
    const regionalUrl = await CopilotService.getDirectLineUrl();
    this.ensureActive();
    const base = new URL(regionalUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
      throw new Error('Invalid regional Direct Line URL.');
    }
    this.domain = `${base.href.replace(/\/+$/, '')}/v3/directline`;
    this.agentBinding = JSON.stringify([appConfig.copilotTokenEndpoint, this.domain]);
    this.session = this.readSession();

    if (this.session) {
      console.info('Conversation continuity: resuming existing conversation.');
      try {
        return await this.refreshAndReconnect();
      } catch {
        this.ensureActive();
        this.clearSession();
        console.warn('Conversation continuity: stored session invalid; starting fresh.');
      }
    }
    // One fresh attempt only. Failure propagates to the existing connection-error UI.
    return this.startFresh();
  }

  public startMonitoring(
    onConnection: (connection: IConversationConnection, replacement: boolean) => void,
    onFailure: () => void
  ): void {
    this.onConnection = onConnection;
    this.onFailure = onFailure;
    window.addEventListener('focus', this.onWake);
    document.addEventListener('visibilitychange', this.onWake);
    this.scheduleRefresh();
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    window.removeEventListener('focus', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
    this.requests.forEach(request => request.abort());
    this.requests.clear();
    this.onConnection = undefined;
    this.onFailure = undefined;
    // Retain the saved session for the next page initialization.
  }

  private readonly onWake = (): void => {
    if (document.visibilityState !== 'hidden' && Date.now() >= this.refreshAt) {
      this.runRefresh().catch(() => this.failMonitoring());
    }
  };

  private ensureActive(): void {
    if (this.disposed) throw new Error('Conversation session disposed.');
  }

  private readSession(): IStoredSession | undefined {
    try {
      const raw = this.storage?.getItem(CONVERSATION_SESSION_KEY);
      if (!raw) return undefined;
      const value: unknown = JSON.parse(raw);
      if (isRecord(value) && value.version === 1 &&
        value.accountBinding === this.accountBinding && value.agentBinding === this.agentBinding &&
        hasText(value.conversationId) && hasText(value.token) && hasText(value.userID) &&
        typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) &&
        value.expiresAt > Date.now()) {
        return {
          version: 1, accountBinding: this.accountBinding, agentBinding: this.agentBinding,
          conversationId: value.conversationId, token: value.token,
          expiresAt: value.expiresAt, userID: value.userID
        };
      }
    } catch {
      // Corrupt JSON or unavailable storage must never break manual chat.
    }
    // Expired Direct Line tokens cannot be refreshed, even with a saved conversation ID.
    this.clearSession();
    console.warn('Conversation continuity: stored session invalid; starting fresh.');
    return undefined;
  }

  private saveSession(): void {
    this.ensureActive();
    if (!this.session) return;
    try {
      // Persist only reconnect state. streamUrl contains credentials and is short-lived.
      this.storage?.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(this.session));
    } catch {
      try { this.storage?.removeItem(CONVERSATION_SESSION_KEY); } catch { /* Storage is blocked. */ }
      this.storage = undefined;
      console.warn('Conversation continuity: session storage unavailable; using memory only.');
    }
  }

  private clearSession(): void {
    this.session = undefined;
    try { this.storage?.removeItem(CONVERSATION_SESSION_KEY); } catch {
      this.storage = undefined;
    }
  }

  private async request(path: string, token: string, method: 'GET' | 'POST', userID?: string): Promise<Record<string, unknown>> {
    this.ensureActive();
    const controller = new AbortController();
    this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${this.domain}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: userID ? JSON.stringify({ user: { id: userID } }) : undefined,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error'
      });
      this.ensureActive();
      if (!response.ok) {
        console.warn(`Conversation continuity: Direct Line request failed (HTTP ${response.status}).`);
        throw new Error('Direct Line request failed.');
      }
      const data: unknown = await response.json();
      this.ensureActive();
      if (!isRecord(data)) throw new Error('Invalid Direct Line response.');
      return data;
    } finally {
      clearTimeout(timeout);
      this.requests.delete(controller);
    }
  }

  private expiresAt(data: Record<string, unknown>, requestedAt: number): number {
    const lifetime = data.expires_in;
    if (typeof lifetime !== 'number' || !Number.isFinite(lifetime) || lifetime <= 0) {
      throw new Error('Missing or invalid Direct Line token expiry.');
    }
    const expiry = requestedAt + lifetime * 1000;
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Direct Line token expired.');
    return expiry;
  }

  private connection(data: Record<string, unknown>, expectedId: string, userID: string): IConversationConnection {
    if (data.conversationId !== expectedId || !hasText(data.token) || !hasText(data.streamUrl)) {
      throw new Error('Invalid Direct Line connection response.');
    }
    const stream = new URL(data.streamUrl);
    if (stream.protocol !== 'wss:' && stream.protocol !== 'https:') {
      throw new Error('Invalid Direct Line stream protocol.');
    }
    return { conversationId: expectedId, token: data.token, streamUrl: data.streamUrl, domain: this.domain, userID };
  }

  private setRefreshTime(): void {
    if (this.session) {
      const remaining = this.session.expiresAt - Date.now();
      this.refreshAt = this.session.expiresAt - Math.min(60000, remaining / 5);
    }
  }

  private async startFresh(): Promise<IConversationConnection> {
    console.info('Conversation continuity: starting new conversation.');
    const info = await CopilotService.getConversationToken();
    this.ensureActive();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    const userID = `dl_${Array.from(bytes, byte => (`0${byte.toString(16)}`).slice(-2)).join('')}`;
    const requestedAt = Date.now();
    const data = await this.request('/conversations', info.token, 'POST', userID);
    if (!hasText(data.conversationId)) throw new Error('Missing Direct Line conversation ID.');
    const connection = this.connection(data, data.conversationId, userID);
    this.session = {
      version: 1, accountBinding: this.accountBinding, agentBinding: this.agentBinding,
      conversationId: connection.conversationId, token: connection.token,
      expiresAt: this.expiresAt(data, requestedAt), userID
    };
    this.saveSession();
    this.setRefreshTime();
    return connection;
  }

  private async refreshAndReconnect(): Promise<IConversationConnection> {
    const session = this.session;
    if (!session || session.expiresAt <= Date.now()) {
      throw new Error('Stored Direct Line token expired.');
    }
    const requestedAt = Date.now();
    const refreshed = await this.request('/tokens/refresh', session.token, 'POST');
    if (refreshed.conversationId !== session.conversationId || !hasText(refreshed.token)) {
      throw new Error('Invalid Direct Line refresh response.');
    }
    session.token = refreshed.token;
    session.expiresAt = this.expiresAt(refreshed, requestedAt);
    this.saveSession();
    console.info('Conversation continuity: Direct Line token refreshed.');

    const data = await this.request(`/conversations/${encodeURIComponent(session.conversationId)}`, session.token, 'GET');
    const connection = this.connection(data, session.conversationId, session.userID);
    session.token = connection.token;
    // Reconnect does not promise expires_in. Keep the preceding refresh's conservative
    // expiry rather than assuming that reconnect grants a new token lifetime.
    if (data.expires_in !== undefined) {
      session.expiresAt = Math.min(session.expiresAt, this.expiresAt(data, requestedAt));
    }
    if (session.expiresAt <= Date.now()) throw new Error('Direct Line token expired during reconnect.');
    this.saveSession();
    this.setRefreshTime();
    console.info('Conversation continuity: reconnect succeeded.');
    return connection;
  }

  private scheduleRefresh(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.disposed || !this.session) return;
    this.timer = setTimeout(() => {
      this.runRefresh().catch(() => this.failMonitoring());
    }, Math.min(2147483647, Math.max(0, this.refreshAt - Date.now())));
  }

  private async runRefresh(): Promise<void> {
    if (this.disposed || this.busy || !this.session) return;
    this.busy = true;
    try {
      let connection: IConversationConnection;
      let replacement = false;
      try {
        connection = await this.refreshAndReconnect();
      } catch {
        this.ensureActive();
        this.clearSession();
        // Never loop on failed credentials: at most one automatic replacement per mount.
        if (this.replacementAttempted) throw new Error('Conversation recovery failed.');
        this.replacementAttempted = true;
        console.warn('Conversation continuity: stored session invalid; starting fresh.');
        connection = await this.startFresh();
        replacement = true;
      }
      this.ensureActive();
      this.onConnection?.(connection, replacement);
      this.scheduleRefresh();
    } finally {
      this.busy = false;
    }
  }

  private failMonitoring(): void {
    if (this.disposed) return;
    this.clearSession();
    if (this.timer !== undefined) clearTimeout(this.timer);
    console.error('Conversation continuity: unable to reconnect or start a fresh conversation.');
    this.onFailure?.();
  }
}
