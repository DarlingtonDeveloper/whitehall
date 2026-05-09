import { describe, it, expect } from 'vitest';
import { cleanTitle, improveStakeholderTitle } from '../clean-title';

// ---------------------------------------------------------------------------
// cleanTitle
// ---------------------------------------------------------------------------

describe('cleanTitle', () => {
  it('passes clean titles through unchanged', () => {
    expect(cleanTitle('Government announces new energy policy')).toBe(
      'Government announces new energy policy',
    );
  });

  it('strips HTML entities &#x27;', () => {
    expect(cleanTitle('It&#x27;s a test')).toBe("It's a test");
  });

  it('strips &amp;', () => {
    expect(cleanTitle('Fish &amp; chips')).toBe('Fish & chips');
  });

  it('decodes &lt; and &gt; (then XML strip may remove tag-like results)', () => {
    // &lt; → < and &gt; → > first, then XML tag strip /<[^>]+>/g may remove
    // sequences that look like tags. "a &lt; b &gt; c" becomes "a < b > c"
    // which then has "< b >" stripped as a tag → "a c"
    expect(cleanTitle('a &lt; b &gt; c')).toBe('a c');
  });

  it('strips &nbsp;', () => {
    expect(cleanTitle('Hello&nbsp;world')).toBe('Hello world');
  });

  it('strips &quot;', () => {
    expect(cleanTitle('She said &quot;hello&quot;')).toBe('She said "hello"');
  });

  it('strips XML tags', () => {
    expect(cleanTitle('<tag>Clean title</tag>')).toBe('Clean title');
  });

  it('strips committee metadata: Published On', () => {
    expect(cleanTitle('Report Title Published On 14 March 2026')).toBe('Report Title');
  });

  it('strips committee metadata: Report: Published On', () => {
    expect(cleanTitle('Energy Report Report: Published On 5 January 2026')).toBe('Energy Report');
  });

  it('strips committee metadata: Govt response', () => {
    expect(cleanTitle('Inquiry Title Govt response: Published On 20 February 2026')).toBe('Inquiry Title');
  });

  it('strips committee metadata: Opened date', () => {
    expect(cleanTitle('Consultation Opened 3 April 2026')).toBe('Consultation');
  });

  it('collapses multiple whitespace', () => {
    expect(cleanTitle('Hello    world   test')).toBe('Hello world test');
  });

  it('trims whitespace', () => {
    expect(cleanTitle('  Title  ')).toBe('Title');
  });

  it('handles combined issues', () => {
    const messy = '<span>Energy &amp; Climate</span> Report: Published On 10 May 2026';
    expect(cleanTitle(messy)).toBe('Energy & Climate');
  });
});

// ---------------------------------------------------------------------------
// improveStakeholderTitle
// ---------------------------------------------------------------------------

describe('improveStakeholderTitle', () => {
  it('returns title unchanged if long enough and distinct from source', () => {
    const title = 'Long enough stakeholder title about important topic that is clearly different';
    expect(improveStakeholderTitle(title, 'Ofgem', null)).toBe(title);
  });

  it('prepends source name for short titles', () => {
    const result = improveStakeholderTitle('Update', 'Ofgem', null);
    expect(result).toBe('Ofgem: Update');
  });

  it('uses first sentence of body for bare titles with body', () => {
    const result = improveStakeholderTitle(
      'News',
      'Ofgem',
      'The new price cap methodology has been announced. More details follow.',
    );
    expect(result).toContain('Ofgem:');
    expect(result).toContain('price cap methodology');
  });

  it('prepends source if title contains source name', () => {
    const result = improveStakeholderTitle('Ofgem update', 'Ofgem', null);
    expect(result).toBe('Ofgem: Ofgem update');
  });

  it('prepends source if source name contains title', () => {
    const result = improveStakeholderTitle(
      'Energy',
      'Energy Regulator',
      null,
    );
    expect(result).toBe('Energy Regulator: Energy');
  });

  it('truncates body first sentence to 100 chars', () => {
    const longBody = 'A'.repeat(200) + '. Second sentence.';
    const result = improveStakeholderTitle('Short', 'Source', longBody);
    expect(result.length).toBeLessThanOrEqual(120); // "Source: " + 100 chars
  });

  it('uses first sentence extraction (ends at period)', () => {
    // First sentence must be > 20 chars to be used
    const result = improveStakeholderTitle(
      'X',
      'Source',
      'The first sentence is long enough now. Second sentence. Third.',
    );
    expect(result).toContain('The first sentence is long enough now.');
  });
});
