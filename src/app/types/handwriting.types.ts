/**
 * Type definitions for handwriting recognition
 */

export interface StrokeFeatures {
  strokeCount: number;
  hasHorizontal: boolean;
  hasVertical: boolean;
  hasDiagonal: boolean;
  hasCurves: boolean;
  centerX: number;
  centerY: number;
}

export interface CharacterPattern {
  character: string;
  features: Partial<StrokeFeatures>;
  confidence: number;
}

export interface CharacterMatch {
  character: string;
  confidence: number;
  alternatives: string[];
}

export interface RecognitionResult {
  character: string | null;
  confidence: number;
  alternatives: string[];
}


