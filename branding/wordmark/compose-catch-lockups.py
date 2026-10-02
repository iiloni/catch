#!/usr/bin/env python3
"""Compose Catch lockups from frozen lettering and current channel SVG icons."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

SVG_NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG_NS)


def tag(name):
    return '{' + SVG_NS + '}' + name


def fmt(value):
    return format(value, '.9f').rstrip('0').rstrip('.')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_icon(path, prefix):
    source = ET.parse(path).getroot()
    if [float(n) for n in source.attrib.get('viewBox', '').split()] != [0, 0, 1024, 1024]:
        raise ValueError(f'Expected the canonical 1024 square icon: {path}')
    for element in source.iter():
        if element.tag.split('}')[-1] in ('image', 'text', 'script', 'foreignObject'):
            raise ValueError(f'Expected pure vector icon artwork: {path}')
        for attribute, value in element.attrib.items():
            if attribute.endswith('href') and not value.startswith('#'):
                raise ValueError(f'External icon dependency is unsupported: {path}')
    icon = copy.deepcopy(source)
    ids = {e.attrib['id']: prefix + e.attrib['id'] for e in icon.iter() if 'id' in e.attrib}
    for element in icon.iter():
        for attribute, value in list(element.attrib.items()):
            if attribute == 'id':
                element.set(attribute, ids[value])
            else:
                value = re.sub(r'url\(#([^)]*)\)', lambda m: 'url(#' + ids.get(m[1], m[1]) + ')', value)
                if attribute.endswith('href') and value.startswith('#'):
                    value = '#' + ids.get(value[1:], value[1:])
                element.set(attribute, value)
    for attribute in ('role', 'aria-label', 'aria-labelledby', 'width', 'height'):
        icon.attrib.pop(attribute, None)
    icon.set('aria-hidden', 'true')
    icon.set('focusable', 'false')
    return icon


def compose(wordmark, icon_path, tokens, channel, orientation, ink, tier):
    layout = tokens['layouts'][orientation]
    width, height = layout['canvas']
    prefix = f'catch-{channel}-{orientation}-{ink}-{tier}-'
    root = ET.Element(tag('svg'), {
        'width': fmt(width), 'height': fmt(height),
        'viewBox': f'0 0 {fmt(width)} {fmt(height)}',
        'role': 'img', 'aria-labelledby': prefix + 'title',
        'preserveAspectRatio': 'xMidYMid meet',
    })
    title = ET.SubElement(root, tag('title'), {'id': prefix + 'title'})
    title.text = 'Catch' if channel == 'stable' else 'Catch ' + ('development build' if channel == 'dev' else 'preview')
    icon = load_icon(icon_path, prefix + 'icon-')
    x, y, w, h = layout['iconBox']
    icon.attrib.update({'x': fmt(x), 'y': fmt(y), 'width': fmt(w), 'height': fmt(h)})
    root.append(icon)

    x, y, _, _ = layout['wordmarkInkBox']
    letters = ET.SubElement(root, tag('g'), {
        'id': prefix + 'lettering',
        'transform': f'translate({fmt(x)} {fmt(y)}) scale({fmt(layout["wordmarkScale"])})',
        'aria-hidden': 'true',
    })
    for child in wordmark:
        if child.tag in (tag('title'), tag('desc'), tag('metadata')):
            continue
        part = copy.deepcopy(child)
        for element in part.iter():
            if 'id' in element.attrib:
                element.set('id', prefix + element.attrib['id'])
            if 'fill' in element.attrib:
                element.set('fill', tokens['inkColors'][ink])
        letters.append(part)
    return ET.tostring(root, encoding='unicode') + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--icons-json', type=Path, help='channel/tier SVG paths; relative to this JSON file')
    parser.add_argument('--output-dir', type=Path, help='default: generated/ beside this script')
    parser.add_argument('--channels', nargs='+', choices=['stable', 'preview', 'dev'], default=['stable', 'preview', 'dev'])
    parser.add_argument('--tiers', nargs='+', choices=['primary', 'small', 'micro'], default=['primary', 'small', 'micro'])
    parser.add_argument('--check', action='store_true', help='verify outputs without writing')
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    tokens_path = here / 'catch-wordmark-tokens.json'
    tokens = json.loads(tokens_path.read_text())
    wordmark_path = here / tokens['canonicalWordmark']
    if digest(wordmark_path) != tokens['canonicalWordmarkSha256']:
        raise SystemExit('Canonical lettering changed. Review wordmark sources before updating the digest.')
    wordmark = ET.parse(wordmark_path).getroot()
    if any(e.tag.split('}')[-1] in ('image', 'text') for e in wordmark.iter()):
        raise SystemExit('Wordmark must contain outlined vector lettering.')
    if args.icons_json:
        inputs = json.loads(args.icons_json.read_text())
        anchor = args.icons_json.resolve().parent
    else:
        inputs = tokens['defaultIconInputs']
        anchor = here
    output_dir = args.output_dir.resolve() if args.output_dir else here / 'generated'
    if not args.check:
        output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {'wordmarkSha256': digest(wordmark_path), 'tokensSha256': digest(tokens_path), 'iconSources': {}, 'outputs': []}
    for channel in args.channels:
        manifest['iconSources'][channel] = {}
        for tier in args.tiers:
            source_ref = inputs[channel][tier]
            icon_path = (anchor / source_ref).resolve()
            manifest['iconSources'][channel][tier] = {'path': source_ref, 'sha256': digest(icon_path)}
            for orientation in ['horizontal', 'stacked']:
                for ink in ['dark', 'light']:
                    suffix = '' if tier == 'primary' else '-' + tier
                    name = f'catch-lockup-{orientation}-{channel}-{ink}{suffix}.svg'
                    content = compose(wordmark, icon_path, tokens, channel, orientation, ink, tier)
                    destination = output_dir / name
                    if args.check:
                        if not destination.is_file() or destination.read_text() != content:
                            raise SystemExit(f'Lockup needs regeneration: {name}')
                    else:
                        destination.write_text(content)
                    manifest['outputs'].append(name)
    content = json.dumps(manifest, indent=2) + '\n'
    destination = output_dir / 'catch-lockup-build-manifest.json'
    if args.check:
        if not destination.is_file() or destination.read_text() != content:
            raise SystemExit('Lockup manifest needs regeneration.')
    else:
        destination.write_text(content)
    print(('Verified' if args.check else 'Generated') + f' {len(manifest["outputs"])} lockups in {output_dir}')


if __name__ == '__main__':
    main()
