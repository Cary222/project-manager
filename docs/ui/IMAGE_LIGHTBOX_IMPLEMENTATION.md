# 图片预览（Lightbox）功能实现总结

## 功能需求

在 Markdown 输入框中添加图片后，点击缩略图可放大预览，点击右上角 X 关闭放大预览，图片保留在缩略图区域。

---

## 完整流程

### 第一步：在 Form 内联实现（错误做法 ❌）

**代码结构：**
```
form
├── 缩略图区域
│   └── img (onClick={setPreviewImage(img)})
│   └── button (onClick={removeImage(i)})  // 删除按钮
├── textarea
├── submit button
└── {previewImage && (
      <div className="fixed">  // Lightbox 内联在 form 内
        <button onClick={() => setPreviewImage(null)}>X</button>
        <img onClick={...} />
      </div>
    )}
```

**问题：** Lightbox 内联在 `<form>` 内部，所有事件被 React 事件委托系统统一处理。

---

### 第二步：Portal 渲染到 document.body（部分修复 ⚠️）

**代码结构：**
```tsx
return (
  <>
    {previewImage && createPortal(
      <div className="fixed inset-0 z-50" onClick={() => setPreviewImage(null)}>
        <button onClick={() => setPreviewImage(null)}>X</button>
        <img onClick={(e) => e.stopPropagation()} />
      </div>,
      document.body
    )}
    <div className="min-h-screen">
      {/* form 结构 */}
    </div>
  </>
);
```

**仍然存在的问题：** React 的事件委托系统仍然会让 Portal 内的事件触发父组件的事件处理器。即使 DOM 在 body 中，React 的事件系统仍然会将这些事件路由回原始组件树。

---

### 第三步：拆分为独立组件 + 缩略图删除按钮加 stopPropagation（部分修复 ⚠️）

```tsx
// ImageLightbox.tsx
export function ImageLightbox({ image, onClose, onDownload }) {
  return createPortal(
    <div className="fixed inset-0" onClick={onClose}>
      <button onClick={(e) => { e.stopPropagation(); onClose(); }}>X</button>
      <img onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body
  );
}

// ProjectDetail.tsx
<button onClick={(e) => { e.stopPropagation(); removeImage(i); }}>
```

**问题：** 仍然存在 React 事件批处理导致的事件同步触发问题。

---

### 第四步：使用 useRef guard（基础 ✅）

见下方「核心代码模板」。

---

### 第五步：删除按钮 hover 交互与事件穿透修复（完整 ✅）

#### 5.1 删除按钮的 hover 显示

**错误做法：**
```tsx
// ❌ group-hover:block 会导致整个 group（包括外层容器盒子）hover 时都显示
<button className="absolute ... group-hover:block ...">X</button>
```

**正确做法：**
```tsx
// ✅ 默认 hidden，只有 hover 单个缩略图时才显示
<button className="absolute ... hidden group-hover:flex ...">X</button>
```

```tsx
// ✅ 或者用 opacity
<button className="absolute ... opacity-0 group-hover:opacity-100 ...">X</button>
```

#### 5.2 删除按钮事件穿透问题

**现象：** 点击缩略图区域的容器盒子（而不是单个图片）时，触发了 `removeImage`。

**原因分析：**
- `stopPropagation` 只阻止 DOM 事件冒泡，不阻止 React 事件系统的事件分发
- React 将事件绑定到根元素，根据组件树分发，`stopPropagation` 无法完全切断同 React 根下的事件流
- `onClick` 的事件处理在 React 批处理中可能被多次触发

**多层防御方案（正确做法）：**

```tsx
{images.map((img, i) => (
  <div
    key={i}
    className="group relative"
    onClick={(e) => e.stopPropagation()}
    onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
  >
    {/* img 需要阻止冒泡，防止点击图片时冒泡到外层 */}
    <img
      src={img.src}
      onClick={(e) => { e.stopPropagation(); openPreview(img); }}
    />

    {/* 删除按钮用 onMouseDown（比 onClick 更早触发） */}
    {/* 移除 pointer-events-auto，它可能导致事件穿透 */}
    <button
      type="button"
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        removeImage(i);
      }}
      className="absolute ... hidden group-hover:flex ..."
    >
      X
    </button>
  </div>
))}
```

