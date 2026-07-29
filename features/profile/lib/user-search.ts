/**
 * user-search.ts — 构建用户搜索字段值（searchName）
 *
 * 输入：用户原始 name
 * 输出：所有变体空格分隔的字符串，直接写入 User.searchName 字段
 *
 * 规则：
 *   - 原始名 lowercase
 *   - 如果含中文，加：全拼（连续） + 全拼反序（连续） + 拆字全拼 + 拆字全拼反序
 *   - 全部用空格分隔（用于 contains 模糊匹配）
 *
 * 此函数必须和 features/ai/tools/search-structured.ts 的输入侧 allTerms 构造逻辑保持一致。
 */
import { pinyin } from "pinyin-pro";

/**
 * 将中文名字转换为不带声调的拼音字符串（无空格），如 "张靖" → "zhangjing"
 */
export function chineseToPinyin(chinese: string): string {
  try {
    const result = pinyin(chinese, {
      toneType: "none",
      type: "string",
      nonZh: "removed",
      surname: "head",
    });
    return result.replace(/\s+/g, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 构建用户搜索字段值（searchName）
 *
 * 对任意 name 输入，返回所有变体以空格分隔的字符串：
 *   - 原始名 lowercase
 *   - 如果含中文：
 *       - 全拼（连续）  如 "张靖" → "zhangjing"
 *       - 全拼反序       如 "张靖" → "gnijgnahz"
 *       - 拆字全拼       如 "张靖" → "zhang jing"
 *       - 拆字全拼反序   如 "张靖" → "jing zhang"
 *   - 全部用空格分隔
 *
 * 示例：
 *   "Jing Zhang" → "jing zhang"
 *   "张靖"       → "zhangjing gnijgnahz zhang jing jing zhang"
 *   "Jing张靖"   → "jingzhang gnijgnahz zhang jing jing zhang"
 */
export function buildUserSearchTerms(name: string | null | undefined): string | null {
  if (!name || !name.trim()) return null;

  const trimmed = name.trim();
  const parts: string[] = [trimmed.toLowerCase()];

  // 含中文时，对中文字符生成拼音变体（非纯中文也生成，如 "cary（刘屹鹏）"）
  // pinyin-pro 的 nonZh:"removed" 会自动跳过非中文字符
  if (/[\u4e00-\u9fa5]/.test(trimmed)) {
    const pinyinStr = chineseToPinyin(trimmed);
    if (pinyinStr) {
      parts.push(pinyinStr);
      parts.push(pinyinStr.split("").reverse().join(""));
    }

    // 拆字拼音（每个字单独一个 token）
    const charPinyins = pinyin(trimmed, {
      toneType: "none",
      type: "array",
      nonZh: "removed",
      surname: "head",
    }) as string[];
    if (charPinyins.length > 0) {
      parts.push(charPinyins.join(" "));
      parts.push([...charPinyins].reverse().join(" "));
    }
  }

  // 去重后用空格连接
  const unique = [...new Set(parts)];
  return unique.join(" ");
}
