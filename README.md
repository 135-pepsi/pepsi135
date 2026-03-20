# 元源紫泽 MES 生产管理系统（GitHub Pages + Supabase）

## 1. Supabase 初始化
1. 创建 Supabase 项目。
2. 打开 SQL Editor，执行 `supabase_schema.sql`。
3. 如需使用物料页面，再执行 `supabase_materials_schema.sql`。
4. 若你之前执行过 `owner_id` 隔离策略（或出现“不同账号无法互相同步”），再执行 `supabase_migration_20260301_shared_rw_policy.sql`。
5. 如需使用“修改记录”审计页面，再执行 `supabase_migration_20260321_audit_logs.sql`，并向 `mes_audit_admins` 表插入允许查看审计日志的邮箱。
6. 在项目设置复制：
- `Project URL`
- `anon public key`

## 2. 配置前端
线上推荐使用“运行时注入”：把真实配置写到 `config.runtime.js`（不提交仓库）。

推荐顺序：
1. 复制 `config.runtime.example.js` 为 `config.runtime.js`，填写真实 Supabase 配置（GitHub Pages / 服务器都用这个）
2. `config.prod.js` 仅保留安全默认值（可提交）
3. 本地调试如需临时覆盖，再复制 `config.example.js` 为 `config.js`（可不提交）

```js
window.MES_CONFIG = {
  SUPABASE_URL: "https://你的项目.supabase.co",
  SUPABASE_ANON_KEY: "你的anon_key",
  AUTO_REFRESH_SECONDS: 15,
  // 图纸上传服务（可选）
  UPLOAD_API_BASE: "http://你的上传服务地址:3000",
  UPLOAD_MAX_MB: 50,
  UPLOAD_ACCEPT: ".pdf,.jpg,.jpeg,.png,.dwg,.step,.zip,.rar",
};
```

> 安全说明：当前推荐 SQL 策略为“未登录可读（只读），登录后可写（共享同一份数据）”。前端也会在未登录时阻止写入操作。
> 配置说明：`config.example.js` / `config.prod.js` / `config.runtime.example.js` 可以提交；`config.runtime.js` 与 `config.js` 建议仅本地/部署环境维护（已在 `.gitignore` 中）。

## 3. 本地验证
- 直接打开 `index.html`
- 页面标题下方应显示：`云端共享模式` 或 `云端只读（未登录）`
- 两台电脑打开同一页面，修改订单后另一台约 15 秒内可见
- 如显示 `云端只读（未登录）`，点击页面右上角 `邮箱登录`，按邮件中的登录链接返回页面后即可写入

## 4. 部署到 GitHub Pages
1. 上传文件到仓库根目录：
- `index.html`
- `styles.css`
- `app.js`
- `supabase.min.js`
- `config.prod.js`
- `config.example.js`
- `config.runtime.example.js`
- `xlsx.full.min.js`
- `supabase_schema.sql`
- `supabase_materials_schema.sql`

2. 使用 GitHub Actions 注入运行时配置（推荐）
- 进入仓库 `Settings -> Secrets and variables -> Actions -> New repository secret`
- 新建以下 secrets：
  - `SUPABASE_URL`（例如 `https://xxxx.supabase.co`）
  - `SUPABASE_ANON_KEY`（`sb_publishable_...`）
  - `UPLOAD_API_BASE`（可空）
- 确认仓库存在 workflow：`.github/workflows/deploy-pages.yml`

3. 仓库 Settings -> Pages
- Source: `Deploy from a branch`
- 改为 `GitHub Actions`

4. 推送到 `main`（或手动触发 Actions）后访问：
- `https://你的用户名.github.io/仓库名/`

## 5. 功能说明
- 类 Excel 快速录入、双击改单元格、回车按常用顺序跳转字段
- Excel 导入/导出（导入为“同键覆盖+新增”，不会自动删除未包含的历史订单）
- 开启 Supabase 后：多电脑共享同一份数据
- 云端异常时自动降级本地模式（避免反复弹窗）
- 断线后支持自动重连；也可点击“重连云端”手动重连
- `material.html` 为物料页面，字段：订单号、客户、物料、规格、数量、金额、是否齐备

## 6. 订单页 UI（当前版本）
- 顶部 KPI：总单、加工中、今日交期、异常数
- 订单明细显示上限 30 行，高度控制在单屏区域
- 关键列固定：序号、订单号、客户、状态、交期、操作
- 操作列右侧固定（滚动时持续可见）
- 名称/图号为“预览”入口（有图纸高亮）
- 名称/备注长文本单行截断，鼠标悬浮可看全文
- 支持紧凑模式切换（并记忆到本地）

## 7. 状态与弹窗交互
- 状态统一显示为“文字 + 固定色块”，颜色总数不超过 5 种
- 加工中状态显示进度条（`当前序/总序`）
- 状态弹窗提供“下一步”推进流程：
  `待排产 -> 已排产 -> 加工中第N序 -> 完成待检 -> 已发货`
- 状态弹窗标题显示当前订单号
- 标题下固定显示工序上下文：
  `当前第N序 / 共M序 / 剩余K序`
- 各业务弹窗底部按钮顺序统一为：`取消 | ... | 保存`

## 8. 数据校验与反馈
- 关键输入即时校验（错误直接显示在单元格下方）：
  - 订单号重复
  - 数量非数字
  - 交期早于开始时间
- 行内编辑有“未保存”红点标记（右上角小点）
- 保存成功后：
  - 行级浅绿色高亮约 1.5 秒
  - 页面右上显示“已保存到 NAS”

## 9. 图纸附件（按订单明细行）
- 每行订单可单独上传图纸
- 支持在线预览（图片 / PDF），不支持类型可下载查看
- 上传后名称/图号预览位显示“已上传时间”
- 图纸接口依赖 `UPLOAD_API_BASE`，未配置时仅提示，不影响订单基础功能
- `audit.html` 为修改记录页，仅登录且已加入 `mes_audit_admins` 的账号可查看；日志由数据库触发器自动记录订单/物料的新增、修改、删除
