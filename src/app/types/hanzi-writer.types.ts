/**
 * Type definitions for HanziWriter library
 */

export interface HanziWriterOptions {
  width?: number;
  height?: number;
  padding?: number;
  strokeColor?: string;
  strokeWidth?: number;
  radicalColor?: string;
  strokeAnimationSpeed?: number;
  delayBetweenStrokes?: number;
  delayBetweenLoops?: number;
  showOutline?: boolean;
  showCharacter?: boolean;
  charColor?: string;
  outlineColor?: string;
}

export interface HanziWriterInstance {
  animateCharacter: (options?: { onComplete?: () => void }) => void;
  animate: (options?: { onComplete?: () => void }) => void;
  showCharacter: (show?: boolean) => void;
  hideCharacter: () => void;
  showOutline: (show?: boolean) => void;
  hideOutline: () => void;
  setColor: (color: string) => void;
  setStrokeColor: (color: string) => void;
  setRadicalColor: (color: string) => void;
  quiz: (options?: any) => void;
  cancelQuiz: () => void;
  cancel?: () => void;
  updateColor: (color: string) => void;
}

export interface HanziWriterStatic {
  create: (element: HTMLElement | string, character: string, options?: HanziWriterOptions) => HanziWriterInstance;
  loadCharacterData: (character: string, callback: (data: any) => void) => void;
}


