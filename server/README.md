# 高考英语单词练习 - FastAPI 同步后端

> 从 Cloudflare Worker 迁移而来的国内可达版本。功能、路由、数据格式与原 Worker 完全兼容。
>
> **目的**：解决 `*.workers.dev` 在国内被墙、用户不开代理无法同步的问题。

---

## 架构

```
用户浏览器 (https://www.goodniuniu.com / https://api.goodniuniu.com)
   ↓ HTTPS
[阿里云 DNS]
   ├─ www.goodniuniu.com → EdgeOne → GitHub Pages（前端）
   └─ api.goodniuniu.com → A 记录 → 8.134.202.27（本服务）
                                ↓
                            Caddy（自动 HTTPS + 反代）
                                ↓
                            uvicorn (127.0.0.1:8000)
                                ↓
                            FastAPI → SQLite
                                ↓
                            (cron 每日) backup.sh → 本地 + COS
```

**与原 Worker 完全兼容**：
- 路由：`/api/register`、`/api/data/:code`、`/api/sync/:code`、`/api/check/:code`、`/sync`、`/api/health`
- 数据格式：JSON 字段名、结构、`ok` 约定不变
- 限流策略：每分钟每 IP 同样的窗口计数
- 安全模型：Origin 白名单（含 `null` 放行，对应 PWA / 微信等场景）

前端唯一需要改的是 `js/sync.js` 里的 `DEFAULT_API`。

---

## 文件清单

| 文件 | 作用 |
|---|---|
| `main.py` | FastAPI 主入口，路由 + 中间件 |
| `db.py` | SQLite 操作（KV 模型，单表对应 CF KV） |
| `models.py` | Pydantic 请求体验证（替代原 Worker `validateSyncBody`） |
| `merge.py` | 多设备冲突合并算法（从 `js/merge.js` 翻译） |
| `rate_limit.py` | 固定窗口限流（按 IP + 分钟桶） |
| `config.py` | 环境变量配置 |
| `migrate_from_cf.py` | 从 Cloudflare KV 导出数据导入 SQLite |
| `backup.sh` | SQLite 定时备份脚本（gzip + 可选 COS 上传） |
| `test_merge.py` | 合并算法一致性测试（与 `test/merge.test.js` 同步） |
| `requirements.txt` | Python 依赖 |

---

## 部署步骤（在腾讯云服务器 8.134.202.27 上）

### 0. 前置条件

- ✅ 腾讯云轻量服务器已开（8.134.202.27）
- ⏳ `goodniuniu.com` **已在腾讯云备案**（子域 `api.` 共享主域备案，不用单独备）
- ✅ 服务器开放 80/443 端口（备案后）

### 1. 安装系统依赖

```bash
# Python 3.10+（Ubuntu 22.04 自带 3.10，建议升 3.11+）
sudo apt update
sudo apt install -y python3 python3-pip python3-venv sqlite3

# Caddy（自动 HTTPS 神器，替代 nginx + certbot）
# 见 https://caddyserver.com/docs/install
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### 2. 部署代码

```bash
# 假设代码放在 /opt/gaokao-vocab
sudo mkdir -p /opt/gaokao-vocab /var/lib/gaokao-vocab
sudo chown -R $USER:$USER /opt/gaokao-vocab /var/lib/gaokao-vocab

# 把 server/ 目录传到服务器
# 本地：scp -r server/ root@8.134.202.27:/opt/gaokao-vocab/
# 或 git clone 后 cd 进 server 子目录

cd /opt/gaokao-vocab/server

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. 数据迁移（从 Cloudflare KV 导入）

```bash
# 在 Cloudflare 控制台获取 Account ID，新建一个 API Token
# （权限：Account → Workers KV Storage → Read）

# 先 dry-run 看看有多少数据
CLOUDFLARE_ACCOUNT_ID=你的account_id \
CLOUDFLARE_API_TOKEN=你的token \
python migrate_from_cf.py

# 确认无误后实际写入
CLOUDFLARE_ACCOUNT_ID=你的account_id \
CLOUDFLARE_API_TOKEN=你的token \
python migrate_from_cf.py --apply

# 验证数据
sqlite3 /var/lib/gaokao-vocab/vocab.db "SELECT COUNT(*) FROM kv_store;"
sqlite3 /var/lib/gaokao-vocab/vocab.db "SELECT key FROM kv_store WHERE key LIKE 'code:%';"
```

