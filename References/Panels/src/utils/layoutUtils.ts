import { LayoutNode, PanelType, SplitDirection, PanelNode, SplitNode } from '../types';

const generateId = () => Math.random().toString(36).substring(2, 9);

export function splitNode(root: LayoutNode, targetId: string, direction: SplitDirection, insertAt: 'first' | 'second' = 'second'): LayoutNode {
  if (root.type === 'leaf') {
    if (root.id === targetId) {
      const newNode: PanelNode = {
        id: generateId(),
        type: 'leaf',
        panelType: 'empty',
      };
      return {
        id: generateId(),
        type: 'split',
        direction,
        ratio: 0.5,
        first: insertAt === 'first' ? newNode : root,
        second: insertAt === 'first' ? root : newNode,
      };
    }
    return root;
  }

  return {
    ...root,
    first: splitNode(root.first, targetId, direction, insertAt),
    second: splitNode(root.second, targetId, direction, insertAt),
  };
}

export function closeNode(root: LayoutNode, targetId: string): LayoutNode | null {
  if (root.id === targetId) return null;

  if (root.type === 'leaf') return root;

  const newFirst = closeNode(root.first, targetId);
  const newSecond = closeNode(root.second, targetId);

  if (!newFirst && !newSecond) return null;
  if (!newFirst) return newSecond;
  if (!newSecond) return newFirst;

  return { ...root, first: newFirst, second: newSecond };
}

export function updatePanelType(root: LayoutNode, targetId: string, panelType: PanelType): LayoutNode {
  if (root.type === 'leaf') {
    if (root.id === targetId) return { ...root, panelType };
    return root;
  }
  return {
    ...root,
    first: updatePanelType(root.first, targetId, panelType),
    second: updatePanelType(root.second, targetId, panelType),
  };
}

export function resizeSplit(root: LayoutNode, targetId: string, ratio: number): LayoutNode {
  if (root.type === 'leaf') return root;
  if (root.id === targetId) return { ...root, ratio };
  return {
    ...root,
    first: resizeSplit(root.first, targetId, ratio),
    second: resizeSplit(root.second, targetId, ratio),
  };
}
