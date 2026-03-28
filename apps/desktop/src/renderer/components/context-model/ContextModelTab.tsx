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
  electrical_part: "#60a5fa",
  software_module: "#4ade80",
  mechanical_part: "#fb923c",
  interface: "#c084fc",
  runtime_signal: "#f472b6",
  document: "#94a3b8",
  paper: "#94a3b8",
  issue: "#f87171",
  fix: "#34d399",
  project: "#fbbf24",
  team_member: "#fbbf24",
  simulation_asset: "#22d3ee",
  external_part_candidate: "#a78bfa",
};

const IMPACT_COLOR = "#ef4444";

export default function ContextModelTab({ projectId }: { projectId: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [graph, setGraph] = useState<GraphData>({ entities: [], relations: [] });
  const [selectedNode, setSelectedNode] = useState<GraphEntity | null>(null);
  const [impactedIds, setImpactedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const resp = await fetch(`${API}/projects/${projectId}/impact/${entityId}`);
      if (!resp.ok) throw new Error("Impact analysis failed");
      const impacted: GraphEntity[] = await resp.json();
      setImpactedIds(new Set(impacted.map((e) => e.id)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Impact analysis failed");
    }
  }, [projectId]);

  useEffect(() => {
    if (!svgRef.current || graph.entities.length === 0) return;

    let cleanup: (() => void) | null = null;
    let cancelled = false;

    import("d3")
      .then((d3) => {
        if (cancelled) return;
        const svg = d3.select(svgRef.current!);
        svg.selectAll("*").remove();

        const width = svgRef.current!.clientWidth;
        const height = svgRef.current!.clientHeight;
        const g = svg.append("g");

        const zoom = d3.zoom<SVGSVGElement, unknown>().on("zoom", (event) => {
          g.attr("transform", event.transform);
        });
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

        // Cluster positions by entity type — hardware left, software right,
        // interfaces center, signals bottom
        const clusterX: Record<string, number> = {
          electrical_part: width * 0.25,
          mechanical_part: width * 0.15,
          software_module: width * 0.75,
          interface: width * 0.5,
          runtime_signal: width * 0.5,
          document: width * 0.75,
          paper: width * 0.75,
          issue: width * 0.35,
          fix: width * 0.65,
          simulation_asset: width * 0.25,
          external_part_candidate: width * 0.85,
        };
        const clusterY: Record<string, number> = {
          electrical_part: height * 0.35,
          mechanical_part: height * 0.55,
          software_module: height * 0.35,
          interface: height * 0.45,
          runtime_signal: height * 0.75,
          document: height * 0.7,
          paper: height * 0.7,
          issue: height * 0.7,
          fix: height * 0.7,
          simulation_asset: height * 0.75,
          external_part_candidate: height * 0.55,
        };

        const simulation = d3
          .forceSimulation(nodes)
          .force("link", d3.forceLink(links).id((d: any) => d.id).distance(90).strength(0.3))
          .force("charge", d3.forceManyBody().strength(-150))
          .force("clusterX", d3.forceX((d: any) => clusterX[d.entity_type] ?? width / 2).strength(0.4))
          .force("clusterY", d3.forceY((d: any) => clusterY[d.entity_type] ?? height / 2).strength(0.4))
          .force("collision", d3.forceCollide(24));

        // Run simulation to completion, then render static positions
        simulation.stop();
        const totalTicks = 300;
        for (let i = 0; i < totalTicks; i++) simulation.tick();

        // Arrow marker for directed edges
        g.append("defs").append("marker")
          .attr("id", "arrowhead").attr("viewBox", "0 -4 8 8")
          .attr("refX", 16).attr("refY", 0)
          .attr("markerWidth", 6).attr("markerHeight", 6)
          .attr("orient", "auto")
          .append("path").attr("d", "M0,-3L7,0L0,3").attr("fill", "#525252");

        const link = g.append("g").selectAll("line").data(links).join("line")
          .attr("stroke", "#525252").attr("stroke-width", 1.5).attr("stroke-opacity", 0.5)
          .attr("marker-end", "url(#arrowhead)")
          .attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);

        const node = g.append("g").selectAll("circle").data(nodes).join("circle")
          .attr("r", 8)
          .attr("fill", (d: SimNode) => impactedIds.has(d.id) ? IMPACT_COLOR : (TYPE_COLORS[d.entity_type] || "#94a3b8"))
          .attr("stroke", "#171717").attr("stroke-width", 1.5).attr("cursor", "pointer")
          .attr("cx", (d: SimNode) => d.x!).attr("cy", (d: SimNode) => d.y!)
          .on("click", (_event: MouseEvent, d: SimNode) => { setSelectedNode(d); })
          .call(
            d3.drag<SVGCircleElement, SimNode>()
              .on("start", (_event, d) => { d.fx = d.x; d.fy = d.y; })
              .on("drag", (event, d) => {
                d.fx = event.x; d.fy = event.y;
                d3.select(event.sourceEvent.target).attr("cx", event.x).attr("cy", event.y);
                // Update connected links and label
                link.filter((l: any) => l.source.id === d.id).attr("x1", event.x).attr("y1", event.y);
                link.filter((l: any) => l.target.id === d.id).attr("x2", event.x).attr("y2", event.y);
                label.filter((l: SimNode) => l.id === d.id).attr("x", event.x).attr("y", event.y);
              }) as any
          );

        const label = g.append("g").selectAll("text").data(nodes).join("text")
          .text((d: SimNode) => d.name)
          .attr("font-size", "10px").attr("font-family", "JetBrains Mono, monospace")
          .attr("fill", "#a3a3a3").attr("dx", 12).attr("dy", 4)
          .attr("x", (d: SimNode) => d.x!).attr("y", (d: SimNode) => d.y!);

        cleanup = () => { simulation.stop(); };
      })
      .catch(() => { /* D3 not installed — fallback */ });

    return () => { cancelled = true; cleanup?.(); };
  }, [graph, impactedIds]);

  if (loading) {
    return <div className="flex items-center justify-center h-full bg-neutral-950 text-neutral-400">Loading context model...</div>;
  }

  return (
    <div className="flex h-full bg-neutral-950 text-neutral-100 font-['Inter']">
      <div className="flex-1 relative">
        {graph.entities.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            No entities in the context model yet. Sync a source to populate the graph.
          </div>
        ) : (
          <svg ref={svgRef} className="w-full h-full" style={{ background: "#0a0a0a" }} />
        )}

        <div className="absolute bottom-4 left-4 bg-neutral-900/90 border border-neutral-800 rounded-lg p-3">
          <div className="text-xs text-neutral-400 mb-2 font-medium">Entity Types</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(TYPE_COLORS)
              .filter(([type]) => graph.entities.some((e) => e.entity_type === type))
              .map(([type, color]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs text-neutral-300">{type.replace(/_/g, " ")}</span>
                </div>
              ))}
            {impactedIds.size > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: IMPACT_COLOR }} />
                <span className="text-xs text-neutral-300">impacted</span>
              </div>
            )}
          </div>
        </div>

        <button onClick={loadGraph} className="absolute top-4 right-4 px-3 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded transition-colors">
          Refresh
        </button>
      </div>

      <div className="w-72 bg-neutral-900 border-l border-neutral-800 p-4 overflow-auto">
        {selectedNode ? (
          <div className="flex flex-col gap-3">
            <div>
              <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ backgroundColor: TYPE_COLORS[selectedNode.entity_type] || "#94a3b8" }} />
              <span className="text-sm font-medium">{selectedNode.name}</span>
            </div>
            <div className="text-xs text-neutral-400">{selectedNode.entity_type.replace(/_/g, " ")}</div>
            {selectedNode.description && <p className="text-sm text-neutral-300">{selectedNode.description}</p>}
            {Object.keys(selectedNode.metadata).length > 0 && (
              <div className="bg-neutral-800 rounded p-2 font-['JetBrains_Mono'] text-xs">
                {Object.entries(selectedNode.metadata).map(([key, val]) => (
                  <div key={key} className="flex justify-between py-0.5">
                    <span className="text-neutral-400">{key}</span>
                    <span className="text-neutral-200">{String(val)}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => runImpact(selectedNode.id)} className="px-3 py-2 text-sm bg-red-600 hover:bg-red-500 rounded transition-colors">
              Analyze Impact
            </button>
            {impactedIds.size > 0 && (
              <div>
                <div className="text-xs text-neutral-400 mb-1">{impactedIds.size} impacted entities</div>
                <button onClick={() => setImpactedIds(new Set())} className="text-xs text-neutral-500 hover:text-neutral-300">Clear highlights</button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-neutral-500">Click a node to see details and run impact analysis.</div>
        )}
        {error && (
          <div className="mt-4 bg-red-900/30 border border-red-700 rounded px-3 py-2 text-xs text-red-300">{error}</div>
        )}
      </div>
    </div>
  );
}
