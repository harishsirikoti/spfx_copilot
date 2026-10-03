import * as React from "react";

import {
  createDirectLine,
  ReactWebChat,
} from "botframework-webchat";

import { ConversationSessionService } from "../../../services/ConversationSessionService";
import { IEnterpriseAssistChatProps } from "./IEnterpriseAssistChatProps";
const EnterpriseAssistChat = ({ accountBinding }: IEnterpriseAssistChatProps): React.ReactElement => {

  const [directLine, setDirectLine] =
    React.useState<ReturnType<typeof createDirectLine>>();

  const [loading, setLoading] = React.useState<boolean>(true);

  const [error, setError] = React.useState<string>();
  const [userID, setUserID] = React.useState<string>();

  React.useEffect(() => {
    const sessions = new ConversationSessionService(accountBinding);
    let disposed = false;
    let connection: ReturnType<typeof createDirectLine> | undefined;
    const fail = (): void => {
      if (disposed) return;
      connection?.end();
      console.error("Unable to initialize Copilot chat.");
      setError("Unable to initialize Copilot chat.");
      setLoading(false);
    };
    const initializeChat = async (): Promise<void> => {
      try {
        setLoading(true);
        setError(undefined);

        const credentials = await sessions.initialize();
        if (disposed) return;
        connection = createDirectLine(credentials);
        setDirectLine(connection);
        setUserID(credentials.userID);
        sessions.startMonitoring((updated, replacement) => {
          if (disposed) return;
          if (replacement) {
            connection?.end();
            connection = createDirectLine(updated);
            setDirectLine(connection);
            setUserID(updated.userID);
          } else {
            connection?.reconnect(updated);
          }
        }, fail);
      } catch {
        // Raw transport errors can contain bearer credentials; log only safe diagnostics.
        fail();
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    initializeChat().catch(fail);
    return () => {
      disposed = true;
      sessions.dispose();
      connection?.end();
    };
  }, [accountBinding]);

  if (loading) {
    return <div>Connecting to Enterprise Assist...</div>;
  }

  if (error) {
    return (
      <div>
        <strong>
          Unable to connect to Enterprise Assist.
        </strong>
        <br />
        {error}
      </div>
    );
  }

  if (!directLine || !userID) {
    return <div>Chat connection is unavailable.</div>;
  }

  return (
    <div style={{ height: "600px" }}>
      <ReactWebChat key={userID} directLine={directLine} userID={userID} />
    </div>
  );
};

export default EnterpriseAssistChat;
