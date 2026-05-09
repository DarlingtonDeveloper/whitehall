-- Add topic_tags column to feed_items for thematic filtering
ALTER TABLE feed_items ADD COLUMN IF NOT EXISTS topic_tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_feed_items_topics ON feed_items USING GIN (topic_tags);
