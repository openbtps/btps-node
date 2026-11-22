/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * What docs/.../boundview/not-supported.md claims, as cases. Each item of the
 * page is put into a seed's design: "Not carried" and "Carried approximately"
 * must not make the snapshot throw; "What makes the snapshot throw" must throw,
 * with its documented message. Half the seeds carry no claim and are the sweep
 * as before; of the rest, a quarter of all seeds an ignored item, 15% an
 * approximate one, 10% a throwing one, the same for every type.
 */

export type Hooks = { plain: boolean; html: string; css: string; glyph: string; width?: number };
export type Group = 'ignored' | 'approximate' | 'throws';
export type Claim = { group: Group; item: string; expect?: RegExp; hooks: (type: string) => Hooks; direct?: () => void };

import { signatureSvg } from '../src/signature.js';

const none: Hooks = { plain: false, html: '', css: '', glyph: '' };
/** Where the page is served from, and the same server by another name: a site that does not allow it (no CORS). */
const here = () => `http://127.0.0.1:${globalThis.location?.port ?? ''}`;
const elsewhere = () => `http://localhost:${globalThis.location?.port ?? ''}`;

/** A decoration at the foot of the page, holding no fact: `inner` in a box styled `style`, with `css` beside it. */
const deco = (style: string, inner = 'With our compliments', css = ''): Hooks => ({
  ...none,
  html: `<div class="claim" style="margin:16px 0 48px;padding:8px;${style}">${inner}</div>`,
  css,
});
/** The same item on a fact's own element (the document's id or date) instead, where the docs say it is safe there too. */
const onFact = (style: string): Hooks => ({ ...none, css: `#preview .anchor{display:inline-block;${style}}` });

/** A choice within an item, from the seed's own number, so a seed always makes the same case. */
let current = 0;
const any = (k: number) => current % k;

type Item = { item: string; hooks: (type: string, alt: boolean) => Hooks; expect?: RegExp; direct?: () => void };

