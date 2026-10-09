// Metadata da composição (puro, sem JSX): usado pelo Root (render) e pelo player.ts (prévia), testado em Node.
import type {OverlayVideoProps} from './types';

export const compositionMetadata = (props: Pick<OverlayVideoProps, 'width' | 'height' | 'fps' | 'durationSeconds'>) => ({
  width: props.width,
  height: props.height,
  fps: props.fps,
  durationInFrames: Math.max(1, Math.round(props.durationSeconds * props.fps))
});
