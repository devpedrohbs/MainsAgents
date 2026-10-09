import React from 'react';
import {Composition} from 'remotion';
import {OverlayVideo} from './Overlays';
import {COMPOSITION_ID, type OverlayVideoProps} from './types';
import {compositionMetadata} from './metadata';

const defaults: OverlayVideoProps = {src: '', width: 1280, height: 720, fps: 30, durationSeconds: 1, theme: 'dark', accent: '#2f6bff'};

export const Root: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={OverlayVideo}
    width={defaults.width}
    height={defaults.height}
    fps={defaults.fps}
    durationInFrames={Math.round(defaults.durationSeconds * defaults.fps)}
    defaultProps={defaults}
    calculateMetadata={({props}) => compositionMetadata(props)}
  />
);
