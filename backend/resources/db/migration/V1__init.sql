-- Keyfall: saved scores and player profiles.
-- Dialect: MySQL (OceanBase MySQL mode and MySQL 8).
--
-- Every finished run is kept as one row (a player's own history); the
-- leaderboard reads one best row per player. `player_key` is a truncated
-- SHA-256 of the SSO email, so no address is stored — NULL means the run was
-- played anonymously and is attributed to "Guest".

CREATE TABLE IF NOT EXISTS scores (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    player_key        VARCHAR(32)  NULL,
    display_name      VARCHAR(24)  NOT NULL,
    level_id          INT          NOT NULL,
    score             INT          NOT NULL,
    wpm               DOUBLE       NOT NULL,
    accuracy          DOUBLE       NOT NULL,
    correct_chars     INT          NOT NULL,
    keystrokes        INT          NOT NULL,
    errors            INT          NOT NULL,
    max_combo         INT          NOT NULL,
    tokens_destroyed  INT          NOT NULL,
    lives_left        INT          NOT NULL,
    cleared           TINYINT(1)   NOT NULL,
    duration_ms       INT          NOT NULL,
    created_at        DATETIME     NOT NULL,
    PRIMARY KEY (id),
    KEY idx_scores_level (level_id, score DESC),
    KEY idx_scores_player (player_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profiles (
    player_key     VARCHAR(32)  NOT NULL,
    display_name   VARCHAR(24)  NOT NULL,
    created_at     DATETIME     NOT NULL,
    updated_at     DATETIME     NOT NULL,
    PRIMARY KEY (player_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;