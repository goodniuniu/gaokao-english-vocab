# 实施日志：从 Cloudflare Worker 到国内自建后端的迁移

> **项目**：高考英语单词练习
> **目标**：解决国内用户不开代理无法同步的问题
> **起点**：2026-07-24
> **状态**：进行中
>
> 本文档按时间线记录全过程，作为最终实施论文的素材。每完成一个阶段即时更新。
> 敏感信息（IP、Token、密码）一律用占位符 `<...>` 表示。

---

## 一、项目背景

### 1.1 原始架构

```
用户浏览器
  ↓ HTTPS（EdgeOne CDN 加速）
GitHub Pages（前端，纯静态）
  ↓ fetch 跨域请求
Cloudflare Worker（gaokao-vocab-sync.goodniuniu.workers.dev）
  ↓
Cloudflare KV（用户数据存储）
```

### 1.2 同步功能简介

应用提供"6 位同步码"机制，跨设备同步学习进度：
- **注册**：服务端生成 6 位随机码（去掉易混淆字符 IO01），返回给用户
- **登录**：用户在另一台设备输入同步码，从云端拉取数据
- **同步**：客户端定期上传本地数据（SRS、错题本、自定义词等）
- **冲突合并**：多设备同时修改时按字段智能合并（SRS 取练习量大的、custom 取并集等）

### 1.3 用户场景

国内高中生群体为主，几乎全在境内访问。手机端 PWA / 微信内打开是常态。

---

## 二、问题诊断（2026-07-24 上午）

### 2.1 用户报告

> 用户在手机使用的时候，使用同步码登录（输入了在电脑端正常使用的同步码 E6UDRU），手机端没有反应，数据也没有同步过来。

### 2.2 分层诊断过程

按"分层隔离法"逐层排查：

#### 层 1：业务逻辑层（Origin 白名单）

**怀疑点**：手机端某些场景发送 `Origin: null`，被白名单拦截。

**诊断方法**：用 curl 模拟不同 Origin 测试 API：

```bash
# 不带 Origin（curl 默认）→ 200
curl https://...workers.dev/api/data/E6UDRU

# 白名单内 Origin → 200
curl -H "Origin: https://www.goodniuniu.com" https://...workers.dev/api/data/E6UDRU

# Origin: null（PWA / 微信场景）→ 403 ❌
curl -H "Origin: null" https://...workers.dev/api/data/E6UDRU

# 非白名单 Origin → 403
curl -H "Origin: https://evil.com" https://...workers.dev/api/data/E6UDRU
```

**根因**：原 Worker 代码 `if (origin && allowedOrigins !== '*')` 中，JavaScript 字符串 `'null'` 是 truthy，所以 `Origin: null` 会进入白名单检查并被拒绝。

**触发场景**（手机端为什么发送 Origin: null）：
- iOS Safari "添加到主屏幕" 启动的 PWA
- 微信/小程序内置 WebView 的部分跳转
- 浏览器严格隐私模式（Brave / Firefox Strict）
- data:/about:blank sandbox iframe

**修复**：白名单检查加 `origin !== 'null'` 例外：

```javascript
// 修复前
if (origin && allowedOrigins !== '*') { ... }

// 修复后
if (origin && origin !== 'null' && allowedOrigins !== '*') { ... }
```

提交：`457b52c fix: 修复手机端同步码登录无反应 - 放行 Origin: null`

#### 层 2：体验层（toast 反馈不及时）

**怀疑点**：即使后端返回错误，用户也可能没看到反馈。

**根因**：`toast('正在恢复数据...')` 默认 1.8 秒自动消失。手机网络稍慢时，提示一闪而过，**用户以为"没反应"**，实际请求还在进行或已失败。

**修复**：toast 函数新增 `'keep'` 模式（持续显示到下次调用）和自定义时长参数。`doLogin/doRegister/doManualSync` 改用 `'keep'` 显示加载提示，错误提示延长到 5-6 秒。

#### 层 3：网络层（workers.dev 国内被墙）⚠️ 真正的硬伤

部署 Origin: null 修复后，发现**手机端依然无法同步**。进一步排查：

```bash
$ dig +short gaokao-vocab-sync.goodniuniu.workers.dev
108.160.169.54    # 这是 Dropbox 的 IP！典型的 DNS 污染
```

**根因**：`*.workers.dev` 域名在国内被 GFW 严重 DNS 污染 + IP 封锁，不开代理基本无法访问。这是**架构层面的问题**，不是代码 bug。

