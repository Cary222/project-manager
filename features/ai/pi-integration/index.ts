/**
 * Pi Integration Runtime Bridge — ProjectHub 与 Pi Web / Coding Agent 的唯一接缝。
 *
 * 核心架构原则：
 *   Pi = Coding Runtime Integration（会话生命周期、所有权校验、策略门禁、UI桥接）
 *   业务能力 = Shared Capability（统一归属 features/ai/core/，受控于 resolveDataScope()）
 *
 * ⚠️ 边界约束：
 * - 本目录职责仅限 Session、Policy、UI Bridge、Coding Adapter；
 * - 严禁在本目录内新建或维护第三套业务工具层（tools/）；
 * - Pi 未来如需扩展业务查询能力，必须统一复用 Shared Capability Registry 与 Core Queries。
 */

export { PiCodingAdapter, type PiRuntimePort } from "./PiCodingAdapter";
export { PiWebUiBridge } from "./PiWebUiBridge";
export {
 createPiSessionOwnership,
 requireOwnedPiSession,
 requireOwnedPiSessionIfEnabled,
 listOwnedPiSessionIds,
 type PiSessionSource,
} from "./pi-session-ownership";
export {
 ProjectHubPolicyExtension,
 type PreExecutionDecision,
} from "./ProjectHubPolicyExtension";
export {
 isPiOwnershipEnabled,
 isWorkOrchestratorEnabled,
} from "./feature-flags";
