// ---------------------------------------------------------------------------
// DOCX generator — produces a formatted Word document from the analysis JSON.
// Direct port of the monitoring agent's generate-report.js using the same
// docx-js library. Every colour, margin, column width, and font choice
// matches the monitoring agent output exactly.
// ---------------------------------------------------------------------------

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  PageBreak,
  HeadingLevel,
  AlignmentType,
  WidthType,
  ShadingType,
  BorderStyle,
  PositionalTab,
  PositionalTabAlignment,
  PositionalTabRelativeTo,
  PositionalTabLeader,
} from 'docx';

import type { ClientConfig } from '@/types/client';
import type {
  AnalysisJSON,
  AnalysedItem,
  ThemeSection,
  ForwardLookItem,
  ActionItem,
  CoverageMetric,
} from './types';

// ---------------------------------------------------------------------------
// Formatting constants — MUST match the monitoring agent exactly
// ---------------------------------------------------------------------------

const NAVY = '1B3A5C';
const DARK_GREY = '333333';
const MED_GREY = '666666';
const LIGHT_GREY = 'F2F2F2';
const WHITE = 'FFFFFF';

// RAG colours
const RED_TEXT = 'CC0000';
const RED_BG = 'FFE6E6';
const AMBER_TEXT = 'CC7700';
const AMBER_BG = 'FFF3E0';
const GREEN_TEXT = '008800';
const GREEN_BG = 'E6FFE6';

// Page dimensions (A4 in DXA units — twentieths of a point)
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const MARGIN = 1440; // 1 inch
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN; // 9026

// Table
const TABLE_WIDTH = CONTENT_WIDTH;
const CELL_MARGINS = { top: 60, bottom: 60, left: 100, right: 100 };
const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

// Fonts
const FONT = 'Arial';

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function textCell(
  text: string,
  width: number,
  opts: {
    bold?: boolean;
    fill?: string;
    color?: string;
    size?: number;
  } = {},
): TableCell {
  return new TableCell({
    borders: BORDERS,
    margins: CELL_MARGINS,
    width: { size: width, type: WidthType.DXA },
    shading: opts.fill
      ? { fill: opts.fill, type: ShadingType.CLEAR, color: 'auto' }
      : undefined,
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            font: FONT,
            size: opts.size || 18,
            color: opts.color || DARK_GREY,
            bold: opts.bold,
          }),
        ],
      }),
    ],
  });
}

function ragDot(colour: string): TableCell {
  const textMap: Record<string, string> = {
    RED: RED_TEXT,
    AMBER: AMBER_TEXT,
    GREEN: GREEN_TEXT,
  };
  const bgMap: Record<string, string> = {
    RED: RED_BG,
    AMBER: AMBER_BG,
    GREEN: GREEN_BG,
  };
  return new TableCell({
    borders: BORDERS,
    margins: CELL_MARGINS,
    width: { size: 400, type: WidthType.DXA },
    shading: {
      fill: bgMap[colour] || LIGHT_GREY,
      type: ShadingType.CLEAR,
      color: 'auto',
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: '\u25CF', // filled circle
            font: FONT,
            size: 22,
            color: textMap[colour] || DARK_GREY,
          }),
        ],
      }),
    ],
  });
}

function sectionHeading(num: number, title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 180 },
    children: [
      new TextRun({
        text: `${num}. ${title}`,
        font: FONT,
        size: 28,
        bold: true,
        color: NAVY,
      }),
    ],
  });
}

function subHeading(ref: string, title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text: `${ref} ${title}`,
        font: FONT,
        size: 24,
        bold: true,
        color: NAVY,
      }),
    ],
  });
}

function bodyText(
  text: string,
  opts: { bold?: boolean; italics?: boolean; color?: string } = {},
): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text,
        font: FONT,
        size: 20,
        color: opts.color || DARK_GREY,
        bold: opts.bold,
        italics: opts.italics,
      }),
    ],
  });
}

/**
 * Confidence flag: append [UNVERIFIED] in amber when confidence < 0.7.
 * This matches the monitoring agent's generate-report.js behaviour —
 * items flagged by the evaluation stage get a visible inline marker.
 */
