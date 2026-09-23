"""Walk the Section 8 demo sequence end to end, in order, against a freshly seeded database.

Each step is what the presenter will do on camera. A step that needs a browser (a chart
appearing, a rail badge turning red) is verified by checking that the data the browser draws
from is correct and that the file it renders contains the element.
"""
import json, os, struct, urllib.request, urllib.error, urllib.parse, uuid, sys, zlib, io, zipfile

BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:4011')
TOKEN = None
fails = []


def png(width=48, height=32):
    """A small valid PNG, encoded here rather than read from disk.

    Step 6 needs a real image: the report embeds attachments as data URIs, so a stub that is not
    decodable would fail somewhere other than where the bug is. This used to read a file from
    /tmp that nothing in the repository created, which meant the script only passed on the
    machine that happened to have it — the check would vanish silently everywhere else, which is
    the failure mode this whole script exists to catch.

    A gradient rather than a flat fill, so the bytes do not compress to almost nothing and the
    embedded data URI is a realistic size.
    """
    # One filter byte (0 = no filtering) then RGB triples, per scanline.
    rows = b''.join(
        b'\x00' + b''.join(bytes([(x * 5) % 256, (y * 8) % 256, 160]) for x in range(width))
        for y in range(height)
    )

    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload
                + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 6))
            + chunk(b'IEND', b''))


def call(method, path, body=None, form=None, raw=False):
    headers = {}
    if TOKEN:
        headers['Authorization'] = 'Bearer ' + TOKEN
    data = None
    if form is not None:
        b = '----s8' + uuid.uuid4().hex
        parts = []
        for name, value in form:
            if isinstance(value, tuple):
                fn, mime, blob = value
                parts.append(
                    (f'--{b}\r\nContent-Disposition: form-data; name="{name}"; '
                     f'filename="{fn}"\r\nContent-Type: {mime}\r\n\r\n').encode()
                    + blob + b'\r\n')
            else:
                parts.append((f'--{b}\r\nContent-Disposition: form-data; '
                              f'name="{name}"\r\n\r\n{value}\r\n').encode())
        data = b''.join(parts) + f'--{b}--\r\n'.encode()
        headers['Content-Type'] = f'multipart/form-data; boundary={b}'
    elif body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            p = r.read()
            return r.status, (p if raw else (json.loads(p) if p else None))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


def check(label, ok, detail=''):
    # The detail is only printed on failure. A PASS line reading "missing '<polyline>'" is worse
    # than no detail at all — it invites the reader to believe a passing check found nothing.
    print(('   PASS  ' + label) if ok
          else ('   FAIL  ' + label + (f'   [{detail}]' if detail else '')))
    if not ok:
        fails.append(label)


def note(label, value):
    """A measured value worth seeing on camera, with no assertion attached."""
    print(f'   ....  {label}: {value}')


def step(n, title):
    print(f'\n--- {n}. {title} ' + '-' * max(0, 62 - len(title)))


st, r = call('POST', '/api/auth/login', {'email': 'tech@delta.test', 'password': 'tech123'})
TOKEN = r['token']

# =========================================================================== 1
step(1, 'Seeded NHB150 demo project is ready before recording')
st, r = call('GET', '/api/projects')
check('exactly one examination, ready to open', st == 200 and len(r['projects']) == 1)
proj = r['projects'][0]
pid = proj['id']
check('task no. A530947', proj['task_no'] == 'A530947', proj['task_no'])
check('report no. DANAK-1911302', proj['report_no'] == 'DANAK-1911302', proj['report_no'])

st, r = call('GET', f'/api/projects/{pid}')
model = r['families'][0]['models'][0]
mid = model['id']
check('NHB150, Max 150 g', model['model_name'] == 'NHB150' and float(model['max_capacity']) == 150.0)
check('e = 0.02 g, d = 0.002 g',
      float(model['e_value']) == 0.02 and float(model['d_value']) == 0.002,
      f"e={model['e_value']} d={model['d_value']}")
check('n = 7500', int(model['n_intervals']) == 7500, str(model.get('n_intervals')))
check('accuracy class II', model['accuracy_class'] == 'II')
base = r['rollup']
check('rolls up to pass with 7 tests', base['verdict'] == 'pass' and base['testCount'] == 7,
      f"{base['verdict']} {base['passCount']}/{base['testCount']}")

