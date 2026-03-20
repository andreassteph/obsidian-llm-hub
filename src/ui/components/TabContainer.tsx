import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { LlmHubPlugin } from "src/plugin";
import type { TFile } from "obsidian";
import Chat, { ChatRef } from "./Chat";
import WorkflowPanel from "./workflow/WorkflowPanel";

export type TabType = "chat" | "workflow";

export interface TabContainerRef {
  getActiveChat: () => TFile | null;
  setActiveChat: (chat: TFile | null) => void;
}

interface TabContainerProps {
  plugin: LlmHubPlugin;
}

const TabContainer = forwardRef<TabContainerRef, TabContainerProps>(
  ({ plugin }, ref) => {
    const [activeTab, setActiveTab] = useState<TabType>("chat");
    const chatRef = useRef<ChatRef>(null);

    useImperativeHandle(ref, () => ({
      getActiveChat: () => chatRef.current?.getActiveChat() ?? null,
      setActiveChat: (chat: TFile | null) => chatRef.current?.setActiveChat(chat),
    }));

    return (
      <div className="llm-hub-tab-container">
        <div className="llm-hub-tab-bar">
          <button
            className={`llm-hub-tab ${activeTab === "chat" ? "active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            Chat
          </button>
          <button
            className={`llm-hub-tab ${activeTab === "workflow" ? "active" : ""}`}
            onClick={() => setActiveTab("workflow")}
          >
            Workflow
          </button>
        </div>
        <div className="llm-hub-tab-content">
          <div className={`llm-hub-tab-panel ${activeTab === "chat" ? "is-active" : ""}`}>
            <Chat ref={chatRef} plugin={plugin} />
          </div>
          <div className={`llm-hub-tab-panel ${activeTab === "workflow" ? "is-active" : ""}`}>
            <WorkflowPanel plugin={plugin} />
          </div>
        </div>
      </div>
    );
  }
);

TabContainer.displayName = "TabContainer";

export default TabContainer;