function renderTextWithConfidence(
  text: string,
  confidence?: number,
): TextRun[] {
  const runs = [
    new TextRun({ text, font: FONT, size: 18, color: DARK_GREY }),
  ];
  if (confidence !== undefined && confidence < 0.7) {
    runs.push(
      new TextRun({
        text: ' [UNVERIFIED]',
        font: FONT,
        size: 16,
        color: AMBER_TEXT,
        bold: true,
      }),
    );
  }
  return runs;
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

// ---------------------------------------------------------------------------
// Item card — the core rendering element. Two-column table: grey label
// column on the left, value on the right.
// ---------------------------------------------------------------------------

function itemCard(item: AnalysedItem): Table {
  const rows: [string, string, number?][] = [
    ['Item', item.ref],
    ['Headline', item.headline],
    ['Date', item.date],
    ['Source', item.source],
    ['Summary', item.summary, item.confidence],
    ['Client relevance', item.client_relevance, item.confidence],
    ['Recommended action', item.recommended_action],
    ['Escalation', item.escalation],
  ];

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [2000, TABLE_WIDTH - 2000],
    rows: rows.map(
      ([label, value, confidence]) =>
        new TableRow({
          children: [
            // Label column: navy text, grey background
            new TableCell({
              borders: BORDERS,
              margins: CELL_MARGINS,
              width: { size: 2000, type: WidthType.DXA },
              shading: {
                fill: LIGHT_GREY,
                type: ShadingType.CLEAR,
                color: 'auto',
              },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: label,
                      font: FONT,
                      size: 18,
                      bold: true,
                      color: NAVY,
                    }),
                  ],
                }),
              ],
            }),
            // Value column
            new TableCell({
              borders: BORDERS,
              margins: CELL_MARGINS,
              width: { size: TABLE_WIDTH - 2000, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children:
                    confidence !== undefined
                      ? renderTextWithConfidence(value, confidence)
                      : [
                          new TextRun({
                            text: value,
                            font: FONT,
                            size: 18,
                            color: DARK_GREY,
                          }),
                        ],
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

// ---------------------------------------------------------------------------
// Header & Footer
// ---------------------------------------------------------------------------

function buildHeader(clientName: string): Header {
  return new Header({
    children: [
      new Paragraph({
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: NAVY,
            space: 1,
          },
        },
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: 'WA COMMUNICATIONS',
            font: FONT,
            size: 16,
            bold: true,
            color: NAVY,
          }),
          new TextRun({
            text: '   |   ',
            font: FONT,
            size: 16,
            color: '999999',
          }),
          new TextRun({
            text: 'WEEKLY MONITORING REPORT',
            font: FONT,
            size: 16,
            color: MED_GREY,
          }),
          new TextRun({
            text: '   |   ',
            font: FONT,
            size: 16,
            color: '999999',
          }),
          new TextRun({
            text: clientName,
            font: FONT,
            size: 16,
            color: MED_GREY,
          }),
        ],
      }),
    ],
  });
}

function buildFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        border: {
          top: {
            style: BorderStyle.SINGLE,
            size: 4,
            color: NAVY,
            space: 1,
          },
        },
        spacing: { before: 100 },
        children: [
          new TextRun({
            text: 'CONFIDENTIAL',
            font: FONT,
            size: 14,
            color: MED_GREY,
            bold: true,
          }),
          new PositionalTab({
            alignment: PositionalTabAlignment.RIGHT,
            relativeTo: PositionalTabRelativeTo.MARGIN,
            leader: PositionalTabLeader.NONE,
          }),
          new TextRun({
            text: 'Prepared by WA Communications Research Team',
            font: FONT,
            size: 14,
            color: MED_GREY,
          }),
        ],
      }),
    ],
  });
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

function buildMetaTable(
  metadata: AnalysisJSON['metadata'],
): Table {
  const rows: [string, string][] = [
    ['Report date', metadata.report_date],
    ['Reporting period', metadata.reporting_period],
    ['Items collected', String(metadata.items_collected)],
    ['Items analysed', String(metadata.items_analysed)],
    ['Generated', metadata.generated_at],
  ];
  return new Table({
    width: { size: 5000, type: WidthType.DXA },
    columnWidths: [2000, 3000],
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [
            textCell(label, 2000, { bold: true, fill: LIGHT_GREY, color: NAVY }),
            textCell(value, 3000),
          ],
        }),
    ),
  });
}

