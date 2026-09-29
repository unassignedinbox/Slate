import React, { useEffect, useRef } from 'react';
import { getNodeDef, PORT_COLORS, type GraphNode } from '../../core/graph/types';
import type { BuildIssue } from '../../core/graph/Evaluator';
import { Icon } from '../icons';
import { NODE_W } from './geometry';
import { useThumbs } from '../thumbs';

export interface PortHit {
  nodeId: string;
  portId: string;
  dir: 'in' | 'out';
  type: string;
}

interface Props {
  node: GraphNode;
  selected: boolean;
  pinned: boolean;
  dragging: boolean;
  connectedIn: Set<string>;
  connectedOut: Set<string>;
  issues: BuildIssue[];
  hotPort: PortHit | null;
  onPointerDownCard(e: React.PointerEvent, node: GraphNode): void;
  onPortDown(e: React.PointerEvent, hit: PortHit): void;
  onPortUp(e: React.PointerEvent, hit: PortHit): void;
  onPortEnter(hit: PortHit | null): void;
  onDoubleClick(node: GraphNode): void;
}

function Thumb({ id }: { id: string }) {
  const data = useThumbs((s) => s.map[id]);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !data) return;
    cv.width = data.width;
    cv.height = data.height;
    const ctx = cv.getContext('2d');
    ctx?.putImageData(data, 0, 0);
  }, [data]);
  if (!data) return <div className="ph" />;
  return <canvas ref={ref} />;
}

export const NodeCard = React.memo(function NodeCard({
  node, selected, pinned, dragging, connectedIn, connectedOut, issues, hotPort,
  onPointerDownCard, onPortDown, onPortUp, onPortEnter, onDoubleClick,
}: Props) {
  const def = getNodeDef(node.type);
  const showThumbs = useThumbs((s) => s.enabled);
  if (!def) {
    return (
      <div className="node has-error" style={{ left: node.x, top: node.y, width: NODE_W }}>
        <div className="node-head">
          <div className="node-glyph"><Icon name="alert" size={16} /></div>
          <div className="node-titles">
            <div className="node-title">Unknown node</div>
            <div className="node-sub">{node.type}</div>
          </div>
        </div>
      </div>
    );
  }

  const rows = Math.max(def.inputs.length, def.outputs.length, 1);
  const err = issues.find((i) => i.severity === 'error');
  const warn = issues.find((i) => i.severity === 'warn');
  const issue = err ?? warn;
  const wantsThumb = showThumbs && def.outputs.some((o) => o.type === 'field' || o.type === 'color');

  const cls = [
    'node',
    selected && 'selected',
    pinned && 'pinned',
    dragging && 'dragging',
    node.bypassed && 'bypassed',
    err && 'has-error',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      style={{ left: node.x, top: node.y, width: NODE_W }}
      onPointerDown={(e) => onPointerDownCard(e, node)}
      onDoubleClick={() => onDoubleClick(node)}
      data-node-id={node.id}
    >
      <div className="node-head">
        <div className="node-glyph" style={pinned ? { color: 'var(--accent)', borderColor: 'var(--accent-dim)' } : undefined}>
          <Icon name={def.icon} size={16} />
        </div>
        <div className="node-titles">
          <div className="node-title">{node.title ?? def.title}</div>
          <div className="node-sub">{def.subtitle}</div>
        </div>
        <div className="node-flags">
          {node.locked && <Icon name="lock" size={12} />}
          {node.bypassed && <Icon name="diamond" size={12} />}
          {pinned && <Icon name="eye" size={12} />}
        </div>
      </div>

      {!node.folded && (
        <>
          <div className="node-div" />
          <div className="node-body">
            <div className="node-col">
              <div className="col-label">In</div>
              {def.inputs.length === 0 && <div className="port-row optional" style={{ opacity: 0.4 }}>—</div>}
              {def.inputs.map((p) => {
                const hit: PortHit = { nodeId: node.id, portId: p.id, dir: 'in', type: p.type };
                const hot = hotPort && hotPort.nodeId === node.id && hotPort.portId === p.id && hotPort.dir === 'in';
                return (
                  <div key={p.id} className={`port-row${p.optional ? ' optional' : ''}`} title={p.info}>
                    <span
                      className={`port-dot${connectedIn.has(p.id) ? ' connected' : ''}${hot ? ' hot' : ''}`}
                      style={{ background: PORT_COLORS[p.type], top: 5 }}
                      onPointerDown={(e) => { e.stopPropagation(); onPortDown(e, hit); }}
                      onPointerUp={(e) => { e.stopPropagation(); onPortUp(e, hit); }}
                      onPointerEnter={() => onPortEnter(hit)}
                      onPointerLeave={() => onPortEnter(null)}
                    />
                    {p.label}
                  </div>
                );
              })}
              {Array.from({ length: Math.max(0, rows - Math.max(1, def.inputs.length)) }).map((_, i) => (
                <div key={`pad${i}`} className="port-row" />
              ))}
            </div>

            <div className="node-col out">
              <div className="col-label">Out</div>
              {def.outputs.length === 0 && <div className="port-row out optional" style={{ opacity: 0.4 }}>—</div>}
              {def.outputs.map((p) => {
                const hit: PortHit = { nodeId: node.id, portId: p.id, dir: 'out', type: p.type };
                const hot = hotPort && hotPort.nodeId === node.id && hotPort.portId === p.id && hotPort.dir === 'out';
                return (
                  <div key={p.id} className="port-row out" title={p.info}>
                    <span
                      className={`port-dot${connectedOut.has(p.id) ? ' connected' : ''}${hot ? ' hot' : ''}`}
                      style={{ background: PORT_COLORS[p.type], top: 5 }}
                      onPointerDown={(e) => { e.stopPropagation(); onPortDown(e, hit); }}
                      onPointerUp={(e) => { e.stopPropagation(); onPortUp(e, hit); }}
                      onPointerEnter={() => onPortEnter(hit)}
                      onPointerLeave={() => onPortEnter(null)}
                    />
                    {p.label}
                  </div>
                );
              })}
              {Array.from({ length: Math.max(0, rows - Math.max(1, def.outputs.length)) }).map((_, i) => (
                <div key={`pad-out-${i}`} className="port-row out" />
              ))}
            </div>
          </div>

          {wantsThumb && (
            <div className="node-preview">
              <Thumb id={node.id} />
            </div>
          )}

          {issue && (
            <div className={`node-issue${issue.severity === 'error' ? ' err' : ''}`}>
              <Icon name="alert" size={12} />
              <span>{issue.message}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
});
