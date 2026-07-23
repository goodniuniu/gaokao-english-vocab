# 部署指南

## 一、前端部署（GitHub Pages 自动构建）

### 工作原理

代码推送到 `main` 分支后，GitHub Actions 自动执行 `build.js`，将所有 `?v=DEV` 替换为内容哈希，然后部署到 GitHub Pages。全程无需手动操作。

### 首次配置（仅需一次）

1. 打开仓库 **Settings → Pages**
2. **Source** 选择 **GitHub Actions**（不是 Deploy from a branch）
3. 保存

### 日常部署流程

```bash
git add .
git commit -m "你的改动说明"
git push
```

推送后 1-2 分钟自动上线。可在仓库 **Actions** 标签页查看构建进度。

### 自动哈希缓存方案

- `index.html` 中所有静态资源引用写 `?v=DEV` 占位符
- `build.js` 构建时根据文件内容自动生成 8 位哈希（如 `?v=acccc0af`）
- 文件没改 → 哈希不变 → 用户命中浏览器缓存（快）
- 文件改了 → 哈希变化 → 浏览器自动拉取新版本（新）

### 本地预览构建结果

```bash
npm run build           # 构建到 dist/
cd dist && python -m http.server 8125   # 本地预览
```

---

## 二、后端部署（Cloudflare Workers + KV）

本指南帮你一步步部署免费后端，实现跨设备数据同步。

> 全程免费，约 15 分钟完成。Cloudflare Workers 免费额度：每天 10 万次请求，完全够用。

---

## 前置条件

- 一个邮箱（注册 Cloudflare 用）
- 电脑上已安装 Node.js（你已有）

## 第一步：注册 Cloudflare 账号

1. 打开 https://dash.cloudflare.com/sign-up
2. 用邮箱注册，选择 **Free** 免费计划
3. 不需要绑定域名，也不需要绑卡

## 第二步：安装 Wrangler CLI

```bash
cd worker
npm install
```

> wrangler 是 Cloudflare 的命令行部署工具，已写在 worker/package.json 中

## 第三步：登录 Cloudflare

```bash
npx wrangler login
```

浏览器会自动打开，点击 "Allow" 授权即可。

## 第四步：创建 KV 存储空间

```bash
npx wrangler kv namespace create VOCAB_KV
```

命令会输出类似：

```json
{ "id": "abc123def456..." }
```

**复制这个 id**，打开 `worker/wrangler.toml`，把 `id` 替换进去：

```toml
[[kv_namespaces]]
binding = "VOCAB_KV"
id = "abc123def456..."    # ← 替换为你的 id
```

## 第五步：部署 Worker

```bash
npx wrangler deploy
```

部署成功后会输出你的 Worker 地址：

```
https://gaokao-vocab-sync.你的子域名.workers.dev
```

**记下这个地址**，下一步要用。

## 第六步：在前端配置地址

1. 用浏览器打开应用：https://goodniuniu.github.io/gaokao-english-vocab/
2. 点击右上角 ⚙️ 设置
3. 找到「☁️ 云同步」区域
4. 填入 Worker 地址：`https://gaokao-vocab-sync.你的子域名.workers.dev`
5. 点击「保存地址」

## 第七步：注册同步账号

1. 在设置 → 云同步中，输入名字
2. 点击「注册并获取同步码」
3. 系统会生成一个 **6 位同步码**（如 `AB3XK9`）
4. **记好这个同步码**——这是跨设备恢复数据的钥匙

## 使用方法

### 在女儿设备上使用

1. 打开 https://goodniuniu.github.io/gaokao-english-vocab/
2. 设置 → 云同步 → 用同步码登录
3. 输入同步码 `AB3XK9`
4. 数据自动从云端恢复

### 日常使用

- **自动同步**：每次答题后，数据会在后台自动同步（每 2 分钟或页面关闭时）
- **手动同步**：设置 → 立即同步
- **断开同步**：设置 → 断开同步（本地数据保留，只是不再上传）

---

## 数据存储说明

