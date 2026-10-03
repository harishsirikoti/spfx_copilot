import { appConfig } from '../config/AppConfig';
import { CopilotService } from './CopilotService';
import { CONVERSATION_SESSION_KEY, ConversationSessionService } from './ConversationSessionService';

const domain = 'https://regional.example.test/v3/directline';
const account = 'test-account';
const conversationId = 'saved-conversation';
const streamUrl = 'wss://regional.example.test/stream?credential=test-only';

function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function savedSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1, accountBinding: account,
    agentBinding: JSON.stringify([appConfig.copilotTokenEndpoint, domain]),
    conversationId, token: 'saved-test-token', expiresAt: Date.now() + 1800000,
    userID: 'dl_saved-user', ...overrides
  };
}

describe('ConversationSessionService', () => {
  let service: ConversationSessionService;
  let fetchMock: jest.MockedFunction<typeof fetch>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    window.sessionStorage.clear();
    originalFetch = window.fetch;
    fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    window.fetch = fetchMock;
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(CopilotService, 'getDirectLineUrl').mockResolvedValue('https://regional.example.test/');
    jest.spyOn(CopilotService, 'getConversationToken').mockResolvedValue({ token: 'copilot-test-token' });
    service = new ConversationSessionService(account);
  });

  afterEach(() => {
    service.dispose();
    window.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
    window.sessionStorage.clear();
  });

  function queueStart(): void {
    fetchMock.mockResolvedValueOnce(response({
      conversationId: 'new-conversation', token: 'started-test-token', expires_in: 1800, streamUrl
    }, 201));
  }

  function queueResume(): void {
    fetchMock.mockResolvedValueOnce(response({ conversationId, token: 'refreshed-test-token', expires_in: 1800 }));
    fetchMock.mockResolvedValueOnce(response({ conversationId, token: 'reconnected-test-token', streamUrl }));
  }

  it('starts through the regional endpoint and persists only the allowed state', async () => {
    queueStart();
    const connection = await service.initialize();
    expect(fetchMock).toHaveBeenCalledWith(`${domain}/conversations`, expect.objectContaining({ method: 'POST' }));
    const stored = JSON.parse(window.sessionStorage.getItem(CONVERSATION_SESSION_KEY) || '{}');
    expect(Object.keys(stored).sort()).toEqual([
      'accountBinding', 'agentBinding', 'conversationId', 'expiresAt', 'token', 'userID', 'version'
    ]);
    expect(stored.userID).toBe(connection.userID);
    expect(connection.userID).toMatch(/^dl_[0-9a-f]{32}$/);
    expect(stored.token).toBe('started-test-token');
    expect(stored.expiresAt).toBe(Date.now() + 1800000);
    expect(window.sessionStorage.getItem(CONVERSATION_SESSION_KEY)).not.toContain(streamUrl);
  });

  it('refreshes and reconnects the same conversation and user on reload', async () => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(savedSession()));
    queueResume();
    const connection = await service.initialize();
    expect(CopilotService.getConversationToken).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe(`${domain}/tokens/refresh`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${domain}/conversations/${conversationId}`);
    expect(connection).toEqual({ conversationId, token: 'reconnected-test-token', streamUrl, domain, userID: 'dl_saved-user' });
    expect(JSON.parse(window.sessionStorage.getItem(CONVERSATION_SESSION_KEY) || '{}').token).toBe('reconnected-test-token');
  });

  it.each([
    { version: 2 }, { accountBinding: 'another-account' }, { agentBinding: 'another-agent' },
    { token: '' }, { expiresAt: 0 }, { userID: null }
  ])('discards invalid stored state without refreshing it: %j', async overrides => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(savedSession(overrides)));
    queueStart();
    await service.initialize();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${domain}/conversations`);
  });

  it('discards corrupt JSON and starts fresh', async () => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, '{invalid');
    queueStart();
    expect((await service.initialize()).conversationId).toBe('new-conversation');
  });

  it.each([401, 403, 404, 500])('falls back once when token refresh returns HTTP %i', async status => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(savedSession()));
    fetchMock.mockResolvedValueOnce(response({}, status));
    queueStart();
    expect((await service.initialize()).conversationId).toBe('new-conversation');
    expect(CopilotService.getConversationToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back once when reconnect returns invalid data', async () => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(savedSession()));
    fetchMock.mockResolvedValueOnce(response({ conversationId, token: 'refreshed-test-token', expires_in: 1800 }));
    fetchMock.mockResolvedValueOnce(response({ conversationId: 'wrong-conversation', token: 'invalid-test-token', streamUrl }));
    queueStart();
    expect((await service.initialize()).conversationId).toBe('new-conversation');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not loop if the single fresh attempt also fails', async () => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(savedSession()));
    fetchMock.mockResolvedValueOnce(response({}, 403));
    fetchMock.mockResolvedValueOnce(response({}, 503));
    await expect(service.initialize()).rejects.toThrow('Direct Line request failed.');
    expect(CopilotService.getConversationToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.sessionStorage.getItem(CONVERSATION_SESSION_KEY)).toBeNull();
  });

  it('refreshes before expiry, persists new credentials, and stops timers on disposal', async () => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(savedSession()));
    queueResume();
    await service.initialize();
    const onConnection = jest.fn();
    const onFailure = jest.fn();
    service.startMonitoring(onConnection, onFailure);
    queueResume();
    await jest.advanceTimersByTimeAsync(1740000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(onConnection).toHaveBeenCalledWith(expect.objectContaining({ conversationId, userID: 'dl_saved-user' }), false);
    expect(onFailure).not.toHaveBeenCalled();
    service.dispose();
    await jest.advanceTimersByTimeAsync(3600000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(window.sessionStorage.getItem(CONVERSATION_SESSION_KEY)).not.toBeNull();
  });

  it('falls back in memory when sessionStorage is unavailable', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    queueStart();
    expect((await service.initialize()).conversationId).toBe('new-conversation');
  });

  it('starts fresh without refreshing an expired token after the page wakes', async () => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(savedSession()));
    queueResume();
    await service.initialize();
    const onConnection = jest.fn();
    service.startMonitoring(onConnection, jest.fn());
    jest.setSystemTime(Date.now() + 1800001);
    queueStart();
    window.dispatchEvent(new Event('focus'));
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe(`${domain}/conversations`);
    expect(onConnection).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'new-conversation' }), true);
  });

  it('stops after a failed live recovery instead of repeatedly starting conversations', async () => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(savedSession()));
    queueResume();
    await service.initialize();
    const onFailure = jest.fn();
    service.startMonitoring(jest.fn(), onFailure);
    fetchMock.mockResolvedValueOnce(response({}, 403));
    fetchMock.mockResolvedValueOnce(response({}, 503));
    await jest.advanceTimersByTimeAsync(1740000);
    expect(onFailure).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3600000);
    window.dispatchEvent(new Event('focus'));
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(CopilotService.getConversationToken).toHaveBeenCalledTimes(1);
  });

  it('never prints credentials or raw transport errors', async () => {
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(savedSession()));
    fetchMock.mockRejectedValueOnce(new Error(`saved-test-token ${streamUrl}`));
    queueStart();
    await service.initialize();
    const output = JSON.stringify([
      (console.info as jest.Mock).mock.calls,
      (console.warn as jest.Mock).mock.calls,
      (console.error as jest.Mock).mock.calls
    ]);
    for (const sensitive of ['saved-test-token', 'started-test-token', 'copilot-test-token', streamUrl, 'Authorization']) {
      expect(output).not.toContain(sensitive);
    }
  });
});
