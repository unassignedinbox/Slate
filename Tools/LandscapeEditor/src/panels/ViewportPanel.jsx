//============================================================================================================================================
//                                                             VIEWPORTPANEL.JSX
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/panels/ViewportPanel.jsx — Viewport panel: lit 3D terrain with orbit drag and wheel zoom, or the 2D
//    view of any render mode chosen from a dropdown, with a measurement footer.

import React, { useEffect, useRef, useState } from 'react';
import { Box, Scan } from 'lucide-react';
import { VIEW_MODES } from '../engine/SatmapProjection.js';
import { createTerrainExchange } from '../viewport/TerrainExchange.js';
import { createOrbitPose, rotateOrbitPose, zoomOrbitPose } from '../viewport/OrbitSolver.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                       FORMATTING
//------------------------------------------------------------------------------------------------------------------------
function formatMeters(value)
{
    return `${Math.round(value)} m`;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         PANEL
//------------------------------------------------------------------------------------------------------------------------
export function ViewportPanel({ viewMode, onViewMode, viewId, onViewId, result, compute })
{
    const canvasRef = useRef(null);
    const flatRef = useRef(null);
    const exchangeRef = useRef(null);
    const poseRef = useRef(createOrbitPose());
    const scheduledRef = useRef(0);
    const [webglError, setWebglError] = useState('');

    const redraw = () =>
    {
        scheduledRef.current = 0;
        if (exchangeRef.current)
        {
            exchangeRef.current.draw(poseRef.current);
        }
    };
    const scheduleRedraw = () =>
    {
        if (!scheduledRef.current)
        {
            scheduledRef.current = requestAnimationFrame(redraw);
        }
    };

    // Creates the WebGL2 exchange once per 3D visit, with orbit drag and wheel zoom bound to the canvas.
    useEffect(() =>
    {
        if (viewMode !== '3d' || !canvasRef.current)
        {
            return undefined;
        }
        const canvas = canvasRef.current;
        let exchange = null;
        try
        {
            exchange = createTerrainExchange(canvas);
            setWebglError('');
        }
        catch (error)
        {
            setWebglError(error.message);
            return undefined;
        }
        exchangeRef.current = exchange;
        let dragging = null;
        const onDown = (event) =>
        {
            dragging = { x: event.clientX, y: event.clientY };
            canvas.setPointerCapture(event.pointerId);
        };
        const onMove = (event) =>
        {
            if (!dragging)
            {
                return;
            }
            rotateOrbitPose(poseRef.current, event.clientX - dragging.x, event.clientY - dragging.y);
            dragging = { x: event.clientX, y: event.clientY };
            scheduleRedraw();
        };
        const onUp = () =>
        {
            dragging = null;
        };
        const onWheel = (event) =>
        {
            event.preventDefault();
            zoomOrbitPose(poseRef.current, event.deltaY);
            scheduleRedraw();
        };
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('resize', scheduleRedraw);
        return () =>
        {
            canvas.removeEventListener('pointerdown', onDown);
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerup', onUp);
            canvas.removeEventListener('pointercancel', onUp);
            canvas.removeEventListener('wheel', onWheel);
            window.removeEventListener('resize', scheduleRedraw);
            if (scheduledRef.current)
            {
                cancelAnimationFrame(scheduledRef.current);
                scheduledRef.current = 0;
            }
            exchange.dispose();
            exchangeRef.current = null;
        };
    }, [viewMode]);

    useEffect(() =>
    {
        if (viewMode !== '3d' || !exchangeRef.current || !result)
        {
            return;
        }
        exchangeRef.current.setTerrain(result);
        scheduleRedraw();
    }, [result, viewMode]);

    useEffect(() =>
    {
        if (viewMode !== '2d' || !flatRef.current || !result)
        {
            return;
        }
        const canvas = flatRef.current;
        canvas.width = result.n;
        canvas.height = result.n;
        const context = canvas.getContext('2d');
        context.putImageData(new ImageData(result.viewRgba, result.n, result.n), 0, 0);
    }, [result, viewMode]);

    const metrics = result ? result.metrics : null;
    const viewStatus = compute.busy ? 'Computing…' : result ? `${result.n} × ${result.n} · ${Math.round(result.timings.totalMs)} ms` : 'Waiting for the first result';

    return (
        <section className="viewport-panel">
            <header className="viewport-toolbar">
                <div className="segmented" role="tablist">
                    <button type="button" role="tab" aria-selected={viewMode === '3d'} className={viewMode === '3d' ? 'is-active' : ''} onClick={() => onViewMode('3d')}>
                        <Box size={14} />
                        <span>3D</span>
                    </button>
                    <button type="button" role="tab" aria-selected={viewMode === '2d'} className={viewMode === '2d' ? 'is-active' : ''} onClick={() => onViewMode('2d')}>
                        <Scan size={14} />
                        <span>2D</span>
                    </button>
                </div>
                {viewMode === '2d' ? (
                    <label className="toolbar-field">
                        <span>View</span>
                        <select value={viewId} onChange={(event) => onViewId(event.target.value)}>
                            {VIEW_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                        </select>
                    </label>
                ) : (
                    <span className="toolbar-hint">Drag to orbit · scroll to zoom · satmap is draped over the relief</span>
                )}
                <span className={`viewport-status${compute.busy ? ' is-busy' : ''}`}>{viewStatus}</span>
            </header>
            <div className="viewport-well">
                {viewMode === '3d' ? (
                    webglError ? <div className="viewport-message">{webglError}</div> : <canvas ref={canvasRef} className="terrain-canvas" />
                ) : (
                    <div className="flat-well">
                        <canvas ref={flatRef} className="flat-canvas" />
                    </div>
                )}
                {compute.error ? <div className="viewport-error">{compute.error}</div> : null}
            </div>
            <footer className="viewport-footer">
                {metrics ? (
                    <>
                        <span>Relief {formatMeters(metrics.reliefM)}</span>
                        <span>Mean slope {metrics.meanSlopeDeg.toFixed(1)}°</span>
                        <span>Slope p95 {metrics.p95SlopeDeg.toFixed(1)}°</span>
                        <span>Channels {(metrics.channelLengthM / 1000).toFixed(2)} km</span>
                        <span>Eroded {(metrics.erodedM3 / 1e6).toFixed(2)} Mm³</span>
                        <span>Deposited {(metrics.depositedM3 / 1e6).toFixed(2)} Mm³</span>
                    </>
                ) : <span>No measurements yet.</span>}
            </footer>
        </section>
    );
}
