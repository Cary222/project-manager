#!/usr/bin/env bash
set -euo pipefail

root=/Volumes/WorkStation/graph
topic=${1:-}

usage() {
  cat <<'EOF'
Usage: open-reference.sh <topic>

Topics:
  modeling      PostgreSQL nodes, edges, provenance, and indexes
  ingestion     chunking, entity/relationship extraction, and resolution
  retrieval     seed entities, recursive CTE expansion, chunk mapping, rerank
  hybrid-search BM25/vector/RRF fusion and query routing
  communities   local/global/DRIFT queries and community reports
  graph-ui      Sigma.js, Graphology, and graph interactions
  agent-mcp     graph tools, agent context, generated skills
  gitnexus-skills GitNexus Exploring, Impact Analysis, Plan, Work, and Review skills
  temporal      incremental updates and historical facts
  workspace     local knowledge workspace UX
EOF
}

case "$topic" in
modeling)
  files=(
    "$root/pg-raggraph/src/pg_raggraph/sql/schema.sql"
    "$root/LightRAG/lightrag/kg/pgtable_impl.py"
    "$root/neo4j-skills/neo4j-modeling-skill/SKILL.md"
  )
  ;;
ingestion)
  files=(
    "$root/LightRAG/lightrag/kg/pgtable_impl.py"
    "$root/neo4j-graphrag-python/src/neo4j_graphrag/components/entity_relation_extractor.py"
    "$root/neo4j-graphrag-python/src/neo4j_graphrag/components/resolver.py"
    "$root/neo4j-skills/neo4j-document-import-skill/SKILL.md"
  )
  ;;
retrieval)
  files=(
    "$root/pg-raggraph/src/pg_raggraph/sql/schema.sql"
    "$root/pg-raggraph/src/pg_raggraph/retrieval.py"
    "$root/LightRAG/lightrag/operate.py"
    "$root/neo4j-skills/neo4j-graphrag-skill/SKILL.md"
  )
  ;;
hybrid-search)
  files=(
    "$root/GitNexus/gitnexus/src/core/search/hybrid-search.ts"
    "$root/pg-raggraph/research/rrf-fusion-vs-prior-art.md"
    "$root/neo4j-graphrag-python/src/neo4j_graphrag/retrievers/hybrid.py"
    "$root/neo4j-skills/neo4j-vector-index-skill/SKILL.md"
  )
  ;;
communities)
  files=(
    "$root/microsoft-graphrag/docs/query/local_search.md"
    "$root/microsoft-graphrag/docs/query/global_search.md"
    "$root/microsoft-graphrag/docs/query/drift_search.md"
    "$root/microsoft-graphrag/packages/graphrag/graphrag/query/structured_search/drift_search/search.py"
  )
  ;;
graph-ui)
  files=(
    "$root/GitNexus/gitnexus-web/src/components/GraphCanvas.tsx"
    "$root/GitNexus/gitnexus-web/src/lib/graph-adapter.ts"
    "$root/GitNexus/gitnexus-web/src/hooks/useSigma.ts"
    "$root/neo4j-skills/neo4j-nvl-skill/SKILL.md"
  )
  ;;
agent-mcp)
  files=(
    "$root/GitNexus/gitnexus/src/mcp/tools.ts"
    "$root/GitNexus/.claude/skills/gitnexus-exploring/SKILL.md"
    "$root/GitNexus/.claude/skills/gitnexus-impact-analysis/SKILL.md"
    "$root/neo4j-skills/neo4j-graphrag-skill/SKILL.md"
  )
  ;;
gitnexus-skills)
  files=(
    "$root/GitNexus/.claude/skills/gitnexus-exploring/SKILL.md"
    "$root/GitNexus/.claude/skills/gitnexus-debugging/SKILL.md"
    "$root/GitNexus/.claude/skills/gitnexus-impact-analysis/SKILL.md"
    "$root/GitNexus/.claude/skills/gitnexus-plan/SKILL.md"
    "$root/GitNexus/.claude/skills/gitnexus-work/SKILL.md"
    "$root/GitNexus/.claude/skills/gitnexus-review/SKILL.md"
  )
  ;;
temporal)
  files=(
    "$root/graphiti/README.md"
    "$root/graphiti/graphiti_core/namespaces/nodes.py"
    "$root/graphiti/graphiti_core/namespaces/edges.py"
    "$root/graphiti/graphiti_core/prompts/extract_edges.py"
  )
  ;;
workspace)
  files=(
    "$root/boujoy-harness/README.md"
    "$root/boujoy-harness"
  )
  ;;
'' | -h | --help)
  usage
  exit 0
  ;;
*)
  printf 'Unknown topic: %s\n\n' "$topic" >&2
  usage >&2
  exit 2
  ;;
esac

printf '# ProjectHub GraphRAG references: %s\n' "$topic"
for file in "${files[@]}"; do
  if [[ -e "$file" ]]; then
    printf '%s\n' "$file"
  else
    printf 'MISSING %s\n' "$file" >&2
  fi
done
