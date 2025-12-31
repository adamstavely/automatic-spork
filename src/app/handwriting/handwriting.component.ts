import { Component, ViewChild, ElementRef, AfterViewInit, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, switchMap } from 'rxjs/operators';
import { of, forkJoin, firstValueFrom } from 'rxjs';
import { DictionaryService, DictionaryEntry } from '../dictionary.service';
import { HandwritingRecognitionService } from '../handwriting-recognition.service';
import { SettingsService } from '../settings.service';

interface Point {
  x: number;
  y: number;
}

interface DrawAheadMatch {
  character: string;
  pinyin: string;
  definitions: string[];
  confidence: number;
}

@Component({
  selector: 'app-handwriting',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './handwriting.component.html',
  styleUrls: ['./handwriting.component.css']
})
export class HandwritingComponent implements AfterViewInit, OnInit {
  @ViewChild('canvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private isDrawing = false;
  private currentPath: Point[] = [];
  private allPaths: Point[][] = [];
  private drawAheadTimer: any = null;
  
  recognizedCharacter = '';
  dictionaryEntries: DictionaryEntry[] = [];
  isLoading = false;
  recognitionError: string | null = null;
  recognitionAlternatives: string[] = [];
  recognitionConfidence: number | null = null;
  strokeTolerance = 0.1; // Tolerance for stroke order mistakes
  
  // Draw-ahead recognition
  drawAheadMatches: DrawAheadMatch[] = [];
  isRecognizingDrawAhead = false;
  
  fontSize: 'small' | 'large' = 'large';
  showSimplified = true;

  constructor(
    private dictionaryService: DictionaryService,
    private recognitionService: HandwritingRecognitionService,
    private settingsService: SettingsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.fontSize = this.settingsService.getFontSize();
    this.showSimplified = this.settingsService.getShowSimplified();
    
    this.settingsService.getFontSize$().subscribe(size => {
      this.fontSize = size;
    });
    
    this.settingsService.getShowSimplified$().subscribe(show => {
      this.showSimplified = show;
    });
  }

  ngAfterViewInit() {
    this.canvas = this.canvasRef.nativeElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.setupCanvas();
  }

  private setupCanvas() {
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  onMouseDown(event: MouseEvent) {
    this.isDrawing = true;
    const point = this.getPointFromEvent(event);
    this.currentPath = [point];
    this.ctx.beginPath();
    this.ctx.moveTo(point.x, point.y);
  }

  onMouseMove(event: MouseEvent) {
    if (!this.isDrawing) return;
    
    const point = this.getPointFromEvent(event);
    this.currentPath.push(point);
    this.ctx.lineTo(point.x, point.y);
    this.ctx.stroke();
  }

  onMouseUp() {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.allPaths.push([...this.currentPath]);
      this.currentPath = [];
      
      // Trigger draw-ahead recognition after stroke completion
      if (this.allPaths.length > 0) {
        this.scheduleDrawAheadRecognition();
      }
    }
  }

  onTouchStart(event: TouchEvent) {
    event.preventDefault();
    const touch = event.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    this.onMouseDown(mouseEvent);
  }

  onTouchMove(event: TouchEvent) {
    event.preventDefault();
    const touch = event.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    this.onMouseMove(mouseEvent);
  }

  onTouchEnd(event: TouchEvent) {
    event.preventDefault();
    this.onMouseUp();
  }

  private getPointFromEvent(event: MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  get strokeCount(): number {
    return this.allPaths.length;
  }

  clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.allPaths = [];
    this.currentPath = [];
    this.recognizedCharacter = '';
    this.dictionaryEntries = [];
    this.recognitionError = null;
    this.recognitionAlternatives = [];
    this.recognitionConfidence = null;
    this.drawAheadMatches = [];
    
    // Clear any pending draw-ahead recognition
    if (this.drawAheadTimer) {
      clearTimeout(this.drawAheadTimer);
      this.drawAheadTimer = null;
    }
  }

  private scheduleDrawAheadRecognition() {
    // Clear existing timer
    if (this.drawAheadTimer) {
      clearTimeout(this.drawAheadTimer);
    }
    
    // Schedule recognition after 250ms debounce
    this.drawAheadTimer = setTimeout(() => {
      this.recognizeDrawAhead();
    }, 250);
  }

  private async recognizeDrawAhead() {
    if (this.isRecognizingDrawAhead || this.allPaths.length === 0) {
      return;
    }

    this.isRecognizingDrawAhead = true;
    
    try {
      // Convert paths to stroke format for recognition
      // HanziLookup expects strokes as arrays of [x, y] pairs: [[x, y], [x, y], ...]
      const strokes: number[][][] = this.allPaths.map(path => {
        return path.map(point => [point.x, point.y] as [number, number]);
      });
      
      // Get multiple recognition candidates (increased to 300 to catch characters like 大 that rank lower)
      // 大 was found at rank 145, so we need to capture more results
      // Pass canvas for image-based recognition
      const results = await firstValueFrom(
        this.recognitionService.recognizeDrawAhead(strokes, this.canvas, 300).pipe(
          catchError(() => of([]))
        )
      );
      
      if (results && results.length > 0) {
        // Quick check: verify 大 exists in dictionary
        this.dictionaryService.lookupCharacter('大').subscribe(entries => {
          console.log('[Recognition] Dictionary lookup test for 大:', {
            found: entries.length > 0,
            entryCount: entries.length,
            firstEntry: entries.length > 0 ? {
              simplified: entries[0].simplified,
              pinyin: entries[0].pinyin,
              definitions: entries[0].definitions.slice(0, 2)
            } : null
          });
        });
        
        console.log('[Recognition] Processing recognition results for dictionary lookup:', {
          totalResults: results.length,
          characters: results.map(r => r.character).slice(0, 20)
        });
        
        // Look up dictionary entries for each character
        const lookupPromises = results.map(result => {
          if (!result.character) return null;
          return firstValueFrom(
            this.dictionaryService.lookupCharacter(result.character).pipe(
              catchError(() => of([])),
              switchMap(entries => {
                if (entries && entries.length > 0) {
                  const entry = entries[0];
                  return of({
                    character: result.character!,
                    pinyin: entry.pinyin,
                    definitions: entry.definitions,
                    confidence: result.confidence
                  } as DrawAheadMatch);
                } else {
                  // Log when dictionary lookup fails
                  console.log(`[Recognition] Character ${result.character} filtered out - no dictionary entry (confidence: ${Math.round(result.confidence * 100)}%)`);
                  // Show character even without dictionary entry (with placeholder info)
                  return of({
                    character: result.character!,
                    pinyin: '?',
                    definitions: ['No dictionary entry available'],
                    confidence: result.confidence
                  } as DrawAheadMatch);
                }
              })
            )
          );
        });
        
        const matches = await Promise.all(lookupPromises);
        // Filter out null results
        // Don't sort - preserve HanziLookup's original ranking (by score, ascending - lower = better)
        const validMatches = matches.filter((match): match is DrawAheadMatch => match !== null);
        
        console.log('[Recognition] Final matches after dictionary lookup:', {
          totalMatches: validMatches.length,
          characters: validMatches.map(m => m.character).slice(0, 20),
          daInResults: validMatches.findIndex(m => m.character === '大') !== -1 ? 'YES' : 'NO'
        });
        
        // Preserve original order from recognition service (HanziLookup ranking by score)
        this.drawAheadMatches = validMatches;
      } else {
        this.drawAheadMatches = [];
      }
    } catch (error) {
      // Don't show errors for partial recognition - it's expected
      this.drawAheadMatches = [];
    } finally {
      this.isRecognizingDrawAhead = false;
    }
  }

  async recognizeCharacter() {
    if (this.allPaths.length === 0) {
      this.recognitionError = 'Please draw a character first';
      return;
    }

    this.isLoading = true;
    this.recognitionError = null;
    this.recognizedCharacter = '';
    this.dictionaryEntries = [];
    this.recognitionConfidence = null;
    
    try {
      // Convert paths to stroke format for recognition
      // HanziLookup expects strokes as arrays of [x, y] pairs: [[x, y], [x, y], ...]
      const strokes: number[][][] = this.allPaths.map(path => {
        return path.map(point => [point.x, point.y] as [number, number]);
      });
      
      // Try to recognize the character from the canvas with stroke data
      const result = await firstValueFrom(
        this.recognitionService.recognizeFromCanvas(this.canvas, strokes).pipe(
          catchError(() => of({ character: null, confidence: 0, alternatives: [] }))
        )
      );
      
      if (result) {
        // Always store confidence score
        this.recognitionConfidence = result.confidence;
        
        // Store alternatives for user selection
        this.recognitionAlternatives = result.alternatives || [];
        
        if (result.character) {
          // Character recognized (even with low confidence)
          this.recognizedCharacter = result.character;
          await this.lookupCharacter(this.recognizedCharacter);
          
          // If confidence is low, show message about alternatives
          if (result.confidence < 0.5 && this.recognitionAlternatives.length > 0) {
            this.recognitionError = 'Low confidence recognition. Try alternatives below if this is incorrect.';
          } else {
            this.recognitionError = null;
          }
        } else if (this.recognitionAlternatives.length > 0) {
          // No primary match but we have alternatives
          this.recognitionError = 'Could not recognize with high confidence. Please select from alternatives below or try drawing again.';
        } else {
          // Try alternative recognition methods
          const browserResult = await this.recognitionService.recognizeWithBrowserAPI(this.canvas);
          if (browserResult && browserResult.character) {
            this.recognizedCharacter = browserResult.character;
            this.recognitionConfidence = browserResult.confidence;
            this.recognitionAlternatives = browserResult.alternatives || [];
            await this.lookupCharacter(this.recognizedCharacter);
          } else {
            // Try image analysis
            const analysisResult = await this.recognitionService.recognizeWithImageAnalysis(this.canvas);
            if (analysisResult && analysisResult.character) {
              this.recognizedCharacter = analysisResult.character;
              this.recognitionConfidence = analysisResult.confidence;
              this.recognitionAlternatives = analysisResult.alternatives || [];
              await this.lookupCharacter(this.recognizedCharacter);
            } else {
              // Recognition failed - show message to user
              this.recognitionError = 'Unable to recognize the character. Please try drawing more clearly, or enter the character manually below.';
              this.recognitionConfidence = 0;
            }
          }
        }
      }
    } catch (error) {
      this.recognitionError = 'An error occurred during recognition. Please try again or enter the character manually.';
      this.recognitionConfidence = 0;
    } finally {
      this.isLoading = false;
    }
  }

  async lookupCharacter(character: string) {
    this.isLoading = true;
    try {
      const entries = await firstValueFrom(this.dictionaryService.lookupCharacter(character));
      this.dictionaryEntries = entries || [];
    } catch (error) {
      this.dictionaryEntries = [];
    } finally {
      this.isLoading = false;
    }
  }

  onCharacterInput(character: string) {
    if (character) {
      this.recognizedCharacter = character;
      this.recognitionError = null;
      this.recognitionAlternatives = [];
      this.recognitionConfidence = null; // Manual input has no confidence score
      this.lookupCharacter(character);
    } else {
      this.recognizedCharacter = '';
      this.dictionaryEntries = [];
      this.recognitionAlternatives = [];
      this.recognitionConfidence = null;
    }
  }

  selectAlternative(character: string) {
    this.recognizedCharacter = character;
    this.recognitionError = null;
    // Keep existing confidence when selecting alternative
    this.lookupCharacter(character);
  }

  onCharacterClick(character: string) {
    this.router.navigate(['/character', character]);
  }

  onDrawAheadMatchClick(match: DrawAheadMatch) {
    // Navigate to character details page
    this.router.navigate(['/character', match.character]);
  }

  getDisplayCharacter(entry: DictionaryEntry): string {
    return this.showSimplified ? entry.simplified : entry.traditional;
  }

  getFontSizeClass(): string {
    return this.fontSize === 'small' ? 'chinese-font-small' : 'chinese-font-large';
  }

  getConfidenceColor(): string {
    if (this.recognitionConfidence === null) {
      return '#666';
    }
    if (this.recognitionConfidence >= 0.7) {
      return '#28a745'; // Green for high confidence
    } else if (this.recognitionConfidence >= 0.4) {
      return '#ffc107'; // Yellow for medium confidence
    } else {
      return '#dc3545'; // Red for low confidence
    }
  }

  getConfidenceText(): string {
    if (this.recognitionConfidence === null) {
      return '';
    }
    return `${Math.round(this.recognitionConfidence * 100)}%`;
  }

  getConfidenceColorForValue(confidence: number): string {
    if (confidence >= 0.7) {
      return '#28a745'; // Green for high confidence
    } else if (confidence >= 0.4) {
      return '#ffc107'; // Yellow for medium confidence
    } else {
      return '#dc3545'; // Red for low confidence
    }
  }

  getConfidencePercentage(confidence: number): number {
    return Math.round(confidence * 100);
  }

  runDiagnostic(): void {
    console.log('Starting diagnostic test...');
    this.recognitionService.testDaVariants();
  }
}
