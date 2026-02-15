# 元源紫泽 MES 生产管理系统（GitHub Pages + Supabase）

## 1. Supabase 初始化
1. 创建 Supabase 项目。
2. 打开 SQL Editor，执行 `supabase_schema.sql`。
3. 如需使用物料页面，再执行 `supabase_materials_schema.sql`。
4. 在项目设置复制：
- `Project URL`
- `anon public key`

## 2. 配置前端
编辑 `config.js`：

```js
window.MES_CONFIG = {
  SUPABASE_URL: "https://你的项目.supabase.co",
  SUPABASE_ANON_KEY: "你的anon_key",
  AUTO_REFRESH_SECONDS: 15,
};
```

## 3. 本地验证
- 直接打开 `index.html`
- 页面标题下方应显示：`云端共享模式`
- 两台电脑打开同一页面，修改订单后另一台约 15 秒内可见

## 4. 部署到 GitHub Pages
1. 上传文件到仓库根目录：
- `index.html`
- `styles.css`
- `app.js`
- `supabase.min.js`
- `config.js`
- `xlsx.full.min.js`
- `supabase_schema.sql`
- `supabase_materials_schema.sql`

2. 仓库 Settings -> Pages
- Source: `Deploy from a branch`
- Branch: `main` + `/(root)`

3. 等待部署后访问：
- `https://你的用户名.github.io/仓库名/`

## 5. 功能说明
- 类 Excel 快速录入、双击改单元格、下拉选择
- Excel 导入/导出
- 开启 Supabase 后：多电脑共享同一份数据
- 云端异常时自动降级本地模式（避免反复弹窗）
- `material.html` 为物料页面，字段：订单号、客户、物料、规格、数量、金额、是否齐备