**关键点：**
- **缩略图容器 div**：`onClick` + `onMouseDown` 都加 `stopPropagation`
- **img**：`onClick` 加 `e.stopPropagation()`，防止点击图片时事件冒泡
- **删除按钮**：用 `onMouseDown` 替代 `onClick`，同时 `e.stopPropagation()` + `e.preventDefault()`
- **删除按钮样式**：不要加 `pointer-events-auto`，它会改变 CSS pointer-events 继承，导致事件穿透

---

## 核心雷点总结

### 雷点 1：Form 内联 Lightbox ❌

**问题：** Lightbox 内联在 `<form>` 内部时，所有事件（包括 form 内部的事件）都会被统一处理。

**解决方案：** 使用 Portal 渲染到 `document.body`，或在组件 return 最外层（form 外部）渲染。

### 雷点 2：React 事件委托 ⚠️

**问题：** 即使使用 Portal 将 Lightbox 渲染到 `document.body`，React 的事件委托系统仍然会将这些事件路由回原始组件树。这导致点击 Lightbox 的关闭按钮时，form 内部的 `removeImage` 可能被意外触发。

**症状：** 关闭放大图片后，缩略图区域的图片莫名其妙消失。

**根本原因：** React 将所有事件绑定到根元素，然后根据组件树分发。当点击 Portal 中的元素时，事件会冒泡到 React 根，React 再根据事件目标找到对应的组件处理器。由于 Lightbox 和 form 在同一个 React 根下，事件可能会被多次处理。

### 雷点 3：React 事件批处理 ⚠️

**问题：** React 18 的自动批处理可能导致多个状态更新在同一个批次中处理，引发竞态条件。

**示例：**
```tsx
// 点击缩略图打开 Lightbox
onClick={() => setPreviewImage(img)}

// 同时触发的删除按钮
onClick={(e) => { e.stopPropagation(); removeImage(i); }}

// 可能导致 setPreviewImage 和 removeImage 在同一批次处理
```

### 雷点 4：事件传播链 ⚠️

**问题：** `stopPropagation()` 只阻止 DOM 事件冒泡，不阻止 React 事件系统的事件分发。

**对比：**
| 方法 | 作用范围 | 对 React 事件系统 |
|------|---------|-----------------|
| `e.stopPropagation()` | DOM 事件冒泡 | 不保证阻止 |
| `e.nativeEvent.stopImmediatePropagation()` | 原生事件立即停止 | 部分有效 |
| `useRef` guard | 逻辑层阻止 | ✅ 有效 |

### 雷点 5：group-hover 作用域不精确 ❌

**问题：** `group-hover:block` 作用于按钮本身，但当外层容器有 `gap` 等布局时，整个 group 区域都算 hover 范围，导致移入容器空白区域也会显示删除按钮。

**正确做法：** 按钮默认 `hidden`，`group-hover:flex` 或 `group-hover:block` 控制显示。

### 雷点 6：onClick 事件穿透 ❌

**问题：** 点击图片列表的外层容器（不是单个图片）时，触发了删除按钮的事件。

**原因：** React 事件批处理中，`onClick` 的执行顺序不稳定，单靠 `stopPropagation` 无法完全切断。

**正确做法：**
- 删除按钮用 `onMouseDown` 替代 `onClick`（`onMouseDown` 更早触发，更可靠）
- 每个缩略图容器的 div 加 `onClick` + `onMouseDown` 的 `stopPropagation`
- img 的 `onClick` 也要加 `e.stopPropagation()`
- 配合 `useRef` guard 作为最后防线

### 雷点 7：pointer-events-auto 导致事件穿透 ⚠️

**问题：** Tailwind 的 `pointer-events-auto` 会显式设置 CSS `pointer-events: auto`，可能覆盖父元素的 `pointer-events: none`，导致事件穿透。

**正确做法：** 删除按钮不需要 `pointer-events-auto`，去掉它。

---

## 最终推荐方案

### 架构要求

1. **Lightbox 必须渲染到 document.body**（用 Portal）
2. **Lightbox 必须在 React 组件树的 form 外部**（在 return 的 Fragment 第一层）
3. **使用 useRef 作为逻辑 guard**（最后防线）
4. **多层事件防御**：每个层级都加 `stopPropagation`
5. **删除按钮用 onMouseDown**（比 onClick 更早、更可靠）
6. **不要用 pointer-events-auto**（可能导致事件穿透）

### 核心代码模板

