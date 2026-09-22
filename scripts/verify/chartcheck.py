"""Inspect the error curve in a generated report as geometry, not as a substring.

`'<polyline' in html` proves an element was emitted. It does not prove the envelope steps where
the standard says it steps, that the series is plotted against the right axis, or that a failing
reading is the dot drawn in red. Those are the claims the chart makes to a reader, so they are
what this checks — by parsing the coordinates back out and comparing them against the numbers in
the API's own evaluation of the same run.
"""
import json, os, re, sys, urllib.request, urllib.parse, xml.etree.ElementTree as ET

BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:4011')
fails = []


def check(label, ok, detail=''):
    print(('   PASS  ' + label) if ok
          else ('   FAIL  ' + label + (f'   [{detail}]' if detail else '')))
    if not ok:
        fails.append(label)


def call(path, token=None, raw=False):
    req = urllib.request.Request(BASE + path)
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    with urllib.request.urlopen(req) as r:
        p = r.read()
        return p if raw else json.loads(p)


def post(path, body, token=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def pts(text):
    nums = [float(v) for v in re.split(r'[,\s]+', text.strip()) if v]
    return list(zip(nums[0::2], nums[1::2]))


req = urllib.request.Request(BASE + '/api/auth/login',
                             data=json.dumps({'email': 'admin@delta.test', 'password': 'admin123'}).encode(),
                             headers={'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(req) as r:
    token = json.loads(r.read())['token']

# The run the chart is drawn from, evaluated by the server — the source of truth to compare against.
proj = call('/api/projects', token)['projects'][0]
pid = proj['id']
mid = call(f'/api/projects/{pid}', token)['families'][0]['models'][0]['id']
tests = call(f'/api/models/{mid}/tests', token)['tests']
intrinsic = next(t for t in tests if 'Intrinsic' in t['displayName'])
rid = intrinsic['testRunId']
rows = call(f'/api/test-runs/{rid}', token)['testRun']['result']['rows']

rep = post(f'/api/projects/{pid}/reports', {}, token)['report']
html = call(rep['url'], raw=True).decode('utf8', 'replace')

# The first chart in the document is the first weighing table's, which is the Intrinsic Error run
# the seed orders first — the same run fetched above.
figures = re.findall(r'<figure class="chart">.*?</figure>', html, re.S)
check('a chart per weighing table', len(figures) == 3, f'{len(figures)} charts')
if not figures:
    print('no chart to inspect')
    sys.exit(1)

svg = ET.fromstring(re.search(r'<svg.*?</svg>', figures[0], re.S).group(0))
W, H = (float(v) for v in svg.get('viewBox').split()[2:])
polylines = svg.findall('polyline')
circles = svg.findall('circle')
# The envelope and the off-scale markers are both polygons; the envelope is the stroked one.
# Distinguished by that rather than by position, so adding a marker cannot silently be read as
# a second envelope.
polygons = svg.findall('polygon')
envelopes = [p for p in polygons if p.get('stroke')]
markers = [p for p in polygons if not p.get('stroke')]

print(f'\n   viewBox {W:g}x{H:g}   envelope {len(envelopes)}  series {len(polylines)}  '
      f'dots {len(circles)}  off-scale markers {len(markers)}')

# --- the envelope ---------------------------------------------------------
check('exactly one envelope', len(envelopes) == 1)
env = pts(envelopes[0].get('points'))
check('envelope is closed and two-sided', len(env) >= 4 and len(env) % 2 == 0, f'{len(env)} vertices')
check('every envelope vertex is inside the frame',
      all(0 <= px <= W and 0 <= py <= H for px, py in env),
      f'x {min(p[0] for p in env):g}..{max(p[0] for p in env):g} '
      f'y {min(p[1] for p in env):g}..{max(p[1] for p in env):g}')

# A step function has vertical segments: two vertices sharing an x with different y. A smooth
# taper has none. This is the single claim that distinguishes the two drawings.
distinct_mpe = sorted({r['mpe'] for r in rows})
verticals = sum(1 for a, b in zip(env, env[1:]) if a[0] == b[0] and a[1] != b[1])
check(f'envelope steps once per band change (MPE takes {len(distinct_mpe)} values: {distinct_mpe})',
      verticals >= 2 * (len(distinct_mpe) - 1), f'{verticals} vertical segments')

# Symmetric about zero: MPE is ±, so the upper and lower halves must mirror.
half = len(env) // 2
upper, lower = env[:half], list(reversed(env[half:]))
mid = H and (min(p[1] for p in env) + max(p[1] for p in env)) / 2
check('envelope is symmetric about the zero line',
      all(abs((u[1] + l[1]) / 2 - mid) < 0.05 and u[0] == l[0] for u, l in zip(upper, lower)))

# --- the series ----------------------------------------------------------
check('increasing and decreasing load both plotted', len(polylines) == 2, f'{len(polylines)} series')
solid = [p for p in polylines if p.get('stroke-dasharray') == 'none']
dashed = [p for p in polylines if p.get('stroke-dasharray') not in (None, 'none')]
check('one solid series and one dashed', len(solid) == 1 and len(dashed) == 1)
check('the two series are drawn in different colours',
      solid and dashed and solid[0].get('stroke') != dashed[0].get('stroke'),
      f"{solid[0].get('stroke') if solid else '-'} vs {dashed[0].get('stroke') if dashed else '-'}")

up = pts(solid[0].get('points'))
plotted = [r for r in rows if r['judgedErrorUp'] is not None]
check('one vertex per measured load', len(up) == len(plotted),
      f"{len(up)} vertices, {len(plotted)} readings")
check('series stays inside the frame', all(0 <= px <= W and 0 <= py <= H for px, py in up))

# The x axis must be monotonic in load: a chart that plots the loads out of order draws a
# zig-zag that looks like instability in the instrument.
check('loads plotted left to right in order', all(a[0] <= b[0] for a, b in zip(up, up[1:])))

# --- the dots -----------------------------------------------------------
FAIL_RED = '#b91c1c'
check('every reading passes, so every marker is a plain dot', len(markers) == 0)
check('a dot per plotted reading', len(circles) == len(up), f'{len(circles)} dots, {len(up)} vertices')
check('no dot is red while every row passes',
      all(c.get('fill') != FAIL_RED for c in circles),
      f"{sum(1 for c in circles if c.get('fill') == FAIL_RED)} red")
check('dots sit on the series line',
      all(abs(float(c.get('cx')) - px) < 0.05 and abs(float(c.get('cy')) - py) < 0.05
          for c, (px, py) in zip(circles, up)))
check('the whole envelope is visible, not squashed against the axis',
      (max(p[1] for p in env) - min(p[1] for p in env)) > 0.3 * H,
      f'{max(p[1] for p in env) - min(p[1] for p in env):.0f} of {H:.0f} units tall')

# --- the vertical mapping ------------------------------------------------
# Derived from the drawing itself rather than copied from the renderer, so this verifies the
# contract ("2.5x MPE, linear, zero centred") instead of restating the implementation. The zero
# line and the y axis give the frame; the envelope's topmost vertex gives the scale.
lines = svg.findall('line')
zero = next(l for l in lines if l.get('y1') == l.get('y2'))
axis = next(l for l in lines if l.get('x1') == l.get('x2'))
y0 = float(zero.get('y1'))
top, bottom = float(axis.get('y1')), float(axis.get('y2'))
maxmpe = max(r['mpe'] for r in rows)
scale = (y0 - min(p[1] for p in env)) / maxmpe          # pixels per gram of error
span = ((bottom - top) / 2) / scale                     # grams from zero to the frame edge


def ey(error):
    return y0 - max(-span, min(span, error)) * scale


def err(row):
    # The column the server says it judged, not a guess at which one it was. Writing
    # `corrected if present else raw` here would restate the exact inference that put a dot
    # inside the tolerance band next to a row marked fail — and, worse, would agree with a
    # renderer making the same mistake, so the check would pass while the chart lied.
    return row['judgedErrorUp']


measured = [r for r in rows if err(r) is not None]

check('the zero line is centred in the frame', abs(y0 - (top + bottom) / 2) < 0.05,
      f'zero at {y0:g}, frame {top:g}..{bottom:g}')
check('the frame is 2.5x MPE from zero to the edge', abs(span / maxmpe - 2.5) < 0.01,
      f'{span / maxmpe:.3f}x')
check('every dot sits where its error says it should',
      all(abs(float(c.get('cy')) - ey(err(r))) < 0.05 for c, r in zip(circles, measured)),
      max((abs(float(c.get('cy')) - ey(err(r))) for c, r in zip(circles, measured)), default=0))
check('every passing dot is inside its own tolerance band, not merely inside the widest one',
      all(abs(float(c.get('cy')) - y0) < abs(ey(r['mpe']) - y0) for c, r in zip(circles, measured)))

# --- the same chart, with one row broken -------------------------------
# Two failures behave differently and both are worth pinning down: a modest overrun, which is
# what a real instrument drifting out of tolerance looks like, and a gross one, which is what a
# transposed digit or the wrong test weight looks like. The first must stay a dot on the curve;
# the second is what a data-fitted axis mishandles.
payload = [{'sequenceNo': r['sequenceNo'], 'loadValue': r['loadValue'],
            'indicationUp': r['indicationUp'], 'indicationDown': r['indicationDown']} for r in rows]
target = 6
original = payload[target]['indicationUp']


def redraw(delta):
    """Nudge one indication, regenerate, and hand back the first chart's parsed geometry."""
    payload[target]['indicationUp'] = None if delta is None else round(original + delta, 4)
    body = json.dumps({'rows': payload}).encode()
    put = urllib.request.Request(f'{BASE}/api/test-runs/{rid}', data=body, method='PUT',
                                 headers={'Content-Type': 'application/json',
                                          'Authorization': 'Bearer ' + token})
    urllib.request.urlopen(put).read()
    doc = call(post(f'/api/projects/{pid}/reports', {}, token)['report']['url'], raw=True)
    fig = re.findall(r'<figure class="chart">.*?</figure>', doc.decode('utf8', 'replace'), re.S)[0]
    node = ET.fromstring(re.search(r'<svg.*?</svg>', fig, re.S).group(0))
    polys = node.findall('polygon')
    return {
        'fig': fig, 'svg': node,
        'env': [p for p in polys if p.get('stroke')],
        'markers': [p for p in polys if not p.get('stroke')],
        'circles': node.findall('circle'),
        'up': pts([p for p in node.findall('polyline')
                   if p.get('stroke-dasharray') == 'none'][0].get('points')),
    }


print('\n   a modest overrun (+0.036 g against a 0.03 g tolerance)')
mild = redraw(0.03)
red_dots = [c for c in mild['circles'] if c.get('fill') == FAIL_RED]
check('stays on the curve as a red dot', len(red_dots) == 1 and len(mild['markers']) == 0,
      f"{len(red_dots)} red dots, {len(mild['markers'])} markers")
check('the red dot is drawn larger than the passing ones',
      red_dots and float(red_dots[0].get('r')) >
      float(next(c for c in mild['circles'] if c.get('fill') != FAIL_RED).get('r')))
check('it is the load that was broken',
      red_dots and abs(float(red_dots[0].get('cx')) - mild['up'][target][0]) < 0.05)
# Outside the band that applies at *that* load, not merely outside the widest band in the sweep:
# the MPE staircase means those are different lines, and only the first is a failure.
check('it is drawn outside its own tolerance band, which is the whole point',
      red_dots and abs(float(red_dots[0].get('cy')) - y0) > abs(ey(rows[target]['mpe']) - y0),
      red_dots and f"dot {abs(float(red_dots[0].get('cy')) - y0):.1f} px from zero, "
                   f"band edge {abs(ey(rows[target]['mpe']) - y0):.1f} px")
check('the caption does not claim anything is off scale',
      'exceeded the plotted range' not in mild['fig'])
check('the envelope did not move for a modest failure',
      pts(mild['env'][0].get('points')) == env)

print('\n   a gross overrun (+0.506 g, ~17x the tolerance)')
gross = redraw(0.5)
check('drawn as an off-scale marker, not clipped away',
      len(gross['markers']) == 1, f"{len(gross['markers'])} markers")
check('the marker is red', gross['markers'] and gross['markers'][0].get('fill') == FAIL_RED,
      gross['markers'] and gross['markers'][0].get('fill'))
check('the remaining readings are still plain dots',
      len(gross['circles']) == len(gross['up']) - 1,
      f"{len(gross['circles'])} dots, {len(gross['up'])} readings")
check('no passing dot turned red',
      sum(1 for c in gross['circles'] if c.get('fill') == FAIL_RED) == 0)

mk = pts(gross['markers'][0].get('points')) if gross['markers'] else []
check('the marker is at the load that was broken',
      mk and abs(mk[0][0] - gross['up'][target][0]) < 0.05,
      mk and f'{mk[0][0]} vs {gross["up"][target][0]}')
check('the marker points up, the way the error went', len(mk) == 3 and mk[1][1] > mk[0][1])
check('the marker is inside the frame', all(0 <= px <= W and 0 <= py <= H for px, py in mk))

# The whole reason for a fixed axis: nothing but the broken reading may move.
check('the envelope did not move when the reading blew out',
      gross['env'] and pts(gross['env'][0].get('points')) == env)
check('every other reading is drawn in exactly the same place as before',
      [p for i, p in enumerate(gross['up']) if i != target]
      == [p for i, p in enumerate(up) if i != target],
      'a fixed axis means an outlier cannot move the rest of the curve')
check('the caption says a reading is off scale', 'exceeded the plotted range' in gross['fig'])
check('the axis now labels the failing load',
      len(gross['svg'].findall('text')) > len(svg.findall('text')),
      f"{len(svg.findall('text'))} -> {len(gross['svg'].findall('text'))} labels")

print('\n   an unmeasured row')
blank = redraw(None)
check('a row with no reading is neither plotted nor coloured as a failure',
      len(blank['up']) == len(up) - 1
      and all(c.get('fill') != FAIL_RED for c in blank['circles']),
      f"{len(blank['up'])} vertices, "
      f"{sum(1 for c in blank['circles'] if c.get('fill') == FAIL_RED)} red")

# restore
payload[target]['indicationUp'] = original
put = urllib.request.Request(f'{BASE}/api/test-runs/{rid}', data=json.dumps({'rows': payload}).encode(),
                             headers={'Content-Type': 'application/json',
                                      'Authorization': 'Bearer ' + token}, method='PUT')
urllib.request.urlopen(put).read()
restored = call(f'/api/test-runs/{rid}', token)['testRun']
check('\n   restoring the reading returns the run to pass', restored['verdict'] == 'pass',
      restored['verdict'])

print('\n' + '=' * 70)
print('CHART GEOMETRY VERIFIED' if not fails else f'{len(fails)} FAILED:\n  - ' + '\n  - '.join(fails))
sys.exit(1 if fails else 0)
