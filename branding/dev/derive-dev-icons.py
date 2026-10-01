#!/usr/bin/env python3
"""Derive dev SVGs by replacing stable paint values; never redraw shapes."""
from pathlib import Path
import argparse
import hashlib
import json
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='check committed derivatives without writing')
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    tokens = json.loads((here / 'catch-dev-brand-tokens.json').read_text())
    base_path = (here / tokens['baseTokens']).resolve()
    base = json.loads(base_path.read_text())
    stable_dir = base_path.parent

    for name, expected in tokens['sourceIntegrity'].items():
        actual = hashlib.sha256((stable_dir / name).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f'Stable source changed: {name}. Review channel derivation before updating its fingerprint.')

    palette = tokens['palette']
    for name, color in palette.items():
        encoded = '#' + ''.join(f'{n:02X}' for n in color['rgb'])
        if encoded != color['hex']:
            raise SystemExit(f'HEX/RGB mismatch for {name}')

    override = tokens['iconOverrides']
    def vector_attributes(g):
        return (f'x1="{g["from"][0]}" y1="{g["from"][1]}" '
                f'x2="{g["to"][0]}" y2="{g["to"][1]}"')
    replacements = [(vector_attributes(base['gradient']), vector_attributes(override['gradient']))]
    for stable_stop, dev_stop in zip(base['gradient']['stops'], override['gradient']['stops'], strict=True):
        if stable_stop['offset'] != dev_stop['offset']:
            raise SystemExit('Dev stop positions must remain the stable positions.')
        replacements.append((base['colors'][stable_stop['color']]['hex'], palette[dev_stop['color']]['hex']))

    shadow = override['landingShadow']
    if shadow['opacity'] != palette[shadow['color']]['alpha']:
        raise SystemExit('Shadow opacity and color alpha must match; alpha is applied once.')
    replacements += [
        (base['colors']['landingShadow']['hex'], palette[shadow['color']]['hex']),
        (f'opacity="{base["geometry"]["landingShadow"]["opacity"]}"', f'opacity="{shadow["opacity"]}"'),
        (base['gradient']['id'], override['gradient']['id']),
        ('id="amber-tile"', 'id="dev-tile"'),
        ('aria-label="Catch ', 'aria-label="Catch Dev '),
    ]

    for asset in tokens['derivedAssets']:
        source = (here / asset['stableSource']).resolve()
        if source.parent != stable_dir:
            raise SystemExit('Expected a direct stable-source file.')
        original = source.read_text()
        output = original
        for before, after in replacements:
            output = output.replace(before, after)
        # All non-paint content is preserved, including every transform and path.
        restored = output
        for before, after in reversed(replacements):
            restored = restored.replace(after, before)
        if restored != original:
            raise SystemExit('Unexpected change outside the permitted paint and label substitutions.')
        root = ET.fromstring(output)
        if root.attrib['viewBox'] != '0 0 1024 1024':
            raise SystemExit('Unexpected source canvas.')
        dest = here / asset['output']
        if dest.parent != here or dest == source:
            raise SystemExit('Output must be a new dev file.')
        if args.check:
            if not dest.is_file() or dest.read_text() != output:
                raise SystemExit(f'Derivative differs from stable geometry and dev tokens: {dest.name}')
        else:
            dest.write_text(output)
        print(('Verified' if args.check else 'Generated') + ': ' + dest.name)


if __name__ == '__main__':
    main()
