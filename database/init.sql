-- ============================================
-- AI News Daily - 数据库初始化脚本
-- 在 ai_nav 数据库中执行
-- ============================================

USE `ai_nav`;

-- ----------------------------
-- 1. 新闻表（如果 news_buffer 不存在则创建）
-- ----------------------------
CREATE TABLE IF NOT EXISTS `news_buffer` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `title` VARCHAR(500) NOT NULL COMMENT '新闻标题',
  `category` VARCHAR(50) NOT NULL DEFAULT 'AI/ML' COMMENT '分类',
  `summary` VARCHAR(2000) NOT NULL DEFAULT '' COMMENT 'AI生成摘要',
  `content` TEXT COMMENT '正文内容',
  `source` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '来源名称',
  `source_url` VARCHAR(1000) NOT NULL COMMENT '原文链接',
  `tags` VARCHAR(500) NOT NULL DEFAULT '' COMMENT '标签，逗号分隔',
  `is_featured` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否精选：0否 1是',
  `status` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '状态：0禁用 1正常',
  `synced` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已同步到线上：0否 1是',
  `publish_date` DATE NULL COMMENT '发布日期（日报日期）',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_source_url` (`source_url`(255)) COMMENT '原文链接唯一，防重复入库',
  KEY `idx_category` (`category`),
  KEY `idx_publish_date` (`publish_date`),
  KEY `idx_is_featured` (`is_featured`, `status`),
  KEY `idx_source` (`source`),
  KEY `idx_status_synced` (`status`, `synced`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI新闻聚合表';

-- ----------------------------
-- 2. 日报记录表
-- ----------------------------
CREATE TABLE IF NOT EXISTS `news_daily_log` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `publish_date` DATE NOT NULL COMMENT '日报日期',
  `total_collected` INT NOT NULL DEFAULT 0 COMMENT '采集总数',
  `total_deduped` INT NOT NULL DEFAULT 0 COMMENT '去重后数量',
  `total_inserted` INT NOT NULL DEFAULT 0 COMMENT '新增入库数量',
  `total_updated` INT NOT NULL DEFAULT 0 COMMENT '更新数量',
  `total_skipped` INT NOT NULL DEFAULT 0 COMMENT '跳过数量',
  `highlights` TEXT COMMENT 'AI生成的今日要点',
  `status` ENUM('success', 'partial', 'failed') NOT NULL DEFAULT 'success' COMMENT '执行状态',
  `error_message` VARCHAR(1000) NOT NULL DEFAULT '' COMMENT '错误信息',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_publish_date` (`publish_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每日采集日志表';

-- ----------------------------
-- 3. 补全字段（如果 news_buffer 已存在但缺少某些字段）
-- ----------------------------

-- 检查并添加 publish_date 字段
SET @dbname = DATABASE();
SET @tablename = 'news_buffer';
SET @columnname = 'publish_date';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  'ALTER TABLE news_buffer ADD COLUMN publish_date DATE NULL COMMENT "发布日期" AFTER synced; ADD INDEX idx_publish_date (publish_date);'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 检查并添加 source_url 唯一索引
SET @indexname = 'uk_source_url';
SET @preparedStatement2 = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname
  ) > 0,
  'SELECT 1 AS idx_exists',
  'ALTER TABLE news_buffer ADD UNIQUE INDEX uk_source_url (source_url(255));'
));
PREPARE alterIdxIfNotExists FROM @preparedStatement2;
EXECUTE alterIdxIfNotExists;
DEALLOCATE PREPARE alterIdxIfNotExists;

-- ----------------------------
-- 验证
-- ----------------------------
SELECT '✅ 初始化完成' AS result;
SELECT
  TABLE_NAME AS `表名`,
  TABLE_ROWS AS `数据量`,
  CREATE_TIME AS `创建时间`
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'ai_nav' AND TABLE_NAME IN ('news_buffer', 'news_daily_log')
ORDER BY TABLE_NAME;
