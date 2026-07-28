#!/bin/bash
# SQLite 数据库定时备份脚本
#
# 用法（配合 cron）：
#   # 每天凌晨 3 点备份
#   0 3 * * * /opt/gaokao-vocab/server/backup.sh >> /var/log/vocab-backup.log 2>&1
#
# 保留策略：
#   - 最近 7 天每天一份
#   - 最近 4 周每周一份
#   - 自动清理更早的备份
#
# 可选：上传到腾讯云 COS（需要 rclone 已配置）
#   设置环境变量 VOCAB_COS_REMOTE=cos-bucket-name 启用

set -euo pipefail

# 配置（与 config.py 中 VOCAB_DB_PATH 保持一致）
DB_PATH="${VOCAB_DB_PATH:-/var/lib/gaokao-vocab/vocab.db}"
BACKUP_DIR="${VOCAB_BACKUP_DIR:-/var/lib/gaokao-vocab/backups}"
COS_REMOTE="${VOCAB_COS_REMOTE:-}"  # 例：cos:goodniuniu-backup/vocab

mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/vocab-$DATE.db"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始备份: $DB_PATH → $BACKUP_FILE"

# 使用 SQLite 的 .backup 命令（热备份，不锁库）
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# 压缩（SQLite 文本数据压缩率不错）
gzip -f "$BACKUP_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 压缩完成: ${BACKUP_FILE}.gz ($(du -h ${BACKUP_FILE}.gz | cut -f1))"

# 本地清理：保留最近 7 天每天一份 + 每周一最近 4 周
find "$BACKUP_DIR" -name "vocab-*.db.gz" -mtime +7 -not -name "vocab-*_1_*.db.gz" -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "vocab-*.db.gz" -mtime +28 -delete 2>/dev/null || true

# 可选：上传到 COS
if [[ -n "$COS_REMOTE" && -x "$(command -v rclone)" ]]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 上传到 COS: $COS_REMOTE"
    rclone copy "${BACKUP_FILE}.gz" "$COS_REMOTE" --quiet
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] COS 上传完成"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份完成"