### 4. 配置环境变量 + systemd

```bash
sudo tee /etc/systemd/system/gaokao-vocab.service << 'EOF'
[Unit]
Description=Gaokao Vocab Sync API (FastAPI)
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/gaokao-vocab/server
Environment="VOCAB_DB_PATH=/var/lib/gaokao-vocab/vocab.db"
Environment="VOCAB_HOST=127.0.0.1"
Environment="VOCAB_PORT=8000"
Environment="ALLOWED_ORIGINS=https://www.goodniuniu.com,https://goodniuniu.com"
ExecStart=/opt/gaokao-vocab/server/venv/bin/uvicorn main:app \
    --host 127.0.0.1 --port 8000 \
    --workers 4 --no-access-log
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 启动
sudo systemctl daemon-reload
sudo systemctl enable --now gaokao-vocab
sudo systemctl status gaokao-vocab

# 本地测试
curl http://127.0.0.1:8000/api/health
```

### 5. 配置 Caddy（自动 HTTPS + 反代）

```bash
sudo tee /etc/caddy/Caddyfile << 'EOF'
api.goodniuniu.com {
    encode gzip

    # API 反代
    reverse_proxy 127.0.0.1:8000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
    }
}
EOF

sudo systemctl reload caddy

# 检查证书申请状态（首次访问会自动签发 Let's Encrypt）
sudo journalctl -u caddy -f
```

### 6. DNS 配置

在阿里云 DNS 控制台添加：

| 主机记录 | 记录类型 | 记录值 |
|---|---|---|
| `api` | A | `8.134.202.27` |

等待 DNS 生效（通常几分钟）：
```bash
dig +short api.goodniuniu.com
# 应返回 8.134.202.27
```

### 7. 验证

```bash
# 国内外都能访问
curl https://api.goodniuniu.com/api/health
# {"ok":true,"service":"gaokao-english-vocab-sync","backend":"fastapi",...}

# API 文档（生产可关闭，在 main.py 中设 docs_url=None）
# 浏览器打开 https://api.goodniuniu.com/docs

# 测试同步码（E6UDRU 是已迁移的真实用户）
curl https://api.goodniuniu.com/api/check/E6UDRU
# {"ok":true,"exists":true}
```

### 8. 修改前端

在仓库根目录修改 `js/sync.js`：

```javascript
// 原：
var DEFAULT_API = 'https://gaokao-vocab-sync.goodniuniu.workers.dev';

// 改为：
var DEFAULT_API = 'https://api.goodniuniu.com';
```

然后构建并部署：
```bash
node build.js && npm run deploy
```

### 9. 配置定时备份

```bash
sudo crontab -e

# 加入（每天凌晨 3 点备份）
0 3 * * * /opt/gaokao-vocab/server/backup.sh >> /var/log/vocab-backup.log 2>&1

# 可选：上传到 COS（先 rclone config 配置好）
# VOCAB_COS_REMOTE=cos:goodniuniu-backup/vocab
```

---

## 本地开发与测试

### 跑测试（merge 一致性）

```bash
cd server
python3 test_merge.py
# 预期：29 通过 / 0 失败
```

### 启动开发服务器

```bash
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 启动（用临时数据库）
VOCAB_DB_PATH=/tmp/vocab-dev.db uvicorn main:app --reload --port 8000

# 浏览器打开 http://127.0.0.1:8000/docs 看 API 文档
# 测试：curl http://127.0.0.1:8000/api/health
```

---

## 国内外访问质量对比

