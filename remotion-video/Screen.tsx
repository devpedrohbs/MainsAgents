import React from 'react';
import {OffthreadVideo, useCurrentFrame, useVideoConfig} from 'remotion';
import {cameraRect, containRect, screenBox} from '../editorial-storyboard.mjs';
import type {ProtectBand} from '../editorial-storyboard.mjs';
import type {ScreenProps} from './types';

// Gravação de TELA de um par câmera+tela. A trilha chega já cortada pelo host com a MESMA linha do tempo do vídeo da
// câmera; `windows` diz onde ela existe. A tela é sempre "contain" (interface real, aspecto preservado, sem corte nem
// distorção). Fora das janelas nada é desenhado aqui: a câmera volta cheia (nunca um quadro congelado).

export const screenAvailable = (screen: ScreenProps | undefined, frame: number) => Boolean(screen?.windows.some((item) => frame >= item.fromFrame && frame < item.toFrame));

/** Fundo + tela no retângulo do modo. */
export const ScreenStage: React.FC<{screen: ScreenProps; src: string; mode: 'full' | 'with-camera'; background: string; protect?: ProtectBand; radius?: number}> = ({screen, src, mode, background, protect, radius = 0}) => {
  const {width, height} = useVideoConfig();
  const rect = containRect(screenBox(mode, width, height, protect), screen.width, screen.height);
  return (
    <div style={{position: 'absolute', inset: 0, background}}>
      <div style={{position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, overflow: 'hidden', borderRadius: mode === 'with-camera' ? radius : 0}}>
        <OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: 'contain'}} />
      </div>
    </div>
  );
};

/** Sem storyboard: composição fixa do par no vídeo todo (tela + câmera no canto, ou só a tela), câmera cheia onde não há tela. */
export const PairVideo: React.FC<{screen: ScreenProps; screenSrc: string; src: string}> = ({screen, screenSrc, src}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const unit = Math.min(width, height) / 100;
  if (!screenAvailable(screen, frame)) return <OffthreadVideo src={src} muted style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain'}} />;
  const cam = cameraRect('pip', width, height);
  return (
    <>
      <ScreenStage screen={screen} src={screenSrc} mode={screen.mode} background="#0c0e14" radius={unit * 1.2} />
      {screen.mode === 'with-camera' ? (
        <div style={{position: 'absolute', left: cam.x, top: cam.y, width: cam.w, height: cam.h, overflow: 'hidden', borderRadius: unit * 1.6, boxShadow: `0 ${unit}px ${unit * 3}px rgba(0,0,0,0.35)`}}>
          <OffthreadVideo src={src} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        </div>
      ) : null}
    </>
  );
};
