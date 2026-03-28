# Collaboration Rules

> Part of [[Team]]

## The Golden Rules
1. **Never edit a file you don't own** — see [[File-Ownership]]
2. **Code against interfaces, not implementations** — use models.py as the contract
3. **Use APIRouter(prefix="/api")** — so routes wire into main.py without conflicts
4. **Pull after every merge** — stay up to date with main
5. **Test your demo flow end-to-end** before merging

## Handling Dependencies
- If you need code from a teammate who hasn't merged yet, code against the interface in models.py
- Use import with try/except if importing from another teammate's module
- It will resolve when they merge — don't wait, keep building

## Route Conflicts
Each person has their own route file (routes_core.py, routes_livebench.py, routes_agent.py). Teammate 3's main.py imports all of them with try/except so the app boots even before everyone merges.

## Communication
- If you're blocked on someone else's code, let them know immediately
- If you finish early, help Teammate 3 with polish
- Test cross-demo flows together before the final merge

#rules #collaboration #workflow
