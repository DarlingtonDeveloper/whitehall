@AGENTS.md

## Agent Classification Task

When asked to **classify** a `.jsonl` file in `.claude/classify/`, follow these instructions exactly.

### What you are doing

You are classifying UK political evidence (speeches, questions, amendments, etc.) against policy indicators. Each evidence row describes something a politician said or did. You must determine which policy indicators it informs and where on each indicator's scale (0-1) it places the politician.

### Input format

Each line of the input `.jsonl` file is a JSON object:
```json
{
  "evidence_id": 12345,
  "politician_id": "keir-starmer",
  "politician_name": "Keir Starmer",
  "politician_party": "Labour",
  "politician_constituency": "Holborn and St Pancras",
  "evidence_type": "chamber_speech",
  "occurred_at": "2025-03-15",
  "raw_content": "The actual text of the speech/question/etc...",
  "topic_tags": ["nhs", "social-care"],
  "candidate_indicators": [
    {
      "id": "health.nhs_funding.public",
      "label_low": "Favours NHS reform/efficiency",
      "label_high": "Favours increased NHS funding",
      "description": "Public statements on NHS funding and reform"
    }
  ]
}
```

### Output format

Write one JSON object per line to `.claude/classify/results/<same-filename>.jsonl`:
```json
{
  "evidence_id": 12345,
  "politician_id": "keir-starmer",
  "evidence_type": "chamber_speech",
  "classifications": [
    {
      "indicator_id": "health.nhs_funding",
      "anchor": 0.75,
      "confidence": 0.85,
      "reasoning": "Direct call for increased NHS investment and opposition to efficiency-only approach"
    }
  ]
}
```

**Do NOT include the `.public` or `.revealed` suffix** in indicator_id — the import script adds the correct routing automatically based on evidence_type.

If the evidence does not meaningfully inform any indicator, output with empty classifications:
```json
{
  "evidence_id": 12345,
  "politician_id": "keir-starmer",
  "evidence_type": "chamber_speech",
  "classifications": [],
  "no_classification_reason": "Procedural statement with no policy content"
}
```

### Classification rules

1. **Only classify from evidence content** — never infer from politician identity, party, or role alone.
2. **anchor** (0.0 to 1.0): Where on the indicator scale this evidence places the politician.
   - 0.0 = strongly aligns with `label_low`
   - 1.0 = strongly aligns with `label_high`
   - 0.5 = neutral or ambiguous
3. **confidence** (0.0 to 1.0): Your confidence that this classification is correct.
   - Direct, explicit policy statements: 0.8-0.95
   - Clear implications from specific proposals: 0.7-0.85
   - Indirect or rhetorical statements: 0.5-0.7
   - Vague or ambiguous content: below 0.6 (will be filtered out — don't bother)
4. **Pick only indicators from candidate_indicators** — don't invent new ones.
5. **Max 4 classifications per evidence row** — pick the strongest signals.
6. **reasoning** must be under 200 characters — be concise and specific.
7. **Performative or party-line statements** get lower confidence than personal conviction.
8. **Questions don't always reveal position** — "Will the Minister confirm..." may be probing, not advocating.

### Workflow

1. Read the input file with the Read tool
2. Process rows in batches (50-100 at a time to avoid losing context)
3. For each row, read `raw_content` and `candidate_indicators`, then classify
4. Write results to `.claude/classify/results/<input-filename>.jsonl`
5. After completing all rows, report: total rows, rows with classifications, rows skipped

### Batch processing tip

Process ~50 rows at a time. Read 50 lines from the JSONL, classify all of them in your reasoning, then write 50 result lines. This is faster than one-at-a-time.
