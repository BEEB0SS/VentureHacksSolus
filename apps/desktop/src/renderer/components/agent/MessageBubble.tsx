// apps/desktop/src/renderer/components/agent/MessageBubble.tsx
import { Bot, User, ChevronDown, ChevronRight, Cpu, ExternalLink } from "lucide-react";
import { useState } from "react";

interface MemoryHit {
  id: string;
  content: string;
  content_type: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

interface PartCandidate {
  name: string;
  manufacturer: string;
  manufacturer_part_number: string;
  distributor_part_number: string;
  unit_price: number;
  price_range: string;
  quantity_available: number;
  category: string;
  datasheet_url: string;
  product_url: string;
  photo_url: string;
  specs: Record<string, string>;
  relevance_score: number;
  compatibility_notes: string;
}

interface AgentResponseData {
  query_id: string;
  response_text: string;
  structured_data: {
    memory_hits?: MemoryHit[];
    impacted_entities?: Array<{ id: string; name: string; entity_type: string }>;
    part_candidates?: PartCandidate[];
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

const INITIAL_DISPLAY_COUNT = 5;

function PartCandidateCard({ part }: { part: PartCandidate }) {
  const scoreColor =
    part.relevance_score >= 0.7
      ? "bg-green-500"
      : part.relevance_score >= 0.4
        ? "bg-yellow-500"
        : "bg-red-500";

  const specEntries = Object.entries(part.specs).slice(0, 4);

  return (
    <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-3 flex gap-3">
      {/* Photo / fallback icon */}
      <div className="w-12 h-12 rounded bg-neutral-700/50 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {part.photo_url ? (
          <img
            src={part.photo_url}
            alt={part.manufacturer_part_number}
            className="w-full h-full object-contain"
          />
        ) : (
          <Cpu size={20} className="text-neutral-500" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-neutral-200 truncate">
              {part.manufacturer_part_number || part.name}
            </div>
            <div className="text-xs text-neutral-400">{part.manufacturer}</div>
          </div>
          {part.product_url && (
            <a
              href={part.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 flex-shrink-0"
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>

        {/* Description */}
        <div className="text-xs text-neutral-300 mt-1 line-clamp-1">{part.name}</div>

        {/* Spec tags */}
        {specEntries.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {specEntries.map(([key, value]) => (
              <span
                key={key}
                className="bg-neutral-700/60 text-neutral-300 text-[10px] px-1.5 py-0.5 rounded"
              >
                {key}: {value}
              </span>
            ))}
          </div>
        )}

        {/* Price, stock, datasheet row */}
        <div className="flex items-center gap-3 mt-2 text-xs">
          <span className="text-neutral-200 font-medium">
            ${part.unit_price.toFixed(2)} ea
          </span>
          <span className="text-neutral-400">
            In Stock: {part.quantity_available.toLocaleString()}
          </span>
          {part.datasheet_url && (
            <a
              href={part.datasheet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
            >
              Datasheet <ExternalLink size={10} />
            </a>
          )}
        </div>

        {/* Compatibility score + notes */}
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-neutral-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${scoreColor}`}
                style={{ width: `${part.relevance_score * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-neutral-500 font-mono">
              {Math.round(part.relevance_score * 100)}%
            </span>
          </div>
          {part.compatibility_notes && (
            <div className="text-[11px] text-neutral-400 mt-1 italic">
              {part.compatibility_notes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PartCandidateCards({ candidates }: { candidates: PartCandidate[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? candidates : candidates.slice(0, INITIAL_DISPLAY_COUNT);
  const remaining = candidates.length - INITIAL_DISPLAY_COUNT;

  return (
    <div className="mt-3 flex flex-col gap-2">
      {visible.map((part, i) => (
        <PartCandidateCard key={part.distributor_part_number || i} part={part} />
      ))}
      {!showAll && remaining > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer text-left"
        >
          Show {remaining} more
        </button>
      )}
    </div>
  );
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const isUser = message.role === "user";
  const partCandidates = message.response?.structured_data?.part_candidates;

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

        {/* Part candidate cards */}
        {!isUser && partCandidates && partCandidates.length > 0 && (
          <PartCandidateCards candidates={partCandidates} />
        )}

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
