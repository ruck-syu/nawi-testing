#!/usr/bin/env python3
"""Convert USER_GUIDE.md to a styled PDF using reportlab."""

import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)

# ---------------------------------------------------------------------------
# Markdown → (tag, content) tokens
# ---------------------------------------------------------------------------

def inline_md(text: str) -> str:
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<link href="\2"><u>\1</u></link>', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<i>\1</i>', text)
    text = re.sub(r'`([^`]+)`', r'<font name="Courier">\1</font>', text)
    return text


def parse_table(rows: list[str]) -> Table:
    cells = [[p.strip() for p in r.strip('|').split('|')] for r in rows]
    cells = [r for r in cells if not re.match(r'^[-:\s|]+$', '|'.join(r))]
    if not cells:
        return Table([['']])

    col_count = max(len(r) for r in cells)
    for r in cells:
        while len(r) < col_count:
            r.append('')

    header, *body = cells

    cell_style = ParagraphStyle(
        'TableCell',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#2d3748'),
    )

    def cell_para(text):
        if not text:
            return ''
        return Paragraph(inline_md(str(text)), cell_style)

    data = [[cell_para(c) for c in header]] + [[cell_para(c) for c in row] for row in body]
    col_width = (A4[0] - 4 * cm) / col_count

    t = Table(data, colWidths=[col_width] * col_count, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#edf2f7')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1a202c')),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e0')),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f7fafc')]),
    ]))
    return t


def md_to_tokens(text: str) -> list:
    lines = text.split('\n')
    tokens = []
    in_table = False
    table_rows: list[str] = []

    for line in lines:
        if line.startswith('|'):
            in_table = True
            table_rows.append(line)
            continue
        elif in_table:
            tokens.append(('table', table_rows))
            table_rows = []
            in_table = False

        if not line.strip():
            tokens.append(('blank', ''))
            continue

        m = re.match(r'^(#{1,6})\s+(.*)', line)
        if m:
            tokens.append((f'h{len(m.group(1))}', inline_md(m.group(2))))
            continue

        if re.match(r'^---+$', line.strip()):
            tokens.append(('hr', ''))
            continue

        if re.match(r'^\s*[-*]\s', line):
            item = re.sub(r'^\s*[-*]\s+', '', line)
            tokens.append(('bullet', inline_md(item)))
            continue

        m = re.match(r'^\s*(\d+)\.\s+(.*)', line)
        if m:
            tokens.append(('numbered', f"{m.group(1)}. {inline_md(m.group(2))}"))
            continue

        tokens.append(('para', inline_md(line)))

    if in_table:
        tokens.append(('table', table_rows))

    return tokens


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

styles = getSampleStyleSheet()

TITLE = ParagraphStyle(
    'DocTitle',
    parent=styles['Title'],
    fontSize=20,
    leading=26,
    spaceAfter=6,
    textColor=colors.HexColor('#1a202c'),
)

H1 = ParagraphStyle(
    'DocH1',
    parent=styles['Heading1'],
    fontSize=15,
    leading=20,
    spaceBefore=16,
    spaceAfter=5,
    textColor=colors.HexColor('#2d3748'),
)

H2 = ParagraphStyle(
    'DocH2',
    parent=styles['Heading2'],
    fontSize=12,
    leading=16,
    spaceBefore=12,
    spaceAfter=4,
    textColor=colors.HexColor('#4a5568'),
)

BODY = ParagraphStyle(
    'DocBody',
    parent=styles['BodyText'],
    fontSize=10,
    leading=14,
    spaceBefore=1,
    spaceAfter=1,
    textColor=colors.HexColor('#2d3748'),
)

BULLET_STYLE = ParagraphStyle(
    'DocBullet',
    parent=BODY,
    leftIndent=16,
    bulletIndent=6,
    spaceBefore=1,
    spaceAfter=1,
)


def build_pdf(md_path: str, pdf_path: str) -> None:
    md_text = Path(md_path).read_text(encoding='utf-8')
    tokens = md_to_tokens(md_text)

    doc = BaseDocTemplate(
        pdf_path,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    frame = Frame(
        doc.leftMargin, doc.bottomMargin,
        doc.width, doc.height,
        leftPadding=0, rightPadding=0,
        topPadding=0, bottomPadding=0,
    )

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(colors.grey)
        canvas.drawRightString(
            A4[0] - doc.rightMargin,
            doc.bottomMargin - 0.5 * cm,
            f'Page {doc.page}',
        )
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=on_page)])

    elements = []
    first_heading = True

    for tag, content in tokens:
        if tag == 'h1':
            if first_heading:
                elements.append(Paragraph(content, TITLE))
                first_heading = False
            else:
                elements.append(Spacer(1, 8))
                elements.append(Paragraph(content, H1))
        elif tag == 'h2':
            elements.append(Spacer(1, 6))
            elements.append(Paragraph(content, H2))
        elif tag in ('h3', 'h4', 'h5', 'h6'):
            elements.append(Spacer(1, 4))
            elements.append(Paragraph(f'<b>{content}</b>', H2))
        elif tag == 'bullet':
            elements.append(Paragraph(f'- {content}', BULLET_STYLE))
        elif tag == 'numbered':
            elements.append(Paragraph(content, BULLET_STYLE))
        elif tag == 'para':
            elements.append(Paragraph(content, BODY))
        elif tag == 'hr':
            elements.append(HRFlowable(width='100%', thickness=0.5, color=colors.HexColor('#cbd5e0')))
        elif tag == 'table':
            elements.append(Spacer(1, 4))
            elements.append(parse_table(content))
            elements.append(Spacer(1, 4))
        elif tag == 'blank':
            elements.append(Spacer(1, 3))

    doc.build(elements)
    print(f'PDF written to: {pdf_path}')


if __name__ == '__main__':
    md = sys.argv[1] if len(sys.argv) > 1 else '/Users/vishalshekhar/Documents/dev/sih/nawi-testing/USER_GUIDE.md'
    pdf = sys.argv[2] if len(sys.argv) > 2 else '/Users/vishalshekhar/Documents/dev/sih/nawi-testing/USER_GUIDE.pdf'
    build_pdf(md, pdf)
