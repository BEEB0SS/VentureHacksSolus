# Merge Order

> Part of [[Team]]

Follow this exact sequence. Each person merges only after the previous person is done.

## The Order
1. **Pratham** → context engine, connectors, core routes, workspace/context tabs
2. **Teammate 3** → Zustand store, shared components, main.py wiring
3. **Teammate 1** → live bench, agent chat, issues/fixes routes
4. **Teammate 2** → AI agent, memory, simulator, agent routes
5. **Teammate 3 again** → final integration pass, polish

## Merge Workflow
```bash
# When it's your turn:
git add -A
git commit -m "Description of what you built"
git push origin feature/YOUR-BRANCH-NAME
# Open PR on GitHub → merge to main

# After EACH merge, everyone pulls:
git checkout feature/YOUR-BRANCH
git pull origin main
git rebase main
# Fix any conflicts (there shouldn't be any if ownership is respected)
```

## Why This Order
- Pratham merges first because the context engine is the foundation everyone depends on
- Teammate 3 merges second because the Zustand store and shared components are used by all frontend tabs
- Teammates 1 and 2 can merge in either order — their code is independent
- Teammate 3's final pass wires everything together and polishes

#merge #workflow #git
