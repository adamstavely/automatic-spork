import { Component, ViewChild, ElementRef, AfterViewInit, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { DictionaryService, DictionaryEntry } from '../dictionary.service';
import { HandwritingRecognitionService } from '../handwriting-recognition.service';
import { SettingsService } from '../settings.service';

interface Point {
  x: number;
  y: number;
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
  
  recognizedCharacter = '';
  dictionaryEntries: DictionaryEntry[] = [];
  isLoading = false;
  recognitionError: string | null = null;
  recognitionAlternatives: string[] = [];
  strokeTolerance = 0.1; // Tolerance for stroke order mistakes
  
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

  clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.allPaths = [];
    this.currentPath = [];
    this.recognizedCharacter = '';
    this.dictionaryEntries = [];
    this.recognitionError = null;
    this.recognitionAlternatives = [];
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
    
    try {
      // Convert paths to stroke format for recognition
      const strokes = this.allPaths.map(path => {
        const stroke: number[] = [];
        path.forEach(point => {
          stroke.push(point.x, point.y);
        });
        return stroke;
      });
      
      // Try to recognize the character from the canvas with stroke data
      const result = await this.recognitionService.recognizeFromCanvas(this.canvas, strokes).pipe(
        catchError(() => of({ character: null, confidence: 0, alternatives: [] }))
      ).toPromise();
      
      if (result) {
        // Store alternatives for user selection
        this.recognitionAlternatives = result.alternatives || [];
        
        if (result.character) {
          // Character recognized (even with low confidence)
          this.recognizedCharacter = result.character;
          await this.lookupCharacter(this.recognizedCharacter);
          
          // If confidence is low, show alternatives
          if (result.confidence < 0.5 && this.recognitionAlternatives.length > 0) {
            this.recognitionError = `Low confidence recognition (${Math.round(result.confidence * 100)}%). Try alternatives below if this is incorrect.`;
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
            this.recognitionAlternatives = browserResult.alternatives || [];
            await this.lookupCharacter(this.recognizedCharacter);
          } else {
            // Try image analysis
            const analysisResult = await this.recognitionService.recognizeWithImageAnalysis(this.canvas);
            if (analysisResult && analysisResult.character) {
              this.recognizedCharacter = analysisResult.character;
              this.recognitionAlternatives = analysisResult.alternatives || [];
              await this.lookupCharacter(this.recognizedCharacter);
            } else {
              // Recognition failed - show message to user
              this.recognitionError = 'Unable to recognize the character. Please try drawing more clearly, or enter the character manually below.';
            }
          }
        }
      }
    } catch (error) {
      console.error('Recognition error:', error);
      this.recognitionError = 'An error occurred during recognition. Please try again or enter the character manually.';
    } finally {
      this.isLoading = false;
    }
  }

  async lookupCharacter(character: string) {
    this.isLoading = true;
    try {
      const entries = await this.dictionaryService.lookupCharacter(character).toPromise();
      this.dictionaryEntries = entries || [];
    } catch (error) {
      console.error('Lookup error:', error);
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
      this.lookupCharacter(character);
    } else {
      this.recognizedCharacter = '';
      this.dictionaryEntries = [];
      this.recognitionAlternatives = [];
    }
  }

  selectAlternative(character: string) {
    this.recognizedCharacter = character;
    this.recognitionError = null;
    this.lookupCharacter(character);
  }

  onCharacterClick(character: string) {
    this.router.navigate(['/character', character]);
  }

  getDisplayCharacter(entry: DictionaryEntry): string {
    return this.showSimplified ? entry.simplified : entry.traditional;
  }

  getFontSizeClass(): string {
    return this.fontSize === 'small' ? 'chinese-font-small' : 'chinese-font-large';
  }
}

