export interface IAppConfig {
  copilotTokenEndpoint: string;
  entraTenantId: string;
  spfxClientId: string;
  copilotScope: string;
  sharePointChatPageUrl: string;
}

export const appConfig: IAppConfig = {
  copilotTokenEndpoint: process.env.COPILOT_TOKEN_ENDPOINT || '',
  entraTenantId: process.env.ENTRA_TENANT_ID || '',
  spfxClientId: process.env.SPFX_CLIENT_ID || '',
  copilotScope: process.env.COPILOT_SCOPE || '',
  sharePointChatPageUrl: process.env.SHAREPOINT_CHAT_PAGE_URL || ''
};