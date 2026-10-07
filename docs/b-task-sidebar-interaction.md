# B 交付：任务详情侧边栏交互约定与复用样式（给 C）

日期：2026-10-07。范围：B 的 P0 任务书第 3 条——「与 C 对齐任务侧边栏：桌面右侧、手机全屏、可键盘关闭、焦点能回到触发卡片。侧边栏主组件由 C 修改，我只交付交互约定和复用样式，避免双写」。

**归属：**主组件 `@/components/tasks/task-detail-panel` 导出 `TaskDetailPanel`，由 **C** 实现与维护；本文件与 `src/app/globals.css` 里新增的 `.ac-sidebar*` / `.ac-scrim` / `.ac-focus-return` 是 **B** 交付的交互约定与复用样式。B 不新建第二份任务 CRUD，也不改写看板卡片的数据结构。

## 1. 组件契约（与接口标准第 9.2 节一致，不自行改名）

```ts
TaskDetailPanel({ projectId, taskId, onClose, onSaved }: {
  projectId: string;
  taskId: string;
  onClose: () => void;
  onSaved: () => void;
})
```

- 面板内部用固定服务 `getTaskPanelData(actorId, projectId, taskId)` 取数，返回
  `{ task, labels, dependencies, subtaskProgress, allowedActions }`；身份取服务端会话，不接受浏览器传 `actorId`。
- `taskId` 变化或重新打开时**重新授权取详情**，不复用上一个任务的缓存。
- `onSaved()` **只在服务端确认保存成功后**调用；失败时保留用户输入并就地显示错误。
- 面板内不复用第二套任务写入；改状态/负责人/日期/阻塞/迭代归属走 C 的统一任务服务。

## 2. 交互约定

### 2.1 触发与打开

| 入口 | 行为 |
|---|---|
| 看板卡片 / 列表行点击 | 打开面板，不跳页；URL 同步为 `/projects/{projectId}?task={taskId}` |
| 深链接 `/projects/{projectId}?task={taskId}` | 直接打开该任务面板（A 的工作台与 D 的来源跳转都复用这个地址） |
| 手机 | 同上，面板全屏；返回手势/返回键先关闭面板 |

打开时记录**触发元素**的引用（`document.activeElement` 或卡片的 ref），供关闭时归还焦点。

### 2.2 布局

- **≥768px：**右侧固定栏，`max-width: 30rem`（480px），高度铺满，头部固定、正文滚动、底部操作栏固定。
- **<768px：**宽度 100%，整屏覆盖；头部保留关闭按钮，底部操作栏保留「保存」。
- 遮罩层 `z-index: 40`，面板 `z-index: 50`；面板打开时锁定 body 滚动，关闭后恢复原滚动位置。
- 直接套用类名：`ac-scrim`、`ac-sidebar`、`ac-sidebar-header`、`ac-sidebar-body`、`ac-sidebar-footer`。

### 2.3 关闭

必须支持三种方式，三者行为一致：

1. 头部关闭按钮（`aria-label="关闭任务详情"`）。
2. `Esc`（在面板内任意位置，包括输入框聚焦时也要生效；不要依赖 `keyup` 冒泡到 document 之外的实现）。
3. 点击遮罩空白处。

关闭时同步清除 URL 上的 `?task=` 参数（保留其它筛选参数，例如看板的分组/筛选），**不要整页刷新**，以保留当前看板筛选与滚动位置。

### 2.4 焦点管理（键盘可达性）

- 打开：焦点移入面板第一个可聚焦元素（建议是标题旁的关闭按钮或标题本身），面板容器加 `role="dialog"` `aria-modal="true"` `aria-labelledby` 指向任务标题。
- 打开期间：`Tab` / `Shift+Tab` 在面板内循环，不跑到被遮住的看板上。
- 关闭：焦点**回到打开它的那张卡片**，并给该卡片临时加上 `ac-focus-return` 类（约 1.5s 后移除或在下一次交互时移除），让键盘用户知道位置回到了哪里。
- 保存成功后若面板保持打开，焦点留在触发的保存按钮上；若关闭面板，按上一条归还。