### 2.3 诊断方法论沉淀

| 原则 | 应用 |
|---|---|
| 先服务端后客户端 | curl 排除浏览器干扰 |
| 逐个变量排查 | Origin、网络、代码分别测试 |
| DNS 看实际解析 | dig 比浏览器更直接 |
| 重视"看起来正常但实际失败" | toast 1.8s 消失的隐蔽 bug |

---

## 三、方案选型（2026-07-24 下午）

### 3.1 候选方案对比

| 方案 | 国内访问 | 改动量 | 月成本 | 维护 |
|---|---|---|---|---|
| EdgeOne 边缘函数 + Edge KV | 最优（边缘节点） | 小（架构对应 CF） | 29.9 元 | 低 |
| CloudBase 云开发 | 优 | 中 | 3000 资源点/月免费 | 低 |
| 腾讯云 SCF + COS | 优 | 中-大（COS 模拟 KV 不优雅） | 已有 COS，0 新增 | 中 |
| **腾讯云轻量服务器 + FastAPI + SQLite** | 优 | 中 | **已有服务器，0 新增** | 中 |

### 3.2 决策路径

1. **首选 EdgeOne 边缘函数**：架构与 CF Worker 一一对应，国内访问最优
2. **申请 Edge KV 内测**：等待审批中
3. **同步评估 CloudBase / COS 方案**：备选
4. **用户提供新思路**：已有腾讯云轻量服务器（IP `<server-ip>`），可零新增成本复用
5. **方案对比细化**：COS 不适合（不是真 KV），自建服务器反而最务实
6. **最终选定**：**腾讯云轻量服务器 + FastAPI + SQLite**

### 3.3 选定方案的核心权衡

- ✅ 零新增费用（服务器已付费）
- ✅ 数据自主可控
- ✅ SQLite 性能极好（本地读写 < 1ms）
- ✅ 国内访问质量优
- ❌ 单点风险（靠每日备份 + COS 异地兜底）
- ❌ 维护成本（systemd / Caddy / 备份脚本）

**核心权衡**：用维护成本换费用和自主性，对个人项目非常划算。

### 3.4 备案的硬约束

国内服务器 + 域名访问（80/443 端口）必须备案：
- 腾讯云主动扫描 80/443 端口
- 未备案 → 显示"暂停服务"页面
- 个人备案周期：7-20 个工作日
- 子域共享主域备案，不需要单独备

---

## 四、技术实现（2026-07-24）

### 4.1 目标架构

```
用户浏览器
  ↓ HTTPS
[阿里云 DNS]
  ├─ www.goodniuniu.com → EdgeOne → GitHub Pages（前端，不变）
  └─ api.goodniuniu.com → A 记录 → <server-ip>
                               ↓
                           Caddy（自动 HTTPS + 反代）
                               ↓
                           uvicorn (127.0.0.1:8000)
                               ↓
                           FastAPI → SQLite
                               ↓
                           (cron 每日) backup.sh → 本地 + COS
```

### 4.2 代码组织

新增 `server/` 目录（与 `worker/` 完全隔离，互不影响）：

| 文件 | 作用 | 行数 |
|---|---|---|
| `main.py` | FastAPI 路由 + 中间件 | 514 |
| `db.py` | SQLite KV 存储（单表对应 CF KV） | 166 |
| `models.py` | Pydantic 请求体验证 | 83 |
| `merge.py` | 多设备冲突合并（从 js/merge.js 翻译） | 126 |
| `rate_limit.py` | 固定窗口限流 | 42 |
| `config.py` | 环境变量配置 | 60 |
| `migrate_from_cf.py` | CF KV → SQLite 数据迁移 | 192 |
| `backup.sh` | SQLite 定时备份脚本 | 48 |
| `test_merge.py` | 合并算法一致性测试 | 212 |
| `requirements.txt` | Python 依赖 | 14 |
| `README.md` | 部署文档 | 357 |

**合计**：~1800 行 Python + Shell

### 4.3 跨语言翻译的关键决策

**决策 1：数据格式 byte-级兼容**
- JSON 字段名、默认值、错误码、HTTP 状态码全部与原 Worker 一一对应
- 前端无需任何改动（除了 `DEFAULT_API`）

**决策 2：用单表 KV 而非分表**
```sql
CREATE TABLE kv_store (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER
);
```
- key 前缀分类：`code:` / `data:` / `rl:`（与原 CF KV 一致）
- 与原 Worker 代码逻辑一一对应，迁移工作量最小