function buildCoverPage(
  metadata: AnalysisJSON['metadata'],
): (Paragraph | Table)[] {
  return [
    new Paragraph({ spacing: { before: 2400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'WA COMMUNICATIONS',
          font: FONT,
          size: 36,
          bold: true,
          color: NAVY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: 'Public Affairs & Strategic Communications',
          font: FONT,
          size: 22,
          color: MED_GREY,
          italics: true,
        }),
      ],
    }),
    new Paragraph({ spacing: { after: 400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'WEEKLY MONITORING REPORT',
          font: FONT,
          size: 30,
          bold: true,
          color: NAVY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: metadata.client_name,
          font: FONT,
          size: 26,
          color: DARK_GREY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: metadata.reporting_period,
          font: FONT,
          size: 22,
          color: MED_GREY,
        }),
      ],
    }),
    buildMetaTable(metadata),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// ---------------------------------------------------------------------------
// Section 1: Executive Summary
// ---------------------------------------------------------------------------

function buildExecutiveSummary(
  exec: AnalysisJSON['executive_summary'],
): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  elements.push(sectionHeading(1, 'Executive Summary'));

  // 1.1 Top line
  elements.push(subHeading('1.1', 'Top Line'));
  elements.push(bodyText(exec.top_line));

  // 1.2 Key developments table
  elements.push(subHeading('1.2', 'Key Developments'));
  elements.push(
    new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA },
      columnWidths: [400, 2500, 2500, 2126, 1500],
      rows: [
        // Header row
        new TableRow({
          children: [
            textCell('RAG', 400, {
              bold: true,
              fill: NAVY,
              color: WHITE,
              size: 16,
            }),
            textCell('Development', 2500, {
              bold: true,
              fill: NAVY,
              color: WHITE,
              size: 16,
            }),
            textCell('Relevance', 2500, {
              bold: true,
              fill: NAVY,
              color: WHITE,
              size: 16,
            }),
            textCell('Action', 2126, {
              bold: true,
              fill: NAVY,
              color: WHITE,
              size: 16,
            }),
            textCell('Ref', 1500, {
              bold: true,
              fill: NAVY,
              color: WHITE,
              size: 16,
            }),
          ],
        }),
        // Data rows
        ...(exec.key_developments || []).map(
          (item) =>
            new TableRow({
              children: [
                ragDot(item.rag),
                textCell(item.development, 2500),
                textCell(item.relevance, 2500),
                textCell(item.recommended_action, 2126),
                textCell(item.section_ref, 1500),
              ],
            }),
        ),
      ],
    }),
  );

  elements.push(new Paragraph({ children: [new PageBreak()] }));
  return elements;
}

// ---------------------------------------------------------------------------
// Section 2: Monitoring themes
// ---------------------------------------------------------------------------

