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
