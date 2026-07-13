# 云同步部署指南（Cloudflare Workers + KV）

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
| `data:AB3XK9` | 完整学习数据（SRS / 错题本 / 设置等） |

数据格式为 JSON，包含：SRS 记录、错题本、最佳成绩、已练题数、自定义单词、每日进度、设置。

## 常见问题

### Q: 免费额度够用吗？
A: 每天可自动同步 10 万次。即使每分钟同步一次，一天也只有 1440 次，远在额度内。

### Q: 同步码丢了怎么办？
A: 目前同步码不可找回。建议：截图保存 / 写在笔记本上 / 多设备都登录一次。

### Q: 数据安全吗？
A: 数据存在 Cloudflare KV 中，只有知道同步码才能访问。同步码为 6 位字母数字组合（去掉易混淆的 IO01），约 10 亿种可能。

### Q: 可以多人共用一个同步码吗？
A: 可以。同一同步码在多设备上登录，各自答题后会自动同步。但注意：多设备同时答题可能出现数据覆盖（后上传的覆盖先上传的）。建议每人一个同步码。

### Q: 如何查看/管理 KV 中的数据？
```bash
# 列出所有 key
npx wrangler kv key list --binding=VOCAB_KV

# 查看某个 key 的数据
npx wrangler kv key get --binding=VOCAB_KV "data:AB3XK9"
```

---

## API 文档

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/register` | POST | 注册新用户，返回同步码 |
| `/api/data/:code` | GET | 获取指定同步码的全部数据 |
| `/api/sync/:code` | POST | 上传数据到指定同步码 |
| `/api/check/:code` | GET | 检查同步码是否存在 |
| `/api/health` | GET | 健康检查 |
