import { Injectable } from '@angular/core';
import * as tf from '@tensorflow/tfjs';
import { Observable, of, from } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { RecognitionResult } from './types/handwriting.types';

@Injectable({
  providedIn: 'root'
})
export class TensorflowRecognitionService {
  private model: tf.LayersModel | null = null;
  private modelLoading = false;
  private modelReady = false;
  private modelUrl: string | null = null;
  
  // Model configuration
  private readonly INPUT_SIZE = 64; // 64x64 input image
  private readonly NUM_CLASSES = 3755; // Common Chinese characters (GB2312 set)
  
  constructor() {
    // Model will be loaded on first use
  }

  /**
   * Set the model URL/path for loading
   * If not set, will use a placeholder that returns empty results
   * 
   * Model requirements:
   * - Input: Grayscale image tensor [1, 64, 64, 1] (normalized 0-1)
   * - Output: Probability distribution over character classes
   * - Character set: Should match NUM_CLASSES (3755 for GB2312, or custom)
   * 
   * To acquire a model:
   * 1. Train using CASIA-HWDB dataset
   * 2. Convert existing model to TensorFlow.js format
   * 3. Use pre-trained model from research papers
   * 
   * Example usage:
   *   tensorflowService.setModelUrl('/assets/models/chinese-handwriting/model.json');
   *   tensorflowService.setCharacterMapping((index) => {
   *     // Map index to Unicode character
   *     return String.fromCharCode(0x4E00 + index);
   *   });
   */
  setModelUrl(url: string): void {
    this.modelUrl = url;
    this.modelReady = false;
    this.model = null;
  }

  /**
   * Check if model is ready for inference
   */
  isReady(): boolean {
    return this.modelReady && this.model !== null;
  }