function buildThemeSections(
  sections: Record<string, ThemeSection>,
  client: ClientConfig,
): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  elements.push(sectionHeading(2, 'Monitoring'));

  client.monitoringThemes.forEach((theme, index) => {
    const sectionNum = index + 1;
    const section = sections[theme.id];

    elements.push(subHeading(`2.${sectionNum}`, theme.name));

    if (
      !section ||
      section.no_developments ||
      !section.items ||
      section.items.length === 0
    ) {
      elements.push(
        bodyText('No significant developments this week.', { italics: true }),
      );
      elements.push(spacer());
      return;
    }

    // Render item cards
    for (const item of section.items) {
      elements.push(itemCard(item));
      elements.push(spacer());
    }

    // ----- Theme-specific tables -----

    // Parliamentary: routine mentions table
    if (
      theme.id.includes('parliamentary') &&
      section.routine_mentions?.length
    ) {
      elements.push(
        bodyText('Routine parliamentary mentions:', { bold: true }),
      );
      elements.push(
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: [1200, 800, 3526, 2000, 1500],
          rows: [
            new TableRow({
              children: [
                textCell('Date', 1200, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Type', 800, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Detail', 3526, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Members', 2000, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Significance', 1500, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
              ],
            }),
            ...section.routine_mentions.map(
              (rm) =>
                new TableRow({
                  children: [
                    textCell(rm.date, 1200),
                    textCell(rm.type, 800),
                    textCell(rm.detail, 3526),
                    textCell(rm.members, 2000),
                    textCell(rm.significance, 1500),
                  ],
                }),
            ),
          ],
        }),
      );
      elements.push(spacer());
    }

    // Media: coverage table
    if (theme.id.includes('media') && section.coverage_table?.length) {
      elements.push(bodyText('Coverage summary:', { bold: true }));
      elements.push(
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: [1000, 1500, 3026, 1500, 2000],
          rows: [
            new TableRow({
              children: [
                textCell('Date', 1000, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Outlet', 1500, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Angle', 3026, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Client named', 1500, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Action', 2000, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
              ],
            }),
            ...section.coverage_table.map(
              (row) =>
                new TableRow({
                  children: [
                    textCell(row.date, 1000),
                    textCell(row.outlet, 1500),
                    textCell(row.angle, 3026),
                    textCell(row.client_named, 1500),
                    textCell(row.action, 2000),
                  ],
                }),
            ),
          ],
        }),
      );
      elements.push(spacer());

      // Significant items as cards
      if (section.significant_items?.length) {
        for (const item of section.significant_items) {
          elements.push(itemCard(item));
          elements.push(spacer());
        }
      }
    }

    // Competitor: comparison table
    if (theme.id.includes('competitor') && section.table?.length) {
      elements.push(bodyText('Competitor activity:', { bold: true }));
      elements.push(
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: [1800, 2800, 2426, 2000],
          rows: [
            new TableRow({
              children: [
                textCell('Organisation', 1800, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Development', 2800, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Relevance', 2426, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
                textCell('Action', 2000, {
                  bold: true,
                  fill: NAVY,
                  color: WHITE,
                  size: 16,
                }),
              ],
            }),
            ...section.table.map(
              (row) =>
                new TableRow({
                  children: [
                    textCell(row.organisation, 1800),
                    textCell(row.development, 2800),
                    textCell(row.relevance, 2426),
                    textCell(row.action, 2000),
                  ],
                }),
            ),
          ],
        }),
      );
      elements.push(spacer());
    }

    // Social media: summary + metrics
    if (theme.id.includes('social') && section.summary) {
      elements.push(bodyText(section.summary));
      if (section.metrics) {
        const metricRows: [string, string][] = [
          ['Total mentions', section.metrics.total_mentions],
          ['Sentiment', section.metrics.sentiment_breakdown],
          ['Top engagement', section.metrics.top_engagement_post],
          ['Trend', section.metrics.trend_vs_previous],
        ];
        elements.push(
          new Table({
            width: { size: TABLE_WIDTH, type: WidthType.DXA },
            columnWidths: [2500, 6526],
            rows: metricRows.map(
              ([label, value]) =>
                new TableRow({
                  children: [
                    textCell(label, 2500, {
                      bold: true,
                      fill: LIGHT_GREY,
                      color: NAVY,
                    }),
                    textCell(value, 6526),
                  ],
                }),
            ),
          }),
        );
      }
      elements.push(spacer());
    }
  });

  elements.push(new Paragraph({ children: [new PageBreak()] }));
  return elements;
}

// ---------------------------------------------------------------------------
// Section 3: Forward Look
// ---------------------------------------------------------------------------

function buildForwardLook(
  items: ForwardLookItem[],
): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  elements.push(sectionHeading(3, 'Forward Look'));

  if (!items || items.length === 0) {
    elements.push(
      bodyText('No forward-looking events identified.', { italics: true }),
    );
  } else {
    elements.push(
      new Table({
        width: { size: TABLE_WIDTH, type: WidthType.DXA },
        columnWidths: [1500, 2800, 2726, 2000],
        rows: [
          new TableRow({
            children: [
              textCell('Date', 1500, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Event', 2800, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Relevance', 2726, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Preparation', 2000, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
            ],
          }),
          ...items.map(
            (item) =>
              new TableRow({
                children: [
                  textCell(item.date, 1500),
                  textCell(item.event, 2800),
                  textCell(item.relevance, 2726),
                  textCell(item.preparation, 2000),
                ],
              }),
          ),
        ],
      }),
    );
  }

  elements.push(spacer());
  return elements;
}

// ---------------------------------------------------------------------------
// Section 4: Emerging Themes
// ---------------------------------------------------------------------------