**决策 3：合并算法用测试用例验证一致性**
- 把原 `test/merge.test.js` 的 11 个测试用例翻译成 `test_merge.py`
- 29 个断言全部通过才算合格
- 杜绝"看起来对，实际边界 case 错"的翻译 bug

**决策 4：Origin 白名单逻辑完整保留（含 null 放行）**
- 之前修的 Origin: null 放行逻辑在 Python 版本里也保留
- 同样的合法场景（PWA、微信、隐私模式）继续支持

### 4.4 关键代码模式（Pydantic 替代手写校验）

原 Worker（JS 手写校验）：
```javascript
function validateSyncBody(body) {
  if (body.done != null && typeof body.done !== 'number') return 'done 必须是数字';
  if (body.custom != null) {
    if (!Array.isArray(body.custom)) return 'custom 必须是数组';
    if (body.custom.length > MAX_CUSTOM_WORDS) return '...';
    // ... 各种 if-else
  }
}
```

Python 版（Pydantic 自动校验）：
```python
class SyncPayload(BaseModel):
    done: Optional[int] = None
    custom: Optional[List[Dict[str, Any]]] = None

    @field_validator("custom")
    def check_custom(cls, v):
        if v is not None and len(v) > settings.max_custom_words:
            raise ValueError(f"custom 超过 {settings.max_custom_words} 条上限")
        return v
```

**优势**：类型校验、错误响应（422）全部自动生成，开发者只关心业务规则。

---

## 五、重大事故与恢复（2026-07-24 晚间）

### 5.1 事故经过

在后端代码写完、测试通过后，执行清理命令 `rm -rf /tmp/vocab-test /tmp/test_api.sh` 时，**项目目录所有文件意外消失**，包括 `.git/`。

仅剩 `.claude/` 目录（Claude 工具的会话数据）。

### 5.2 根因分析

具体原因不明（可能是 shell 状态异常 + WSL 文件系统的竞争条件）。但暴露了多个工程纪律问题：

| 错误 | 反思 |
|---|---|
| 攒了一堆改动没 commit | **每完成一个功能点立即 commit** |
| shell cwd 进入即将被删除的目录周边 | `rm -rf` 必须用绝对路径，远离操作目录 |
| 后台进程清理不严谨 | kill 后立即确认 |
| 没有事故前的备份点 | 大改前 `git stash` 或 commit WIP |

### 5.3 恢复过程

| 步骤 | 状态 |
|---|---|
| 1. 确认 GitHub 远程仓库完整 | ✅ `457b52c` 已 push |
| 2. 从 GitHub 克隆到 `/tmp/restore-check` | ✅ 所有原文件就位 |
| 3. `cp -a` 复制回项目目录 | ✅ 主体恢复 |
| 4. 关闭 git filemode（消除假改动） | ✅ git status 干净 |
| 5. 重新应用 `.gitignore` 改动 | ✅ |
| 6. 重新应用 `build.js` IGNORE 改动 | ✅ |
| 7. 从对话历史还原 `server/` 目录 10 个文件 | ✅ |
| 8. 重新创建 venv + 安装依赖 | ✅ |
| 9. Python 语法验证 | ✅ |
| 10. merge 一致性测试 | ✅ 29/29 通过 |
| 11. API 端到端测试 | ✅ health / Origin: null / 403 全部正确 |

### 5.4 救命的因素

**之前 commit Origin: null 修复时立即 push 了**。这是恢复的根基。如果只 local commit 没 push，事故会损失全部新代码。

### 5.5 提炼的工程纪律（写进项目 CONTRIBUTING）

1. **每完成一个独立功能（修复/新文件/新模块），立即 commit**
2. **重要节点立即 push 到 GitHub**
3. **`server/` 等新代码单独建分支**（`feature/server-backend`），不污染 main
4. **`rm -rf` 用绝对路径，不在 cwd 接近的位置操作**
5. **生产数据库做异地备份**（daily cron 备份到 COS）

---

## 六、阶段进度

### ✅ 已完成

- [x] **阶段 1**：代码入库（2026-07-24）
  - commit `0d976e0`：feat 新增 FastAPI 同步后端
  - 分支：`feature/server-backend`
  - 已推送到 GitHub
  - 11 个文件，~1800 行

- [x] **阶段 0**（前置）：Origin: null + toast keep 修复（2026-07-24）
  - commit `457b52c`（已合并 main，已部署）
  - Cloudflare Worker 端已部署修复

