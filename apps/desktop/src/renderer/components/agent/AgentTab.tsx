// apps/desktop/src/renderer/components/agent/AgentTab.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { Send, BookOpen, Sparkles, Bot } from "lucide-react";
import { MessageBubble, type ChatMessage } from "./MessageBubble";
import { MemoryPanel } from "./MemoryPanel";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

interface GraphEntity {
  id: string;
  entity_type: string;
  name: string;
}

const QUERY_TYPES = [
  { value: "general", label: "General", description: "Ask anything about the project" },
  { value: "debug", label: "Debug", description: "Diagnose an issue" },
  { value: "search_parts", label: "Find Parts", description: "Component recommendations" },
  { value: "extract_values", label: "Extract Values", description: "Pull specs from docs" },
  { value: "impact_analysis", label: "Impact", description: "Explain change impact" },
  { value: "diagnose_and_replace", label: "Diagnose & Fix", description: "Impact analysis + find replacement parts" },
  { value: "plan", label: "Plan", description: "Plan integration work" },
] as const;

interface AgentTabProps {
  projectId: string;
}

export default function AgentTab({ projectId }: AgentTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [queryType, setQueryType] = useState("general");
  const [sending, setSending] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load entities for impact analysis entity picker
  useEffect(() => {
    if (!projectId) return;
    fetch(`${API}/projects/${projectId}/entities`)
      .then((r) => r.ok ? r.json() : [])
      .then(setEntities)
      .catch(() => {});
  }, [projectId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendQuery = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !projectId || sending) return;

    // For impact_analysis, include the selected entity ID
    const contextEntityIds: string[] = [];
    if ((queryType === "impact_analysis" || queryType === "diagnose_and_replace") && selectedEntityId) {
      contextEntityIds.push(selectedEntityId);
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      query_type: queryType,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const resp = await fetch(`${API}/projects/${projectId}/agent/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          query_type: queryType,
          context_entity_ids: contextEntityIds,
        }),
      });
      if (!resp.ok) throw new Error(`Agent query failed: ${resp.status}`);
      const data = await resp.json();

      const agentMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "agent",
        content: data.response_text,
        response: data,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, agentMessage]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, projectId, queryType, selectedEntityId, sending]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuery();
    }
  };

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-100 font-['Inter']">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-blue-400" />
            <span className="text-sm font-medium">Solus Agent</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMemoryOpen(!memoryOpen)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer ${
                memoryOpen
                  ? "bg-blue-600/20 border-blue-500/30 text-blue-400"
                  : "bg-neutral-800 border-neutral-700 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              <BookOpen size={12} />
              Memory
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-4 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-600/10 flex items-center justify-center">
                <Sparkles size={24} className="text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-neutral-300">Ask Solus anything</h3>
                <p className="text-xs text-neutral-500 mt-1 max-w-xs">
                  Debug issues, find components, search team memory, or analyze change impact.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 mt-2 max-w-md">
                {[
                  { text: "My motor keeps stalling at low RPM", type: "debug" },
                  { text: "Recommend a motor driver compatible with NEMA17", type: "search_parts" },
                  { text: "What happens if I swap the DRV8825?", type: "general" },
                  { text: "The DRV8825 is failing — find a replacement", type: "diagnose_and_replace" },
                ].map((suggestion) => (
                  <button
                    key={suggestion.text}
                    onClick={() => {
                      setInput(suggestion.text);
                      setQueryType(suggestion.type);
                      inputRef.current?.focus();
                    }}
                    className="text-xs bg-neutral-900 border border-neutral-800 rounded-full px-3 py-1.5 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 transition-colors cursor-pointer"
                  >
                    {suggestion.text}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {sending && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0">
                <Bot size={14} className="text-blue-400 animate-pulse" />
              </div>
              <div className="bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-3 text-sm text-neutral-500">
                Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-2 bg-red-900/30 border border-red-700 rounded px-3 py-2 text-xs text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 cursor-pointer">dismiss</button>
          </div>
        )}

        {/* Input area */}
        <div className="px-4 py-3 border-t border-neutral-800">
          {/* Query type selector */}
          <div className="flex gap-1 mb-2 flex-wrap">
            {QUERY_TYPES.map((qt) => (
              <button
                key={qt.value}
                onClick={() => setQueryType(qt.value)}
                title={qt.description}
                className={`px-2.5 py-1 text-[11px] rounded transition-colors cursor-pointer ${
                  queryType === qt.value
                    ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                    : "bg-neutral-900 text-neutral-500 border border-neutral-800 hover:text-neutral-300 hover:border-neutral-700"
                }`}
              >
                {qt.label}
              </button>
            ))}
          </div>
          {/* Entity picker — shown only for impact_analysis */}
          {(queryType === "impact_analysis" || queryType === "diagnose_and_replace") && entities.length > 0 && (
            <div className="mb-2">
              <select
                value={selectedEntityId}
                onChange={(e) => setSelectedEntityId(e.target.value)}
                className="bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-200 w-full outline-none focus:border-neutral-600"
              >
                <option value="">Select entity for impact analysis...</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.entity_type.replace(/_/g, " ")})
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Text input + send */}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Solus..."
              rows={1}
              className="flex-1 bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-neutral-600 resize-none"
            />
            <button
              onClick={sendQuery}
              disabled={sending || !input.trim()}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-lg transition-colors cursor-pointer"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Memory panel */}
      <MemoryPanel projectId={projectId} open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </div>
  );
}
