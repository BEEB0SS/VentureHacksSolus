# Context Model Architecture

> Part of [[Product]]

The Robotics Context Model is the core of Solus — a hybrid data structure that represents everything about a robot system.

## Four Layers

### 1. Structured Graph (Deterministic)
Project structure and impact analysis via typed nodes and edges.

**Node types:** Project, TeamMember, MechanicalPart, ElectricalPart, SoftwareModule, Interface, RuntimeSignal, Document, Paper, Issue, Fix, Run, SimulationAsset, ExternalPartCandidate

**Edge types:** connected_to, depends_on, configured_by, documented_by, publishes, subscribes_to, drives, reads_from, changed_by, impacts, observed_in, resolved_by, similar_to

### 2. Semantic Memory (Fuzzy Recall)
Embeddings over issue descriptions, fix summaries, paper values, datasheet chunks, project notes. Powers Team Memory (Demo C) and External Knowledge (Demo D).

**Hackathon:** TF-IDF cosine similarity (standard library only)
**Production:** sentence-transformers

### 3. Runtime State Layer (Live)
Current status, telemetry, health, anomaly flags for every component. Powers Live Bench (Demo B).

Updated via WebSocket streaming from the robot (or simulated data for demos).

### 4. Change Log Layer (History)
When any source changes: create snapshot, diff, list impacted entities, suggest follow-up. Powers Change Propagation (Demo A).

## The Rule
Everything in the app either **creates**, **updates**, **queries**, or **validates** the Robotics Context Model. If a feature doesn't do one of those four things, it doesn't belong.

#architecture #context-model #core