### ⏳ 进行中

- [ ] **阶段 2**：实施记录文档（本文档）
  - 框架已搭好
  - 随项目进展持续追加

### 📋 待执行

- [ ] **阶段 3**：用户在腾讯云启动备案（**关键路径**，7-20 天）
- [ ] **阶段 4**：服务器环境准备（Python 3.11+ / Caddy / sqlite3 / systemd）
- [ ] **阶段 5**：数据迁移（CF KV → SQLite）
- [ ] **阶段 6**：DNS 切换 + 上线（备案通过后）
- [ ] **阶段 7**：运维 + 论文成稿

---

## 七、关键技术决策记录（KDR）

> 格式：决策 + 上下文 + 替代方案 + 结论

### KDR-001：后端语言选 Python 而非 Node.js

- **上下文**：原 Worker 是 JS，可保持语言栈一致
- **替代方案**：Node.js + Express + better-sqlite3
- **决策**：选 Python（FastAPI）
- **理由**：用户有"通用业务后端"的远期规划，FastAPI 的 Pydantic 类型系统、自动 OpenAPI 文档对未来扩展更友好
- **代价**：merge.js 需要翻译到 Python（多花 1-2 小时）

### KDR-002：单表 KV 而非分表

- **上下文**：数据有三类（用户元数据、学习数据、限流计数）
- **替代方案**：分三张表（users / user_data / rate_limit）
- **决策**：单表 KV（`kv_store`）
- **理由**：与原 CF KV 完全对应，迁移代码改动最小；未来加新 key 类型无需改 schema
- **代价**：查询时需要前缀过滤（性能差异 < 1ms，可忽略）

### KDR-003：用 Caddy 而非 Nginx

- **上下文**：服务器需要反代 + HTTPS
- **替代方案**：Nginx + Let's Encrypt certbot
- **决策**：Caddy
- **理由**：自动 HTTPS 证书签发和续期，配置文件仅 3 行，对个人项目是神器
- **代价**：Caddy 生态比 Nginx 小，但够用

### KDR-004：备份策略本地 + COS 双副本

- **上下文**：SQLite 单文件，磁盘故障会丢数据
- **替代方案**：仅本地备份 / 仅 COS 备份 / 主从复制
- **决策**：本地保留 7 天 + COS 异地备份
- **理由**：双副本覆盖磁盘故障和机房故障两个场景；rclone 上传 COS 简单可靠
- **代价**：需要配置 rclone（一次性工作）

---

## 八、风险登记册

| ID | 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|---|
| R1 | 备案被驳回 | 低 | 高（无法上线） | 准备 plan B：用境外服务器 |
| R2 | 服务器宕机 | 中 | 中 | systemd 自动重启 + 监控告警 |
| R3 | SQLite 文件损坏 | 低 | 高 | 每日热备份 + COS 异地 |
| R4 | 数据迁移过程用户在用 | 中 | 低 | 双后端并行 + 凌晨切换 + 冲突合并机制兜底 |
| R5 | Caddy 证书续期失败 | 低 | 中 | Caddy 自动重试 + 监控 |
| R6 | Cloudflare API Token 泄露 | 低 | 中 | Token 最小权限（只读 KV），用完即删 |

---

## 九、论文大纲（待项目结束时填充）

```
1. 摘要
2. 引言
   2.1 项目背景
   2.2 问题陈述
3. 现状分析
   3.1 Cloudflare Worker 在国内的可用性
   3.2 用户访问质量实测
4. 方案选型
   4.1 候选方案对比
   4.2 选型权衡框架
   4.3 最终决策与依据
5. 系统设计与实现
   5.1 总体架构
   5.2 数据模型（KV 兼容设计）
   5.3 关键模块实现
   5.4 与原 Worker 的兼容性保障
6. 部署与运维
   6.1 备案流程
   6.2 服务器部署
   6.3 数据迁移
   6.4 备份与监控
7. 测试与验证
   7.1 单元测试（merge 一致性）
   7.2 端到端测试
   7.3 性能对比
   7.4 国内访问质量实测
8. 工程教训
   8.1 分层诊断方法论
   8.2 跨语言代码翻译的经验
   8.3 严重事故复盘
   8.4 工程纪律
9. 总结与展望
   9.1 成果总结
   9.2 后续优化方向（监控、CDN、多副本）
```

---

## 十、变更日志

| 日期 | 变更 |
|---|---|
| 2026-07-24 | 文档创建，记录阶段 0-2 完成 |
