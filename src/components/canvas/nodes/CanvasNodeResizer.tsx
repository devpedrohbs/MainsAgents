import { NodeResizer } from '@xyflow/react';
import type { CanvasNodeKind } from '../canvasTypes';
import { canvasSizes } from '../canvasGeometry';

// Keep controls outside the clipped article so all corners remain reachable.
export function CanvasNodeResizer({kind,selected}:{kind:CanvasNodeKind;selected:boolean}) {
  const size=canvasSizes[kind];
  return <NodeResizer isVisible={selected} minWidth={size.minWidth} minHeight={size.minHeight} color="var(--accent)" handleClassName="canvas-resize-handle" lineClassName="canvas-resize-line"/>;
}