const IGNORED: Item[] = [
  { item: 'filter on a box', hooks: (_, alt) => (alt ? onFact('filter:blur(1px) grayscale(1)') : deco('background:#e9f7ef;filter:blur(2px) sepia(1)')) },
  { item: 'mix-blend-mode on a box', hooks: (_, alt) => (alt ? onFact('mix-blend-mode:multiply') : deco('background:#fff7e6;mix-blend-mode:difference')) },
  { item: 'clip-path on a box', hooks: (_, alt) => (alt ? onFact('clip-path:inset(0 round 4px)') : deco('background:#eef2f7;clip-path:circle(40%)')) },
  { item: 'backdrop-filter', hooks: (_, alt) => (alt ? onFact('backdrop-filter:blur(4px)') : deco('backdrop-filter:blur(6px);background:rgba(255,255,255,.4)')) },
  { item: 'mask-image', hooks: (_, alt) => (alt ? onFact('mask-image:linear-gradient(#000,#000)') : deco('background:#1d4ed8;color:#fff;mask-image:linear-gradient(to right,#000,transparent)')) },
  { item: 'border-image', hooks: (_, alt) => (alt ? onFact('border:2px solid #0b6e4f;border-image:linear-gradient(red,blue) 1') : deco('border:6px solid #333;border-image:repeating-linear-gradient(45deg,#f00 0 5px,#00f 5px 10px) 6')) },
  { item: 'z-index, stacking contexts', hooks: () => deco('position:relative;z-index:5;background:#f1edfb', '<span style="position:relative;z-index:-2">Stacked</span> and <span style="position:relative;z-index:9;isolation:isolate">restacked</span>') },
  { item: 'overflow hidden inside the preview', hooks: () => deco('overflow:hidden;height:22px;background:#eef2f7', 'First line<br>second line clipped by the browser<br>third line') },
  { item: 'text-overflow ellipsis', hooks: () => deco('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:120px', 'A long line the browser cuts with an ellipsis') },
  { item: 'conic-gradient', hooks: () => deco('height:24px;background:conic-gradient(red,yellow,green,blue,red)', '') },
  { item: 'repeating-radial-gradient', hooks: () => deco('height:24px;background:repeating-radial-gradient(circle,#ddd 0 4px,#fff 4px 8px)', '') },
  { item: 'repeating-conic-gradient', hooks: () => deco('height:24px;background:repeating-conic-gradient(#eee 0 10deg,#fff 10deg 20deg)', '') },
  { item: 'gradient with a colour hint', hooks: () => deco('height:24px;background:linear-gradient(red, 30%, blue)', '') },
  { item: 'background-size/position/repeat on a gradient', hooks: () => deco('height:32px;background:linear-gradient(#0b6e4f,#e9f7ef) no-repeat right 4px top 4px / 40px 12px', '') },
  { item: 'color transparent, background-clip text', hooks: () => deco('font-size:20px;font-weight:700;background:linear-gradient(90deg,#1d4ed8,#6d28d9);-webkit-background-clip:text;background-clip:text;color:transparent', 'Gradient words') },
  { item: 'direction rtl', hooks: (_, alt) => deco('direction:rtl;text-align:right', alt ? 'With our compliments, شكرا, תודה' : 'With our compliments') },
  { item: 'writing-mode vertical', hooks: () => deco('writing-mode:vertical-rl;text-orientation:upright;height:120px', 'PAID') },
  { item: 'text-transform capitalize', hooks: (_, alt) => (alt ? onFact('text-transform:capitalize') : deco('text-transform:capitalize', 'thank you for your business')) },
  { item: 'hyphens auto', hooks: () => ({ ...deco('hyphens:auto;width:70px', 'Extraordinarily comprehensive internationalisation'), html: `<div class="claim" lang="en" style="margin:16px 0 48px;padding:8px;hyphens:auto;-webkit-hyphens:auto;width:70px">Extraordinarily comprehensive internationalisation</div>` }) },
  { item: '::first-line', hooks: () => deco('', 'First line styled by the browser and a second line after it that wraps somewhere', '#preview .claim::first-line{color:#7c2d12;font-weight:700}') },
  { item: '::before counter()', hooks: () => deco('counter-reset:n 3', 'Item', '#preview .claim::before{counter-increment:n;content:counter(n) ". "}') },
  { item: '::before url()', hooks: () => deco('', 'Logo before', `#preview .claim::before{content:url(/logo.svg)}`) },
  { item: '::before quotes', hooks: () => deco('quotes:"«" "»"', 'Quoted', '#preview .claim::before{content:open-quote}#preview .claim::after{content:close-quote}') },
  { item: '<canvas>', hooks: () => deco('', '<canvas width="80" height="20" style="border:1px solid #999;background:#eee"></canvas>') },
  { item: '<video>', hooks: () => deco('', '<video width="80" height="40" style="border:1px solid #999;background:#000"></video>') },
  { item: '<iframe>', hooks: () => deco('', '<iframe srcdoc="<p>inside</p>" width="120" height="40" style="border:1px solid #999"></iframe>') },
  { item: 'fonts after the first in font-family', hooks: (_, alt) => (alt ? onFact(`font-family:'Not A Font','Tinos',serif`) : deco(`font-family:'Not A Font', 'Arimo', sans-serif`)) },
  {
    item: 'font from a cross-origin stylesheet without CORS',
    hooks: () => ({ ...deco(`font-family:'Remote Caveat'`, 'With our compliments'), html: `<link rel="stylesheet" href="${elsewhere()}/nocors.css"><div class="claim" style="margin:16px 0 48px;font-family:'Remote Caveat'">With our compliments</div>` }),
  },
  { item: 'animations and transitions', hooks: (_, alt) => (alt ? onFact('animation:claimfade 2s infinite alternate;transition:all 1s') : deco('', '<span style="display:inline-block;width:40px;animation:claimspin 1s linear infinite;transition:all 1s;background:#eef2f7">PAID</span>')) },
].map((item) =>
  item.item === 'animations and transitions'
    ? { ...item, hooks: (type: string, alt: boolean) => { const h = item.hooks(type, alt); return { ...h, css: `${h.css}\n@keyframes claimspin{to{transform:rotate(360deg)}}@keyframes claimfade{from{outline:1px solid transparent}to{outline:3px solid #9be7c4}}` }; } }
    : item,
);

