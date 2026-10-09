CREATE TABLE IF NOT EXISTS visitor_tokens (
    token TEXT PRIMARY KEY,
    counted_at INTEGER NOT NULL,
    counted_day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS visitor_tokens_counted_at ON visitor_tokens(counted_at);

CREATE TABLE IF NOT EXISTS visitor_daily (
    day TEXT PRIMARY KEY,
    count INTEGER NOT NULL CHECK (count >= 0)
);
CREATE TABLE IF NOT EXISTS visitor_total (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    count INTEGER NOT NULL CHECK (count >= 0)
);
INSERT OR IGNORE INTO visitor_total (id, count) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS count_new_visitor
AFTER INSERT ON visitor_tokens
BEGIN
    INSERT INTO visitor_daily (day, count) VALUES (NEW.counted_day, 1)
    ON CONFLICT(day) DO UPDATE SET count = count + 1;
    UPDATE visitor_total SET count = count + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS count_returning_visitor
AFTER UPDATE OF counted_at ON visitor_tokens
WHEN NEW.counted_at > OLD.counted_at
BEGIN
    INSERT INTO visitor_daily (day, count) VALUES (NEW.counted_day, 1)
    ON CONFLICT(day) DO UPDATE SET count = count + 1;
    UPDATE visitor_total SET count = count + 1 WHERE id = 1;
END;
