import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import type { LlmHubPlugin } from "src/plugin";
import type { TFile } from "obsidian";
import type { Attachment } from "src/types";
import Chat, { ChatRef } from "./Chat";
import SearchPanel from "./SearchPanel";
import WorkflowPanel from "./workflow/WorkflowPanel";
import { t } from "src/i18n";

export type TabType = "chat" | "search" | "workflow";

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

    const handleChatWithResults = useCallback((attachments: Attachment[]) => {
      chatRef.current?.clearRagSetting();
      chatRef.current?.addAttachments(attachments);
      setActiveTab("chat");
    }, []);

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
            className={`llm-hub-tab ${activeTab === "search" ? "active" : ""}`}
            onClick={() => setActiveTab("search")}
          >
            {t("search.tab")}
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
          <div className={`llm-hub-tab-panel ${activeTab === "search" ? "is-active" : ""}`}>
            <SearchPanel plugin={plugin} onChatWithResults={handleChatWithResults} />
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