  /**
   * Load the TensorFlow.js model
   * For now, this is a placeholder - actual model needs to be acquired/trained
   */
  async loadModel(): Promise<boolean> {
    if (this.modelReady && this.model !== null) {
      return true;
    }

    if (this.modelLoading) {
      // Wait for ongoing load
      while (this.modelLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.modelReady;
    }

    this.modelLoading = true;

    try {
      if (this.modelUrl) {
        console.log('[TensorFlow] Loading model from:', this.modelUrl);
        this.model = await tf.loadLayersModel(this.modelUrl);
        this.modelReady = true;
        console.log('[TensorFlow] Model loaded successfully');
        return true;
      } else {
        console.warn('[TensorFlow] No model URL set. Recognition will return empty results.');
        console.warn('[TensorFlow] Set model URL using setModelUrl() or train/acquire a model.');
        this.modelReady = false;
        return false;
      }
    } catch (error) {
      console.error('[TensorFlow] Failed to load model:', error);
      this.modelReady = false;
      this.model = null;
      return false;
    } finally {
      this.modelLoading = false;
    }
  }

  /**
   * Convert strokes to image tensor for model input
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  private strokesToImage(strokes: number[][][]): tf.Tensor {
    // Create a temporary canvas
    const canvas = document.createElement('canvas');
    canvas.width = this.INPUT_SIZE;
    canvas.height = this.INPUT_SIZE;
    const ctx = canvas.getContext('2d')!;

    // Clear canvas with white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, this.INPUT_SIZE, this.INPUT_SIZE);

    // Set drawing style
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Get bounding box of all strokes
    const bounds = this.getBoundingBox(strokes);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const maxDim = Math.max(width, height);

    if (maxDim === 0) {
      // No strokes, return blank image
      return tf.browser.fromPixels(canvas).expandDims(0);
    }

    // Calculate scale to fit in canvas with padding
    const padding = 8;
    const availableSize = this.INPUT_SIZE - (2 * padding);
    const scale = availableSize / maxDim;

    // Calculate offset to center
    const offsetX = padding - bounds.minX * scale + (availableSize - width * scale) / 2;
    const offsetY = padding - bounds.minY * scale + (availableSize - height * scale) / 2;

    // Draw strokes
    for (const stroke of strokes) {
      if (stroke.length < 2) continue;

      ctx.beginPath();
      const firstPoint = stroke[0];
      const scaledX = firstPoint[0] * scale + offsetX;
      const scaledY = firstPoint[1] * scale + offsetY;
      ctx.moveTo(scaledX, scaledY);

      for (let i = 1; i < stroke.length; i++) {
        const point = stroke[i];
        const x = point[0] * scale + offsetX;
        const y = point[1] * scale + offsetY;
        ctx.lineTo(x, y);
      }

      ctx.stroke();
    }

    // Convert canvas to tensor
    // Shape: [1, height, width, 3] (RGB)
    const imageTensor = tf.browser.fromPixels(canvas);
    
    // Convert to grayscale and normalize to [0, 1]
    const gray = imageTensor.mean(2).expandDims(2);
    const normalized = gray.div(255.0);
    
    // Add batch dimension: [1, height, width, 1]
    const batched = normalized.expandDims(0);

    // Clean up intermediate tensors
    imageTensor.dispose();
    gray.dispose();

    return batched;
  }

  /**
   * Get bounding box of all strokes
   */
  private getBoundingBox(strokes: number[][][]): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const stroke of strokes) {
      for (const point of stroke) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }
    }

    return { minX, minY, maxX, maxY };
  }

  /**
   * Run inference on strokes and return recognition results
   * Strokes format: [[[x, y], [x, y], ...], [[x, y], [x, y], ...], ...]
   */
  recognize(strokes: number[][][], maxResults: number = 20): Observable<RecognitionResult[]> {
    if (!strokes || strokes.length === 0) {
      return of([]);
    }

    return from(this.recognizeAsync(strokes, maxResults)).pipe(
      catchError(error => {
        console.error('[TensorFlow] Recognition error:', error);
        return of([]);
      })
    );
  }

  /**
   * Async version of recognize
   */
  private async recognizeAsync(strokes: number[][][], maxResults: number): Promise<RecognitionResult[]> {
    // Ensure model is loaded
    const loaded = await this.loadModel();
    if (!loaded || !this.model) {
      console.warn('[TensorFlow] Model not available, returning empty results');
      return [];
    }

    try {
      // Convert strokes to image tensor
      const imageTensor = this.strokesToImage(strokes);

      // Run inference
      const predictions = this.model.predict(imageTensor) as tf.Tensor;
      
      // Get top predictions
      const topK = Math.min(maxResults, this.NUM_CLASSES);
      const { values, indices } = tf.topk(predictions as tf.Tensor1D, topK);

      // Get values and indices as arrays
      const valuesArray = await values.data();
      const indicesArray = await indices.data();

      // Clean up tensors
      imageTensor.dispose();
      predictions.dispose();
      values.dispose();
      indices.dispose();

      // Convert to RecognitionResult array
      // Note: This is a placeholder - actual character mapping needs to be implemented
      // based on the model's output format
      const results: RecognitionResult[] = [];
      
      for (let i = 0; i < Math.min(topK, indicesArray.length); i++) {
        const charIndex = indicesArray[i];
        const confidence = valuesArray[i];
        
        // TODO: Map index to actual character
        // For now, return placeholder
        // This needs to be implemented based on the model's character set
        const character = this.indexToCharacter(charIndex);
        
        if (character) {
          results.push({
            character: character,
            confidence: confidence,
            alternatives: []
          });
        }
      }

      return results;
    } catch (error) {
      console.error('[TensorFlow] Inference error:', error);
      return [];
    }
  }

  /**
   * Map model output index to character
   * This is a placeholder - needs to be implemented based on actual model
   */
  private indexToCharacter(index: number): string | null {
    // Placeholder implementation
    // Actual implementation depends on the model's character set
    // Common approaches:
    // 1. GB2312 encoding (3755 characters)
    // 2. Unicode range mapping
    // 3. Custom character list
    
    // For now, return null to indicate placeholder
    // This will be implemented when we have the actual model
    return null;
  }

  /**
   * Set character mapping for model output
   * This should be called after model is loaded with the character set
   */
  setCharacterMapping(mapping: Map<number, string> | ((index: number) => string | null)): void {
    if (typeof mapping === 'function') {
      this.indexToCharacter = mapping;
    } else {
      this.indexToCharacter = (index: number) => mapping.get(index) || null;
    }
  }
}

