---
name: projecthub-graphrag-reference
description: Routes ProjectHub knowledge-graph and GraphRAG design or implementation work to the local reference source repositories and the five Neo4j design skills. Use before designing KnowledgeNode, KnowledgeEdge, entity extraction, PostgreSQL graph retrieval, hybrid/RRF search, graph UI, communities, MCP graph tools, temporal facts, or GraphRAG evaluation.
license: MIT
allowed-tools: Bash Read Grep
---

# ProjectHub GraphRAG Reference

Use this as the entry point for ProjectHub knowledge-graph work. It is a **reference router**, not a runtime dependency or a directive to introduce Neo4j, Apache AGE, KuzuDB, or a new frontend package.

## MCP fast path

> `.mcp.json` registers the project-local, **read-only** `graph-reference` MCP. When the host exposes it, use its `graph_open_topic` tool first, then `graph_read_source` or `graph_search_sources`; read the `graph-reference://catalog` resource for this library's README. The shell lookup script below is the fallback for hosts without MCP tools.

## Non-negotiable local boundary

ProjectHub stays on its existing PostgreSQL `pm` schema, `pgvector`, Prisma, and ordinary relationship tables. Translate concepts from references into the existing domain; do not copy external code verbatim or transplant their infrastructure.

## Procedure

1. Identify the smallest topic below.
2. Run `./scripts/open-reference.sh <topic>` from this skill directory to print exact local files.
3. Read only the returned source files and the matching Neo4j skill; inspect callers/tests before proposing a ProjectHub change.
4. State which reference contributed the idea and how it maps to `KnowledgeNode`, `KnowledgeEdge`, `KnowledgeNodeSource`, or the existing `SearchDocument` pipeline.
5. Design the minimal PostgreSQL-native implementation. Do not create schemas or migrations until the user asks to implement.

## Topic → primary reference → required skill

| Topic | Primary source | Read skill |
| --- | --- | --- |
| Node / edge / provenance schema, constraints, intermediate relations | `pg-raggraph`, LightRAG `PGTableGraphStorage` | `neo4j-modeling-skill` |
| Entity & relationship extraction, resolution, document ingestion | LightRAG, Neo4j GraphRAG Python | `neo4j-document-import-skill` |
| Seed → recursive CTE → neighborhood → chunk → rerank | `pg-raggraph` | `neo4j-graphrag-skill` + `rag-retrieval` |
| Vector, lexical/BM25 and RRF fusion | GitNexus, `pg-raggraph` | `neo4j-vector-index-skill` + `rag-retrieval` |
| Local/global/DRIFT/community query concepts | Microsoft GraphRAG | `neo4j-graphrag-skill` |
| Graph page, Sigma.js/Graphology interactions | GitNexus | `neo4j-nvl-skill` + `pretty-ui` |
| Graph MCP tools, agent context, generated skills | GitNexus | `neo4j-graphrag-skill` |
| GitNexus agent working modes and generated skills | GitNexus `.claude/skills` | `projecthub-graphrag-reference` only |
| Temporal facts, incremental updates, historical state | Graphiti | `conversation-memory` |
| Knowledge Workspace / Markdown Vault UX | boujoy-harness | `pretty-ui` |

## Source roles

- **`pg-raggraph`**: first implementation reference for PostgreSQL-native GraphRAG. Favor its graph tables, recursive CTE traversal, entity–chunk mapping, retrieval modes, and benchmarks.
- **`LightRAG`**: algorithm and storage dictionary. Start with `lightrag/kg/pgtable_impl.py`; use only the portable node/edge + JSONB + index ideas.
- **`GitNexus`**: product architecture, hybrid search, graph canvas, MCP tools, communities, Wiki, and agent skills. It is not a database template for ProjectHub.
- **`microsoft-graphrag`**: theory reference for entities, text units, communities, community reports, local/global/DRIFT search. It is not the ProjectHub runtime.
- **`neo4j-graphrag-python`**: mature implementation patterns for KG Builder, resolver, vector/hybrid retrievers, and text-to-Cypher. Translate patterns; do not add Neo4j unless explicitly approved.
- **`graphiti`**: future temporal/incremental knowledge reference for ticket, owner, meeting, and architecture history.
- **`boujoy-harness`**: local knowledge-workspace UX only.

## Installed design skills

- `.agents/skills/neo4j-modeling-skill/`
- `.agents/skills/neo4j-graphrag-skill/`
- `.agents/skills/neo4j-document-import-skill/`
- `.agents/skills/neo4j-vector-index-skill/`
- `.agents/skills/neo4j-nvl-skill/`

Claude has matching copies in `.claude/skills/`. Pi loads this `.agents/skills/` entry directly.

## Update

To refresh the source library, use `git -C /Volumes/WorkStation/graph/<repo> pull --ff-only`. To update the installed Neo4j skills, use `npx skills update --project neo4j-modeling-skill neo4j-graphrag-skill neo4j-document-import-skill neo4j-vector-index-skill neo4j-nvl-skill`.
