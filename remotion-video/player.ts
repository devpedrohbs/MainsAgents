// Entrada da PRÉVIA no app (React + @remotion/player): browser-safe, sem node/fs. Usa exatamente a mesma composição
// e o mesmo cálculo de metadata do render (Root.tsx), então prévia e MP4 não divergem.
// Uso na UI: <Player {...playerProps(props)} controls style={{width: '100%'}} />, com `props` = resolveAnimations(spec,
// metadata) do adaptador + src (URL local do vídeo cortado) + width/height/fps/durationSeconds (+ assets locais).
import {OverlayVideo} from './Overlays';
import {compositionMetadata} from './metadata';
import type {OverlayVideoProps} from './types';

export {OverlayVideo};
export type {OverlayVideoProps} from './types';

/** Mesmo cálculo do `calculateMetadata` da composição registrada para o render. */
export {compositionMetadata};

/** Props prontas para <Player>: componente, inputProps e dimensões/fps/duração idênticos aos do render. */
export const playerProps = (props: OverlayVideoProps) => {
  const meta = compositionMetadata(props);
  return {component: OverlayVideo, inputProps: props, durationInFrames: meta.durationInFrames, fps: meta.fps, compositionWidth: meta.width, compositionHeight: meta.height};
};
