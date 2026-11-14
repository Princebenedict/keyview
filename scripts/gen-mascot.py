#!/usr/bin/env python3
"""Generates the Keykeeper mascot SVGs into public/mascot/. Flat, no blur, deterministic (seeded)."""
import random, os

INK, INK2, PAPER, ACID = '#09090B', '#2A2A31', '#F8F4E8', '#D2E823'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'mascot')

CSS = '''<style>
@keyframes dr{0%,100%{transform:translate(0,0)}50%{transform:translate(var(--dx),var(--dy))}}
.p{animation:dr var(--d) ease-in-out var(--l) infinite}
@media (prefers-reduced-motion:reduce){.p{animation:none}}
</style>'''

def fragments(seed, n=40):
    r = random.Random(seed); out = []
    for i in range(n):
        t = i / n
        y = 188 + 126 * (t ** 0.85) + r.uniform(-5, 5)
        x = 120 + r.uniform(-1, 1) * (36 + 70 * t)
        size = max(3.0, 11 * (1 - t) + r.uniform(0, 3))
        col = ACID if r.random() < 0.5 else PAPER
        rot = r.randint(0, 80)
        dx, dy = r.uniform(-6, 6), r.uniform(-12, -3)
        d, l = r.uniform(3.2, 6.4), -r.uniform(0, 6)
        out.append(f'<g class="p" style="--dx:{dx:.1f}px;--dy:{dy:.1f}px;--d:{d:.1f}s;--l:{l:.1f}s">'
                   f'<rect x="{x - size/2:.1f}" y="{y - size/2:.1f}" width="{size:.1f}" height="{size:.1f}" '
                   f'transform="rotate({rot} {x:.1f} {y:.1f})" fill="{col}" stroke="{INK}" stroke-width="2"/></g>')
    return '\n'.join(out)

def figure(holding_key):
    arm_r = (f'<path d="M172 118 L206 134 L200 150 L160 132 Z" fill="{INK}" stroke="{INK}" stroke-width="2"/>'
             f'<circle cx="209" cy="143" r="7" fill="{INK2}" stroke="{INK}" stroke-width="2"/>'
             f'<g fill="none" stroke-linecap="round" stroke-linejoin="round">'
             f'<circle cx="210" cy="112" r="9" stroke="{INK}" stroke-width="8"/><path d="M210 121 V150 M210 138 h8 M210 145 h6" stroke="{INK}" stroke-width="8"/>'
             f'<circle cx="210" cy="112" r="9" stroke="{ACID}" stroke-width="4"/><path d="M210 121 V150 M210 138 h8 M210 145 h6" stroke="{ACID}" stroke-width="4"/></g>'
             ) if holding_key else (
             f'<path d="M172 118 L186 178 L174 184 L156 128 Z" fill="{INK}" stroke="{INK}" stroke-width="2"/>'
             f'<circle cx="180" cy="187" r="6" fill="{INK2}" stroke="{INK}" stroke-width="2"/>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 330" role="img" aria-label="The Keykeeper: a hooded sentinel with a keyhole-shaped visor, its cloak breaking into pieces">
{CSS}
<path d="M50 180 L190 180 L198 204 L184 212 L178 238 L160 230 L152 256 L134 244 L120 276 L106 248 L90 262 L84 232 L66 242 L60 212 L42 204 Z" fill="{INK}" stroke="{INK}" stroke-width="2" stroke-linejoin="round"/>
<path d="M72 100 L168 100 L192 180 L48 180 Z" fill="{INK}" stroke="{INK}" stroke-width="2" stroke-linejoin="round"/>
<path d="M103 104 H137 L147 176 H93 Z" fill="{INK2}" stroke="{PAPER}" stroke-opacity=".55" stroke-width="1.5"/>
<path d="M66 98 L96 94 L92 112 L70 116 Z" fill="{INK2}" stroke="{PAPER}" stroke-opacity=".55" stroke-width="1.5"/>
<path d="M174 98 L144 94 L148 112 L170 116 Z" fill="{INK2}" stroke="{PAPER}" stroke-opacity=".55" stroke-width="1.5"/>
<path d="M68 118 L54 178 L66 184 L84 128 Z" fill="{INK}" stroke="{INK}" stroke-width="2"/>
<circle cx="60" cy="187" r="6" fill="{INK2}" stroke="{INK}" stroke-width="2"/>
{arm_r}
<path d="M110 94 H130 V102 H110 Z" fill="{INK}"/>
<path d="M88 36 C102 22 138 22 152 36 L158 84 C140 99 100 99 82 84 Z" fill="{INK}" stroke="{INK}" stroke-width="2" stroke-linejoin="round"/>
<path d="M100 42 H140 L143 82 C131 92 109 92 97 82 Z" fill="{INK2}" stroke="{PAPER}" stroke-opacity=".55" stroke-width="1.5"/>
<g fill="{ACID}"><circle cx="120" cy="56" r="9"/><path d="M115.5 62 H124.5 L128 80 H112 Z"/></g>
{fragments(7 if not holding_key else 11)}
</svg>
'''

MARK = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" role="img" aria-label="KeyView">
{CSS}
<path d="M8 27 L32 27 L36 34 L4 34 Z" fill="{INK}"/>
<path d="M11 7 C14 3 26 3 29 7 L31 21 C26 27 14 27 9 21 Z" fill="{INK}" stroke="{INK}" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M15 9 H25 L26 20 C23 23 17 23 14 20 Z" fill="{INK2}"/>
<g fill="{ACID}"><circle cx="20" cy="13.5" r="2.8"/><path d="M18.7 15.9 H21.3 L22.4 20 H17.6 Z"/></g>
<g stroke="{INK}" stroke-width="1"><rect class="p" style="--dx:1px;--dy:-2px;--d:3.6s;--l:0s" x="10" y="36" width="3.2" height="3.2" fill="{ACID}"/><rect class="p" style="--dx:-1px;--dy:-2px;--d:4.4s;--l:-1s" x="18" y="36.5" width="3" height="3" fill="{ACID}"/><rect class="p" style="--dx:1px;--dy:-2px;--d:5s;--l:-2s" x="26" y="36" width="2.8" height="2.8" fill="{ACID}"/></g>
</svg>
'''

os.makedirs(OUT, exist_ok=True)
for name, content in (('keykeeper.svg', figure(False)), ('keykeeper-key.svg', figure(True)), ('keykeeper-mark.svg', MARK)):
    with open(os.path.join(OUT, name), 'w') as f: f.write(content)
    print('wrote', name, len(content), 'bytes')