| KV Key | 内容 |
|--------|------|
| `code:AB3XK9` | 同步码 → 用户信息映射 |
| `data:AB3XK9` | 完整学习数据（SRS / 错题本 / 设置等，含 `lastSync` 版本戳） |
| `rl:IP:分钟戳` | 限流计数（自动过期，无需管理） |

数据格式为 JSON，包含：SRS 记录、错题本、最佳成绩、已练题数、自定义单词、每日进度、设置。

## 常见问题

### Q: 免费额度够用吗？
A: 每天可自动同步 10 万次。即使每分钟同步一次，一天也只有 1440 次，远在额度内。

### Q: 同步码丢了怎么办？
A: 目前同步码不可找回。建议：截图保存 / 写在笔记本上 / 多设备都登录一次。

### Q: 数据安全吗？
A: 数据存在 Cloudflare KV 中，只有知道同步码才能访问。同步码为 6 位字母数字组合（去掉易混淆的 IO01），由加密安全随机数生成，约 10 亿种可能；敏感接口有按 IP 的速率限制，且 API 只允许白名单网站来源调用。

### Q: 可以多人共用一个同步码吗？
A: 可以。同一同步码在多设备上登录，各自答题后会自动同步。多设备同时使用时，后上传的一方若检测到云端已被更新（409 冲突），会自动与云端数据按字段合并后重传，不会互相覆盖丢失。但仍建议每人一个同步码，进度统计更清晰。

### Q: 如何查看/管理 KV 中的数据？
```bash
# 列出所有 key
npx wrangler kv key list --binding=VOCAB_KV

# 查看某个 key 的数据
npx wrangler kv key get --binding=VOCAB_KV "data:AB3XK9"
```

---

## API 文档

| 端点 | 方法 | 说明 | 限流（每 IP 每分钟） |
|------|------|------|------|
| `/api/register` | POST | 注册新用户，返回同步码与初始 `lastSync` | 5 次 |
| `/api/data/:code` | GET | 获取指定同步码的全部数据 | 20 次 |
| `/api/sync/:code` | POST | 上传数据到指定同步码（见下方说明） | 不限 |
| `/api/check/:code` | GET | 检查同步码是否存在（不回显用户名） | 10 次 |
| `/api/health` | GET | 健康检查 | 不限 |

### POST /api/sync/:code 请求体

```json
{
  "srs": {}, "wrong": {}, "best": {}, "done": 0,
  "custom": [], "daily": {}, "streak": {}, "settings": {},
  "baseSync": 1753000000000
}
```

- `baseSync`：客户端最后一次见到的云端 `lastSync`，用于多设备冲突检测（旧客户端可省略，省略则退化为整包覆盖）
- 校验：请求体超过 1MB 返回 **413**；字段类型非法返回 **400**；`custom` 上限 2000 条
- 冲突：若云端 `lastSync` 晚于 `baseSync`（已被其他设备更新），返回 **409** `{ ok:false, code:'conflict', lastSync }`；客户端随后会自动拉取云端数据、按字段合并（SRS 逐词取练习量更大的一侧、错题/最佳取大、自定义词取并集）后重传
- 成功返回 `{ ok:true, lastSync }`，客户端据此更新基线

### 安全机制

- 同步码使用 `crypto.getRandomValues` 生成（加密安全随机数）
- 枚举敏感接口按 IP 限流（KV 固定窗口计数，`rl:` 前缀 key 自动过期）；更高强度防护可在 Cloudflare Dashboard 配置 Rate Limiting 规则
- `ALLOWED_ORIGINS`（`wrangler.toml` `[vars]`）限制可调用 API 的网站来源；`localhost/127.0.0.1` 始终放行便于本地开发，自建部署时改成自己的前端域名即可

---

## ALLOWED_ORIGINS 配置详解

Worker 通过检查浏览器请求的 `Origin` 头来防止恶意网站借用户浏览器调用 API。配置在 `worker/wrangler.toml`：

```toml
[vars]
ALLOWED_ORIGINS = "https://你的域名.com,http://www.你的域名.com,https://www.你的域名.com"
```

**关键规则**（踩过的坑）：

