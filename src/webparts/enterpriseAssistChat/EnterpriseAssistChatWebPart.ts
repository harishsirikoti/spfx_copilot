import * as React from "react";
import * as ReactDom from "react-dom";
import { Version } from "@microsoft/sp-core-library";
import { BaseClientSideWebPart } from "@microsoft/sp-webpart-base";
import EnterpriseAssistChat from "./components/EnterpriseAssistChat";

export interface IEnterpriseAssistChatWebPartProps {}

export default class EnterpriseAssistChatWebPart extends BaseClientSideWebPart<IEnterpriseAssistChatWebPartProps> {
  public render(): void {
    const element = React.createElement(EnterpriseAssistChat, {
      accountBinding: this.context.pageContext.user.loginName,
    });

    ReactDom.render(element, this.domElement);
  }

  protected onDispose(): void {
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  protected get dataVersion(): Version {
    return Version.parse("1.0");
  }

}