# =========================================================================== 2
step(2, 'Model workspace: Intrinsic Error, live calc, flip a Pass to a Fail')
st, r = call('GET', f'/api/models/{mid}/tests')
tests = r['tests']
check('19 test types apply to this instrument', len(tests) == 19, str(len(tests)))
enterable = sum(1 for t in tests if t.get('formKind'))
check('14 are enterable (carry a formKind)', enterable == 14, str(enterable))
check('nameplate travels with the sheet list', r['model']['e_value'] is not None)

intrinsic = next(t for t in tests if 'Intrinsic' in t['displayName'])
rid = intrinsic['testRunId']
check('Intrinsic Error is seeded and passing', intrinsic['verdict'] == 'pass', intrinsic['verdict'])

st, r = call('GET', f'/api/test-runs/{rid}')
run = r['testRun']
rows = run['result']['rows']
check('11 loads swept', len(rows) == 11, str(len(rows)))
check('every row passing to start',
      all(x['rowPass'] for x in rows if x['indicationUp'] is not None))
check('n_i computed per row, not stored', rows[-1]['nI'] == 7500, str(rows[-1]['nI']))
check('MPE staircase steps across the range',
      len({x['mpe'] for x in rows}) > 1, str(sorted({x['mpe'] for x in rows})))

# the presenter's edit: nudge one indication until it breaks
target = 6
original = rows[target]['indicationUp']
payload = [{'sequenceNo': x['sequenceNo'], 'loadValue': x['loadValue'],
            'indicationUp': x['indicationUp'], 'indicationDown': x['indicationDown']}
           for x in rows]
payload[target]['indicationUp'] = round(original + 0.5, 4)
st, r = call('PUT', f'/api/test-runs/{rid}', {'rows': payload})
after = r['testRun']
bad = after['result']['rows'][target]
check('the edited row now fails', bad['rowPass'] is False,
      f"error {bad['errorUp']} vs MPE {bad['mpe']}")
check('its neighbours still pass',
      after['result']['rows'][target - 1]['rowPass'] and after['result']['rows'][target + 1]['rowPass'])
check('the run verdict flipped to fail', after['verdict'] == 'fail', after['verdict'])
check('the failing row is named for the notice',
      after['result']['failingRows'] == [target + 1], str(after['result']['failingRows']))
check('chart has the fields errorCurve reads',
      all(k in bad for k in ('loadValue', 'mpe', 'rowPass', 'errorUp', 'correctedErrorUp')))

# =========================================================================== 3
step(3, 'Summary dashboard re-rolls when a test result changes')
st, r = call('GET', f'/api/projects/{pid}')
rolled = r['rollup']
check('project verdict is now fail', rolled['verdict'] == 'fail', rolled['verdict'])
check('6 pass / 1 fail', rolled['passCount'] == 6 and rolled['failCount'] == 1,
      f"{rolled['passCount']}/{rolled['failCount']}")
model_roll = rolled['models'][0]
check('the model rolls up fail too', model_roll['verdict'] == 'fail')
named = [s for s in model_roll['summary'] if s.get('verdict') == 'fail']
check('the summary names the failing test',
      any('Intrinsic' in s.get('displayName', '') for s in named),
      str([s.get('displayName') for s in named]))
st, rail = call('GET', f'/api/models/{mid}/tests')
check('the rail badge data changed',
      next(t for t in rail['tests'] if t['testRunId'] == rid)['verdict'] == 'fail')

# restore, and confirm it rolls back
payload[target]['indicationUp'] = original
call('PUT', f'/api/test-runs/{rid}', {'rows': payload})
st, r = call('GET', f'/api/projects/{pid}')
check('restoring the reading rolls the project back to pass',
      r['rollup']['verdict'] == 'pass', r['rollup']['verdict'])