1. **逗号分隔，精确匹配**。`Origin` = scheme + host + port，不含路径。以下都被视为**不同**的 Origin：
   - `https://example.com` ≠ `http://example.com`（协议不同）
   - `https://example.com` ≠ `https://www.example.com`（www 和裸域不同）
   - `https://example.com` ≠ `https://example.com:8080`（端口不同）

2. **`localhost` / `127.0.0.1` 始终放行**，无需配进白名单（本地开发友好）。

3. **不配或设为 `*` = 不限制**（任何网站都能调用，仅适用于无敏感数据的场景）。

4. **改完必须重新部署**：`cd worker && npx wrangler deploy`。

5. **`Origin: null` 会被拦截**。以下场景浏览器会发送 `Origin: null`：
   - 从 `file://` 协议打开（双击 index.html）
   - iframe sandbox
   - 浏览器严格隐私模式
   如果你需要支持这些场景，把白名单设为 `*` 或单独处理。

---

## 自定义域名与 CDN 配置

如果你除了 `*.github.io` 还用自己的域名（如 `www.example.com`），按以下步骤配置。

### 架构选择

```
方案 A（简单，无 CDN）：
  浏览器 → DNS 直接指向 GitHub Pages IP → GitHub Pages（含免费 HTTPS 证书）

方案 B（国内加速，推荐面向国内用户）：
  浏览器 → DNS 指向 EdgeOne/Cloudflare CDN → 回源 → GitHub Pages
  注意：CDN 节点必须有自己的 SSL 证书（不能白嫖 GitHub 的）
```

### 方案 B 关键配置（以 EdgeOne 为例）

1. **DNS**：CNAME 把 `www` 指向 EdgeOne 给的 CNAME 地址。**同一主机只能有一条 CNAME**，删掉旧的 GitHub Pages CNAME。

2. **EdgeOne 回源**：
   - 源站地址：`你的用户名.github.io`
   - 回源协议：HTTPS 或协议跟随
   - **回源 Host：你的自定义域名**（如 `www.example.com`），**不是** `*.github.io`
     （因为 GitHub Pages 已绑定自定义域名，用 `*.github.io` 做 Host 会触发 301 重定向循环）

3. **EdgeOne SSL 证书**：申请免费 DV 证书。CDN 架构下浏览器跟 CDN 握手，GitHub 的证书管不到这一段。

4. **Worker 白名单**：把你的域名加入 `ALLOWED_ORIGINS`（http 和 https 都要加）。

---

## 常见排障

### 同步报 403

**症状**：点同步/自动同步时提示"访问被拒绝"或 HTTP 403。

**根因**：Worker 的 `ALLOWED_ORIGINS` 白名单不包含你当前访问的域名。

**排查**：
1. 按 F12 → Network → 找到 403 的请求 → 看 Request Headers 里的 `Origin:` 值
2. 把这个 Origin 加入 `worker/wrangler.toml` 的 `ALLOWED_ORIGINS`
3. `cd worker && npx wrangler deploy`

**常见 Origin 陷阱**：
- 从 `file://` 打开 → `Origin: null` → 被拦截
- 从 `http://` 访问但白名单只写了 `https://` → 被拦截
- 用了自定义域名但白名单没更新 → 被拦截

### HTTPS 时好时坏 / "连接不安全"

**症状**：刷新页面有时正常有时报证书错误。

**根因**：DNS 里同一主机有多条 CNAME（如同时指向 GitHub Pages 和 CDN），DNS 轮询导致每次解析到不同服务器，而不同服务器的证书覆盖范围不同。

**解决**：同一主机只保留一条 CNAME，删掉冲突的那条。

### Worker 改了白名单但不生效

**检查**：
```bash
# 确认部署成功
cd worker && npx wrangler deploy

# 验证 Origin 是否放行（把 Origin 换成你的）
curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST \
  -H "Origin: https://你的域名.com" \
  -H "Content-Type: application/json" \
  -d '{"name":"test"}' \
  https://你的worker地址/api/register
```
返回 `HTTP 200` 表示白名单已生效。
