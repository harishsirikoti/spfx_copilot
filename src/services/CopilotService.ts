import { appConfig } from '../config/AppConfig';

export interface ICopilotConversationInfo {
  token: string;
  expires_in?: number;
  conversationId?: string;
}

export interface IRegionalChannelSettings {
  channelUrlsById: {
    directline: string;
  };
}

export class CopilotService {
  /**
   * Retrieves a short-lived conversation token from the
   * Copilot Studio agent Token Endpoint.
   *
   * This token is safe for browser use because it is short-lived.
   * We never expose a Direct Line secret in the SPFx bundle.
   */
  public static async getConversationToken(): Promise<ICopilotConversationInfo> {
    const response = await fetch(appConfig.copilotTokenEndpoint);

    if (!response.ok) {
      throw new Error(
        `Failed to retrieve Copilot conversation token. HTTP ${response.status}`
      );
    }

    const conversationInfo =
      (await response.json()) as ICopilotConversationInfo;

    if (!conversationInfo.token) {
      throw new Error(
        'Copilot Studio Token Endpoint did not return a conversation token.'
      );
    }

    return conversationInfo;
  }

  /**
   * Retrieves the regional Direct Line service URL.
   *
   * Copilot Studio can use a regional Direct Line endpoint,
   * so we should not hardcode https://directline.botframework.com.
   */
  public static async getDirectLineUrl(): Promise<string> {
  const tokenEndpoint = appConfig.copilotTokenEndpoint;

  const powervaIndex = tokenEndpoint.indexOf('/powervirtualagents');
  const apiVersionIndex = tokenEndpoint.indexOf('api-version=');

  if (powervaIndex === -1 || apiVersionIndex === -1) {
    throw new Error(
      'Invalid Copilot Studio Token Endpoint format. Unable to derive regional Direct Line URL.'
    );
  }

  const environmentEndpoint = tokenEndpoint.slice(0, powervaIndex);

  const apiVersion = tokenEndpoint
    .slice(apiVersionIndex)
    .split('=')[1]
    .split('&')[0];

  const regionalChannelSettingsUrl =
    `${environmentEndpoint}/powervirtualagents/regionalchannelsettings?api-version=${apiVersion}`;

  const response = await fetch(regionalChannelSettingsUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to retrieve Direct Line regional URL. HTTP ${response.status}`
    );
  }

  const settings =
    (await response.json()) as IRegionalChannelSettings;

  const directLineUrl = settings.channelUrlsById?.directline;

  if (!directLineUrl) {
    throw new Error(
      'Copilot Studio did not return a Direct Line regional URL.'
    );
  }

  return directLineUrl;
}
}