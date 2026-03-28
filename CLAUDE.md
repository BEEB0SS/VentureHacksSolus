# Solus — Agent Instructions

> Part of [[BRAIN-INDEX]]

## What Is This Brain?
Solus is a team robotics development workspace centered on a Robotics Context Model — a living graph that ingests design files, code, documents, runtime telemetry, and simulation state, then uses that shared context to help teams plan, detect change impact, debug, and reuse knowledge. This brain tracks everything about building Solus for a hackathon demo.

## Owner
- **Role**: Team Lead
- **Context**: Building Solus with a 4-person team for a hackathon. The product is validated through customer discovery with robotics engineers at CMU RI, competition teams, and startups.
- **Goals**: Ship 5 working demo flows that prove the Robotics Context Model concept end-to-end.

## Brain Structure
- [[Vision]] - What Solus is, validated problems, target users
- [[Product]] - Demo flows, features, specs, architecture
- [[Build]] - Tech stack, implementation details, code structure
- [[Team]] - Members, roles, assignments, merge workflow
- [[Go-To-Market]] - Hackathon presentation, pitch, positioning
- [[Operations]] - Sprint process, tools, integration workflow
- [[Assets]] - Images, videos, PDFs, mockups, screenshots
- [[Handoffs]] - Session continuity notes
- [[Templates]] - Reusable note structures

## Conventions
- Use [[wikilinks]] for all cross-references between notes, but ONLY link to files that exist. Never create wikilinks to files that haven't been created yet.
- Keep files concise and actionable
- Tag files with relevant hashtags for discoverability
- Check [[Assets]] for related images, videos, PDFs when working on any task
- Update Handoffs/ at the end of every work session
- Reference the [[Execution-Plan]] as the source of truth for build order
- Read productcontext.md for the full product spec — it is the single source of truth for what Solus is

## Assets
The [[Assets]] folder contains images, videos, PDFs, and other media. When working on any task, check Assets/ for related materials. You can analyze images, read PDFs, and process any file dropped there.

## Agent Personas
Available specialized agents in .claude/agents/:
- [[builder]] - Implementation, ships code, makes technical decisions
- [[strategist]] - Product thinking, demo planning, prioritization
- [[debugger]] - System debugging and integration troubleshooting

## Commands
- /init-braintree - Initialize a new brain
- /resume-braintree - Resume from where you left off
- /wrap-up-braintree - End session with proper handoff
- /status-braintree - View progress dashboard
- /plan-braintree [step] - Plan a specific step
- /sprint-braintree - Plan the week's work
- /sync-braintree - Health check and sync
- /feature-braintree [name] - Plan a new feature