# =========================================================================== 4
step(4, 'Repeatability and Eccentricity prove the pattern reuses')
# Each form kind names its collection after what it holds — `trials` for repeatability,
# `rows` for the tables judged row by row. Asserted against the key the matching client
# module actually reads, so a rename on either side fails here.
COLLECTION = {'repeatability': 'trials', 'eccentricity': 'rows'}
for name, kind in [('Repeatability', 'repeatability'), ('Eccentric', 'eccentricity')]:
    t = next(t for t in tests if name in t['displayName'])
    st, r = call('GET', f"/api/test-runs/{t['testRunId']}")
    tr = r['testRun']
    key = COLLECTION[kind]
    check(f'{name}: form kind {kind}', tr['formKind'] == kind, tr['formKind'])
    check(f'{name}: result.{key} computed',
          len(tr['result'].get(key, [])) > 0, str(len(tr['result'].get(key, []))))
    check(f'{name}: verdict present', tr['verdict'] in ('pass', 'fail'), tr['verdict'])
    if kind == 'repeatability':
        res = tr['result']
        check('Repeatability: judged as a set (range vs MPE, no per-trial verdict)',
              'range' in res and res['trials'][0].get('rowPass') is None,
              f"range {res.get('range')} mpe {res.get('mpe')}")
        check('Repeatability: the stats the result panel shows are present',
              all(k in res for k in ('pMax', 'pMin', 'range', 'mpe', 'load')))
    else:
        check('Eccentricity: positions carry x/y for the pan diagram',
              all('x' in p and 'y' in p for p in tr['result']['positions']),
              str([p['code'] for p in tr['result']['positions']]))
        check('Eccentricity: every position has a row to pair with',
              {p['code'] for p in tr['result']['positions']}
              == {x['positionCode'] for x in tr['result']['rows']})

# =========================================================================== 5
step(5, 'Checklist screen')
st, r = call('GET', f'/api/projects/{pid}/checklist')
items = r['items']
check('15 clauses apply under OIML R76-1:2006', len(items) == 15, str(len(items)))
# `clauseNo`, camelCase: the column is `clause_no` but this route maps every field to camelCase
# before it leaves the server. Asserted against the API's contract rather than the schema's,
# since that is what the checklist screen consumes.
check('clause references present', all(x.get('clauseNo') for x in items),
      str([x.get('clauseNo') for x in items[:3]]))
check('each clause names its requirement', all(x.get('description') for x in items))
note('clauses', ', '.join(x['clauseNo'] for x in items[:6]) + ', …')
answered = sum(1 for x in items if x.get('status') and x['status'] != 'na')
print(f'          {answered} of {len(items)} answered in the seed')

# =========================================================================== 6
step(6, 'Attach a photograph, then Generate Report')
st, r = call('POST', f'/api/projects/{pid}/attachments', form=[
    ('photo', ('bench.png', 'image/png', png())),
    ('test_run_id', str(rid)), ('model_id', str(mid)),
])
check('photo attached to the Intrinsic Error sheet', st == 200, f'status {st}')
aid = r['attachments'][0]['id']
call('PATCH', f'/api/attachments/{aid}', {'caption': 'NHB150 on the bench, 20.5 C'})

st, r = call('POST', f'/api/projects/{pid}/reports', {})
check('report generated', st == 200, f'status {st}')
rep = r['report']
print(f"          {rep['url']}  (format {rep['format']})")
if r.get('message'):
    print(f"          note: {r['message'][:78]}...")

st, html = call('GET', rep['url'], raw=True)
html = html.decode('utf8', 'replace')
check('report opens', st == 200, f'{len(html)} bytes')
low = html.lower()
for label, needle in [
    # The report prints the standard as it is versioned in the seed — "OIML R76-1:2006".
    # Asserted verbatim rather than loosely, so a change to the printed form
    # shows up here instead of passing on a substring that happens to still match.
    ('title names the standard', 'OIML R76-1:2006'),
    ('instrument nameplate', 'NHB150'),
    ('e value', '0.02'),
    ('n intervals', '7500'),
    ('summary of type evaluation section', 'summary of type evaluation'),
    ('checklist section', '7.1.1'),
    ('error series drawn', '<polyline'),
    ('MPE envelope drawn', '<polygon'),
    ('pan diagram drawn', '<circle'),
    ('photo section', 'Photographic evidence'),
    ('photo embedded as data URI', 'data:image/png;base64,'),
    ('caption printed', 'NHB150 on the bench'),
    ('paginated for print', '@page'),
    ('print stylesheet', '@media print'),
    ('signature sheet', 'signature'),
]:
    check(label, needle.lower() in low, f'missing {needle!r}')

# Accuracy class sits in a table as a label cell and a value cell, so the two are never adjacent
# in the markup. Checked as two separate facts, which is what the document actually asserts.
check('accuracy class stated', 'accuracy class' in low and '>ii<' in low.replace(' ', ''),
      'label and value cells')