```tsx
"use client";

import { createPortal } from "react-dom";
import { useState, useRef } from "react";

// === Lightbox 组件 ===
function ImageLightbox({ image, onClose, onDownload }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.name}
        className="max-h-[90vh] max-w-[90vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      {/* 关闭按钮 */}
      <button
        className="absolute right-4 top-4 ..."
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        X
      </button>
      {/* 下载按钮 */}
      <button
        className="absolute right-16 top-4 ..."
        onClick={(e) => { e.stopPropagation(); onDownload(); }}
      >
        Download
      </button>
    </div>,
    document.body
  );
}

// === 主组件 ===
export function YourComponent() {
  const [previewImage, setPreviewImage] = useState(null);
  const [images, setImages] = useState([]);
  const isLightboxOpenRef = useRef(false);  // 👈 关键！作为最后防线

  function openPreview(img) {
    isLightboxOpenRef.current = true;
    setPreviewImage(img);
  }

  function closePreview() {
    setPreviewImage(null);
    setTimeout(() => { isLightboxOpenRef.current = false; }, 0);
  }

  function removeImage(index) {
    if (isLightboxOpenRef.current) return;  // 👈 Guard 防止误删
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <>
      {/* 👈 Lightbox 在 form 外部 */}
      {previewImage && (
        <ImageLightbox
          image={previewImage}
          onClose={closePreview}
          onDownload={() => {
            const a = document.createElement("a");
            a.href = previewImage.src;
            a.download = previewImage.name || "image";
            a.click();
          }}
        />
      )}

      {/* form 内容 */}
      <form>
        {/* 缩略图区域 */}
        {images.map((img, i) => (
          <div
            key={i}
            className="group relative"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
          >
            {/* 👈 img 也需要阻止冒泡，防止点击图片时事件冒泡到外层 */}
            <img
              src={img.src}
              onClick={(e) => { e.stopPropagation(); openPreview(img); }}
            />

            {/* 👈 删除按钮用 onMouseDown，更可靠；不用 pointer-events-auto */}
            <button
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                removeImage(i);
              }}
              className="absolute ... hidden group-hover:flex ..."
            >
              X
            </button>
          </div>
        ))}
        <textarea />
        <button type="submit">提交</button>
      </form>
    </>
  );
}
```

### 关键点解释

| 要点 | 说明 |
|------|------|
| `isLightboxOpenRef` | mutable ref，不触发重新渲染，用于逻辑判断，是最后防线 |
| `setTimeout(..., 0)` | 确保在 React 批处理完成后才重置 guard |
| `stopPropagation` | 阻止 DOM 事件冒泡，多层防御 |
| `stopImmediatePropagation` | 原生事件立即停止，阻止同元素其他监听器 |
| `onMouseDown` 替代 `onClick` | `onMouseDown` 更早触发，更可靠 |
| `Portal + document.body` | 将 Lightbox DOM 移出组件树 |
| Lightbox 在 form 外 | 确保事件系统不会混淆 |
| `group-hover:flex` / `group-hover:block` | 控制删除按钮显示，优于 `group-hover:opacity-100` |
| 不使用 `pointer-events-auto` | 避免 CSS pointer-events 覆盖导致的事件穿透 |
| 每个层级都加 `stopPropagation` | img、容器 div、删除按钮，三层防御 |

---

## 不要做的事 ❌

1. **不要**在 form 内部渲染 Lightbox overlay
2. **不要**依赖 `stopPropagation` 作为唯一防护
3. **不要**在同一个 React 根下混用多个事件处理器
4. **不要**省略 `useRef` guard
5. **不要**在删除按钮加 `pointer-events-auto`
6. **不要**只用 `onClick` 而不用 `onMouseDown` 处理删除事件
7. **不要**省略缩略图容器 div 和 img 的 `stopPropagation`
8. **不要**用 `group-hover:block` 作为唯一显示控制（外层容器 hover 时会误触发）

## 应该做的事 ✅

1. **始终**用 Portal 渲染到 document.body
2. **始终**在 return 最外层渲染 Lightbox
3. **始终**用 useRef guard 保护可能误触发的事件
4. **始终**在删除按钮加 `stopPropagation`
5. **始终**在每个层级（容器 div、img、按钮）都加 `stopPropagation`
6. **始终**用 `onMouseDown` 替代 `onClick` 处理删除事件
7. **始终**用 `hidden` + `group-hover:flex/block` 控制删除按钮显示
8. **始终**移除 `pointer-events-auto`
