/**
 * Title cleaning — strips metadata dumps, HTML entities, XML tags, and
 * committee date patterns from feed item titles at collection time.
 */

export function cleanTitle(title: string): string {
  let cleaned = title;

  // Strip HTML entities
  cleaned = cleaned
    .replace(/&#x27;/g, "'")
    .replace(/&#x2019;/g, "\u2019")
    .replace(/&#x201C;/g, "\u201C")
    .replace(/&#x201D;/g, "\u201D")
    .replace(/&#xA;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"');

  // Strip XML tags (legislation items sometimes have raw XML in titles)
  cleaned = cleaned.replace(/<[^>]+>/g, '').trim();

  // Strip committee metadata dumps
  cleaned = cleaned.replace(/\s*Report:\s*Published On \d{1,2} \w+ \d{4}/gi, '');
  cleaned = cleaned.replace(/\s*Govt\.?\s*response:\s*Published On \d{1,2} \w+ \d{4}/gi, '');
  cleaned = cleaned.replace(/\s*Opened\s+\d{1,2}\s+\w+\s+\d{4}/gi, '');
  cleaned = cleaned.replace(/\s*Published On \d{1,2} \w+ \d{4}/gi, '');

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Improve short/bare stakeholder titles by prepending source name
 * and/or using body text for context.
 */
export function improveStakeholderTitle(
  title: string,
  sourceName: string,
  body: string | null,
): string {
  const isBareName =
    title.length < 30 ||
    sourceName.toLowerCase().includes(title.toLowerCase()) ||
    title.toLowerCase().includes(sourceName.toLowerCase().split(' ')[0].toLowerCase());

  if (isBareName && body) {
    // Use first sentence of body as the title
    const firstSentence = body.match(/^[^.!?]+[.!?]/)?.[0];
    if (firstSentence && firstSentence.length > 20) {
      return `${sourceName}: ${firstSentence.substring(0, 100).trim()}`;
    }
    return `${sourceName}: ${title}`;
  }

  if (isBareName) {
    return `${sourceName}: ${title}`;
  }

  return title;
}
