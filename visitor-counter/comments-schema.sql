CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL CHECK (length(nickname) BETWEEN 1 AND 24),
    anonymous INTEGER NOT NULL CHECK (anonymous IN (0, 1)),
    avatar TEXT NOT NULL CHECK (avatar IN ('cat', 'bunny', 'bear', 'panda', 'fox', 'robot')),
    message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_created_at ON comments(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS comment_rate_tokens (
    request_id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comment_rate_tokens_token_time ON comment_rate_tokens(token, created_at);
CREATE INDEX IF NOT EXISTS comment_rate_tokens_created_at ON comment_rate_tokens(created_at);
