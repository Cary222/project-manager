import type { PolicyContext } from "@/features/ai/agents/work/subagents/types";

export type PreExecutionDecision = "ALLOW" | "DENY" | "WAITING_APPROVAL";

type PolicyGateway = {
  check(
    context: PolicyContext,
  ): Promise<{ decision: "allow" | "deny" | "approve"; reason?: string }>;
};

type ApprovalWaiter = {
  wait(context: PolicyContext, reason: string): Promise<boolean>;
};

/**
 * Runtime-facing pre-execution gate. Call `run` around the actual executor,
 * never from an event consumer after a Pi tool_call has already happened.
 */
export class ProjectHubPolicyExtension {
  constructor(
    private readonly gateway: PolicyGateway,
    private readonly approvals: ApprovalWaiter,
  ) {}

  async run<T>(context: PolicyContext, execute: () => Promise<T>): Promise<T> {
    const result = await this.gateway.check(context);
    if (result.decision === "deny") {
      throw new Error(result.reason ?? "Tool call denied by ProjectHub policy");
    }
    if (result.decision === "approve") {
      const approved = await this.approvals.wait(
        context,
        result.reason ?? "Approval required",
      );
      if (!approved) throw new Error("Tool call was not approved");
    }
    return execute();
  }
}
