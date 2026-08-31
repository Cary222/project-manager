/**
 * Tool-name predicates shared by the chat views.
 *
 * Pi's built-in names are plain `write` / `edit`, but MCP servers expose the
 * same operations under prefixed or namespaced names, so each predicate also
 * accepts the common decorated forms.
 */

export function isWriteToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return (
    name === "write" ||
    name === "create_file" ||
    name.startsWith("write_") ||
    name.endsWith(".write") ||
    name.endsWith("_write")
  );
}

export function isEditToolName(toolName: string): boolean {
  const name = toolName.toLowerCase();
  return (
    name === "edit" ||
    name === "replace" ||
    name === "insert" ||
    name === "patch" ||
    name === "undo_last_change" ||
    name.startsWith("edit_") ||
    name.endsWith(".edit") ||
    name.endsWith("_edit") ||
    name.startsWith("replace_") ||
    name.endsWith(".replace") ||
    name.endsWith("_replace") ||
    name.startsWith("insert_") ||
    name.endsWith(".insert") ||
    name.endsWith("_insert") ||
    name.startsWith("patch_") ||
    name.endsWith(".patch") ||
    name.endsWith("_patch") ||
    name.includes("str_replace") ||
    name.includes("replace_editor") ||
    name.includes("apply_patch")
  );
}
