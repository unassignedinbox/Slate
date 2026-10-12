import React, { useId } from 'react';
import { ROAD_PRESETS, laneLayout, isBridgePreset } from '../lib/network.js';

export function RoadThumbnail({ type = 'arterial', large = false }) {
  const uid = useId().replace(/:/g, '');
  const catalogPreset = ROAD_PRESETS.find((p) => p.id === type);
  if (isBridgePreset(catalogPreset))
    return <BridgeThumbnail preset={catalogPreset} large={large} />;
  if (['tjunction', 'ymerge', 'crossroad'].includes(type))
    return (
      <svg
        viewBox="0 0 120 84"
        className={`road-thumbnail ${large ? 'large' : ''}`}
        aria-hidden="true"
      >
        <rect width="120" height="84" fill="#758268" />
        <path d="M-10 58L130 12" stroke="#b6b6a4" strokeWidth="21" />
        <path d="M-10 58L130 12" stroke="#3b453e" strokeWidth="15" />
        <path
          d={
            type === 'ymerge'
              ? 'M110 80C72 83 92 38 60 35'
              : type === 'crossroad'
                ? 'M80 84L50 -4'
                : 'M80 84L62 35'
          }
          stroke="#b6b6a4"
          strokeWidth="16"
          fill="none"
        />
        <path
          d={
            type === 'ymerge'
              ? 'M110 80C72 83 92 38 60 35'
              : type === 'crossroad'
                ? 'M80 84L50 -4'
                : 'M80 84L62 35'
          }
          stroke="#3b453e"
          strokeWidth="11"
          fill="none"
        />
        <path
          d="M-10 58L47 39M80 29L130 12"
          stroke="#e7deba"
          strokeWidth="1.4"
          strokeDasharray="7 5"
        />
        <circle cx="62" cy="35" r="3" fill="#d2b57a" />
        <circle cx="62" cy="35" r="5.6" fill="none" stroke="#d2b57a" strokeWidth=".8" />
      </svg>
    );
  if (type === 'diamond')
    return (
      <svg
        viewBox="0 0 120 84"
        className={`road-thumbnail ${large ? 'large' : ''}`}
        aria-hidden="true"
      >
        <rect width="120" height="84" fill="#758268" />
        <path d="M58 -5V90" stroke="#a5a58f" strokeWidth="14" />
        <path d="M58 -5V90" stroke="#3b463e" strokeWidth="10" />
        <path
          d="M8 42C28 42 31 15 56 15M108 36C90 36 84 67 59 67M60 15C81 15 89 42 109 42M57 67C34 67 28 36 8 36"
          stroke="#b8baa4"
          strokeWidth="5"
          fill="none"
        />
        <path
          d="M8 42C28 42 31 15 56 15M108 36C90 36 84 67 59 67M60 15C81 15 89 42 109 42M57 67C34 67 28 36 8 36"
          stroke="#424d43"
          strokeWidth="3"
          fill="none"
        />
        <path d="M-5 48H125" stroke="#27332a" strokeWidth="16" opacity=".4" />
        <path d="M-5 39H125" stroke="#b9b7a2" strokeWidth="15" />
        <path d="M-5 39H125" stroke="#3b443d" strokeWidth="11" />
        <path d="M-5 39H125" stroke="#c8b474" strokeWidth="1" />
        <path d="M-5 36H125M-5 42H125" stroke="#eee7ce" strokeWidth=".8" strokeDasharray="7 5" />
        <path d="M48 46v8m20-8v8" stroke="#a5a591" strokeWidth="3" />
      </svg>
    );
  if (type === 'cloverleaf')
    return (
      <svg className="road-thumbnail" viewBox="0 0 112 82" aria-hidden="true">
        <path d="M7 42l48-30 50 29-49 30z" fill="#46533b" />
        <g transform="translate(56 41) matrix(.75 -.4 .75 .4 0 0)">
          <path d="M-48 0H48M0-48V48" stroke="#313832" strokeWidth="13" fill="none" />
          <path d="M-48 0H48M0-48V48" stroke="#6e7868" strokeWidth="9" fill="none" />
          {[0, 90, 180, 270].map((a) => (
            <g key={a} transform={`rotate(${a})`}>
              <path
                d="M15 3a13 13 0 1 1-12 12M-36 3Q-3 3-3 36"
                stroke="#a5ab8f"
                strokeWidth="4"
                fill="none"
              />
            </g>
          ))}
          <path d="M0-45V45" stroke="#323a33" strokeWidth="13" />
          <path d="M0-45V45" stroke="#b9b79e" strokeWidth="10" />
          <path d="M0-45V45" stroke="#687064" strokeWidth="7" />
          <path d="M-45 0H45M0-45V45" stroke="#d8ca9b" strokeWidth=".7" strokeDasharray="4 4" />
        </g>
      </svg>
    );
  if (type === 'railway')
    return (
      <svg className="road-thumbnail" viewBox="0 0 112 82" aria-hidden="true">
        <path d="M10 43l48-28 47 25-49 31z" fill="#747b68" />
        <path d="M10 43v4l46 28 49-30v-5L56 71z" fill="#51584b" />
        <g transform="translate(56 42) matrix(.77 -.4 .82 .46 0 0)">
          <rect x="-47" y="-20" width="94" height="40" fill="#827e70" />
          {[-13, 13].map((y) => (
            <g key={y} transform={`translate(0 ${y})`}>
              {Array.from({ length: 14 }, (_, i) => (
                <path key={i} d={`M${i * 7 - 45} -7V7`} stroke="#b1b09e" strokeWidth="2.5" />
              ))}
              <path d="M-48-4H48M-48 4H48" stroke="#444c47" strokeWidth="2.4" />
              <path d="M-48-4H48M-48 4H48" stroke="#d2d5c9" strokeWidth="1.1" />
            </g>
          ))}
        </g>
      </svg>
    );
  if (type === 'roundabout')
    return (
      <svg className="road-thumbnail" viewBox="0 0 112 82" aria-hidden="true">
        <path d="M10 42l48-27 46 28-48 28z" fill="#303c2a" />
        <path d="M10 42v5l46 28 48-28v-4L56 71z" fill="#79816b" />
        <ellipse cx="56" cy="44" rx="36" ry="22" fill="#afb298" />
        <ellipse cx="56" cy="43" rx="32" ry="19" fill="#525b4e" />
        <ellipse
          cx="56"
          cy="43"
          rx="25"
          ry="14"
          stroke="#d6d5b8"
          strokeWidth=".8"
          strokeDasharray="4 5"
          fill="none"
        />
        <ellipse cx="56" cy="43" rx="18" ry="10" fill="#b3b398" />
        <ellipse cx="56" cy="42" rx="16" ry="9" fill="#81936b" />
        <path d="M20 43H6m87 0h13M57 24V13m0 49v10" stroke="#9aab85" strokeWidth="9" />
        <path d="M20 43H6m87 0h13M57 24V13m0 49v10" stroke="#535d4f" strokeWidth="6" />
        <ellipse cx="53" cy="41" rx="3" ry="4" fill="#617c53" />
      </svg>
    );
  const road = ROAD_PRESETS.find((p) => p.id === type) || ROAD_PRESETS[0];
  const bands = laneLayout({ ...road, type: road.type || road.id });
  const total = bands.reduce((s, b) => s + b.width, 0);
  const scale = 40 / Math.max(total, 15);
  const colors = {
    sidewalk: '#b2b19b',
    median: '#78835e',
    lane:
      road.material === 'concrete'
        ? '#a4a697'
        : road.material === 'gravel'
          ? '#958266'
          : road.material === 'paving'
            ? '#a8aa94'
            : '#555b59',
    cycle: '#788f7e',
    bus: '#9b756b',
    parking: '#676d68',
    shoulder: '#5d625b',
    path: road.material === 'asphalt' ? '#555b59' : '#a8aa90',
    rail: '#6b657a',
  };
  return (
    <svg
      className={`road-thumbnail ${large ? 'large' : ''}`}
      viewBox="0 0 112 82"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`tile-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#464d42" />
          <stop offset="1" stopColor="#303630" />
        </linearGradient>
        <linearGradient id={`side-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#929785" />
          <stop offset="1" stopColor="#62695e" />
        </linearGradient>
      </defs>
      <path d="M10 42L62 16l44 25-52 29z" fill="#161c18" opacity=".55" transform="translate(0 4)" />
      <path d="M10 38L62 12l44 25-52 29z" fill={`url(#tile-${uid})`} />
      <path d="M10 38v5l44 28v-5zm44 28v5l52-29v-5z" fill={`url(#side-${uid})`} />
      {type === 'bridge' && (
        <path d="M18 44l25-14 49 27-25 14z" fill="#424b40" stroke="#a1a78f" strokeWidth="2" />
      )}
      <g transform="translate(56 40) matrix(.77 -.40 .82 .46 0 0)">
        <rect x="-49" y="-22" width="98" height="44" rx="0.5" fill="#939882" />
        {bands.map((band, i) => (
          <rect
            key={i}
            x="-49"
            y={(band.center - band.width / 2) * scale}
            width="98"
            height={band.width * scale}
            fill={colors[band.kind]}
          />
        ))}
        {bands
          .filter((b) => b.kind === 'lane' || b.kind === 'bus')
          .map((band, i) => (
            <path
              key={i}
              d={`M-47 ${(band.center + band.width / 2) * scale}H47`}
              stroke="#e2dfc8"
              strokeWidth=".65"
              strokeDasharray="6 7"
              opacity=".8"
            />
          ))}
        {road.lanes > 1 && !road.oneWay && (
          <>
            <path d="M-49 -0.8H49M-49 0.8H49" stroke="#d1b772" strokeWidth=".65" />
          </>
        )}
        {type === 'bridge' && (
          <>
            <path d="M-49 -22H49M-49 22H49" stroke="#c7c7b3" strokeWidth="2" />
            <path
              d="M-32 -22v-5m24 5v-5m24 5v-5m24 5v-5M-32 22v-5m24 5v-5m24 5v-5m24 5v-5"
              stroke="#babdab"
              strokeWidth="1.4"
            />
          </>
        )}
        {type === 'subway' && (
          <>
            <path d="M-49 -7H49M-49 7H49" stroke="#d0cacb" strokeWidth="1.7" />
            <path
              d="M-48 -12v24m7-24v24m7-24v24m7-24v24m7-24v24m7-24v24m7-24v24m7-24v24m7-24v24m7-24v24m7-24v24m7-24v24m7-24v24m7-24v24"
              stroke="#8d8a90"
              strokeWidth="1.1"
            />
          </>
        )}
        {road.oneWay && (
          <g fill="#e2ddc4">
            <path d="M-10 -2l12-3v2h9v3H2v2z" />
          </g>
        )}
        {road.sidewalk > 0 && (
          <>
            <path
              d="M-30 -22v4m12-4v4m12-4v4m12-4v4m12-4v4m12-4v4M-30 18v4m12-4v4m12-4v4m12-4v4m12-4v4m12-4v4"
              stroke="#737b6a"
              strokeWidth=".5"
            />
            <ellipse cx="-23" cy="-22" rx="3.5" ry="4.7" fill="#6b7956" />
            <ellipse cx="27" cy="22" rx="3.5" ry="4.7" fill="#6b7956" />
          </>
        )}
      </g>
    </svg>
  );
}

