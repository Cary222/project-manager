/**
 * resolveCurrentInputImages tests (C3 fix).
 *
 * 覆盖：
 *   1. 并行解析多张图片（验证调用 resolveProviderImageSource 的次数 / 时序）
 *   2. 空输入返回空数组
 *   3. 任一失败抛错（错误不静默吞）
 *   4. 输出 url 顺序与输入 images 顺序一致
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveCurrentInputImages } from "../resolve-current-input-images";

// Mock file-source so we don't need DB
const mockResolveProviderImageSource = vi.fn();
vi.mock("@/features/ai/lib/storage/file-source", () => ({
  resolveProviderImageSource: (id: string) => mockResolveProviderImageSource(id),
}));

describe("resolveCurrentInputImages", () => {
  beforeEach(() => {
    mockResolveProviderImageSource.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array for empty input", async () => {
    const result = await resolveCurrentInputImages([]);
    expect(result).toEqual([]);
    expect(mockResolveProviderImageSource).not.toHaveBeenCalled();
  });

  it("resolves a single image", async () => {
    mockResolveProviderImageSource.mockResolvedValueOnce({
      url: "data:image/jpeg;base64,abc",
      mimeType: "image/jpeg",
    });
    const result = await resolveCurrentInputImages([
      { id: "asset-1", storageType: "BASE64", mimeType: "image/jpeg" },
    ]);
    expect(result).toEqual(["data:image/jpeg;base64,abc"]);
  });

  it("resolves multiple images in parallel (Promise.all)", async () => {
    // 模拟 5 张图，每张图延迟 50ms；并行解析应在 ~50ms 内完成（不是 5×50=250ms）
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const callTimes: number[] = [];
    const start = Date.now();

    for (let i = 0; i < 5; i++) {
      mockResolveProviderImageSource.mockImplementationOnce(async (id: string) => {
        callTimes.push(Date.now() - start);
        await sleep(50);
        return { url: `data:image/jpeg;base64,${id}`, mimeType: "image/jpeg" };
      });
    }

    const result = await resolveCurrentInputImages(
      [1, 2, 3, 4, 5].map((i) => ({
        id: `asset-${i}`,
        storageType: "BASE64",
        mimeType: "image/jpeg",
      })),
    );

    const elapsed = Date.now() - start;

    expect(result).toHaveLength(5);
    // 输出顺序与输入顺序一致
    expect(result).toEqual([
      "data:image/jpeg;base64,asset-1",
      "data:image/jpeg;base64,asset-2",
      "data:image/jpeg;base64,asset-3",
      "data:image/jpeg;base64,asset-4",
      "data:image/jpeg;base64,asset-5",
    ]);
    // 并行：所有调用在 30ms 内发起（远早于 50ms 第一个 sleep 完成）
    expect(callTimes[0]).toBeLessThan(30);
    expect(callTimes[4]).toBeLessThan(30);
    // 总耗时 ≈ 1×sleep 而非 5×sleep
    expect(elapsed).toBeLessThan(150);
  });

  it("throws when any image fails to resolve (no silent drop)", async () => {
    mockResolveProviderImageSource.mockImplementationOnce(async () => ({
      url: "data:image/jpeg;base64,ok1",
      mimeType: "image/jpeg",
    }));
    mockResolveProviderImageSource.mockImplementationOnce(async () => {
      throw new Error("FileAsset not found: asset-2");
    });

    await expect(
      resolveCurrentInputImages([
        { id: "asset-1", storageType: "BASE64", mimeType: "image/jpeg" },
        { id: "asset-2", storageType: "BASE64", mimeType: "image/jpeg" },
      ]),
    ).rejects.toThrow("FileAsset not found: asset-2");
  });
});