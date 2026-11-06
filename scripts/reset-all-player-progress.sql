-- AKIRA: полный сброс игрового прогресса всех игроков.
-- Безопасность: сначала сохраняет снимок игроков и наград, затем меняет данные
-- в одной транзакции. При любой SQL-ошибке транзакцию нужно ROLLBACK.
-- Запускать вручную только после проверки DATABASE_URL, указывающего на AKIRA DB.
-- Этот файл НЕ выполняется автоматически приложением.

BEGIN;

LOCK TABLE players IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS akira_progress_reset_backups (
  id BIGSERIAL PRIMARY KEY,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  player_id BIGINT,
  telegram_id TEXT,
  player_snapshot JSONB NOT NULL,
  rank_rewards_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
);

INSERT INTO akira_progress_reset_backups
  (player_id, telegram_id, player_snapshot, rank_rewards_snapshot)
SELECT
  p.id,
  p.telegram_id,
  to_jsonb(p),
  COALESCE((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
    FROM player_rank_rewards r
    WHERE r.telegram_id = p.telegram_id
  ), '[]'::jsonb)
FROM players p;

-- Сброс кошелька, заработка, улучшений и престиж-прогресса.
UPDATE players
SET
  balance = 0,
  total_earned = 0,
  click_power = 1,
  auto_level = 0,
  multiplier_level = 0,
  prestige_level = 0,
  prestige_crystals = 0,
  shards = 0,
  last_auto_at = NOW();

-- Сбрасываем выданные ранговые трофеи, чтобы награды можно было получать заново.
DELETE FROM player_rank_rewards;

-- Проверка результата до COMMIT.
SELECT
  COUNT(*) AS players_total,
  COUNT(*) FILTER (
    WHERE balance = 0
      AND total_earned = 0
      AND click_power = 1
      AND auto_level = 0
      AND multiplier_level = 0
      AND prestige_level = 0
      AND prestige_crystals = 0
      AND shards = 0
  ) AS players_reset
FROM players;

SELECT COUNT(*) AS rank_rewards_remaining
FROM player_rank_rewards;

-- Если проверки верны — выполнить COMMIT.
-- Если результат неожиданный — выполнить ROLLBACK вместо COMMIT.
COMMIT;