function BridgeThumbnail({ preset, large }) {
  const style = preset.bridgeStyle || 'beam',
    narrow = style === 'footbridge',
    half = narrow ? 7 : 12;
  const project = (x, z, y = 8) => [56 + x * 0.82 + z * 0.67, 49 - x * 0.33 + z * 0.35 - y * 0.95];
  const path = (points) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${project(...p).join(' ')}`).join(' ');
  const polygon = (points) => points.map((p) => project(...p).join(',')).join(' ');
  const steel = ['covered', 'timber'].includes(style) ? '#967856' : '#a6bdb1';
  const truss = (z) => {
    const h = narrow ? 10 : 18,
      xs = [-35, -21, -7, 7, 21, 35];
    return (
      <g key={z} fill="none" stroke={steel} strokeWidth="1.4">
        <path
          d={path([
            [-35, z, 8],
            [35, z, 8],
          ])}
        />
        <path
          d={path([
            [-35, z, h],
            [35, z, h],
          ])}
        />
        {xs.slice(1).map((x, i) => (
          <path
            key={x}
            d={path([
              [xs[i], z, i % 2 ? h : 8],
              [x, z, i % 2 ? 8 : h],
            ])}
          />
        ))}
        {xs.map((x) => (
          <path
            key={`p${x}`}
            d={path([
              [x, z, 8],
              [x, z, h],
            ])}
          />
        ))}
      </g>
    );
  };
  const superstructure = (z) => {
    if (['truss', 'covered', 'footbridge'].includes(style)) return truss(z);
    if (style === 'arch')
      return (
        <g key={z} stroke={steel} fill="none">
          <path
            d={path(
              Array.from({ length: 21 }, (_, i) => [
                -35 + i * 3.5,
                z,
                8 + 20 * Math.sin((Math.PI * i) / 20),
              ]),
            )}
            strokeWidth="2.7"
          />
          {[-28, -14, 0, 14, 28].map((x) => (
            <path
              key={x}
              d={path([
                [x, z, 8],
                [x, z, 8 + 20 * Math.sin((Math.PI * (x + 35)) / 70)],
              ])}
              strokeWidth=".7"
            />
          ))}
        </g>
      );
    if (['cableStayed', 'suspension'].includes(style))
      return (
        <g key={z} stroke={steel} fill="none">
          {[-24, 24].map((x) => (
            <path
              key={x}
              d={path([
                [x, z, 8],
                [x, z, 37],
              ])}
              strokeWidth="2.5"
            />
          ))}
          {style === 'cableStayed' ? (
            [-35, -16, -7, 0, 7, 16, 35].map((x) => (
              <path
                key={x}
                d={path([
                  [x < 0 ? -24 : 24, z, 36],
                  [x, z, 8],
                ])}
                strokeWidth=".65"
              />
            ))
          ) : (
            <>
              <path
                d={path(
                  Array.from({ length: 25 }, (_, i) => [
                    -24 + i * 2,
                    z,
                    16 + 21 * ((2 * i) / 24 - 1) ** 2,
                  ]),
                )}
                strokeWidth="1.4"
              />
              {[-18, -12, -6, 0, 6, 12, 18].map((x) => (
                <path
                  key={x}
                  d={path([
                    [x, z, 8],
                    [x, z, 16 + 21 * (x / 24) ** 2],
                  ])}
                  strokeWidth=".6"
                />
              ))}
              <path
                d={path([
                  [-46, z, 8],
                  [-24, z, 37],
                ])}
                strokeWidth="1"
              />
              <path
                d={path([
                  [24, z, 37],
                  [46, z, 8],
                ])}
                strokeWidth="1"
              />
            </>
          )}
        </g>
      );
    return null;
  };
  return (
    <svg
      className={`road-thumbnail ${large ? 'large' : ''}`}
      viewBox="0 0 112 82"
      aria-hidden="true"
    >
      <path d="M8 51L61 20L105 45L52 76Z" fill="#3d4d37" />
      {[-28, 0, 28].map((x) => (
        <path
          key={x}
          d={path([
            [x, 0, -3],
            [x, 0, 8],
          ])}
          stroke={style === 'timber' ? '#95764f' : '#969f8c'}
          strokeWidth="5"
        />
      ))}
      {style === 'stoneArch' && (
        <g stroke="#b7ab8e" fill="none" strokeWidth="4">
          {[-1, 1].map((z) => (
            <path
              key={z}
              d={path(
                Array.from({ length: 25 }, (_, i) => [
                  -32 + (i * 64) / 24,
                  z * 7,
                  -1 + 7 * Math.abs(Math.sin((Math.PI * i) / 12)),
                ]),
              )}
            />
          ))}
        </g>
      )}
      {['girder', 'box', 'viaduct', 'timber'].includes(style) && (
        <path
          d={path([
            [-46, half, 4],
            [46, half, 4],
          ])}
          fill="none"
          stroke={style === 'girder' ? '#738d86' : steel}
          strokeWidth={style === 'box' ? 6 : 3}
        />
      )}
      {superstructure(-half)}
      <polygon
        points={polygon([
          [-47, -half, 5],
          [-47, -half, 8],
          [47, -half, 8],
          [47, -half, 5],
        ])}
        fill="#8a9281"
      />
      <polygon
        points={polygon([
          [-47, -half, 8],
          [47, -half, 8],
          [47, half, 8],
          [-47, half, 8],
        ])}
        fill={['timber', 'covered'].includes(style) ? '#b39b72' : narrow ? '#bbbba7' : '#555f56'}
      />
      <path
        d={path([
          [-46, half, 8],
          [46, half, 8],
        ])}
        stroke="#cad0b9"
        strokeWidth="1.3"
      />
      {!narrow && (
        <path
          d={path([
            [-46, 0, 8.1],
            [46, 0, 8.1],
          ])}
          stroke="#d6c27d"
          strokeWidth=".7"
          strokeDasharray="5 4"
        />
      )}
      {['cableStayed', 'suspension'].includes(style) &&
        [-24, 24].map((x) => (
          <path
            key={x}
            d={path([
              [x, -half, 31],
              [x, half, 31],
            ])}
            stroke="#a6b6a5"
            strokeWidth="2.4"
          />
        ))}
      {superstructure(half)}
      {style === 'covered' && (
        <>
          <polygon
            points={polygon([
              [-36, -half - 2, 19],
              [36, -half - 2, 19],
              [36, 0, 23],
              [-36, 0, 23],
            ])}
            fill="#49625a"
          />
          <polygon
            points={polygon([
              [-36, 0, 23],
              [36, 0, 23],
              [36, half + 2, 19],
              [-36, half + 2, 19],
            ])}
            fill="#658174"
          />
        </>
      )}
    </svg>
  );
}

export function DetailThumbnail({ type }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg className="detail-thumbnail" viewBox="0 0 116 64" aria-hidden="true">
      <defs>
        <linearGradient id={`metal-${uid}`} x1="0" x2="1">
          <stop stopColor="#5f6864" />
          <stop offset=".5" stopColor="#bbc1b1" />
          <stop offset="1" stopColor="#59615a" />
        </linearGradient>
      </defs>
      {['crosswalk', 'arrow', 'bump', 'rail'].includes(type) && (
        <>
          <path d="M13 36l44-24 48 24-44 25z" fill="#383e39" />
          <path d="M13 36v3l48 25v-3m0 3l44-25v-3" fill="#252b27" />
        </>
      )}
      {['driveway', 'curbRamp'].includes(type) && (
        <>
          <path d="M13 48L72 17L110 37L52 68Z" fill="#39443b" />
          <path d="M19 29L56 10L109 37L72 56Z" fill="#b3b3a1" />
          <path d="M19 29V36L72 64V56Z" fill="#888e7c" />
          <path d="M35 38L63 24L89 37L60 54Z" fill="#cac6af" />
          <path d="M35 38L60 54L60 61L35 44Z" fill="#a7aa94" />
          {type === 'curbRamp' ? (
            <g>
              <path d="M39 41L62 29L73 35L51 47Z" fill="#c9a653" />
              {[0, 1, 2, 3].map((i) => (
                <path
                  key={i}
                  d={`M${43 + i * 5} ${41 - i * 2.6}l7 3.5`}
                  stroke="#ead083"
                  strokeWidth="2"
                  strokeDasharray="1 2"
                />
              ))}
            </g>
          ) : (
            <path d="M71 29l13-7 22 11-13 7z" fill="#cdc9b2" />
          )}
        </>
      )}
      {type === 'crosswalk' && (
        <g transform="matrix(.85 -.46 .86 .43 57 37)">
          {[-22, -14, -6, 2, 10, 18].map((x) => (
            <rect key={x} x={x} y="-17" width="4.7" height="34" fill="#dddccd" />
          ))}
        </g>
      )}
      {type === 'arrow' && (
        <path d="M47 44l17-9-7-3 18-11 15 8-7 4-6-3-16 9 7 4-6 4z" fill="#dddece" />
      )}
      {type === 'bollard' && (
        <>
          <ellipse cx="60" cy="54" rx="21" ry="5" fill="#161c18" opacity=".35" />
          <path d="M44 48l14-7 15 8-14 8z" fill="#969e8d" />
          <path d="M51 20h16v28c0 8-16 8-16 0z" fill={`url(#metal-${uid})`} />
          <ellipse cx="59" cy="20" rx="8" ry="4" fill="#b5baaa" />
          <path d="M51 28c0 5 16 5 16 0v5c0 5-16 5-16 0z" fill="#d3bb79" />
        </>
      )}
      {type === 'bump' && (
        <>
          <path d="M28 36l40-20c5-2 11 2 15 8l-40 21c-4-6-10-10-15-9z" fill="#171f1a" />
          <g stroke="#ccb36c" strokeWidth="5">
            <path d="M38 30l13 10m-3-15l13 10m-3-15l13 10m-3-15l13 10" />
          </g>
        </>
      )}
      {type === 'rail' && (
        <>
          <path d="M23 29l64 25m-56-31l64 25" stroke="#a6ae9f" strokeWidth="2" />
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <path
              key={n}
              d={`M${27 + n * 9} ${24 + n * 3.5}l-5 12`}
              stroke="#756b59"
              strokeWidth="2.4"
            />
          ))}
          <path d="M34 16v16M34 18l34 12" stroke="#d3d1bd" strokeWidth="3" />
          <path d="M43 21l5 2m8 3l5 2" stroke="#b76c5e" strokeWidth="3.3" />
          <path d="M34 17l8-4" stroke="#babda8" strokeWidth="2" />
        </>
      )}
      {type === 'light' && (
        <>
          <path d="M35 52l35-6" stroke="#1c241d" strokeWidth="4" opacity=".3" />
          <path d="M56 51V13l18-6" fill="none" stroke={`url(#metal-${uid})`} strokeWidth="3" />
          <path d="M70 6l14 1-10 5-14-1z" fill="#bfc4b2" />
          <path d="M51 51l5-3 6 3-5 3z" fill="#8f9788" />
        </>
      )}
      {type === 'busStop' && (
        <>
          <path d="M30 22l29-15 33 17-30 15z" fill="#818e80" />
          <path d="M33 24v24m53-21v24M61 36v23" stroke="#a0ac98" strokeWidth="2" />
          <path d="M35 27l23 12v12L35 39z" fill="#91b1a4" opacity=".35" />
          <path d="M43 43l16 8 14-7-16-8z" fill="#a7946e" />
        </>
      )}
      {type === 'subway' && (
        <>
          <path d="M28 38l36-19 31 18-35 21z" fill="#959d8b" />
          <path d="M36 38l27-14 25 13-28 17z" fill="#303b32" />
          <path d="M51 44l27-15m-22 17l28-15m-23 17l27-15" stroke="#7c8876" strokeWidth="2" />
          <path d="M33 36V15m0 1l28 16v20" fill="none" stroke="#a4ad98" strokeWidth="1.8" />
          <path d="M28 13l10-4 28 15-8 5z" fill="#6d9291" />
        </>
      )}
    </svg>
  );
}
