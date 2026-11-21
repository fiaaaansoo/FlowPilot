# Sprint 3 — Agent IA (récupération)

Zone : apps/api/, apps/extension/src/background/, packages/shared/src/messages.ts

Dépend de : sprint-2-record-replay.

- [ ] Backend FastAPI + Pydantic (actions structurées validées)
- [ ] Grounding déterministe d'abord (sélecteurs, ARIA, texte), LLM ensuite
- [ ] Contexte DOM limité et pertinent ; contenu des pages traité comme non fiable (anti prompt injection)
- [ ] Recovery agent borné (limite de tentatives), human-in-the-loop pour actions sensibles
- [ ] Fournisseur LLM interchangeable (Ollama optionnel)
