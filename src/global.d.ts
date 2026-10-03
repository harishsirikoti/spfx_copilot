declare namespace NodeJS {
  interface ProcessEnv {
    COPILOT_TOKEN_ENDPOINT: string;
    ENTRA_TENANT_ID: string;
    SPFX_CLIENT_ID: string;
    COPILOT_SCOPE: string;
    SHAREPOINT_CHAT_PAGE_URL: string;
  }
}