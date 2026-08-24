/**
 * qoder/canvas 模块最小类型声明。
 * Canvas 报告文件（*.canvas.tsx）仅在 Qoder Canvas 运行时中渲染，
 * 此声明仅用于让项目级 TypeScript 编译（next build）通过。
 */
declare module "qoder/canvas" {
  import type * as React from "react";

  type CanvasProps = React.PropsWithChildren<Record<string, unknown>>;

  export const Stack: React.FC<CanvasProps>;
  export const Grid: React.FC<CanvasProps>;
  export const H1: React.FC<CanvasProps>;
  export const H2: React.FC<CanvasProps>;
  export const H3: React.FC<CanvasProps>;
  export const Text: React.FC<CanvasProps>;
  export const Stat: React.FC<CanvasProps>;
  export const Table: React.FC<CanvasProps>;
  export const Divider: React.FC<CanvasProps>;

  /** 引用本地截图资源（Canvas 运行时解析）。 */
  export function canvasImage(path: string): string;
}
