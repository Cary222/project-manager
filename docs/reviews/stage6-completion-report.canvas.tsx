import {
  Divider,
  Grid,
  H1,
  H2,
  Stack,
  Stat,
  Table,
  Text,
  canvasImage,
} from "qoder/canvas";

export default function Stage6CompletionReport() {
  return (
    <Stack gap={20}>
      <Stack gap={6}>
        <H1>Stage 6 完成报告：ProjectHub AI Settings / Model Selector 融合</H1>
        <Text tone="secondary">
          Pi 成熟模型配置 UX 成为 ProjectHub 新标准；ProjectHub DB / CredentialService /
          权限体系保持数据主权；Pi Workspace 与 PiSubAgent 零改动。
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="124/124" label="Vitest 单测通过" tone="success" />
        <Stat value="Build ✓" label="next build 成功" tone="success" />
        <Stat value="2316→412" label="ModelsConfig.tsx 薄壳化（行）" />
        <Stat value="5" label="浏览器实测 UI 场景通过" tone="success" />
      </Grid>

      <Divider />

      <H2>一、达成概览</H2>
      <Table
        headers={["目标", "结果", "证据"]}
        rows={[
          [
            "统一 Model Settings UI（Pi UX + ProjectHub DB）",
            "完成",
            "Settings 页新面板 + Pi 风格对话框浏览器实测",
          ],
          [
            "旧简陋 ModelConfigPanel 退出并删除",
            "完成",
            "ModelConfigPanel/ModelList/TinyModelSelector/useModelSortAndFilter 已删除，无残留引用",
          ],
          [
            "UserAiModelPreference 持久化（跨设备）",
            "完成",
            "迁移已应用，远程 DB 实测 count() 成功",
          ],
          [
            "统一 ModelRuntimeConfig + 字段级 Resolver",
            "完成",
            "17 个单测覆盖合并优先级与 reasoning levels",
          ],
          [
            "Chat / WorkAgent 接入 Runtime Config",
            "完成",
            "generate-response.ts / summarizer.ts 已接线，解析失败自动降级",
          ],
          [
            "Pi Workspace / PiSubAgent 不受影响",
            "完成",
            "models.json 链路文件未改动；Pi 对话框浏览器实测正常",
          ],
        ]}
        rowTone={[
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
        ]}
      />

      <H2>二、关键实施步骤</H2>
      <Table
        headers={["步骤", "内容"]}
        rows={[
          ["1", "Settings Schema Phase：新增 UserAiModelPreference（pm schema），手写迁移 SQL + resolve 登记 + generate"],
          ["2", "Shared Domain：model-runtime-config.ts（ReasoningLevel / availableReasoningLevels / 字段级 mergeRuntimeConfig / resolveModelRuntimeConfig）+ preferences service + /api/ai/models catalog 富化"],
          ["3", "ModelsConfig 2316 行拆分为 features/ai/ui/model-settings/ 16 个共享组件（adapter 驱动，不含 Prisma/models.json/Route Handler 依赖）"],
          ["4", "PiWorkspaceAdapter + ModelsConfig 薄壳（保留 OAuthDetail，继续写 models.json）"],
          ["5", "ProjectHubAdapter + 新 Settings UI + 4 个新 API 路由 + lib/model-connection-test.ts 双路由共用"],
          ["6", "Model Selection 持久化迁 DB（登录=DB SoT，匿名/失败=localStorage fallback，legacy 一次性迁移）"],
          ["7", "UnifiedModelSelector（搜索/厂商/能力筛选/Context/Reasoning 徽标/收藏/Thinking），model-selector.tsx 改为 re-export"],
          ["8-9", "Chat generate-response 与 summarizer 接 resolveModelRuntimeConfig（Selection 与 Runtime Configuration 分离）"],
          ["10", "全量回归：test 124/124、i18n 6/6、build 成功、浏览器 5 场景实测"],
          ["11", "删除旧 ModelConfigPanel 等 4 个旧 UI 文件，死引用扫描为零"],
        ]}
      />

      <H2>三、主要变更文件</H2>
      <Table
        headers={["类别", "文件"]}
        rows={[
          [
            "新增（共享套件）",
            "features/ai/ui/model-settings/：ModelSettingsPanel / ProviderForm / ProviderPicker / CredentialForm / ModelMetadata / CapabilityBadges / ThinkingConfig / CostConfig / ModelDiscoveryPanel / ConnectionTest / provider-icons / form-controls / adapter / types / i18n / helpers",
          ],
          [
            "新增（服务/路由）",
            "features/ai/llm/model-runtime-config.ts、preferences/user-model-preferences.ts、providers/presets.ts、user-providers.ts；app/api/ai/model-preferences、/api/ai/providers/{presets,discover,test}；lib/model-connection-test.ts",
          ],
          [
            "新增（ProjectHub UI）",
            "features/settings/components/project-hub-model-settings.tsx、model-settings-theme.css、features/settings/lib/project-hub-model-adapter.ts、features/ai/ui/model-select/UnifiedModelSelector.tsx",
          ],
          [
            "修改",
            "prisma/schema.prisma、registry.ts（catalog 富化）、models-config test/catalog 路由、ModelsConfig.tsx（薄壳）、ModelSelectionContext.tsx（DB 持久化）、model-selector.tsx（re-export）、ai-model-config-panel.tsx（新入口）、generate-response.ts、summarizer.ts",
          ],
          [
            "删除",
            "ModelConfigPanel.tsx（862 行）、ModelList.tsx、useModelSortAndFilter.ts、ui/select.tsx",
          ],
        ]}
      />

      <H2>四、验证证据</H2>
      <Table
        headers={["项目", "结果"]}
        rows={[
          ["npm run test", "16 文件 / 124 用例全部通过（含新增 17 例 Resolver 测试）"],
          ["npm run test:i18n", "6/6 通过"],
          ["npm run build", "编译成功（24.7s），全部路由产出"],
          ["DB 实测", "UserAiModelPreference 表存在且可查询（远程 pm schema）"],
          ["浏览器：Settings 新面板", "对话总结模型 + 我的 Provider + 配置按钮正常渲染"],
          ["浏览器：Pi 风格配置对话框", "树 + DB 合成 providers（deepseek/agnes）+ Provider Picker（30+ 卡片）正常"],
          ["浏览器：Pi Workspace 对话框", "models.json 链路原样工作"],
          ["浏览器：UnifiedModelSelector", "搜索过滤（8→5）/厂商与能力 chips/图标/徽标/收藏全部生效"],
          ["硬约束", "ProjectHubAdapter 仅 GET /api/models-config/catalog（只读）；PiSubAgent 与 workspace lib 本阶段零改动"],
        ]}
      />

      <Divider />

      <H2>五、浏览器实测截图</H2>
      <Grid columns={2} gap={12}>
        <Stack gap={4}>
          <Text size="small" tone="secondary">Settings 页 AI 模型配置（新 UI）</Text>
          <img
            src={canvasImage(
              "/Users/vastgui/Desktop/project-manager/docs/ui/stage6-step2-settings-ai-config.png"
            )}
            alt="Settings 页 AI 模型配置区域"
            style={{ width: "100%", borderRadius: 8 }}
          />
        </Stack>
        <Stack gap={4}>
          <Text size="small" tone="secondary">Pi 风格 AI 模型配置对话框（DB-backed）</Text>
          <img
            src={canvasImage(
              "/Users/vastgui/Desktop/project-manager/docs/ui/stage6-step3-pi-config-dialog.png"
            )}
            alt="Pi 风格配置对话框"
            style={{ width: "100%", borderRadius: 8 }}
          />
        </Stack>
        <Stack gap={4}>
          <Text size="small" tone="secondary">Provider Picker（搜索 / 分类 / 30+ 卡片）</Text>
          <img
            src={canvasImage(
              "/Users/vastgui/Desktop/project-manager/docs/ui/stage6-step3-provider-picker.png"
            )}
            alt="Provider 选择器"
            style={{ width: "100%", borderRadius: 8 }}
          />
        </Stack>
        <Stack gap={4}>
          <Text size="small" tone="secondary">Pi Workspace 模型对话框（models.json，未受影响）</Text>
          <img
            src={canvasImage(
              "/Users/vastgui/Desktop/project-manager/docs/ui/stage6-step5-pi-workspace-models-dialog.png"
            )}
            alt="Pi Workspace 模型配置对话框"
            style={{ width: "100%", borderRadius: 8 }}
          />
        </Stack>
        <Stack gap={4}>
          <Text size="small" tone="secondary">UnifiedModelSelector 下拉（Chat 页）</Text>
          <img
            src={canvasImage(
              "/Users/vastgui/Desktop/project-manager/docs/debug/verify-ai-step2b-dropdown-panel-full.png"
            )}
            alt="UnifiedModelSelector 下拉面板"
            style={{ width: "100%", borderRadius: 8 }}
          />
        </Stack>
        <Stack gap={4}>
          <Text size="small" tone="secondary">搜索过滤实测（agnes：8→5）</Text>
          <img
            src={canvasImage(
              "/Users/vastgui/Desktop/project-manager/docs/debug/verify-ai-step3-search-agnes.png"
            )}
            alt="搜索 agnes 过滤后的模型列表"
            style={{ width: "100%", borderRadius: 8 }}
          />
        </Stack>
      </Grid>

      <Divider />

      <H2>六、最终结果</H2>
      <Stack gap={8}>
        <Text>
          用户现在只看到一套模型配置 UI：ProjectHub AI Settings（Pi 成熟 UX + ProjectHub
          DB）。凭证加密、权限、默认模型、Discovery、Catalog、Connection Test
          能力全部保留并统一经由 CredentialService / Shared AI Domain 提供。
        </Text>
        <Text>
          两条数据流严格隔离：ProjectHub UI → /api/ai/* → UserApiKey /
          UserAiModelPreference；Pi Workspace UI → /api/models-config* → models.json →
          PiSubAgent。不存在双向 Source of Truth。
        </Text>
        <Text tone="secondary" size="small">
          剩余事项：OAuth Credential DB 化（独立 Schema Phase）、reasoning level 的
          provider-specific 请求注入、PiSubAgent → ModelRuntimeConfig 适配评估（Stage 7）。
        </Text>
      </Stack>
    </Stack>
  );
}
