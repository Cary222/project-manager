import { splitIntoChunks } from "./chunk";

export interface ParentChunk {
  id: string;
  sectionTitle: string;
  content: string;
  charStart: number;
  charEnd: number;
  childIds: string[];
}

export interface ChildChunk {
  id: string;
  parentId: string;
  sectionTitle: string;
  content: string;
  index: number;
}

export interface HierarchicalDocument {
  parents: ParentChunk[];
  children: ChildChunk[];
}

export interface HierarchicalOptions {
  parentMaxChars?: number; // default 2000
  childMaxChars?: number; // default 350 (optimal for semantic embedding & exact keyword match)
  childOverlap?: number; // default 50
}

/**
 * Splits Markdown into natural semantic sections by headings (#, ##, ###).
 * Fallback to double newline paragraphs if no headings exist.
 */
export function splitMarkdownIntoSections(
  markdown: string,
  maxSectionChars = 2500,
): Array<{ title: string; content: string; start: number; end: number }> {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Match Markdown headings (#, ##, ###)
  const headingRegex = /^(#{1,4})\s+(.+)$/gm;
  const sections: Array<{
    title: string;
    content: string;
    start: number;
    end: number;
  }> = [];

  const matches: Array<{ title: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRegex.exec(normalized)) !== null) {
    matches.push({ title: m[2].trim(), index: m.index });
  }

  if (matches.length === 0) {
    // No headings: split into natural paragraph blocks
    const rawBlocks = normalized.split(/\n\s*\n/);
    let currentBlock = "";
    let blockStart = 0;
    let blockIdx = 1;

    for (const block of rawBlocks) {
      if (
        currentBlock &&
        currentBlock.length + block.length > maxSectionChars
      ) {
        sections.push({
          title: `第 ${blockIdx} 节`,
          content: currentBlock.trim(),
          start: blockStart,
          end: blockStart + currentBlock.length,
        });
        blockIdx++;
        blockStart += currentBlock.length + 2;
        currentBlock = block;
      } else {
        currentBlock = currentBlock ? `${currentBlock}\n\n${block}` : block;
      }
    }
    if (currentBlock.trim()) {
      sections.push({
        title: `第 ${blockIdx} 节`,
        content: currentBlock.trim(),
        start: blockStart,
        end: normalized.length,
      });
    }
    return sections;
  }

  // Slice by heading boundaries
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const sectionStart = current.index;
    const sectionEnd = next ? next.index : normalized.length;
    const sectionText = normalized.slice(sectionStart, sectionEnd).trim();

    sections.push({
      title: current.title,
      content: sectionText,
      start: sectionStart,
      end: sectionEnd,
    });
  }

  return sections;
}

/**
 * Creates a two-tier Parent-Child hierarchy from text:
 * - Parent: larger section containing complete reasoning context (e.g. 1500~2500 chars).
 * - Child: small focused segment (e.g. 200~350 chars) for high-precision retrieval.
 */
export function createHierarchicalChunks(
  text: string,
  docId = "doc",
  options: HierarchicalOptions = {},
): HierarchicalDocument {
  const parentMaxChars = options.parentMaxChars ?? 2000;
  const childMaxChars = options.childMaxChars ?? 350;
  const childOverlap = options.childOverlap ?? 50;

  const sections = splitMarkdownIntoSections(text, parentMaxChars);
  const parents: ParentChunk[] = [];
  const children: ChildChunk[] = [];

  let globalChildIdx = 0;

  for (let pIdx = 0; pIdx < sections.length; pIdx++) {
    const sec = sections[pIdx];
    const parentId = `${docId}_p${pIdx + 1}`;
    const childIds: string[] = [];

    // Split parent section into small children for granular vector search
    const childTexts = splitIntoChunks(
      sec.content,
      childMaxChars,
      childOverlap,
    );

    for (let cIdx = 0; cIdx < childTexts.length; cIdx++) {
      const childId = `${parentId}_c${cIdx + 1}`;
      childIds.push(childId);
      children.push({
        id: childId,
        parentId,
        sectionTitle: sec.title,
        content: childTexts[cIdx],
        index: globalChildIdx++,
      });
    }

    parents.push({
      id: parentId,
      sectionTitle: sec.title,
      content: sec.content,
      charStart: sec.start,
      charEnd: sec.end,
      childIds,
    });
  }

  return { parents, children };
}

