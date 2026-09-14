import { describe, expect, it } from "vitest";
import * as PiIntegration from "./index";
import { CAPABILITY_CATALOG } from "@/features/ai/core/capability-registry";

describe("Pi Integration Architectural Boundary", () => {
  it("pi-integration 仅导出 Runtime Bridge 核心（Session / Policy / Bridge / Adapter）", () => {
    expect(PiIntegration.PiCodingAdapter).toBeDefined();
    expect(PiIntegration.PiWebUiBridge).toBeDefined();
    expect(PiIntegration.createPiSessionOwnership).toBeDefined();
    expect(PiIntegration.requireOwnedPiSession).toBeDefined();
    expect(PiIntegration.ProjectHubPolicyExtension).toBeDefined();
    expect(PiIntegration.isPiOwnershipEnabled).toBeDefined();
  });

  it("pi-integration 严禁包含或导出独立的业务工具层", () => {
    const exportedKeys = Object.keys(PiIntegration);
    const forbiddenPatterns = [
      "queryTicket",
      "queryProject",
      "queryCommits",
      "submitReport",
      "tools",
    ];
    for (const key of exportedKeys) {
      for (const forbidden of forbiddenPatterns) {
        expect(key.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("业务能力唯一定义在 Shared Capability Registry 中", () => {
    const toolNames = CAPABILITY_CATALOG.map((c) => c.name);
    expect(toolNames).toContain("business_query");
    expect(toolNames).toContain("business_report");
    expect(toolNames).toContain("generate_text");
    expect(toolNames).toContain("read_resource");
    expect(toolNames).toContain("write_file");
    expect(toolNames).toContain("edit_file");
    expect(toolNames).toContain("execute_command");
  });
});