| 指标 | 原 Cloudflare Worker | 本服务（腾讯云 + Caddy） |
|---|---|---|
| 国内访问 | ❌ DNS 污染，需开代理 | ✅ 直连，< 50ms |
| 海外访问 | ✅ 全球 CDN | ⚠️ 国内节点，海外较慢 |
| 费用 | Worker 免费版有额度 | 服务器已付费，0 新增 |
| 维护 | 0 维护 | 需定期检查服务和备份 |
| 可控性 | 平台托管 | 完全自主 |

---

## 运维手册

### 日常检查

```bash
sudo systemctl status gaokao-vocab
sudo journalctl -u gaokao-vocab -f
ls -lh /var/lib/gaokao-vocab/vocab.db
ls -lh /var/lib/gaokao-vocab/backups/
tail -50 /var/log/vocab-backup.log
```

### 故障恢复

```bash
# 服务挂了
sudo systemctl restart gaokao-vocab

# 数据库损坏（从备份恢复）
sudo systemctl stop gaokao-vocab
gunzip < /var/lib/gaokao-vocab/backups/vocab-YYYYMMDD_030000.db.gz > /var/lib/gaokao-vocab/vocab.db
sudo systemctl start gaokao-vocab
```

### 回滚到 Cloudflare Worker

1. 修改 `js/sync.js` 的 `DEFAULT_API` 改回 `'https://gaokao-vocab-sync.goodniuniu.workers.dev'`
2. 构建部署：`node build.js && npm run deploy`
3. 注意：迁移后新产生的数据不会自动同步回 CF KV

---

## 安全注意事项

1. **Origin 白名单**：默认放行 `https://www.goodniuniu.com` 等。**生产部署时通过 `ALLOWED_ORIGINS` 环境变量收紧**。
2. **API Token**：迁移用的 Cloudflare API Token 权限最小化（只读 KV），用完即删。
3. **SQLite 文件权限**：确保 `vocab.db` 对 `www-data` 可读写，其他用户不可读。
4. **HTTPS 强制**：Caddy 默认强制 HTTPS，所有 HTTP 请求自动 301 到 HTTPS。
5. **限流**：与原 Worker 一致的 IP+分钟桶限流。

---

## 常见问题

### Q1: 备案要多久？

个人备案通常 7-20 个工作日，各省不同。腾讯云有快速备案通道，材料齐全一般 7-10 天。

### Q2: 不备案行不行？

不行。腾讯云会主动扫描 80/443 端口的备案状态，未备案会显示"暂停服务"页面。
临时方案：用境外服务器（如腾讯云香港轻量，约 24 元/月）+ 不需要备案的域名。

### Q3: 数据迁移过程中用户在用怎么办？

迁移期间**两个后端并行运行**：
- 老 Worker 继续服务（用户无感）
- 迁移完成后切 DNS 和前端
- 切换瞬间的数据冲突，`merge.py` 的冲突合并机制会处理

更稳妥的做法：在凌晨低峰期切换。

### Q4: 单点故障怎么办？

- 数据：每日备份到本地 + COS
- 服务：systemd 自动重启 + Caddy 健康检查
- 监控：可接入腾讯云云监控（免费额度）
- 灾备：备份能恢复到任意一天

---

## 联调检查清单

- [ ] 备案已通过，`api.goodniuniu.com` DNS 正确解析到 8.134.202.27
- [ ] Caddy 启动且 HTTPS 证书自动签发成功（`https://api.goodniuniu.com` 返回 200）
- [ ] FastAPI 服务运行正常（`/api/health` 返回 ok）
- [ ] 数据已从 CF KV 迁移完成（`sqlite3 vocab.db "SELECT COUNT(*) FROM kv_store;"` 有数据）
- [ ] 老同步码可访问：`curl https://api.goodniuniu.com/api/check/E6UDRU` 返回 `{"exists":true}`
- [ ] 前端 `DEFAULT_API` 已改并重新部署
- [ ] 手机端实测：输入同步码 E6UDRU 能正常恢复数据
- [ ] 备份脚本配置且手动跑通一次

---

*文档与代码同步演进。改动后记得更新此文件。*
