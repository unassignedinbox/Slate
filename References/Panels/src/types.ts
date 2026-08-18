export type GridType = 'none' | 'lines' | 'dots';
export type ShadingMode = 'solid' | 'wireframe' | 'matcap' | 'normal' | 'metallic' | 'gi';
export type GridUnit = 'mm' | 'cm' | 'm' | 'km';
export type GizmoType = 'blender' | 'cad';
export type CameraType = 'perspective' | 'orthographic';
export type PanelType = '3d_viewport' | 'outliner' | 'properties' | 'empty' | 'uv_editor';
export type SplitDirection = 'horizontal' | 'vertical';

export interface PanelNode {
  id: string;
  type: 'leaf';
  panelType: PanelType;
}

export interface SplitNode {
  id: string;
  type: 'split';
  direction: SplitDirection;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = PanelNode | SplitNode;

export interface CameraBookmark {
  id: string;
  name: string;
  position: number[];
  target: number[];
}

export interface ViewportConfig {
  id: string;
  name: string;
  gridType: GridType;
  gridSize: number;
  gridSubdivisions: number;
  gridUnit: GridUnit;
  shadingMode: ShadingMode;
  gizmoType: GizmoType;
  zoomToFit: boolean;
  showAxisX: boolean;
  showAxisY: boolean;
  showAxisZ: boolean;
  cameraType: CameraType;
  bookmarks: CameraBookmark[];
  activeOverlays: string[];
  layout: LayoutNode;
}