export interface ExpandableEvidence {
  id: string;
  title: string;
  content: string;
  type?: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Expands retrieved child chunks to their parent section context.
 * When multiple child chunks match within the same parent section,
 * deduplicates them to present the unified parent section once to the LLM.
 */
export function expandToParentSections<T extends ExpandableEvidence>(
  items: T[],
  parentStore?: Map<string, ParentChunk>,
): T[] {
  const seenParentIds = new Set<string>();
  const expandedList: T[] = [];

  for (const item of items) {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    const parentId = (meta.parentId || meta.parentChunkId) as
      | string
      | undefined;
    const parentContent = meta.parentContent as string | undefined;
    const sectionTitle = meta.sectionTitle as string | undefined;

    // If already has parent content embedded in metadata
    if (parentId && seenParentIds.has(parentId)) {
      // Deduplicate: same parent section already included
      continue;
    }

    if (parentId && parentStore && parentStore.has(parentId)) {
      seenParentIds.add(parentId);
      const parent = parentStore.get(parentId)!;
      expandedList.push({
        ...item,
        title: parent.sectionTitle
          ? `${item.title} > ${parent.sectionTitle}`
          : item.title,
        content: parent.content,
      });
      continue;
    }

    if (parentId && parentContent) {
      seenParentIds.add(parentId);
      expandedList.push({
        ...item,
        title: sectionTitle ? `${item.title} > ${sectionTitle}` : item.title,
        content: parentContent,
      });
      continue;
    }

    // Default: keep item unchanged
    expandedList.push(item);
  }

  return expandedList;
}

/**
 * Locates the enclosing Markdown section around a matched text snippet.
 */
/**
 * Strips indexed metadata header lines (标题, 章节, 作者, 项目, 标签, [chunk X/Y])
 * that are prepended during SearchDocument indexing.
 */
export function cleanIndexedHeader(content: string): string {
  return content
    .replace(/^(?:标题|章节|作者|项目|标签|\[chunk\s*\d+\/\d+\])[^\n]*\n?/gim, "")
    .trim();
}

export function findEnclosingSection(
  fullText: string,
  chunkSnippet: string,
  maxSectionChars = 2500,
): { sectionTitle?: string; sectionContent: string } {
  const sections = splitMarkdownIntoSections(fullText, maxSectionChars);
  const cleanBody = cleanIndexedHeader(chunkSnippet);
  const lines = cleanBody
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 6 && !l.startsWith("#"));

  for (const line of lines.slice(0, 5)) {
    const probe = line.slice(0, 40);
    const found = sections.find((s) => s.content.includes(probe));
    if (found) {
      return { sectionTitle: found.title, sectionContent: found.content };
    }
  }

  if (cleanBody.length >= 6) {
    const probe = cleanBody.slice(0, 40);
    const found = sections.find((s) => s.content.includes(probe));
    if (found) {
      return { sectionTitle: found.title, sectionContent: found.content };
    }
  }

  return { sectionContent: fullText.slice(0, maxSectionChars) };
}

/**
 * Asynchronously enriches evidence with parent sections by looking up underlying source notes or docs.
 * Bridges legacy/un-migrated records to the full parent section at runtime.
 */
export async function enrichEvidenceWithParentSections<T extends ExpandableEvidence>(
  items: T[],
  dbLookups?: {
    getNoteContent?: (noteId: string, sourceId?: string) => Promise<string | null>;
    getDocumentText?: (docId: string, sourceId?: string) => Promise<string | null>;
  },
): Promise<T[]> {
  const partiallyExpanded = expandToParentSections(items);
  if (!dbLookups) return partiallyExpanded;

  const fullyExpanded: T[] = [];
  for (const item of partiallyExpanded) {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    if (meta.parentContent || item.content.length > 800) {
      fullyExpanded.push(item);
      continue;
    }

    const sourceId = meta.sourceId as string | undefined;
    const isDoc = item.type === "doc" || meta.sourceType === "DOCUMENT" || Boolean(meta.isDocument);
    if (isDoc && dbLookups.getDocumentText) {
      try {
        const fullText = await dbLookups.getDocumentText(item.id, sourceId);
        if (fullText && fullText.length > item.content.length) {
          const section = findEnclosingSection(fullText, item.content);
          fullyExpanded.push({
            ...item,
            title: section.sectionTitle ? `${item.title} > ${section.sectionTitle}` : item.title,
            content: section.sectionContent,
          });
          continue;
        }
      } catch {
        /* ignore */
      }
    }

    const isNote = item.type === "note" || meta.sourceType === "PKM_NOTE";
    if (isNote && dbLookups.getNoteContent) {
      try {
        const fullText = await dbLookups.getNoteContent(item.id, sourceId);
        if (fullText && fullText.length > item.content.length) {
          const section = findEnclosingSection(fullText, item.content);
          fullyExpanded.push({
            ...item,
            title: section.sectionTitle ? `${item.title} > ${section.sectionTitle}` : item.title,
            content: section.sectionContent,
          });
          continue;
        }
      } catch {
        /* ignore */
      }
    }
    fullyExpanded.push(item);
  }
  return fullyExpanded;
}