### 2.5 状态与错误

| 情况 | 面板表现 |
|---|---|
| 加载中 | 头部显示标题占位，正文骨架；不显示上一任务的旧内容 |
| 无权限 / 任务已删除 | 面板内提示「任务不存在或你没有权限查看」，提供关闭按钮；不泄露其它项目任务 |
| 保存失败（校验） | 保留输入，字段旁显示原因 |
| 并发冲突 | 提示先刷新核对，刷新后由用户重新确认，不自动覆盖 |
| 结果不确定（网络中断） | 提示「请刷新确认保存状态」，重试复用同一 `requestId` |

## 3. 复用样式（已在 `src/app/globals.css` 增加）

| 类名 | 用途 |
|---|---|
| `.ac-scrim` | 半透明遮罩，`z-index: 40`，点击关闭 |
| `.ac-sidebar` | 面板容器：手机 100% 宽，≥768px 起 `max-width: 30rem`，右侧固定 |
| `.ac-sidebar-header` | 头部：标题 + 关闭按钮，底部一条分隔线 |
| `.ac-sidebar-body` | 正文：独立滚动，`overscroll-behavior: contain` |
| `.ac-sidebar-footer` | 底部操作栏：保存/取消，右对齐、可换行 |
| `.ac-focus-return` | 关闭后触发卡片上的可见焦点环 |

用法示例（样式部分直接照抄，逻辑由 C 实现）：

```tsx
<>
  <div className="ac-scrim" onClick={handleClose} aria-hidden />
  <aside className="ac-sidebar" role="dialog" aria-modal="true" aria-labelledby="task-panel-title">
    <header className="ac-sidebar-header">
      <h2 id="task-panel-title" className="font-display text-lg font-semibold">{task.title}</h2>
      <button className="ac-btn-ghost" onClick={handleClose} aria-label="关闭任务详情">关闭</button>
    </header>
    <div className="ac-sidebar-body">{/* 描述/状态/日期/标签/依赖/完成说明/迭代/验收标准；末尾嵌 E 评论与 D 来源反馈 */}</div>
    <footer className="ac-sidebar-footer">
      <button className="ac-btn-ghost" onClick={handleClose}>取消</button>
      <button className="ac-btn" disabled={saving} onClick={handleSave}>{saving ? "保存中…" : "保存"}</button>
    </footer>
  </aside>
</>
```

## 4. 与 E / D 的嵌入位置

- 面板正文底部嵌入 E 的 `TaskComments({ projectId, taskId })`，C 不重复实现评论库。
- 「来源反馈」区块读 D 的 `listTaskFeedbackAction(projectId, taskId)`，并提供到成果详情的反向跳转（`/projects/{projectId}/deliverables/{deliverableId}?feedbackId={feedbackId}`）。
- D 的成果详情页已经支持 `?versionId=` 与 `?feedbackId=` 定位，反向跳转直接复用。

## 5. 验收清单（B 复核时逐条走）

- [ ] 桌面 1280px：从看板卡片打开，面板在右侧，宽度不超过 30rem，看板筛选与滚动位置不变。
- [ ] 手机 390px：面板全屏，无横向滚动，底部保存按钮可点。
- [ ] 键盘：只用 Tab 能进入面板、能在面板内循环；`Esc` 关闭；关闭后焦点回到原卡片且可见。
- [ ] 深链接 `?task={taskId}` 直接打开；关闭后 URL 不再带 `?task=`，其它筛选参数保留。
- [ ] 保存成功后看板与概览刷新；保存失败时输入不丢、不显示成功；重复点击只提交一次。
- [ ] 切换到另一个任务时重新取详情，不显示上一个任务的内容。
