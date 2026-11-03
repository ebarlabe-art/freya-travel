"""Read-only independent audit of original.pdf with pdfplumber (local tool only).
Regenerate: python scripts/extract-aran-layout.py > /tmp/aran-layout.json
No model output is used to infer these source row coordinates.
"""
import hashlib, json, re
from pathlib import Path
import pdfplumber
path = Path(__file__).parent / 'fixtures/aran/original.pdf'
rows = []
with pdfplumber.open(path) as pdf:
    for number, page in enumerate(pdf.pages, 1):
        words = page.extract_words()
        for word in words:
            if not re.fullmatch(r'\d{2}\.\d{2}', word['text']):
                continue
            cells = [w for w in words if w['x0'] > word['x1'] and abs(w['top'] - word['top']) < 6]
            cells.sort(key=lambda w: w['x0'])
            rows.append({'page': number, 'time': word['text'], 'time_box': [round(word[k], 3) for k in ['x0','top','x1','bottom']],
                         'title': ' '.join(w['text'] for w in cells),
                         'title_box': [round(cells[0]['x0'],3),round(min(w['top'] for w in cells),3),round(cells[-1]['x1'],3),round(max(w['bottom'] for w in cells),3)] if cells else None})
print(json.dumps({'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'rows': rows}, ensure_ascii=False, indent=2))