function buildEmergingThemes(themes: string[]): Paragraph[] {
  const elements: Paragraph[] = [];
  elements.push(sectionHeading(4, 'Emerging Themes'));

  if (!themes || themes.length === 0) {
    elements.push(
      bodyText('No emerging themes identified.', { italics: true }),
    );
  } else {
    for (const paragraph of themes) {
      elements.push(bodyText(paragraph));
    }
  }

  elements.push(spacer());
  return elements;
}

// ---------------------------------------------------------------------------
// Section 5: Actions Tracker
// ---------------------------------------------------------------------------

function buildActionsTracker(
  actions: ActionItem[],
): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  elements.push(sectionHeading(5, 'Actions Tracker'));

  if (!actions || actions.length === 0) {
    elements.push(bodyText('No actions identified.', { italics: true }));
  } else {
    elements.push(
      new Table({
        width: { size: TABLE_WIDTH, type: WidthType.DXA },
        columnWidths: [600, 3000, 1200, 1200, 1826, 1200],
        rows: [
          new TableRow({
            children: [
              textCell('Ref', 600, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Action', 3000, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Owner', 1200, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Deadline', 1200, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Origin', 1826, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Status', 1200, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
            ],
          }),
          ...actions.map(
            (action) =>
              new TableRow({
                children: [
                  textCell(action.ref, 600),
                  textCell(action.action, 3000),
                  textCell(action.owner, 1200),
                  textCell(action.deadline, 1200),
                  textCell(action.origin, 1826),
                  textCell(action.status, 1200, {
                    fill: action.status === 'DONE' ? GREEN_BG : undefined,
                  }),
                ],
              }),
          ),
        ],
      }),
    );
  }

  elements.push(spacer());
  return elements;
}

// ---------------------------------------------------------------------------
// Section 6: Coverage Summary
// ---------------------------------------------------------------------------

function buildCoverageSummary(
  metrics: CoverageMetric[],
): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  elements.push(sectionHeading(6, 'Coverage Summary'));

  if (!metrics || metrics.length === 0) {
    elements.push(
      bodyText('No coverage metrics available.', { italics: true }),
    );
  } else {
    elements.push(
      new Table({
        width: { size: TABLE_WIDTH, type: WidthType.DXA },
        columnWidths: [3000, 2000, 2026, 2000],
        rows: [
          new TableRow({
            children: [
              textCell('Metric', 3000, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('This week', 2000, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Previous week', 2026, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
              textCell('Trend', 2000, {
                bold: true,
                fill: NAVY,
                color: WHITE,
                size: 16,
              }),
            ],
          }),
          ...metrics.map(
            (m) =>
              new TableRow({
                children: [
                  textCell(m.metric, 3000, { bold: true }),
                  textCell(m.this_week, 2000),
                  textCell(m.previous_week, 2026),
                  textCell(m.trend, 2000),
                ],
              }),
          ),
        ],
      }),
    );
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Main assembly
// ---------------------------------------------------------------------------

function buildAllSections(
  analysis: AnalysisJSON,
  client: ClientConfig,
): (Paragraph | Table)[] {
  return [
    ...buildCoverPage(analysis.metadata),
    ...buildExecutiveSummary(analysis.executive_summary),
    ...buildThemeSections(analysis.sections, client),
    ...buildForwardLook(analysis.forward_look),
    ...buildEmergingThemes(analysis.emerging_themes),
    ...buildActionsTracker(analysis.actions_tracker),
    ...buildCoverageSummary(analysis.coverage_summary),
  ];
}

export async function generateReport(
  analysis: AnalysisJSON,
  client: ClientConfig,
): Promise<Buffer> {
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20 } },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 36, bold: true, font: FONT, color: NAVY },
          paragraph: {
            spacing: { before: 240, after: 240 },
            outlineLevel: 0,
          },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 28, bold: true, font: FONT, color: NAVY },
          paragraph: {
            spacing: { before: 180, after: 180 },
            outlineLevel: 1,
          },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 24, bold: true, font: FONT, color: NAVY },
          paragraph: {
            spacing: { before: 120, after: 120 },
            outlineLevel: 2,
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: {
              top: MARGIN,
              right: MARGIN,
              bottom: MARGIN,
              left: MARGIN,
            },
          },
        },
        headers: { default: buildHeader(client.name) },
        footers: { default: buildFooter() },
        children: buildAllSections(analysis, client),
      },
    ],
  });

  return await Packer.toBuffer(doc) as Buffer;
}