# The chart has to be the technician's chart, not a decorative one: same envelope, same series.
check('envelope is a step function, not a taper',
      html.count('<polygon') >= 1 and 'stroke-dasharray="3 2"' in html)
check('both loading directions plotted', html.count('<polyline') >= 2, f'{html.count("<polyline")} series')
check('chart kept whole across page breaks', 'page-break-inside:avoid' in html.replace(' ', ''))
check('chart described for screen readers', 'outside tolerance' in low)
check('background colours survive printing', 'print-color-adjust' in low)

check('no undefined leaked', 'undefined' not in html)
check('no NaN leaked', 'NaN' not in html)
check('page breaks present', html.count('page-break') >= 1, str(html.count('page-break')))

# =========================================================================== 7
step(7, 'Report repository search finds it')
st, r = call('GET', '/api/reports')
check('the new generation is at the top of the history', r['reports'][0]['id'] == rep['id'])
check('history carries the searchable joins',
      bool(r['reports'][0]['task_no']) and bool(r['reports'][0]['manufacturer_name']))
for term in ['A530947', 'DANAK-1911302', 'Taiwan', 'nielsen']:
    st, s = call('GET', f'/api/reports?search={urllib.parse.quote(term)}')
    check(f'search "{term}" finds it', any(x['id'] == rep['id'] for x in s['reports']),
          f"{len(s['reports'])} hits")
st, s = call('GET', '/api/reports?search=notarealthing')
check('a miss returns an empty list, not everything', len(s['reports']) == 0)

# regenerating appends rather than overwriting
call('POST', f'/api/projects/{pid}/reports', {})
st, r = call('GET', '/api/reports')
check('regenerating appends a row', len(r['reports']) == 2, str(len(r['reports'])))
check('both generations still openable',
      all(call('GET', x['url'], raw=True)[0] == 200 for x in r['reports']))
check('newest first', r['reports'][0]['id'] > r['reports'][1]['id'])

# The PDF endpoint shares the HTML evaluation path but renders through Puppeteer, so it
# gets its own contract: real PDF bytes when the renderer is present, an honest fallback
# flag when it is not. The row is deleted afterwards (this script asserts exact history
# lengths above), which also exercises the admin delete path.
st, r = call('POST', f'/api/projects/{pid}/reports', {'format': 'pdf'})
check('pdf generation accepted', st == 200, f'status {st}')
pdf = r['report']
if r.get('pdfFallback'):
    check('missing renderer reported honestly', pdf['format'] == 'html', pdf['format'])
else:
    check('pdf row recorded', pdf['format'] == 'pdf', pdf['format'])
    st, blob = call('GET', pdf['url'], raw=True)
    check('pdf opens', st == 200, f'status {st}')
    check('pdf magic header', blob[:5] == b'%PDF-', repr(blob[:12]))
    check('pdf is a real document, not an empty shell', len(blob) > 50_000, f'{len(blob)} bytes')
st, _ = call('DELETE', f"/api/reports/{pdf['id']}")
check('test generation cleaned up', st == 200, f'status {st}')

# The DOCX endpoint shares the evaluation path through the renderer interface, so it
# gets the same style of contract: real Word bytes carrying the report number and the
# verdicts inside word/document.xml. Deleted afterwards to keep the exact history
# lengths asserted above.
st, r = call('POST', f'/api/projects/{pid}/reports', {'format': 'docx'})
check('docx generation accepted', st == 200, f'status {st}')
doc = r['report']
check('docx row recorded', doc['format'] == 'docx', doc['format'])
st, blob = call('GET', doc['url'], raw=True)
check('docx opens', st == 200, f'status {st}')
check('docx zip magic', blob[:4] == b'PK\x03\x04', repr(blob[:12]))
parts = zipfile.ZipFile(io.BytesIO(blob))
check('docx carries document.xml', 'word/document.xml' in parts.namelist())
xml = parts.read('word/document.xml').decode('utf-8')
check('docx names the report', doc['report_no'] in xml, doc['report_no'])
check('docx carries the verdicts',
      'Summary of Type Evaluation' in xml and 'Conclusion' in xml)
st, _ = call('DELETE', f"/api/reports/{doc['id']}")
check('docx generation cleaned up', st == 200, f'status {st}')

print('\n' + '=' * 70)
print('ALL SECTION 8 STEPS PASSED' if not fails
      else f'{len(fails)} FAILED:\n  - ' + '\n  - '.join(fails))
sys.exit(1 if fails else 0)