const APPROXIMATE: Item[] = [
  { item: 'box-shadow with a blur', hooks: (_, alt) => (alt ? onFact('box-shadow:0 4px 16px rgba(0,0,0,.25)') : deco('box-shadow:0 8px 24px rgba(0,0,0,.2), 0 0 2px #000')) },
  { item: 'text-shadow', hooks: (_, alt) => (alt ? onFact('text-shadow:0 0 4px rgba(0,0,0,.4)') : deco('text-shadow:2px 2px 6px #999;font-size:18px')) },
  { item: 'radial-gradient as an ellipse', hooks: () => deco('height:40px;background:radial-gradient(ellipse at center,#fff7e6,#0b6e4f)', '') },
  { item: 'gradient with more than 8 stops', hooks: () => deco('height:24px;background:linear-gradient(90deg,#f00,#f80,#ff0,#8f0,#0f0,#0f8,#0ff,#08f,#00f,#80f,#f0f,#f08)', '') },
  { item: 'dotted and dashed borders with rounded corners, mixed sides', hooks: () => deco('border:3px dotted #333;border-top:4px dashed #0b6e4f;border-left-color:#7c2d12;border-radius:14px') },
  { item: 'groove, ridge, inset, outset borders', hooks: (_, alt) => deco(alt ? 'border:6px groove #888;outline:4px ridge #aaa' : 'border-width:6px;border-style:inset outset inset outset;border-color:#999') },
  { item: 'text shaping: ligatures, justify, word-spacing', hooks: () => deco('text-align:justify;word-spacing:6px;width:220px', 'Affluent office officials fiddle with efficient waffle flows and justified text that wraps across lines') },
  { item: 'font-variant small-caps', hooks: (_, alt) => (alt ? onFact('font-variant:small-caps') : deco('font-variant:small-caps;font-size:14px')) },
  { item: 'translucent text', hooks: (_, alt) => deco(alt ? 'opacity:.6' : 'color:rgba(15,27,45,.55)') },
  { item: 'images downscaled', hooks: () => deco('', `<img src="/big.png" alt="" style="display:block;width:300px;height:225px">`) },
  { item: 'img or svg with filter, blend or clip-path', hooks: (_, alt) => deco('', alt ? `<svg width="60" height="60" style="filter:drop-shadow(2px 2px 2px #000);clip-path:circle(45%)"><rect width="60" height="60" fill="#1d4ed8"/></svg>` : `<img src="/logo.png" width="64" height="64" alt="" style="filter:sepia(1);mix-blend-mode:multiply;clip-path:inset(4px round 8px)">`) },
  {
    item: 'a fact in a font it cannot read (cross-origin stylesheet)',
    hooks: () => ({ ...none, html: `<link rel="stylesheet" href="${elsewhere()}/nocors.css">`, css: `#preview .anchor{font-family:'Remote Caveat'}` }),
  },
  { item: '3D transforms', hooks: (_, alt) => deco(alt ? 'transform:perspective(300px) rotateY(25deg)' : 'transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,10,0,0,1) rotateX(20deg)', 'PAID') },
  { item: 'a font it cannot read, or a system font', hooks: (_, alt) => (alt ? onFact(`font-family:system-ui;font-weight:700`) : deco(`font-family:${['Helvetica', 'Inter', 'Roboto', 'system-ui', 'Calibri'][any(5)]};font-weight:700;font-style:italic`)) },
];

/** A run of `count` characters with no space, and the distinct characters of Latin, Latin Extended, Greek and Cyrillic. */
const MANY_GLYPHS = [
  ...Array.from({ length: 94 }, (_, i) => String.fromCodePoint(33 + i)),
  ...Array.from({ length: 128 }, (_, i) => String.fromCodePoint(0x100 + i)),
  ...Array.from({ length: 64 }, (_, i) => String.fromCodePoint(0x410 + i)),
].join('');
/** A filled circle traced through `points` points: long, and drawn alike by the engine and the browser, so it goes as outlines. */
const pathOf = (points: number) =>
  `M${Array.from({ length: points }, (_, i) => `${(150 + 38 * Math.cos((2 * Math.PI * i) / points)).toFixed(3)} ${(40 + 38 * Math.sin((2 * Math.PI * i) / points)).toFixed(3)}`).join('L')}Z`;
const FONTS_10 = [
  ['Arimo', 400], ['Arimo', 700], ['Tinos', 400], ['Tinos', 700], ['Cousine', 400], ['Cousine', 700],
  ['Geist', 400], ['Source Serif 4', 400], ['Atkinson Hyperlegible Next', 400], ['Caveat', 400],
] as const;

