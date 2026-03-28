// apps/desktop/src/renderer/components/agent/MessageBubble.tsx
import { Bot, User, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

interface MemoryHit {
  id: string;
  content: string;
  content_type: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

interface AgentResponseData {
  query_id: string;
  response_text: string;
  structured_data: {
    memory_hits?: MemoryHit[];
    impacted_entities?: Array<{ id: string; name: string; entity_type: string }>;
  };
  sources: string[];
  confidence: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  query_type?: string;
  response?: AgentResponseData;
  timestamp: string;
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0 mt-1">
          <Bot size={14} className="text-blue-400" />
        </div>
      )}
      <div className={`max-w-[80%] ${isUser ? "bg-blue-600/20 border-blue-500/30" : "bg-neutral-900 border-neutral-800"} border rounded-lg px-4 py-3`}>
        {isUser && message.query_type && message.query_type !== "general" && (
          <span className="inline-block text-[10px] font-mono bg-neutral-800 text-neutral-400 rounded px-1.5 py-0.5 mb-2">
            {message.query_type}
          </span>
        )}
        <div className="text-sm text-neutral-200 whitespace-pre-wrap">{message.content}</div>
        {!isUser && message.response && (
          <div className="mt-2 pt-2 border-t border-neutral-800">
            {/* Confidence bar */}
            <div className="flex items-center gap-2 mb-1">
              <div className="flex-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    message.response.confidence >= 0.7 ? "bg-green-500" :
                    message.response.confidence >= 0.4 ? "bg-yellow-500" : "bg-red-500"
                  }`}
                  style={{ width: `${message.response.confidence * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-neutral-500 font-mono">
                {Math.round(message.response.confidence * 100)}%
              </span>
            </div>
            {/* Sources toggle */}
            <button
              onClick={() => setSourcesExpanded(!sourcesExpanded)}
              className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-300 cursor-pointer"
            >
              {sourcesExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Sources: {message.response.sources.join(", ")}
            </button>
            {sourcesExpanded && message.response.structured_data.memory_hits && message.response.structured_data.memory_hits.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {message.response.structured_data.memory_hits.map((hit) => (
                  <div key={hit.id} className="bg-neutral-800 rounded px-2 py-1.5 text-xs">
                    <div className="flex justify-between text-neutral-400">
                      <span>{hit.content_type}</span>
                      <span className="font-mono">{(hit.similarity * 100).toFixed(0)}% match</span>
                    </div>
                    <div className="text-neutral-300 mt-0.5 line-clamp-2">{hit.content}</div>
                  </div>
                ))}
              </div>
            )}
            {sourcesExpanded && message.response.structured_data.impacted_entities && message.response.structured_data.impacted_entities.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] text-neutral-500 mb-1">Impacted entities:</div>
                <div className="flex flex-wrap gap-1">
                  {message.response.structured_data.impacted_entities.map((e) => (
                    <span key={e.id} className="bg-red-900/30 border border-red-800 text-red-300 text-[10px] px-1.5 py-0.5 rounded">
                      {e.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-neutral-800 flex items-center justify-center flex-shrink-0 mt-1">
          <User size={14} className="text-neutral-400" />
        </div>
      )}
    </div>
  );
}
