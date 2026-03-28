import { useState, useEffect, useRef, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

interface GraphEntity {
  id: string;
  entity_type: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
}

interface GraphRelation {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
}

interface GraphData {
  entities: GraphEntity[];
  relations: GraphRelation[];
}

const TYPE_COLORS: Record<string, string> = {
  electrical_part:         "#60a5fa",
  software_module:         "#4ade80",
  mechanical_part:         "#fb923c",
  interface:               "#c084fc",
  runtime_signal:          "#f472b6",
  document:                "#94a3b8",
  paper:                   "#94a3b8",
  issue:                   "#f87171",
  fix:                     "#34d399",
  project:                 "#fbbf24",
  team_member:             "#fbbf24",
  simulation_asset:        "#22d3ee",
  external_part_candidate: "#a78bfa",
};

// Edge colors grouped by relationship category:
// power/hardware wiring → warm yellow
// software dependencies → blue
// sensor reads → purple
// ROS publish/subscribe → cyan / pink
// runtime observations → red-ish
// documentation → slate
const RELATION_COLORS: Record<string, string> = {
  connected_to:  "#facc15",
  drives:        "#fb923c",
  depends_on:    "#60a5fa",
  configured_by: "#4ade80",
  reads_from:    "#c084fc",
  publishes:     "#22d3ee",
  subscribes_to: "#f472b6",
  observed_in:   "#f87171",
  documented_by: "#64748b",
};

const IMPACT_COLOR = "#ef4444";
const SOURCE_COLOR = "#f59e0b";   // amber — the origin node of an impact run
const NODE_R = 11;

export default function ContextModelTab({ projectId }: { projectId: string }) {
  const svgRef       = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graph,        setGraph]        = useState<GraphData>({ entities: [], relations: [] });
  const [selectedNode, setSelectedNode] = useState<GraphEntity | null>(null);
  const [impactedIds,  setImpactedIds]  = useState<Set<string>>(new Set());
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [tooltip,      setTooltip]      = useState<{ x: number; y: number; entity: GraphEntity } | null>(null);

  const loadGraph = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const resp = await fetch(`${API}/projects/${projectId}/graph`);
      if (!resp.ok) throw new Error("Failed to load graph");
      const data: GraphData = await resp.json();
      setGraph(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const runImpact = useCallback(async (entityId: string) => {
    setSourceNodeId(entityId);
    try {
      const resp = await fetch(`${API}/projects/${projectId}/impact/${entityId}`);
      if (!resp.ok) throw new Error("Impact analysis failed");
      const impacted: GraphEntity[] = await resp.json();
      // Exclude the source node from impactedIds — it gets its own distinct treatment
      setImpactedIds(new Set(impacted.map((e) => e.id).filter((id) => id !== entityId)));
    } catch (e: unknown) {
      setSourceNodeId(null);
      setError(e instanceof Error ? e.message : "Impact analysis failed");
    }
  }, [projectId]);

  useEffect(() => {
    if (!svgRef.current || graph.entities.length === 0) return;

    let cancelled = false;

    import("d3").then((d3) => {
      if (cancelled) return;

      const svg = d3.select(svgRef.current!);
      svg.selectAll("*").remove();

      // ── Fixed dot-grid backdrop ────────────────────────────────────────────
      const bgDefs = svg.append("defs");
      bgDefs.append("pattern")
        .attr("id",           "dot-grid")
        .attr("x",            0).attr("y", 0)
        .attr("width",        28).attr("height", 28)
        .attr("patternUnits", "userSpaceOnUse")
        .append("circle")
        .attr("cx",   14).attr("cy", 14).attr("r", 0.65)
        .attr("fill", "rgba(99,102,241,0.16)");
      svg.append("rect")
        .attr("width",  "100%").attr("height", "100%")
        .attr("fill",   "url(#dot-grid)");

      const width  = svgRef.current!.clientWidth;
      const height = svgRef.current!.clientHeight;
      const g      = svg.append("g");

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 3])
        .on("zoom", (event) => { g.attr("transform", event.transform); });
      svg.call(zoom);

      type SimNode = d3.SimulationNodeDatum & GraphEntity;
      type SimLink = d3.SimulationLinkDatum<SimNode> & GraphRelation;

      const nodes: SimNode[] = graph.entities.map((e) => ({ ...e }));
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      const links: SimLink[] = graph.relations
        .filter((r) => nodeMap.has(r.source_entity_id) && nodeMap.has(r.target_entity_id))
        .map((r) => ({
          ...r,
          source: nodeMap.get(r.source_entity_id)!,
          target: nodeMap.get(r.target_entity_id)!,
        }));

      const clusterX: Record<string, number> = {
        electrical_part:         width * 0.25,
        mechanical_part:         width * 0.15,
        software_module:         width * 0.75,
        interface:               width * 0.50,
        runtime_signal:          width * 0.50,
        document:                width * 0.75,
        paper:                   width * 0.75,
        issue:                   width * 0.35,
        fix:                     width * 0.65,
        simulation_asset:        width * 0.25,
        external_part_candidate: width * 0.85,
      };
      const clusterY: Record<string, number> = {
        electrical_part:         height * 0.35,
        mechanical_part:         height * 0.55,
        software_module:         height * 0.35,
        interface:               height * 0.45,
        runtime_signal:          height * 0.75,
        document:                height * 0.70,
        paper:                   height * 0.70,
        issue:                   height * 0.70,
        fix:                     height * 0.70,
        simulation_asset:        height * 0.75,
        external_part_candidate: height * 0.55,
      };

      const simulation = d3.forceSimulation(nodes)
        .force("link",      d3.forceLink(links).id((d: any) => d.id).distance(220).strength(0.12))
        .force("charge",    d3.forceManyBody().strength(-900).distanceMax(600))
        .force("clusterX",  d3.forceX((d: any) => clusterX[d.entity_type] ?? width  / 2).strength(0.22))
        .force("clusterY",  d3.forceY((d: any) => clusterY[d.entity_type] ?? height / 2).strength(0.22))
        .force("collision", d3.forceCollide(NODE_R + 58));

      simulation.stop();
      for (let i = 0; i < 500; i++) simulation.tick();

      // Auto-fit: compute node bounding box and zoom to fill the viewport
      const pad = 80;
      const xs = nodes.map((n) => n.x!);
      const ys = nodes.map((n) => n.y!);
      const bx0 = Math.min(...xs) - pad, bx1 = Math.max(...xs) + pad;
      const by0 = Math.min(...ys) - pad, by1 = Math.max(...ys) + pad;
      const bw = bx1 - bx0, bh = by1 - by0;
      const fitScale = Math.min(width / bw, height / bh, 1.4);
      const fitTx = (width  - bw * fitScale) / 2 - bx0 * fitScale;
      const fitTy = (height - bh * fitScale) / 2 - by0 * fitScale;
      svg.call(zoom.transform, d3.zoomIdentity.translate(fitTx, fitTy).scale(fitScale));

      // ── Defs ──────────────────────────────────────────────────────────────
      const defs = g.append("defs");

      // CSS animations: pulse ring + outward ripple + edge flash
      defs.append("style").text(
        `.impact-ring{animation:sol-pulse 1.2s ease-in-out infinite}` +
        `.impact-ripple{animation:sol-ripple 1.2s ease-out infinite;transform-box:fill-box;transform-origin:center}` +
        `@keyframes sol-pulse{0%,100%{opacity:1}50%{opacity:0.05}}` +
        `@keyframes sol-ripple{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(3)}}`
      );

      // Red glow — source node
      const glowF = defs.append("filter")
        .attr("id",     "glow-impact")
        .attr("x",      "-100%").attr("y", "-100%")
        .attr("width",  "300%").attr("height", "300%");
      glowF.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "9").attr("result", "blur");
      const glowMerge = glowF.append("feMerge");
      glowMerge.append("feMergeNode").attr("in", "blur");
      glowMerge.append("feMergeNode").attr("in", "blur");
      glowMerge.append("feMergeNode").attr("in", "SourceGraphic");

      // Amber glow — impacted nodes
      const glowAmber = defs.append("filter")
        .attr("id",     "glow-affected")
        .attr("x",      "-80%").attr("y", "-80%")
        .attr("width",  "260%").attr("height", "260%");
      glowAmber.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "6").attr("result", "ablur");
      const amberMerge = glowAmber.append("feMerge");
      amberMerge.append("feMergeNode").attr("in", "ablur");
      amberMerge.append("feMergeNode").attr("in", "SourceGraphic");


      // One arrowhead marker per relation color + impact color
      const markerColors = new Set(links.map((l) => RELATION_COLORS[l.relation_type] ?? "#525252"));
      markerColors.forEach((color) => {
        defs.append("marker")
          .attr("id",           `arr-${color.replace("#", "")}`)
          .attr("viewBox",      "0 -3.5 7 7")
          .attr("refX",         NODE_R + 9)
          .attr("refY",         0)
          .attr("markerWidth",  5)
          .attr("markerHeight", 5)
          .attr("orient",       "auto")
          .append("path")
          .attr("d",    "M0,-3L6,0L0,3Z")
          .attr("fill", color);
      });

      // ── Edges ─────────────────────────────────────────────────────────────
      const impactedEdgeColor = (d: SimLink) => {
        const src = d.source as SimNode;
        const tgt = d.target as SimNode;
        return impactedIds.has(src.id) && impactedIds.has(tgt.id);
      };

      // An edge is on the impact path only if it flows outward from the origin:
      //   origin → impacted  OR  impacted → impacted
      const isImpactPath = (srcId: string, tgtId: string) => {
        if (!sourceNodeId) return false;
        return (srcId === sourceNodeId && impactedIds.has(tgtId)) ||
               (impactedIds.has(srcId) && impactedIds.has(tgtId));
      };

      // Quadratic bezier: control point offset perpendicular to the line
      const curvePath = (x1: number, y1: number, x2: number, y2: number) => {
        const dx = x2 - x1, dy = y2 - y1;
        const norm = Math.sqrt(dx * dx + dy * dy) || 1;
        const cx = (x1 + x2) / 2 + (-dy / norm) * 28;
        const cy = (y1 + y2) / 2 + ( dx / norm) * 28;
        return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
      };

      const link = g.append("g").selectAll<SVGPathElement, SimLink>("path.edge")
        .data(links).join("path")
        .attr("class",          "edge")
        .attr("fill",           "none")
        .attr("stroke",         (d) => RELATION_COLORS[d.relation_type] ?? "#525252")
        .attr("stroke-width",   (d: any) => {
          if (!sourceNodeId) return 1.5;
          return isImpactPath((d.source as SimNode).id, (d.target as SimNode).id) ? 2.5 : 0.8;
        })
        .attr("stroke-opacity", (d: any) => {
          if (!sourceNodeId) return 0.45;
          return isImpactPath((d.source as SimNode).id, (d.target as SimNode).id) ? 0.85 : 0.06;
        })
        .attr("marker-end", (d) => {
          const c = RELATION_COLORS[d.relation_type] ?? "#525252";
          return `url(#arr-${c.replace("#", "")})`;
        })
        .attr("d", (d: any) => curvePath(d.source.x, d.source.y, d.target.x, d.target.y));

      // ── Node groups ───────────────────────────────────────────────────────
      const nodeGroup = g.append("g")
        .selectAll<SVGGElement, SimNode>("g.node-g")
        .data(nodes).join("g")
        .attr("class",     "node-g")
        .attr("cursor",    "pointer")
        .attr("transform", (d) => `translate(${d.x},${d.y})`);

      // Outward ripple — source node only
      nodeGroup.filter((d) => d.id === sourceNodeId)
        .append("circle")
        .attr("class",          "impact-ripple")
        .attr("r",              NODE_R + 6)
        .attr("fill",           "none")
        .attr("stroke",         IMPACT_COLOR)
        .attr("stroke-width",   2)
        .attr("pointer-events", "none");

      // Selection / impact ring
      nodeGroup.append("circle")
        .attr("class",          (d) => d.id === sourceNodeId ? "node-ring impact-ring" : "node-ring")
        .attr("r",              NODE_R + 6)
        .attr("fill",           "none")
        .attr("stroke",         (d) => {
          if (d.id === sourceNodeId) return IMPACT_COLOR;
          if (impactedIds.has(d.id)) return SOURCE_COLOR;
          return TYPE_COLORS[d.entity_type] ?? "#94a3b8";
        })
        .attr("stroke-width",   (d) => d.id === sourceNodeId ? 2.5 : (impactedIds.has(d.id) ? 2.5 : 1))
        .attr("stroke-opacity", (d) => d.id === sourceNodeId ? 0.9 : (impactedIds.has(d.id) ? 0.85 : 0.2))
        .attr("pointer-events", "none");

      // Main fill circle
      nodeGroup.append("circle")
        .attr("class",        "node-circle")
        .attr("r",            NODE_R)
        .attr("fill",         (d) => {
          if (d.id === sourceNodeId) return IMPACT_COLOR;
          if (impactedIds.has(d.id)) return SOURCE_COLOR;
          return TYPE_COLORS[d.entity_type] ?? "#94a3b8";
        })
        .attr("fill-opacity", 0.9)
        .attr("stroke",       (d) => {
          if (d.id === sourceNodeId) return "#fca5a5";
          if (impactedIds.has(d.id)) return "#fde68a";
          return TYPE_COLORS[d.entity_type] ?? "#94a3b8";
        })
        .attr("stroke-width", 2)
        .attr("filter",       (d) => {
          if (d.id === sourceNodeId) return "url(#glow-impact)";
          if (impactedIds.has(d.id)) return "url(#glow-affected)";
          return null;
        });

      // Label: semi-transparent pill background + text
      const labelG = nodeGroup.append("g")
        .attr("class",          "node-label")
        .attr("pointer-events", "none");

      labelG.append("rect")
        .attr("x",            NODE_R + 4)
        .attr("y",            -7)
        .attr("height",       14)
        .attr("width",        (d) => {
          const name = d.name.length > 20 ? d.name.slice(0, 18) + "…" : d.name;
          return name.length * 5.6 + 8;
        })
        .attr("rx",           3)
        .attr("fill",         "#050508")
        .attr("fill-opacity", 0.75);

      labelG.append("text")
        .text((d) => d.name.length > 20 ? d.name.slice(0, 18) + "…" : d.name)
        .attr("x",           NODE_R + 8)
        .attr("y",           4)
        .attr("font-size",   "9.5px")
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("fill",        "#e2e8f0");

      // ── Interactions ──────────────────────────────────────────────────────
      const connectedNodeIds = (d: SimNode) =>
        new Set(links.flatMap((l: any) => {
          if ((l.source as SimNode).id === d.id) return [(l.target as SimNode).id];
          if ((l.target as SimNode).id === d.id) return [(l.source as SimNode).id];
          return [];
        }));

      nodeGroup
        .on("mouseenter", (event: MouseEvent, d: SimNode) => {
          const t = d3.zoomTransform(svgRef.current!);
          setTooltip({
            x: Math.min(t.applyX(d.x!), (svgRef.current?.clientWidth ?? 700) - 190),
            y: Math.max(t.applyY(d.y!), 44),
            entity: d,
          });
          d3.select(event.currentTarget as SVGGElement)
            .select<SVGCircleElement>(".node-circle")
            .attr("fill-opacity", 1)
            .attr("r", NODE_R + 1.5);
          d3.select(event.currentTarget as SVGGElement)
            .select<SVGCircleElement>(".node-ring")
            .attr("stroke-opacity", (nd: any) => impactedIds.has(nd.id) ? 1 : 0.55);

          // Dim unconnected edges, lift connected ones
          const neighbors = connectedNodeIds(d);
          link.attr("stroke-opacity", (l: any) => {
            const src = (l.source as SimNode).id;
            const tgt = (l.target as SimNode).id;
            return (src === d.id || tgt === d.id) ? 0.9 : 0.05;
          }).attr("stroke-width", (l: any) => {
            const src = (l.source as SimNode).id;
            const tgt = (l.target as SimNode).id;
            return (src === d.id || tgt === d.id) ? 2.5 : 1;
          });

          // Dim unconnected nodes
          nodeGroup.selectAll<SVGCircleElement, SimNode>(".node-circle")
            .attr("fill-opacity", (n) =>
              n.id === d.id || neighbors.has(n.id) ? 1 : 0.18
            );
        })
        .on("mouseleave", (event: MouseEvent, d: SimNode) => {
          setTooltip(null);
          d3.select(event.currentTarget as SVGGElement)
            .select<SVGCircleElement>(".node-circle")
            .attr("fill-opacity", 0.9)
            .attr("r", NODE_R);
          d3.select(event.currentTarget as SVGGElement)
            .select<SVGCircleElement>(".node-ring")
            .attr("stroke-opacity", impactedIds.has(d.id) ? 0.7 : 0.2);

          // Restore all edges and nodes
          link
            .attr("stroke-opacity", (l: any) => {
              if (!sourceNodeId) return 0.45;
              return isImpactPath((l.source as SimNode).id, (l.target as SimNode).id) ? 0.85 : 0.06;
            })
            .attr("stroke-width", (l: any) => {
              if (!sourceNodeId) return 1.5;
              return isImpactPath((l.source as SimNode).id, (l.target as SimNode).id) ? 2.5 : 0.8;
            });
          nodeGroup.selectAll<SVGCircleElement, SimNode>(".node-circle")
            .attr("fill-opacity", 0.9);
        })
        .on("click", (_: MouseEvent, d: SimNode) => { setSelectedNode(d); });

      // Drag
      nodeGroup.call(
        d3.drag<SVGGElement, SimNode>()
          .on("start", (_, d) => { d.fx = d.x; d.fy = d.y; setTooltip(null); })
          .on("drag", (event, d) => {
            d.fx = event.x; d.fy = event.y;
            nodeGroup.filter((n) => n.id === d.id).attr("transform", `translate(${event.x},${event.y})`);
            link.filter((l: any) => (l.source as SimNode).id === d.id)
              .attr("d", (l: any) => curvePath(event.x, event.y, (l.target as SimNode).x!, (l.target as SimNode).y!));
            link.filter((l: any) => (l.target as SimNode).id === d.id)
              .attr("d", (l: any) => curvePath((l.source as SimNode).x!, (l.source as SimNode).y!, event.x, event.y));
          }) as any
      );
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [graph, impactedIds, sourceNodeId]);

  // Highlight selected node ring without full re-render
  useEffect(() => {
    if (!svgRef.current) return;
    import("d3").then((d3) => {
      d3.select(svgRef.current!)
        .selectAll<SVGCircleElement, GraphEntity>(".node-ring")
        .attr("r",              (d) => d.id === selectedNode?.id ? NODE_R + 9 : NODE_R + 6)
        .attr("stroke-width",   (d) => {
          if (d.id === selectedNode?.id) return 2.5;
          if (d.id === sourceNodeId)     return 2.5;
          if (impactedIds.has(d.id))     return 1.5;
          return 1;
        })
        .attr("stroke-opacity", (d) => {
          if (d.id === selectedNode?.id) return 1;
          if (d.id === sourceNodeId)     return 0.9;
          if (impactedIds.has(d.id))     return 0.5;
          return 0.2;
        });
    });
  }, [selectedNode, impactedIds, sourceNodeId]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "#060610", fontFamily: "JetBrains Mono, monospace" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 28, height: 28, border: "2px solid #6366f1", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <span style={{ fontSize: 11, color: "#4b5563", letterSpacing: "0.1em" }}>LOADING CONTEXT MODEL</span>
        </div>
      </div>
    );
  }

  const nodeColor = selectedNode ? (TYPE_COLORS[selectedNode.entity_type] ?? "#94a3b8") : null;

  return (
    <div style={{ display: "flex", height: "100%", background: "#060610", color: "#e2e8f0", fontFamily: "JetBrains Mono, monospace" }}>

      {/* ── Canvas ─────────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {graph.entities.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, color: "#374151" }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
              <line x1="12" y1="7" x2="5" y2="17" /><line x1="12" y1="7" x2="19" y2="17" />
            </svg>
            <span style={{ fontSize: 11, letterSpacing: "0.06em" }}>NO ENTITIES — SYNC A SOURCE TO POPULATE</span>
          </div>
        ) : (
          <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block", background: "#060610" }} />
        )}

        {/* Hover tooltip */}
        {tooltip && (
          <div style={{
            position: "absolute", pointerEvents: "none", zIndex: 20,
            left: tooltip.x + 14, top: tooltip.y - 8,
            background: "#0d0d18", border: "1px solid #2a2a40",
            borderRadius: 8, padding: "10px 12px", minWidth: 160, maxWidth: 230,
            boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: TYPE_COLORS[tooltip.entity.entity_type] ?? "#94a3b8", display: "inline-block", boxShadow: `0 0 6px ${TYPE_COLORS[tooltip.entity.entity_type] ?? "#94a3b8"}` }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tooltip.entity.name}</span>
            </div>
            <div style={{ fontSize: 9, color: "#4b5563", letterSpacing: "0.1em", textTransform: "uppercase" }}>{tooltip.entity.entity_type.replace(/_/g, " ")}</div>
            {tooltip.entity.description && (
              <div style={{ marginTop: 6, fontSize: 10, color: "#6b7280", lineHeight: 1.5 }}>{tooltip.entity.description.slice(0, 100)}{tooltip.entity.description.length > 100 ? "…" : ""}</div>
            )}
          </div>
        )}

        {/* Stats strip — top left */}
        <div style={{ position: "absolute", top: 14, left: 14, display: "flex", gap: 10 }}>
          <span style={{ fontSize: 9, color: "#374151", letterSpacing: "0.12em", background: "#0d0d18", border: "1px solid #1e1e2e", borderRadius: 4, padding: "3px 8px" }}>
            {graph.entities.length} NODES
          </span>
          <span style={{ fontSize: 9, color: "#374151", letterSpacing: "0.12em", background: "#0d0d18", border: "1px solid #1e1e2e", borderRadius: 4, padding: "3px 8px" }}>
            {graph.relations.length} EDGES
          </span>
          {impactedIds.size > 0 && (
            <span style={{ fontSize: 9, color: "#ef4444", letterSpacing: "0.12em", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, padding: "3px 8px" }}>
              ⚠ {impactedIds.size} IMPACTED
            </span>
          )}
        </div>

        {/* Legend — bottom left */}
        <div style={{ position: "absolute", bottom: 14, left: 14, background: "rgba(8,8,18,0.96)", border: "1px solid #252535", borderRadius: 12, padding: "12px 14px", backdropFilter: "blur(12px)", boxShadow: "0 4px 24px rgba(0,0,0,0.6)", minWidth: 180 }}>
          <div style={{ fontSize: 9, color: "#6b7280", letterSpacing: "0.16em", marginBottom: 10, textTransform: "uppercase", fontWeight: 600, borderBottom: "1px solid #1e1e2e", paddingBottom: 8 }}>Entity Types</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {Object.entries(TYPE_COLORS)
              .filter(([type]) => graph.entities.some((e) => e.entity_type === type))
              .map(([type, color]) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: color, display: "inline-block", boxShadow: `0 0 7px ${color}` }} />
                  <span style={{ fontSize: 11, color: "#c9cfd6", letterSpacing: "0.01em" }}>{type.replace(/_/g, " ")}</span>
                </div>
              ))}
            {sourceNodeId && (
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 4, paddingTop: 8, borderTop: "1px solid #1e1e2e" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: IMPACT_COLOR, display: "inline-block", boxShadow: `0 0 8px ${IMPACT_COLOR}` }} />
                <span style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>change origin</span>
              </div>
            )}
            {impactedIds.size > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: SOURCE_COLOR, display: "inline-block", boxShadow: `0 0 8px ${SOURCE_COLOR}` }} />
                <span style={{ fontSize: 11, color: "#fcd34d", fontWeight: 600 }}>impacted</span>
              </div>
            )}
          </div>
        </div>

        {/* Top-right controls */}
        <div style={{ position: "absolute", top: 14, right: 14, display: "flex", gap: 8 }}>
          {sourceNodeId && (
            <button
              onClick={() => { setImpactedIds(new Set()); setSourceNodeId(null); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontSize: 10, fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.08em", fontWeight: 600, color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 6, cursor: "pointer", backdropFilter: "blur(8px)", transition: "background 0.15s, border-color 0.15s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(251,191,36,0.22)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(251,191,36,0.7)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(251,191,36,0.12)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(251,191,36,0.4)"; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              CLEAR IMPACT
            </button>
          )}
          <button
            onClick={loadGraph}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", fontSize: 9, fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.1em", color: "#6b7280", background: "rgba(13,13,24,0.9)", border: "1px solid #2a2a40", borderRadius: 6, cursor: "pointer", backdropFilter: "blur(8px)", transition: "color 0.15s, border-color 0.15s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#a5b4fc"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#4338ca"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6b7280"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#2a2a40"; }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            REFRESH
          </button>
        </div>
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div style={{ width: 268, background: "#08080f", borderLeft: "1px solid #1a1a28", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header — colored accent bar when a node is selected */}
        <div style={{ borderTop: `2px solid ${nodeColor ?? "#1a1a28"}`, padding: "12px 16px 10px", borderBottom: "1px solid #1a1a28" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 8, color: "#374151", letterSpacing: "0.16em", textTransform: "uppercase" }}>Inspector</span>
            <span style={{ fontSize: 8, color: "#374151", letterSpacing: "0.08em" }}>{graph.entities.length} entities</span>
          </div>
          {selectedNode && (
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.3 }}>{selectedNode.name}</div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {selectedNode ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Type pill */}
              <span style={{
                display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 9,
                letterSpacing: "0.12em", textTransform: "uppercase",
                background: `${nodeColor}18`, color: nodeColor ?? "#94a3b8",
                border: `1px solid ${nodeColor}38`,
              }}>
                {selectedNode.entity_type.replace(/_/g, " ")}
              </span>

              {/* Description */}
              {selectedNode.description && (
                <p style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.6, margin: 0 }}>{selectedNode.description}</p>
              )}

              {/* Metadata */}
              {Object.keys(selectedNode.metadata).length > 0 && (
                <div style={{ background: "#0d0d18", border: "1px solid #1e1e2e", borderRadius: 8 }}>
                  <div style={{ padding: "8px 12px 6px", fontSize: 8, color: "#374151", letterSpacing: "0.14em", textTransform: "uppercase", borderBottom: "1px solid #1a1a28" }}>Metadata</div>
                  <div style={{ padding: "6px 0" }}>
                    {Object.entries(selectedNode.metadata).map(([key, val]) => (
                      <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 12px", gap: 8 }}>
                        <span style={{ fontSize: 9, color: "#4b5563", flexShrink: 0 }}>{key}</span>
                        <span style={{ fontSize: 9, color: "#9ca3af", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(val)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Impact analysis */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  onClick={() => runImpact(selectedNode.id)}
                  style={{ width: "100%", padding: "9px 0", fontSize: 9, letterSpacing: "0.14em", fontFamily: "JetBrains Mono, monospace", textTransform: "uppercase", color: "#ef4444", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 6, cursor: "pointer", transition: "background 0.15s, border-color 0.15s" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.14)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.5)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.07)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.25)"; }}
                >
                  ⚡ Run Impact Analysis
                </button>
                {impactedIds.size > 0 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 9, color: "#ef4444", letterSpacing: "0.08em" }}>{impactedIds.size} nodes impacted</span>
                    <button
                      onClick={() => { setImpactedIds(new Set()); setSourceNodeId(null); }}
                      style={{ fontSize: 9, color: "#374151", background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", letterSpacing: "0.08em" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#6b7280"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#374151"; }}
                    >
                      clear
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, color: "#1f2937", textAlign: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
                <line x1="12" y1="7" x2="5" y2="17" /><line x1="12" y1="7" x2="19" y2="17" />
              </svg>
              <span style={{ fontSize: 9, color: "#374151", letterSpacing: "0.1em", lineHeight: 1.6 }}>SELECT A NODE TO<br />INSPECT &amp; ANALYZE</span>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.05)" }}>
            <div style={{ fontSize: 9, color: "#ef4444", lineHeight: 1.5 }}>{error}</div>
            <button onClick={() => setError(null)} style={{ fontSize: 9, color: "#6b2828", background: "none", border: "none", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", marginTop: 4, padding: 0 }}>dismiss</button>
          </div>
        )}
      </div>
    </div>
  );
}
