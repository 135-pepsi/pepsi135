# DS218j 静态版部署说明

## 1. 打包静态站
在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-synology-static.ps1
```

如果要把当前 Supabase 的“订单+物料”数据一起固化到静态版，先导出种子再打包：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-synology-static.ps1 -ExportSeedFromSupabase
```

输出目录：

`dist/synology-static`

说明：首次打开页面时会自动把 `seed-data.js` 导入浏览器本地存储（仅首次或本地为空时），从而离线也能看到已导出的数据。

## 2. 群晖 DS218j 准备
1. 在 DSM 套件中心安装并启用 `Web Station`。  
2. 确认共享目录 `web` 可用（默认路径通常是 `/volume1/web`）。  
3. 在 `Web Station -> Web 服务门户` 新建一个基于 Nginx 的网站（也可先用默认站点测试）。

## 3. 上传文件
把 `dist/synology-static` 目录内文件全部上传到站点目录，例如：

- `/volume1/web/mes-static/`

访问地址示例：

- `http://NAS局域网IP/mes-static/`
- `http://NAS局域网IP/mes-static/index.html`

## 4. 运行时配置（关键）
编辑部署目录内的 `config.runtime.js`，确认以下字段：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `UPLOAD_API_BASE`（如未启用上传服务可留空）

注意：静态版运行依赖此文件，不能缺失。

## 5. Supabase 回调与白名单
如果你要用“邮箱登录（Magic Link）”，在 Supabase 控制台设置：

1. `Auth -> URL Configuration -> Site URL`  
   设为你的最终访问地址，例如：`https://mes.your-domain.com/mes-static/`
2. `Redirect URLs`  
   增加：
   - `https://mes.your-domain.com/mes-static/`
   - `https://mes.your-domain.com/mes-static/index.html`

否则用户会出现登录后无法回跳的问题。

## 6. HTTPS（推荐）
1. DSM `控制面板 -> 安全性 -> 证书` 申请证书（Let's Encrypt）。  
2. DSM `登录门户 -> 反向代理` 将域名 `443` 反代到本地站点。  
3. 在 Supabase 里把 Site URL/Redirect URLs 改为 HTTPS 地址。

## 7. 升级流程
后续更新建议固定流程：

1. 本地执行打包脚本；
2. 覆盖上传 `dist/synology-static` 中的文件；
3. 浏览器强刷（`Ctrl+F5`）验证版本。

## 8. 常见问题
- 页面能打开但数据显示“只读/未连接”：先检查 `config.runtime.js` 是否正确。  
- 邮箱登录失败：检查 Supabase 的 `Site URL` 与 `Redirect URLs` 是否和实际访问地址完全一致。  
- 上传附件失败：检查 `UPLOAD_API_BASE`、NAS 到上传服务的网络连通性和 CORS 设置。