const THROWS: Item[] = [
  { item: 'a fact rotated', expect: /is turned or slanted by a CSS transform; a BoundView draws it upright/, hooks: (_, alt) => onFact(alt ? 'rotate:3deg' : 'transform:rotate(-4deg)') },
  { item: 'a fact skewed, flipped or unevenly scaled', expect: /is turned or slanted by a CSS transform/, hooks: (_, alt) => onFact(alt ? 'transform:skewX(10deg)' : `transform:${['scaleX(-1)', 'scale(1.3,1)'][any(2)]}`) },
  { item: 'the area around a fact rotated', expect: /is turned or slanted by a CSS transform/, hooks: () => ({ ...none, css: '#preview header{transform:rotate(2deg)}' }) },
  { item: 'a background image without CORS', expect: /a background image \(.*\) could not be read: it must be served from this site, or allow it \(CORS\)/, hooks: () => deco(`height:30px;background-image:url(${elsewhere()}/nocors.png);background-size:contain;background-repeat:no-repeat`, '') },
  { item: 'a background image that fails to load', expect: /a background image \(.*\) could not be read/, hooks: () => deco(`height:30px;background-image:url(${here()}/missing.png)`, '') },
  { item: 'an <img> without CORS', expect: /an image \(.*\) could not be read: it must be served from this site, or allow it \(CORS\)/, hooks: () => deco('', `<img src="${elsewhere()}/nocors.png" width="40" height="40" alt="">`) },
  { item: 'a character in a fact with no glyph (emoji)', expect: /no font has a glyph for ".*", which .* shows/, hooks: () => ({ ...none, glyph: ['😀', '🧾', '✅'][any(3)] as string }) },
  { item: 'more than 8 fonts', expect: /the preview uses \d+ fonts; a BoundView carries at most 8/, hooks: () => deco('', FONTS_10.map(([family, weight]) => `<span style="font-family:'${family}';font-weight:${weight}">Aa</span>`).join(' ')) },
  { item: 'more than 8 images', expect: /images: must have at most 8 keys/, hooks: () => deco('', Array.from({ length: 9 }, (_, i) => `<img src="/logo.png?${i}" width="${20 + i}" height="${20 + i}" alt="">`).join('')) },
  { item: 'an image over 256 KiB of data (a photo)', expect: /data: String must contain at most \d+ character|at most 393216 bytes as JSON/, hooks: () => deco('', '<img src="/mid1.png" width="240" height="240" alt="">') },
  { item: 'text smaller than 6 px', expect: /size: Number must be greater than or equal to 6/, hooks: () => deco('font-size:5px', 'Fine print') },
  { item: 'small capitals under 6 px', expect: /size: Number must be greater than or equal to 6/, hooks: () => deco('font-size:8px;font-variant:small-caps', 'fine print') },
  { item: 'text larger than 400 px', expect: /size: Number must be less than or equal to 400/, hooks: () => ({ ...deco('font-size:420px;line-height:1', 'W'), width: 794 }) },
  { item: 'too many path characters', expect: /d: String must contain at most 20000 character|at most 100000 characters of paths/, hooks: () => deco('', `<svg width="300" height="80" viewBox="0 0 300 80"><path d="${pathOf(2600)}" fill="#0b6e4f"/></svg>`) },
  { item: 'more than 2,000 elements', expect: /elements: must have at most 2000 entries/, hooks: () => deco('line-height:0', Array.from({ length: 2100 }, () => '<i style="display:inline-block;width:3px;height:3px;margin:1px;background:#ccc"></i>').join('')) },
  { item: 'page wider than 2,000 px', expect: /page\.width: Number must be less than or equal to 2000/, hooks: () => ({ ...none, width: 2100 }) },
  { item: 'more than 256 glyphs in a font', expect: /glyphs: must have at most 256 keys/, hooks: () => deco(`font-family:'Arimo';word-break:break-all`, MANY_GLYPHS.replace(/[<>&"]/g, '')) },
  { item: 'a label over 500 characters', expect: /text: String must contain at most 500 character/, hooks: () => ({ ...deco('white-space:nowrap;font-size:6px', 'x'.repeat(520)), width: 1900 }) },
  { item: 'the BoundView over 384 KiB as JSON', expect: /at most 393216 bytes as JSON/, hooks: () => deco('', '<img src="/mid1.png" width="240" height="240" alt=""><img src="/mid2.png" width="240" height="240" alt="">') },
  { item: 'a fact covered by a positioned element (z-index -1)', expect: /A receiver would not show this BoundView/, hooks: () => ({ ...none, html: '<div style="position:absolute;inset:0;z-index:-1;background:#ffffff"></div>' }) },
  { item: "a signature's colour not hex or currentColor", expect: /a signature's colour is a hex colour or currentColor/, hooks: () => none, direct: () => void signatureSvg([[100, 100, 300, 200]], ['red', 'rgb(0,0,0)', '#12345', 'url(#x)', 'currentcolor'][any(5)] as string) },
];

/** A stream of numbers from a seed, apart from generate's own, so a claim never moves a seed's layout. */
const mix = (seed: number) => {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};

export const ITEMS: Record<Group, string[]> = { ignored: IGNORED.map((i) => i.item), approximate: APPROXIMATE.map((i) => i.item), throws: THROWS.map((i) => i.item) };

/** The claim a seed tests, if any: by seed / 5, so each of the five types gets the same share of every item. */
export const claimFor = (seed: number): Claim | undefined => {
  const h = mix(Math.floor(seed / 5));
  const bucket = h % 20;
  const group: Group | undefined = bucket < 10 ? undefined : bucket < 15 ? 'ignored' : bucket < 18 ? 'approximate' : 'throws';
  if (group === undefined) return undefined;
  const list = group === 'ignored' ? IGNORED : group === 'approximate' ? APPROXIMATE : THROWS;
  const pick = list[(h >>> 8) % list.length] as Item;
  const alt = ((h >>> 20) & 1) === 1;
  const choose = () => (current = h >>> 21);
  return {
    group,
    item: pick.item,
    expect: pick.expect,
    // Alone in a plain design: what the case shows is the item's doing, not a random effect beside it.
    hooks: (type) => (choose(), { ...pick.hooks(type, alt), plain: true }),
    direct: pick.direct && (() => (choose(), pick.direct?.())),
  };
};
