import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateProjectProgressSummary } from "./generate-progress-summary";
import { prisma } from "@/shared/db/client";

vi.mock("@/shared/db/client", () => ({
    prisma: {
        ticket: {
            findMany: vi.fn(),
        },
        ticketCommit: {
            findMany: vi.fn(),
        },
        workflowRun: {
            update: vi.fn(),
        },
    },
}));

vi.mock("@/features/ai/llm/summarizer", () => ({
    callAgnes: vi.fn().mockResolvedValue({
        content: "## 📊 阶段进展总览\n\nAI生成的项目进展汇总分析。",
    }),
}));

describe("generateProjectProgressSummary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("aggregates tickets and commits, calls LLM, and persists metadata", async () => {
        const mockTickets = [
            {
                id: "t1",
                ticketNo: 10001,
                title: "重构 AI Work 模块",
                status: "DEVELOPING",
                priority: 1,
                updatedAt: new Date("2026-09-01T10:00:00Z"),
                project: { id: "p1", name: "Project Hub" },
                module: { id: "m1", name: "AI Agent" },
                assignees: [{ user: { id: "u1", name: "Cary" } }],
            },
            {
                id: "t2",
                ticketNo: 10002,
                title: "修复转写流式中断 Bug",
                status: "DONE",
                priority: 2,
                updatedAt: new Date("2026-09-01T11:00:00Z"),
                project: { id: "p1", name: "Project Hub" },
                module: { id: "m2", name: "Meeting" },
                assignees: [{ user: { id: "u2", name: "Alice" } }],
            },
        ];

        const mockCommits = [
            {
                id: "c1",
                commitSha: "abc123456789",
                author: "Cary",
                subject: "feat: add work mode projection",
                committedAt: new Date("2026-09-01T11:30:00Z"),
                ticketNo: 10001,
                ticket: { id: "t1", title: "重构 AI Work 模块" },
            },
        ];

        vi.mocked(prisma.ticket.findMany).mockResolvedValue(
            mockTickets as unknown as Awaited<
                ReturnType<typeof prisma.ticket.findMany>
            >,
        );
        vi.mocked(prisma.ticketCommit.findMany).mockResolvedValue(
            mockCommits as unknown as Awaited<
                ReturnType<typeof prisma.ticketCommit.findMany>
            >,
        );
        vi.mocked(prisma.workflowRun.update).mockResolvedValue(
            {} as unknown as Awaited<
                ReturnType<typeof prisma.workflowRun.update>
            >,
        );

        const result = await generateProjectProgressSummary(
            "run-123",
            "user-1",
        );

        expect(result.ticketCount).toBe(2);
        expect(result.inProgressCount).toBe(1);
        expect(result.resolvedCount).toBe(1);
        expect(result.commitCount).toBe(1);
        expect(result.summary).toContain("阶段进展总览");
        expect(result.tickets).toHaveLength(2);
        expect(result.tickets[0].ticketNo).toBe(10001);
        expect(result.commits).toHaveLength(1);
        expect(result.commits[0].shortSha).toBe("abc1234");

        expect(prisma.workflowRun.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "run-123" },
                data: expect.objectContaining({
                    status: "completed",
                }),
            }),
        );
    });
});
