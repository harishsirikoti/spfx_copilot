# SPFx Copilot Studio Chatbot

## 1. Project Overview

This project embeds an existing Microsoft Copilot Studio Enterprise Assist agent in a SharePoint page:

```text
SharePoint page
  → SPFx React web part
  → Bot Framework Web Chat
  → Copilot Studio Token Endpoint
  → Regional Direct Line
  → Enterprise Assist agent
```

The current authentication model is Copilot Studio''s working manual OAuth flow. When the agent requests authentication, Web Chat shows the normal Login card and validation-code experience.

The application also supports Direct Line conversation continuity. It stores the minimum reconnect state in `sessionStorage) so a still-valid conversation can be resumed in the same browser session, reducing repeated authentication prompts. This is not SharePoint SSO.

## 2. Final Technology Stack

Versions used by this project:

- Node.js: `>=22.14.0 <23.0.0` (development was run with Node 22.23.3)
- npm: 10.9.9 in the development environment
- SPFx: 1.23.2
- React: 17.0.1
- Bot Framework Web Chat: 4.19.1
- TypeScript: approximately 5.8.x
- Heft: 1.2.17
- dotenv: 18.0.5

## 3. Prerequisites

You need:

- Node.js 22.x and npm
- SharePoint Framework tooling and Yeoman if creating a new project
- A SharePoint Online tenant with App Catalog access
- An existing published Copilot Studio agent
- The Copilot Studio Token Endpoint and regional Direct Line discovery enabled
- The configured Entra authentication application, exposed scope, federated credential, and approved SharePoint API permission

The existing tenant and agent configuration are prerequisites; this repository does not create or modify them.

## 4. Architecture

```text
SharePoint page
  → EnterpriseAssistChatWebPart
  → EnterpriseAssistChat
  → ConversationSessionService
      ↘ CopilotService
          ↘ Copilot Studio Token Endpoint
          ↘ regional Direct Line discovery
  → Direct Line conversation
  → Bot Framework Web Chat
  → Enterprise Assist agent
```

## 5. Copilot Studio / Entra prerequisites

Configure these items outside the repository:

- A published Copilot Studio agent.
- A Copilot Studio Token Endpoint.
- An authentication app registration exposing `copilot.studio.scope`.
- The required Entra authentication and federated credential configuration.
- The `EnterpriseAssistAuth / copilot.studio.scope` SharePoint API permission approved in SharePoint Admin Center.

Use placeholders such as `<TENANT_ID>`, `<AUTH_APP_CLIENT_ID>`, and `<TOKEN_ENDPOINT>` in documentation and deployment notes. Do not commit real tenant values.

## 6. Environment Configuration

Create a local `.env) file from `.env.example):

```env
COPILOT_TOKEN_ENDPOINT=<TOKEN_ENDPOINT>
ENTRA_TENANT_ID=<TENANT_ID>
SPFX_CLIENT_ID=<CLIENT_ID>
COPILOT_SCOPE=api://<AUTH_APP_CLIENT_ID>/copilot.studio.scope
SHAREPOINT_CHAT_PAGE_URL=<SHAREPOINT_CHAT_PAGE_URL>
```

These values are injected into the browser bundle as configuration. They are not secrets. The `.env) file is ignored by Git.

Never place client secrets, Direct Line secrets, passwords, private keys, or other long-lived credentials in `.env) or browser code.

## 7. Local Development

```powershell
npm install
npm run start
```

The development server uses HTTPS on port 4321. The tenant-specific `initialPage) was removed from `config/serve.json); open the SharePoint hosted workbench or target page manually while the server is running.

Local workbench testing must use the same SharePoint tenant configuration as the deployed web part. Verify the deployed page for final behavior.

## 8. Production Build

```powershell
npm run build
```

The build runs TypeScript, linting, tests, and package generation. The solution package is generated at:

```text
sharepoint/solution/spfx-chatbot.sppkg
```

## 9. Versioning

Before uploading a newer package to the App Catalog, increment the solution version in `config/package-solution.json), for example:

```text
1.0.0.0 → 1.0.0.1
```

A patch increment is sufficient for ordinary releases; major versions are not required for every change.

## 10. Deployment

1. Run `npm run build`.
2. Upload or replace `sharepoint/solution/spfx-chatbot.sppkg) in the App Catalog.
3. Enable and deploy the package.
4. Approve the requested API permission if it is new or pending.
5. Add the app to the target site when required.
6. Add the Enterprise Assist Chat web part to the page.
7. Publish the page.
8. Hard refresh after a package update.

## 11. Authentication Behavior

On a new conversation, the application obtains a Copilot conversation token, discovers the regional Direct Line URL, starts a Direct Line conversation, and renders Web Chat. Copilot Studio''s normal manual OAuth Login and validation-code flow remains available.

For continuity, `ConversationSessionService) stores this namespaced record in `sessionStorage):

- schema version
- SharePoint account binding
- token-endpoint/regional-agent binding
- conversation ID
- Direct Line bearer token
- token expiry timestamp
- stable Web Chat user ID

The short-lived `streamUrl) is not stored; reconnect obtains a fresh one. On reload, a valid session is refreshed and the same conversation is reconnected. If the session is missing, expired, invalid, or rejected, it is cleared and one fresh conversation is started. Manual Login may then be required again.

This continuity mechanism reduces repeated authentication during the supported browser/session lifetime. It is not full SharePoint SSO.

## 12. Security Notes

- A Direct Line token is a bearer credential.
- `sessionStorage) is used intentionally instead of `localStorage) so state is scoped to the browser tab/session lifetime; it still remains exposed to scripts running in that page.
- Tokens, authorization headers, stream URLs, secrets, and raw credential-bearing responses must never be logged.
- Browser-side environment values are configuration, not secrets.
- No client secret or Direct Line secret belongs in SPFx code.
- Entra access tokens are not persisted by this implementation.

## 13. Project Structure

```text
src/
  config/
    AppConfig.ts                 Environment-backed configuration
  services/
    CopilotService.ts            Copilot token and regional Direct Line APIs
    ConversationSessionService.ts
                                 Direct Line start, reconnect, refresh, and fallback
    ConversationSessionService.test.ts
                                 Continuity and security regression tests
  webparts/
    enterpriseAssistChat/
      EnterpriseAssistChatWebPart.ts
                                 SPFx host and SharePoint account binding
      components/
        EnterpriseAssistChat.tsx
                                 Web Chat lifecycle and UI orchestration
        IEnterpriseAssistChatProps.ts
                                 Component contract
```

## 14. Troubleshooting

- A regional Direct Line 404 usually means the application is using the wrong regional URL. Keep regional discovery enabled and do not replace it with the global Direct Line URL.
- The Copilot Studio Token Endpoint is different from the Bot Framework OAuth redirect URL. Configure and troubleshoot them separately.
- Manual OAuth validation-code behavior is expected when a new or invalid conversation requires authentication.
- After an App Catalog upgrade, hard refresh the SharePoint page and confirm the deployed solution version changed.
- `npm run build) may encounter an EPERM cleanup error when Jest coverage files are locked by another process. Close file watchers or editors using the output and rerun the same build command.
- Local HTTPS/workbench behavior can differ from the deployed SharePoint package. Verify authentication and agent actions on the published page.

## 15. Final Verified Flow

```text
SharePoint page
  → chatbot loads
  → user sends a message
  → Copilot Studio responds
  → manual authentication is requested when needed
  → user completes Login and validation code
  → authenticated agent action runs
  → ticket or incident workflow completes
```

Conversation continuity can resume the same authenticated Direct Line conversation while its stored session and token remain valid. Runtime authentication persistence must be verified in the target SharePoint and Copilot Studio tenant.



